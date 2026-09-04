import { Router } from "express";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  createTelegramJobMetadataAndSettings,
  getDurableJob,
  getLiveAccountWorker,
  deleteDurableJobSettings,
  telegramAccounts,
  telegramJobs,
  type TelegramAccount,
} from "@workspace/db";
import { CheckTelegramAccountPhonesBody } from "@workspace/api-zod";
import { runDesktopControl, spawnDurableWorker } from "../lib/desktop-engine";
import { protectSecret, revealSecret } from "../lib/telegram-crypto";
import { spawnTelegramPython } from "../lib/python-runtime";

const router = Router();
const accountJobStarts = new Set<string>();

class AccountStartConflictError extends Error {}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAccountWorkerClaim(
  phoneNumber: string,
  jobId: string,
  timeoutMs = 2_000,
): Promise<"claimed" | "busy" | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const worker = getLiveAccountWorker(phoneNumber);
    if (worker?.jobId === jobId) return "claimed";
    if (worker && worker.jobId !== jobId) return "busy";
    await delay(50);
  }
  return "timeout";
}

type BridgeResult = {
  state:
    | "awaiting_code"
    | "awaiting_2fa"
    | "connected"
    | "disconnected"
    | "error";
  phoneCodeHash?: string;
  sessionString?: string;
  displayName?: string | null;
  username?: string | null;
  errorType?: string;
  message?: string;
  results?: BridgeCheckResult[];
};

type BridgeCheckResult = {
  phone: string;
  status: "found" | "not_discoverable" | "error" | "rate_limited";
  username: string | null;
  displayName: string | null;
  telegramId: string | null;
  lastOnline: string | null;
  errorMessage: string | null;
  retryAfterSeconds: number | null;
};

function normalizePhone(value: string): string {
  const phone = value.replace(/[^\d+]/g, "");
  if (!/^\+?[1-9]\d{6,14}$/.test(phone)) {
    throw new Error("Nhập số điện thoại quốc tế hợp lệ, ví dụ +84912345678.");
  }
  return phone.startsWith("+") ? phone : `+${phone}`;
}

function publicAccount(account: TelegramAccount) {
  return {
    id: account.id,
    phoneNumber: account.phoneNumber,
    displayName: account.displayName,
    username: account.username,
    status: account.status,
    lastCheckedAt: account.lastCheckedAt?.toISOString() ?? null,
    lastError: account.lastError,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

function runBridge(payload: Record<string, unknown>): Promise<BridgeResult> {
  return new Promise((resolve, reject) => {
    const child = spawnTelegramPython("api-bridge", {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let stdout = "";
    const maxStdoutBytes = 8 * 1024 * 1024;
    const phoneCount = Array.isArray(payload.phones)
      ? payload.phones.length
      : 0;
    const timeoutMs = Math.min(
      30 * 60_000,
      Math.max(90_000, 60_000 + phoneCount * 3_000),
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Telegram request timed out."));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, "utf8") > maxStdoutBytes) {
        child.kill("SIGKILL");
        clearTimeout(timer);
        reject(
          new Error("Telegram engine response exceeded the safety limit."),
        );
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Telegram engine is unavailable."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(new Error("Telegram engine exited unexpectedly."));
      try {
        resolve(JSON.parse(stdout.trim()) as BridgeResult);
      } catch {
        reject(new Error("Telegram engine returned an invalid response."));
      }
    });
    child.stdin?.end(JSON.stringify(payload));
  });
}

function bridgeError(result: BridgeResult): Error {
  const error = new Error(result.message ?? "Telegram từ chối yêu cầu.");
  (error as Error & { code?: string }).code = result.errorType;
  return error;
}

router.get("/telegram-accounts", async (_req, res) => {
  const accounts = await db.select().from(telegramAccounts);
  res.json({ accounts: accounts.map(publicAccount) });
});

router.post("/telegram-accounts", async (req, res) => {
  const apiId = String(req.body?.apiId ?? "").trim();
  const apiHash = String(req.body?.apiHash ?? "").trim();
  let phoneNumber: string;
  try {
    phoneNumber = normalizePhone(String(req.body?.phoneNumber ?? ""));
    if (!/^\d+$/.test(apiId) || apiHash.length < 16) {
      throw new Error("API ID hoặc API Hash không hợp lệ.");
    }
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : "Dữ liệu không hợp lệ.",
    });
  }

  const existing = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.phoneNumber, phoneNumber));
  if (existing.length)
    return res.status(409).json({ message: "Tài khoản này đã được thêm." });

  try {
    const result = await runBridge({
      command: "start",
      apiId,
      apiHash,
      phoneNumber,
    });
    if (
      result.state === "error" ||
      !result.phoneCodeHash ||
      !result.sessionString
    ) {
      throw bridgeError(result);
    }
    const [account] = await db
      .insert(telegramAccounts)
      .values({
        id: randomUUID(),
        phoneNumber,
        status: "awaiting_code",
        apiIdEncrypted: protectSecret(apiId),
        apiHashEncrypted: protectSecret(apiHash),
        sessionEncrypted: protectSecret(result.sessionString),
        phoneCodeHashEncrypted: protectSecret(result.phoneCodeHash),
        lastError: null,
        updatedAt: new Date(),
      })
      .returning();
    return res
      .status(201)
      .json({ account: publicAccount(account), requiresPassword: false });
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : "Không thể gửi mã OTP.",
    });
  }
});

