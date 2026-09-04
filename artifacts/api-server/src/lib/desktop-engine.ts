import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  databasePath,
  db,
  telegramAccounts,
  telegramJobs,
  getDurableJobSettings,
} from "@workspace/db";
import { revealSecret } from "./telegram-crypto";
import { logger } from "./logger";

const pythonRoot = path.resolve(
  import.meta.dirname,
  "../../../telegram-phone-number-checker",
);
const pythonBin = process.env.PYTHON_BIN || "python";
const workerLogDir = path.resolve(path.dirname(databasePath), "logs");
fs.mkdirSync(workerLogDir, { recursive: true });

export type ControlResponse = {
  ok: boolean;
  message?: string;
  errorType?: string;
  [key: string]: unknown;
};

export function runDesktopControl(
  payload: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<ControlResponse> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonBin,
      ["-m", "telegram_phone_number_checker.desktop_control"],
      {
        cwd: pythonRoot,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, DATABASE_PATH: databasePath },
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new Error("Durable engine control command timed out."));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, "utf8") > 2 * 1024 * 1024) {
        child.kill("SIGKILL");
        clearTimeout(timer);
        fail(new Error("Durable engine control output exceeded 2 MB."));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      try {
        const parsed = JSON.parse(stdout || "{}") as ControlResponse;
        if (code !== 0 || !parsed.ok) {
          fail(new Error(parsed.message || "Durable engine command failed."));
          return;
        }
        settled = true;
        resolve(parsed);
      } catch {
        fail(
          new Error(
            `Durable engine returned invalid JSON${stderr ? ": " + stderr : ""}`,
          ),
        );
      }
    });
    child.stdin?.end(JSON.stringify({ ...payload, databasePath }));
  });
}

export type WorkerCredentials = {
  apiId: string;
  apiHash: string;
  phoneNumber: string;
  sessionString: string;
};

const activeWorkers = new Map<string, ReturnType<typeof spawn>>();

export function spawnDurableWorker(
  jobId: string,
  credentials: WorkerCredentials,
  options: { maxAttempts?: number; minRequestInterval?: number; autoResume?: boolean } = {},
): void {
  const existing = activeWorkers.get(jobId);
  if (existing && existing.exitCode === null) return;

  const logPath = path.join(workerLogDir, `worker-${jobId}.log`);
  const rotatedPath = `${logPath}.1`;
  if (fs.existsSync(logPath) && fs.statSync(logPath).size > 10 * 1024 * 1024) {
    fs.rmSync(rotatedPath, { force: true });
    fs.renameSync(logPath, rotatedPath);
  }
  const logFd = fs.openSync(logPath, "a");
  const child = spawn(
    pythonBin,
    ["-m", "telegram_phone_number_checker.desktop_control"],
    {
      cwd: pythonRoot,
      windowsHide: true,
      detached: true,
      stdio: ["pipe", logFd, logFd],
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        MAX_ATTEMPTS: String(options.maxAttempts ?? 3),
        MIN_REQUEST_INTERVAL_SECONDS: String(options.minRequestInterval ?? 1.2),
      },
    },
  );
  fs.closeSync(logFd);
  activeWorkers.set(jobId, child);
  child.once("exit", () => activeWorkers.delete(jobId));
  child.once("error", (error) => {
    activeWorkers.delete(jobId);
    logger.error({ err: error, jobId }, "Durable worker process failed to start");
  });
  child.stdin?.on("error", (error) => {
    // EPIPE can happen when Python exits before consuming the startup payload.
    // The child error/exit path is authoritative; never let the pipe itself
    // become an uncaught EventEmitter error in the API process.
    logger.warn({ err: error, jobId }, "Durable worker input pipe closed");
  });
  const workerPayload = JSON.stringify({
    command: "run",
    jobId,
    databasePath,
    apiId: credentials.apiId,
    apiHash: credentials.apiHash,
    phoneNumber: credentials.phoneNumber,
    sessionString: credentials.sessionString,
    maxAttempts: options.maxAttempts,
    minRequestInterval: options.minRequestInterval,
    autoResume: options.autoResume,
    parentWatch: true,
  });
  child.stdin?.write(`${workerPayload}\n`);
  // Keep stdin OPEN as a liveness pipe: if the API process disappears, the OS
  // closes this pipe and the Python worker self-suspends. Unref the pipe handle
  // so it does not prevent a normal Node process exit.
  const workerStdin = child.stdin as
    | (typeof child.stdin & { unref?: () => void })
    | null;
  workerStdin?.unref?.();
  child.unref();
}

function waitForWorkerExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(value);
    };
    const onExit = () => finish(true);
    // Keep this timer referenced: during application shutdown the worker is
    // detached/unref'ed, so this wait is what keeps Node alive long enough to
    // observe a graceful worker exit before falling back to force termination.
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

export type WorkerShutdownResult = {
  requested: string[];
  graceful: string[];
  forced: string[];
};

export async function suspendActiveWorkers(
  timeoutMs = 10_000,
): Promise<WorkerShutdownResult> {
  const entries = [...activeWorkers.entries()].filter(
    ([, child]) => child.exitCode === null,
  );
  const requested: string[] = [];

  await Promise.all(
    entries.map(async ([jobId]) => {
      try {
        await runDesktopControl({ command: "suspend", jobId }, 5_000);
        requested.push(jobId);
      } catch {
        // A worker may have exited between the activeWorkers snapshot and the
        // control request. The exit wait below is authoritative.
      }
    }),
  );

  const graceful: string[] = [];
  const forced: string[] = [];
  const exits = await Promise.all(
    entries.map(async ([jobId, child]) => ({
      jobId,
      child,
      exited: await waitForWorkerExit(child, timeoutMs),
    })),
  );

  for (const { jobId, child, exited } of exits) {
    if (exited || child.exitCode !== null) {
      graceful.push(jobId);
      continue;
    }
    forced.push(jobId);
    child.kill("SIGKILL");
    await waitForWorkerExit(child, 2_000);
  }

  return { requested, graceful, forced };
}

export async function recoverAndResumeStaleJobs(): Promise<string[]> {
  const recovered = await runDesktopControl({ command: "recover-all" }, 60_000);
  const jobIds = Array.isArray(recovered.jobIds)
    ? recovered.jobIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  for (const jobId of jobIds) {
    const [metadata] = await db
      .select()
      .from(telegramJobs)
      .where(eq(telegramJobs.id, jobId));
    if (!metadata) continue;

    const [account] = await db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.id, metadata.accountId));
    if (!account?.sessionEncrypted || account.status !== "connected") continue;

    const settings = getDurableJobSettings(jobId);
    if (!settings.autoResume) continue;
    spawnDurableWorker(
      jobId,
      {
        apiId: revealSecret(account.apiIdEncrypted),
        apiHash: revealSecret(account.apiHashEncrypted),
        phoneNumber: account.phoneNumber,
        sessionString: revealSecret(account.sessionEncrypted),
      },
      settings,
    );
  }

  return jobIds;
}
