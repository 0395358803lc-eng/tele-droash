import { createHash } from "node:crypto";
import { sqlite } from "./sqlite-handle";

export type DurableJobRow = {
  id: string;
  name: string | null;
  status: string;
  total_items: number;
  processed_items: number;
  found_items: number;
  failed_items: number;
  not_discoverable_items: number;
  last_error_type: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type DurableResultRow = {
  id: number;
  job_id: string;
  original_phone: string;
  normalized_phone: string | null;
  status: string;
  telegram_user_id: number | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  user_was_online: string | null;
  last_error_type: string | null;
  last_error_message: string | null;
  next_retry_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type DurableJobSettings = {
  maxAttempts: number;
  minRequestInterval: number;
  phoneRegion: string;
  autoResume: boolean;
};

export type LiveAccountWorker = {
  jobId: string | null;
  leaseUntil: string;
};

export type TelegramJobMetadataInput = {
  id: string;
  accountId: string;
  name: string;
  total: number;
  maxAttempts: number;
  minRequestInterval: number;
  phoneRegion: string;
  autoResume: boolean;
};

function accountKeyFromPhone(phoneNumber: string): string {
  return createHash("sha256").update(phoneNumber, "utf8").digest("hex").slice(0, 16);
}

export function getLiveAccountWorker(
  phoneNumber: string,
): LiveAccountWorker | undefined {
  const row = sqlite
    .prepare(
      `SELECT job_id, worker_lease_until
       FROM account_worker_state
       WHERE account_key = ?`,
    )
    .get(accountKeyFromPhone(phoneNumber)) as
    | { job_id: string | null; worker_lease_until: string | null }
    | undefined;

  if (!row?.worker_lease_until) return undefined;
  const leaseUntilMs = Date.parse(row.worker_lease_until);
  if (!Number.isFinite(leaseUntilMs) || leaseUntilMs <= Date.now()) {
    return undefined;
  }
  return { jobId: row.job_id, leaseUntil: row.worker_lease_until };
}

export function createTelegramJobMetadataAndSettings(
  input: TelegramJobMetadataInput,
): void {
  const now = Date.now();
  const write = sqlite.transaction(() => {
    sqlite
      .prepare(
        `INSERT INTO telegram_jobs (
          id, account_id, name, status, total, processed, found,
          not_discoverable, errors, max_attempts, min_request_interval,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'queued', ?, 0, 0, 0, 0, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.accountId,
        input.name,
        input.total,
        input.maxAttempts,
        input.minRequestInterval,
        now,
        now,
      );

    sqlite
      .prepare(
        `INSERT INTO desktop_job_settings (
          job_id, max_attempts, min_request_interval, phone_region, auto_resume
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.maxAttempts,
        input.minRequestInterval,
        input.phoneRegion,
        input.autoResume ? 1 : 0,
      );
  });
  write();
}

export function getDurableJob(jobId: string): DurableJobRow | undefined {
  return sqlite.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as
    DurableJobRow | undefined;
}

export function listDurableJobs(): DurableJobRow[] {
  return sqlite
    .prepare("SELECT * FROM jobs ORDER BY created_at DESC")
    .all() as DurableJobRow[];
}

export function listDurableResults(jobId: string): DurableResultRow[] {
  return sqlite
    .prepare(
      `
    SELECT id, job_id, original_phone, normalized_phone, status,
           telegram_user_id, username, first_name, last_name, user_was_online,
           last_error_type, last_error_message, next_retry_at, completed_at, updated_at
    FROM check_items WHERE job_id = ?\n      AND status NOT IN ('PENDING','PROCESSING','IN_FLIGHT_UNKNOWN') ORDER BY id\n  `,
    )
    .all(jobId) as DurableResultRow[];
}

export function saveDurableJobSettings(
  jobId: string,
  settings: DurableJobSettings,
): void {
  sqlite
    .prepare(
      `
    INSERT INTO desktop_job_settings (job_id, max_attempts, min_request_interval, phone_region, auto_resume)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      max_attempts = excluded.max_attempts,
      min_request_interval = excluded.min_request_interval,
      phone_region = excluded.phone_region,
      auto_resume = excluded.auto_resume
  `,
    )
    .run(jobId, settings.maxAttempts, settings.minRequestInterval, settings.phoneRegion, settings.autoResume ? 1 : 0);
}

export function getDurableJobSettings(jobId: string): DurableJobSettings {
  const row = sqlite
    .prepare(
      `
    SELECT max_attempts, min_request_interval, phone_region, auto_resume FROM desktop_job_settings WHERE job_id = ?
  `,
    )
    .get(jobId) as
    { max_attempts: number; min_request_interval: number; phone_region: string; auto_resume: number } | undefined;
  return {
    maxAttempts: row?.max_attempts ?? 3,
    minRequestInterval: row?.min_request_interval ?? 1.2,
    phoneRegion: row?.phone_region ?? "VN",
    autoResume: Boolean(row?.auto_resume ?? 1),
  };
}

export function deleteDurableJobSettings(jobId: string): void {
  sqlite
    .prepare("DELETE FROM desktop_job_settings WHERE job_id = ?")
    .run(jobId);
}