router.post("/telegram-accounts/:accountId/login", async (req, res) => {
  const [account] = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.id, req.params.accountId));
  if (!account)
    return res.status(404).json({ message: "Không tìm thấy tài khoản." });
  const code = String(req.body?.code ?? "").trim();
  const password = req.body?.password ? String(req.body.password) : undefined;
  if (!code || code.length < 4)
    return res.status(400).json({ message: "Nhập mã OTP Telegram." });
  if (!account.sessionEncrypted || !account.phoneCodeHashEncrypted) {
    return res
      .status(400)
      .json({ message: "Phiên chờ đăng nhập đã hết. Hãy bắt đầu lại." });
  }

  try {
    const result = await runBridge({
      command: "verify",
      apiId: revealSecret(account.apiIdEncrypted),
      apiHash: revealSecret(account.apiHashEncrypted),
      phoneNumber: account.phoneNumber,
      code,
      password,
      phoneCodeHash: revealSecret(account.phoneCodeHashEncrypted),
      sessionString: revealSecret(account.sessionEncrypted),
    });
    if (result.state === "error") throw bridgeError(result);
    const nextStatus =
      result.state === "awaiting_2fa" ? "awaiting_2fa" : "connected";
    const [updated] = await db
      .update(telegramAccounts)
      .set({
        status: nextStatus,
        sessionEncrypted: result.sessionString
          ? protectSecret(result.sessionString)
          : account.sessionEncrypted,
        phoneCodeHashEncrypted:
          nextStatus === "connected" ? null : account.phoneCodeHashEncrypted,
        displayName: result.displayName ?? account.displayName,
        username: result.username ?? account.username,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(telegramAccounts.id, account.id))
      .returning();
    return res.json(publicAccount(updated));
  } catch (error) {
    await db
      .update(telegramAccounts)
      .set({
        status: "failed",
        lastError:
          error instanceof Error ? error.message : "Đăng nhập thất bại.",
        updatedAt: new Date(),
      })
      .where(eq(telegramAccounts.id, account.id));
    return res.status(400).json({
      message: error instanceof Error ? error.message : "Đăng nhập thất bại.",
    });
  }
});

router.post("/telegram-accounts/:accountId/status", async (req, res) => {
  const [account] = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.id, req.params.accountId));
  if (!account)
    return res.status(404).json({ message: "Không tìm thấy tài khoản." });
  if (account.status === "disabled") return res.json(publicAccount(account));
  if (!account.sessionEncrypted) return res.json(publicAccount(account));
  try {
    const result = await runBridge({
      command: "status",
      apiId: revealSecret(account.apiIdEncrypted),
      apiHash: revealSecret(account.apiHashEncrypted),
      sessionString: revealSecret(account.sessionEncrypted),
    });
    if (result.state === "error") throw bridgeError(result);
    const [updated] = await db
      .update(telegramAccounts)
      .set({
        status: result.state === "connected" ? "connected" : "disconnected",
        displayName: result.displayName ?? account.displayName,
        username: result.username ?? account.username,
        sessionEncrypted: result.sessionString
          ? protectSecret(result.sessionString)
          : account.sessionEncrypted,
        lastCheckedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(telegramAccounts.id, account.id))
      .returning();
    return res.json(publicAccount(updated));
  } catch (error) {
    const errorCode = (error as Error & { code?: string }).code;
    const rateLimited = errorCode === "FloodWaitError";
    const [updated] = await db
      .update(telegramAccounts)
      .set({
        status: rateLimited ? "rate_limited" : "failed",
        lastCheckedAt: new Date(),
        lastError:
          error instanceof Error
            ? error.message
            : "Không thể kiểm tra trạng thái.",
        updatedAt: new Date(),
      })
      .where(eq(telegramAccounts.id, account.id))
      .returning();
    return res.json(publicAccount(updated));
  }
});

