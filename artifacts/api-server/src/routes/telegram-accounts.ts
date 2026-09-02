import { Router } from "express";
import { eq } from "drizzle-orm";
import { randomUUID, createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { db, telegramAccounts, type TelegramAccount } from "@workspace/db";

const router = Router();
const bridgePath = path.resolve(
  import.meta.dirname,
  "../../../telegram-phone-number-checker/telegram_phone_number_checker/api_bridge.py",
);
const encryptionKey = createHash("sha256")
  .update(process.env.SESSION_SECRET ?? "")
  .digest();

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set to manage Telegram sessions.");
}

type BridgeResult = {
  state: "awaiting_code" | "awaiting_2fa" | "connected" | "disconnected" | "error";
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

const accountLocks = new Set<string>();

function protect(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function reveal(value: string): string {
  const [, iv, tag, ciphertext] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

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
    const child = spawn("python", [bridgePath], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Telegram request timed out."));
    }, 90_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Telegram engine is unavailable."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error("Telegram engine exited unexpectedly."));
      try {
        resolve(JSON.parse(stdout.trim()) as BridgeResult);
      } catch {
        reject(new Error("Telegram engine returned an invalid response."));
      }
    });
    child.stdin.end(JSON.stringify(payload));
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
    return res.status(400).json({ message: error instanceof Error ? error.message : "Dữ liệu không hợp lệ." });
  }

  const existing = await db.select().from(telegramAccounts).where(eq(telegramAccounts.phoneNumber, phoneNumber));
  if (existing.length) return res.status(409).json({ message: "Tài khoản này đã được thêm." });

  try {
    const result = await runBridge({ command: "start", apiId, apiHash, phoneNumber });
    if (result.state === "error" || !result.phoneCodeHash || !result.sessionString) {
      throw bridgeError(result);
    }
    const [account] = await db.insert(telegramAccounts).values({
      id: randomUUID(),
      phoneNumber,
      status: "awaiting_code",
      apiIdEncrypted: protect(apiId),
      apiHashEncrypted: protect(apiHash),
      sessionEncrypted: protect(result.sessionString),
      phoneCodeHashEncrypted: protect(result.phoneCodeHash),
      lastError: null,
      updatedAt: new Date(),
    }).returning();
    return res.status(201).json({ account: publicAccount(account), requiresPassword: false });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : "Không thể gửi mã OTP." });
  }
});

