import {
  app as electronApp,
  BrowserWindow,
  safeStorage,
  shell,
} from "electron";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";

type SecretRecord =
  | { version: 1; mode: "safeStorage"; data: string }
  | { version: 1; mode: "plain"; data: string };

let mainWindow: BrowserWindow | null = null;
let httpServer: Server | null = null;
let runtimeCloseDatabase: (() => void) | null = null;
let runtimeSuspendWorkers:
  | ((timeoutMs?: number) => Promise<{
      requested: string[];
      graceful: string[];
      forced: string[];
    }>)
  | null = null;
let shutdownStarted = false;
let allowQuit = false;
const smokeTestMode = process.env.TELEGRAM_CHECKER_SMOKE_TEST === "1";

function devProjectRoot(): string {
  return path.resolve(import.meta.dirname, "../../..");
}

function sessionSecretPath(): string {
  return path.join(electronApp.getPath("userData"), "session-secret.json");
}

function readStoredSecret(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;

  const record = JSON.parse(fs.readFileSync(filePath, "utf8")) as SecretRecord;
  if (record?.version !== 1 || typeof record.data !== "string") {
    throw new Error("Stored Telegram Checker session secret is invalid.");
  }

  if (record.mode === "safeStorage") {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "macOS secure storage is unavailable, so the existing session secret cannot be decrypted.",
      );
    }
    return safeStorage.decryptString(Buffer.from(record.data, "base64"));
  }

  if (record.mode === "plain") return record.data;
  throw new Error("Stored Telegram Checker session secret mode is unsupported.");
}

function persistSecret(filePath: string, secret: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const record: SecretRecord = safeStorage.isEncryptionAvailable()
    ? {
        version: 1,
        mode: "safeStorage",
        data: safeStorage.encryptString(secret).toString("base64"),
      }
    : { version: 1, mode: "plain", data: secret };

  fs.writeFileSync(filePath, JSON.stringify(record), {
    encoding: "utf8",
    mode: 0o600,
  });
}

function ensureSessionSecret(legacySecret: string | undefined): string {
  const filePath = sessionSecretPath();
  const stored = readStoredSecret(filePath);
  if (stored) {
    if (stored.length < 32) {
      throw new Error("Stored SESSION_SECRET is unexpectedly short.");
    }
    return stored;
  }

  const inherited = legacySecret?.trim();
  const secret =
    inherited && inherited.length >= 32
      ? inherited
      : randomBytes(48).toString("base64");
  persistSecret(filePath, secret);
  return secret;
}

async function migrateLegacyDatabase(
  legacyPath: string | undefined,
  targetPath: string,
): Promise<void> {
  if (fs.existsSync(targetPath)) return;
  const source = legacyPath?.trim();
  if (!source) return;

  const resolvedSource = path.resolve(source);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedSource === resolvedTarget || !fs.existsSync(resolvedSource)) return;

  fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });

  const module = await import("better-sqlite3");
  const Database = module.default;
  const sourceDb = new Database(resolvedSource, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await sourceDb.backup(resolvedTarget);
  } finally {
    sourceDb.close();
  }
}

function configurePackagedEnvironment(): {
  databasePath: string;
  staticDir: string;
} {
  const userData = electronApp.getPath("userData");
  const databasePath = path.join(userData, "checker.db");
  const staticDir = electronApp.isPackaged
    ? path.join(process.resourcesPath, "ui")
    : path.join(devProjectRoot(), "artifacts", "telegram-checker", "dist", "public");

  process.env.NODE_ENV = "production";
  process.env.HOST = "127.0.0.1";
  process.env.DESKTOP_APP_MODE = "1";
  process.env.DATABASE_PATH = databasePath;
  process.env.STATIC_DIR = staticDir;

  if (electronApp.isPackaged) {
    process.env.TELEGRAM_ENGINE_EXE = path.join(
      process.resourcesPath,
      "bin",
      "telegram-engine",
    );
    delete process.env.PYTHON_BIN;
  } else if (!process.env.PYTHON_BIN) {
    process.env.PYTHON_BIN = path.join(
      devProjectRoot(),
      "telegram-phone-number-checker",
      ".venv",
      "bin",
      "python",
    );
  }

  return { databasePath, staticDir };
}

async function listen(serverApp: {
  listen: (
    port: number,
    host: string,
    callback: (error?: Error) => void,
  ) => Server;
}): Promise<{ server: Server; origin: string }> {
  return await new Promise((resolve, reject) => {
    const server = serverApp.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Desktop API did not expose a TCP port."));
        return;
      }
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
    server.once("error", reject);
  });
}

