import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { CreateTelegramJobBody, UpdateTelegramJobBody } from "@workspace/api-zod";
import {
  db,
  telegramAccounts,
  telegramJobResults,
  telegramJobs,
  type TelegramJob,
  type TelegramJobResult,
} from "@workspace/db";

const router = Router();

function publicJob(job: TelegramJob) {
  return {
    id: job.id,
    accountId: job.accountId,
    name: job.name,
    status: job.status,
    total: job.total,
    processed: job.processed,
    found: job.found,
    notDiscoverable: job.notDiscoverable,
    errors: job.errors,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function publicResult(result: TelegramJobResult) {
  return {
    phone: result.phone,
    status: result.status,
    username: result.username,
    displayName: result.displayName,
    telegramId: result.telegramId,
    lastOnline: result.lastOnline,
    errorMessage: result.errorMessage,
    retryAfterSeconds: result.retryAfterSeconds,
    checkedAt: result.checkedAt.toISOString(),
  };
}

async function findJobWithResults(jobId: string) {
  const [job] = await db.select().from(telegramJobs).where(eq(telegramJobs.id, jobId));
  if (!job) return null;
  const results = await db
    .select()
    .from(telegramJobResults)
    .where(eq(telegramJobResults.jobId, jobId));
  return { ...publicJob(job), results: results.map(publicResult) };
}

router.get("/jobs", async (_req, res) => {
  const jobs = await db
    .select()
    .from(telegramJobs)
    .orderBy(desc(telegramJobs.updatedAt));
  res.json({ jobs: jobs.map(publicJob) });
});

router.post("/jobs", async (req, res) => {
  const parsed = CreateTelegramJobBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Dữ liệu tác vụ không hợp lệ." });
  }

  const account = await db
    .select({ id: telegramAccounts.id })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.id, parsed.data.accountId));
  if (!account.length) {
    return res.status(400).json({ message: "Tài khoản Telegram không còn tồn tại." });
  }

  const uniquePhones = new Set(parsed.data.results.map((result) => result.phone));
  if (uniquePhones.size !== parsed.data.results.length) {
    return res.status(400).json({ message: "Mỗi số điện thoại chỉ được xuất hiện một lần trong tác vụ." });
  }

  const found = parsed.data.results.filter((result) => result.status === "found").length;
  const notDiscoverable = parsed.data.results.filter((result) => result.status === "not_discoverable").length;
  const jobId = randomUUID();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(telegramJobs).values({
      id: jobId,
      accountId: parsed.data.accountId,
      name: parsed.data.name.trim(),
      status: "completed",
      total: parsed.data.results.length,
      processed: parsed.data.results.length,
      found,
      notDiscoverable,
      errors: parsed.data.results.length - found - notDiscoverable,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(telegramJobResults).values(parsed.data.results.map((result) => ({
      id: randomUUID(),
      jobId,
      phone: result.phone,
      status: result.status,
      username: result.username ?? null,
      displayName: result.displayName ?? null,
      telegramId: result.telegramId ?? null,
      lastOnline: result.lastOnline ?? null,
      errorMessage: result.errorMessage ?? null,
      retryAfterSeconds: result.retryAfterSeconds ?? null,
      checkedAt: result.checkedAt,
    })));
  });

  const created = await findJobWithResults(jobId);
  return res.status(201).json(created);
});

router.get("/jobs/:jobId", async (req, res) => {
  const job = await findJobWithResults(req.params.jobId);
  if (!job) return res.status(404).json({ message: "Không tìm thấy tác vụ." });
  return res.json(job);
});

router.patch("/jobs/:jobId", async (req, res) => {
  const parsed = UpdateTelegramJobBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Trạng thái tác vụ không hợp lệ." });

  const [updated] = await db
    .update(telegramJobs)
    .set({ status: parsed.data.status, updatedAt: new Date() })
    .where(eq(telegramJobs.id, req.params.jobId))
    .returning();
  if (!updated) return res.status(404).json({ message: "Không tìm thấy tác vụ." });
  return res.json(publicJob(updated));
});

router.delete("/jobs/:jobId", async (req, res) => {
  const deleted = await db
    .delete(telegramJobs)
    .where(eq(telegramJobs.id, req.params.jobId))
    .returning({ id: telegramJobs.id });
  if (!deleted.length) return res.status(404).json({ message: "Không tìm thấy tác vụ." });
  return res.status(204).send();
});

export default router;