router.post("/telegram-accounts/:accountId/login", async (req, res) => {
  const [account] = await db.select().from(telegramAccounts).where(eq(telegramAccounts.id, req.params.accountId));
  if (!account) return res.status(404).json({ message: "Không tìm thấy tài khoản." });
  const code = String(req.body?.code ?? "").trim();
  const password = req.body?.password ? String(req.body.password) : undefined;
  if (!code || code.length < 4) return res.status(400).json({ message: "Nhập mã OTP Telegram." });
  if (!account.sessionEncrypted || !account.phoneCodeHashEncrypted) {
    return res.status(400).json({ message: "Phiên chờ đăng nhập đã hết. Hãy bắt đầu lại." });
  }

  try {
    const result = await runBridge({
      command: "verify",
      apiId: reveal(account.apiIdEncrypted),
      apiHash: reveal(account.apiHashEncrypted),
      phoneNumber: account.phoneNumber,
      code,
      password,
      phoneCodeHash: reveal(account.phoneCodeHashEncrypted),
      sessionString: reveal(account.sessionEncrypted),
    });
    if (result.state === "error") throw bridgeError(result);
    const nextStatus = result.state === "awaiting_2fa" ? "awaiting_2fa" : "connected";
    const [updated] = await db.update(telegramAccounts).set({
      status: nextStatus,
      sessionEncrypted: result.sessionString ? protect(result.sessionString) : account.sessionEncrypted,
      phoneCodeHashEncrypted: nextStatus === "connected" ? null : account.phoneCodeHashEncrypted,
      displayName: result.displayName ?? account.displayName,
      username: result.username ?? account.username,
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(telegramAccounts.id, account.id)).returning();
    return res.json(publicAccount(updated));
  } catch (error) {
    await db.update(telegramAccounts).set({
      status: "failed",
      lastError: error instanceof Error ? error.message : "Đăng nhập thất bại.",
      updatedAt: new Date(),
    }).where(eq(telegramAccounts.id, account.id));
    return res.status(400).json({ message: error instanceof Error ? error.message : "Đăng nhập thất bại." });
  }
});

router.post("/telegram-accounts/:accountId/status", async (req, res) => {
  const [account] = await db.select().from(telegramAccounts).where(eq(telegramAccounts.id, req.params.accountId));
  if (!account) return res.status(404).json({ message: "Không tìm thấy tài khoản." });
  if (account.status === "disabled") return res.json(publicAccount(account));
  if (!account.sessionEncrypted) return res.json(publicAccount(account));
  try {
    const result = await runBridge({
      command: "status",
      apiId: reveal(account.apiIdEncrypted),
      apiHash: reveal(account.apiHashEncrypted),
      sessionString: reveal(account.sessionEncrypted),
    });
    if (result.state === "error") throw bridgeError(result);
    const [updated] = await db.update(telegramAccounts).set({
      status: result.state === "connected" ? "connected" : "disconnected",
      displayName: result.displayName ?? account.displayName,
      username: result.username ?? account.username,
      sessionEncrypted: result.sessionString ? protect(result.sessionString) : account.sessionEncrypted,
      lastCheckedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(telegramAccounts.id, account.id)).returning();
    return res.json(publicAccount(updated));
  } catch (error) {
    const errorCode = (error as Error & { code?: string }).code;
    const rateLimited = errorCode === "FloodWaitError";
    const [updated] = await db.update(telegramAccounts).set({
      status: rateLimited ? "rate_limited" : "failed",
      lastCheckedAt: new Date(),
      lastError: error instanceof Error ? error.message : "Không thể kiểm tra trạng thái.",
      updatedAt: new Date(),
    }).where(eq(telegramAccounts.id, account.id)).returning();
    return res.json(publicAccount(updated));
  }
});

router.post("/telegram-accounts/:accountId/check", async (req, res) => {
  const accountId = req.params.accountId;
  const [account] = await db.select().from(telegramAccounts).where(eq(telegramAccounts.id, accountId));
  if (!account) return res.status(404).json({ message: "Không tìm thấy tài khoản." });
  if (account.status !== "connected" || !account.sessionEncrypted) {
    return res.status(400).json({ message: "Tài khoản chưa ở trạng thái đã kết nối." });
  }
  if (accountLocks.has(accountId)) {
    return res.status(409).json({ message: "Tài khoản đang được dùng cho một tác vụ khác." });
  }
  const rawPhones = req.body?.phones;
  if (!Array.isArray(rawPhones) || rawPhones.length < 1 || rawPhones.length > 1000) {
    return res.status(400).json({ message: "Cần nhập từ 1 đến 1.000 số điện thoại." });
  }
  const phones = [...new Set(rawPhones.map((phone) => String(phone).trim()).filter((phone) => phone.length >= 7))];
  if (!phones.length) return res.status(400).json({ message: "Không có số điện thoại hợp lệ để kiểm tra." });

  accountLocks.add(accountId);
  try {
    const result = await runBridge({
      command: "check",
      apiId: reveal(account.apiIdEncrypted),
      apiHash: reveal(account.apiHashEncrypted),
      sessionString: reveal(account.sessionEncrypted),
      phones,
    });
    if (result.state === "error" || !result.results) throw bridgeError(result);
    const hasRateLimit = result.results.some((item) => item.status === "rate_limited");
    await db.update(telegramAccounts).set({
      status: hasRateLimit ? "rate_limited" : "connected",
      lastCheckedAt: new Date(),
      lastError: hasRateLimit ? "Telegram đang giới hạn tốc độ yêu cầu." : null,
      updatedAt: new Date(),
    }).where(eq(telegramAccounts.id, accountId));
    return res.json({
      accountId,
      results: result.results.map((item) => ({ ...item, checkedAt: new Date().toISOString() })),
    });
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : "Không thể kiểm tra số điện thoại." });
  } finally {
    accountLocks.delete(accountId);
  }
});

router.delete("/telegram-accounts/:accountId", async (req, res) => {
  const deleted = await db.delete(telegramAccounts).where(eq(telegramAccounts.id, req.params.accountId)).returning({ id: telegramAccounts.id });
  if (!deleted.length) return res.status(404).json({ message: "Không tìm thấy tài khoản." });
  return res.status(204).send();
});

export default router;