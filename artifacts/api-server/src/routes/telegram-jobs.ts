import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  getDurableJob,
  getDurableJobSettings,
  listDurableJobs,
  listDurableResults,
  deleteDurableJobSettings,
  telegramAccounts,
  telegramJobs,
} from "@workspace/db";
import { UpdateTelegramJobBody } from "@workspace/api-zod";
import { revealSecret } from "../lib/telegram-crypto";
import { runDesktopControl, spawnDurableWorker } from "../lib/desktop-engine";

const router = Router();

function publicStatus(status: string) {
  switch (status) {
    case "CREATED":
      return "queued";
    case "RUNNING":
      return "running";
    case "RATE_LIMITED":
      return "rate_limited";
    case "PAUSED":
      return "paused";
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "queued";
  }
}

function resultStatus(status: string, errorType: string | null) {
  switch (status) {
    case "FOUND":
      return "found";
    case "NOT_DISCOVERABLE":
      return "not_discoverable";
    case "RATE_LIMITED":
      return "rate_limited";
    case "PERMANENT_ERROR":
      return errorType === "INVALID_PHONE" ? "invalid" : "error";
    default:
      return "error";
  }
}

function resultView(row: ReturnType<typeof listDurableResults>[number]) {
  const displayName =
    [row.first_name, row.last_name].filter(Boolean).join(" ") || null;
  return {
    phone: row.normalized_phone || row.original_phone,
    status: resultStatus(row.status, row.last_error_type),
    username: row.username,
    displayName,
    telegramId:
      row.telegram_user_id == null ? null : String(row.telegram_user_id),
    lastOnline: row.user_was_online,
    errorMessage: row.last_error_message,
    retryAfterSeconds: null,
    checkedAt: row.completed_at || row.updated_at,
  };
}

async function metadataMap() {
  const rows = await db.select().from(telegramJobs);
  return new Map(rows.map((row) => [row.id, row]));
}

function jobView(
  job: ReturnType<typeof getDurableJob> extends infer T
    ? Exclude<T, undefined>
    : never,
  metadata: Awaited<ReturnType<typeof metadataMap>> extends Map<string, infer M>
    ? M
    : never,
) {
  return {
    id: job.id,
    accountId: metadata.accountId,
    name: metadata.name || job.name || "Telegram check",
    status: publicStatus(job.status),
    total: job.total_items,
    processed: job.processed_items,
    found: job.found_items,
    notDiscoverable: job.not_discoverable_items,
    errors: job.failed_items,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

router.get("/jobs", async (_req, res) => {
  const metadata = await metadataMap();
  const jobs = listDurableJobs()
    .filter((job) => metadata.has(job.id))
    .map((job) => jobView(job, metadata.get(job.id)!));
  return res.json({ jobs });
});


router.get("/jobs/:jobId", async (req, res) => {
  const durable = getDurableJob(req.params.jobId);
  if (!durable)
    return res.status(404).json({ message: "Không tìm thấy tác vụ." });
  const [metadata] = await db
    .select()
    .from(telegramJobs)
    .where(eq(telegramJobs.id, req.params.jobId));
  if (!metadata)
    return res.status(404).json({ message: "Không tìm thấy metadata tác vụ." });
  return res.json({
    ...jobView(durable, metadata),
    results: listDurableResults(req.params.jobId).map(resultView),
  });
});

router.patch("/jobs/:jobId", async (req, res) => {
  const parsed = UpdateTelegramJobBody.safeParse(req.body);
  if (!parsed.success || !["running", "paused"].includes(parsed.data.status)) {
    return res
      .status(400)
      .json({ message: "Chỉ hỗ trợ chạy tiếp hoặc tạm dừng durable job." });
  }

  const durable = getDurableJob(req.params.jobId);
  if (!durable)
    return res.status(404).json({ message: "Không tìm thấy tác vụ." });
  const [metadata] = await db
    .select()
    .from(telegramJobs)
    .where(eq(telegramJobs.id, req.params.jobId));
  if (!metadata)
    return res.status(404).json({ message: "Không tìm thấy metadata tác vụ." });

  if (parsed.data.status === "paused") {
    await runDesktopControl({ command: "pause", jobId: req.params.jobId });
  } else {
    if (durable.status === "COMPLETED" || durable.status === "CANCELLED") {
      return res
        .status(409)
        .json({ message: "Tác vụ đã kết thúc và không thể chạy tiếp." });
    }
    try {
      await runDesktopControl({ command: "resume", jobId: req.params.jobId });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Không thể resume tác vụ.";
      if (!message.includes("live worker")) throw error;
      return res.status(409).json({
        message:
          "Worker cũ vẫn đang hoàn tất request. Hãy thử Resume lại sau vài giây.",
      });
    }

    const [account] = await db
      .select()
      .from(telegramAccounts)
      .where(eq(telegramAccounts.id, metadata.accountId));
    if (!account?.sessionEncrypted || account.status !== "connected") {
      return res
        .status(409)
        .json({ message: "Telegram account của tác vụ không còn kết nối." });
    }
    const settings = getDurableJobSettings(req.params.jobId);
    spawnDurableWorker(
      req.params.jobId,
      {
        apiId: revealSecret(account.apiIdEncrypted),
        apiHash: revealSecret(account.apiHashEncrypted),
        phoneNumber: account.phoneNumber,
        sessionString: revealSecret(account.sessionEncrypted),
      },
      settings,
    );
  }

  const current = getDurableJob(req.params.jobId)!;
  return res.json(jobView(current, metadata));
});

router.delete("/jobs/:jobId", async (req, res) => {
  const durable = getDurableJob(req.params.jobId);
  if (!durable)
    return res.status(404).json({ message: "Không tìm thấy tác vụ." });
  if (["RUNNING", "RATE_LIMITED"].includes(durable.status)) {
    await runDesktopControl({ command: "cancel", jobId: req.params.jobId });
    return res.status(409).json({
      message:
        "Đã yêu cầu dừng worker. Hãy xóa lại tác vụ sau khi worker giải phóng lease.",
    });
  }
  await runDesktopControl({ command: "delete", jobId: req.params.jobId });
  deleteDurableJobSettings(req.params.jobId);
  await db.delete(telegramJobs).where(eq(telegramJobs.id, req.params.jobId));
  return res.status(204).send();
});

export default router;