async function closeHttpServer(): Promise<void> {
  const server = httpServer;
  httpServer = null;
  if (!server) return;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function shutdownRuntime(): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;

  const forceTimer = setTimeout(() => {
    process.exitCode = 1;
    allowQuit = true;
    electronApp.exit(1);
  }, 25_000);

  try {
    const [, workers] = await Promise.all([
      closeHttpServer(),
      runtimeSuspendWorkers?.(10_000) ??
        Promise.resolve({ requested: [], graceful: [], forced: [] }),
    ]);

    if (workers.forced.length) {
      console.error(
        "Some Telegram workers required forced termination:",
        workers.forced,
      );
      process.exitCode = 1;
    }
  } finally {
    try {
      runtimeCloseDatabase?.();
    } finally {
      clearTimeout(forceTimer);
    }
  }
}

function createMainWindow(origin: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#111827",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(origin)) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void window.loadURL(origin);
  return window;
}

function verifyPackagedEngine(): void {
  const engine = process.env.TELEGRAM_ENGINE_EXE?.trim();
  if (!engine) return;

  const result = spawnSync(engine, ["self-test"], {
        encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Packaged Telegram engine self-test failed: ${result.stderr || result.stdout}`,
    );
  }

  const parsed = JSON.parse(result.stdout || "{}") as { ok?: boolean };
  if (!parsed.ok) {
    throw new Error("Packaged Telegram engine self-test returned unhealthy JSON.");
  }
}

async function runPackagedSmokeTest(origin: string): Promise<void> {
  verifyPackagedEngine();
  const response = await fetch(`${origin}/api/healthz`);
  if (!response.ok) {
    throw new Error(`Packaged API health check failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as { status?: string };
  if (body.status !== "ok") {
    throw new Error("Packaged API health response was unhealthy.");
  }

  await shutdownRuntime();
  allowQuit = true;
  electronApp.exit(0);
}

async function startDesktop(): Promise<void> {
  const legacyDatabasePath = process.env.DATABASE_PATH;
  const legacySessionSecret = process.env.SESSION_SECRET;

  console.info("Telegram Checker desktop startup", {
    platform: process.platform,
    arch: process.arch,
    packaged: electronApp.isPackaged,
    smokeTestMode,
  });

  const { databasePath, staticDir } = configurePackagedEnvironment();
  process.env.SESSION_SECRET = smokeTestMode
    ? legacySessionSecret?.trim() ||
      "macos-packaged-smoke-secret-0123456789abcdef0123456789abcdef"
    : ensureSessionSecret(legacySessionSecret);

  if (!fs.existsSync(staticDir)) {
    throw new Error(`Packaged dashboard assets are missing: ${staticDir}`);
  }
  if (
    electronApp.isPackaged &&
    (!process.env.TELEGRAM_ENGINE_EXE ||
      !fs.existsSync(process.env.TELEGRAM_ENGINE_EXE))
  ) {
    throw new Error("Packaged Telegram engine executable is missing.");
  }

  await migrateLegacyDatabase(legacyDatabasePath, databasePath);

  const [{ default: api }, dbModule, engineModule] = await Promise.all([
    import("../../../artifacts/api-server/src/app"),
    import("../../../lib/db/src/index"),
    import("../../../artifacts/api-server/src/lib/desktop-engine"),
  ]);

  runtimeCloseDatabase = dbModule.closeDatabase;
  runtimeSuspendWorkers = engineModule.suspendActiveWorkers;

  try {
    const recovered = await engineModule.recoverAndResumeStaleJobs();
    if (recovered.length) {
      console.info("Recovered durable jobs:", recovered);
    }
  } catch (error) {
    console.error("Durable job recovery failed during desktop startup:", error);
  }

  const listening = await listen(api);
  httpServer = listening.server;

  if (smokeTestMode) {
    await runPackagedSmokeTest(listening.origin);
    return;
  }

  mainWindow = createMainWindow(listening.origin);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const singleInstance = electronApp.requestSingleInstanceLock();
if (!singleInstance) {
  electronApp.quit();
} else {
  electronApp.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  electronApp.on("window-all-closed", () => {
    electronApp.quit();
  });

  electronApp.on("before-quit", (event) => {
    if (allowQuit) return;
    event.preventDefault();
    if (shutdownStarted) return;

    void shutdownRuntime()
      .catch((error) => {
        console.error("Desktop shutdown failed:", error);
        process.exitCode = 1;
      })
      .finally(() => {
        allowQuit = true;
        electronApp.quit();
      });
  });

  electronApp
    .whenReady()
    .then(startDesktop)
    .catch((error) => {
      console.error("Telegram Checker failed to start:", error);
      allowQuit = true;
      electronApp.exit(1);
    });
}