router.post("/telegram-accounts/:accountId/check", async (req, res) => {
  const accountId = req.params.accountId;
  const [account] = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.id, accountId));
  if (!account)
    return res.status(404).json({ message: "Không tìm thấy tài khoản." });
  if (account.status !== "connected" || !account.sessionEncrypted) {
    return res
      .status(400)
      .json({ message: "Tài khoản chưa ở trạng thái đã kết nối." });
  }

  const parsed = CheckTelegramAccountPhonesBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dữ liệu kiểm tra không hợp lệ." });
  }
  if (parsed.data.phones.length > 1000) {
    return res
      .status(400)
      .json({ message: "Mỗi tác vụ tối đa 1.000 số điện thoại." });
  }

  if (accountJobStarts.has(accountId)) {
    return res.status(409).json({
      message: "Telegram account đang khởi tạo một tác vụ khác. Hãy thử lại sau.",
    });
  }
  const currentWorker = getLiveAccountWorker(account.phoneNumber);
  if (currentWorker) {
    return res.status(409).json({
      message: "Telegram account đang được một durable worker khác sử dụng.",
      activeJobId: currentWorker.jobId,
    });
  }

  accountJobStarts.add(accountId);
  const jobId = randomUUID();
  const jobName = String(
    req.body?.jobName || `Telegram check ${new Date().toLocaleString("vi-VN")}`,
  )
    .trim()
    .slice(0, 120);
  let durableCreated = false;

  try {
    const created = await runDesktopControl({
      command: "create",
      jobId,
      name: jobName,
      phones: parsed.data.phones,
      maxAttempts: parsed.data.maxAttempts,
      defaultRegion: parsed.data.phoneRegion ?? "VN",
    });
    durableCreated = true;

    const maxAttempts = parsed.data.maxAttempts ?? 3;
    const minRequestInterval = parsed.data.minRequestInterval ?? 1.2;
    const phoneRegion = parsed.data.phoneRegion ?? "VN";
    const autoResume = parsed.data.autoResume ?? true;
    const total = Number(created.total ?? parsed.data.phones.length);

    createTelegramJobMetadataAndSettings({
      id: jobId,
      accountId,
      name: jobName,
      total,
      maxAttempts,
      minRequestInterval,
      phoneRegion,
      autoResume,
    });

    const workerBeforeSpawn = getLiveAccountWorker(account.phoneNumber);
    if (workerBeforeSpawn) {
      throw new AccountStartConflictError(
        "Telegram account became busy while this job was being created.",
      );
    }

    spawnDurableWorker(
      jobId,
      {
        apiId: revealSecret(account.apiIdEncrypted),
        apiHash: revealSecret(account.apiHashEncrypted),
        phoneNumber: account.phoneNumber,
        sessionString: revealSecret(account.sessionEncrypted),
      },
      {
        maxAttempts,
        minRequestInterval,
        autoResume,
      },
    );

    const claimState = await waitForAccountWorkerClaim(account.phoneNumber, jobId);
    if (claimState === "busy") {
      throw new AccountStartConflictError(
        "Another durable worker claimed this Telegram account first.",
      );
    }

    try {
      await db
        .update(telegramAccounts)
        .set({
          lastCheckedAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(telegramAccounts.id, accountId));
    } catch (error) {
      req.log?.warn(
        { err: error, accountId, jobId },
        "Failed to update Telegram account activity metadata",
      );
    }

    return res.status(202).json({ accountId, jobId, status: "queued" });
  } catch (error) {
    if (durableCreated) {
      try {
        await runDesktopControl({ command: "delete", jobId });
      } catch (cleanupError) {
        req.log?.error(
          { err: cleanupError, jobId },
          "Failed to compensate durable job creation",
        );
      }
      try {
        deleteDurableJobSettings(jobId);
        await db.delete(telegramJobs).where(eq(telegramJobs.id, jobId));
      } catch (cleanupError) {
        req.log?.error(
          { err: cleanupError, jobId },
          "Failed to compensate Telegram job metadata creation",
        );
      }
    }

    if (error instanceof AccountStartConflictError) {
      return res.status(409).json({
        message: "Telegram account đang được một durable worker khác sử dụng.",
      });
    }
    return res.status(400).json({
      message:
        error instanceof Error
          ? error.message
          : "Không thể tạo tác vụ kiểm tra.",
    });
  } finally {
    accountJobStarts.delete(accountId);
  }
});

router.delete("/telegram-accounts/:accountId", async (req, res) => {
  const accountJobs = await db
    .select({ id: telegramJobs.id })
    .from(telegramJobs)
    .where(eq(telegramJobs.accountId, req.params.accountId));
  const active = accountJobs.find(({ id }) => {
    const job = getDurableJob(id);
    return job && !["COMPLETED", "FAILED", "CANCELLED"].includes(job.status);
  });
  if (active) {
    return res.status(409).json({
      message:
        "Không thể xóa Telegram account khi còn durable job chưa kết thúc.",
    });
  }
  for (const { id } of accountJobs) {
    if (getDurableJob(id))
      await runDesktopControl({ command: "delete", jobId: id });
  }
  const deleted = await db
    .delete(telegramAccounts)
    .where(eq(telegramAccounts.id, req.params.accountId))
    .returning({ id: telegramAccounts.id });
  if (!deleted.length)
    return res.status(404).json({ message: "Không tìm thấy tài khoản." });
  return res.status(204).send();
});

export default router;
