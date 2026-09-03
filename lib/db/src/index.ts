import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { databasePath } from "./path";
import { sqlite } from "./sqlite-handle";

// Desktop-safe bootstrap. The web metadata tables and the Python durable
// worker tables intentionally coexist in one SQLite database.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS telegram_accounts (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL UNIQUE,
  display_name TEXT,
  username TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  api_id_encrypted TEXT NOT NULL,
  api_hash_encrypted TEXT NOT NULL,
  session_encrypted TEXT,
  phone_code_hash_encrypted TEXT,
  last_checked_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  total INTEGER NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0,
  found INTEGER NOT NULL DEFAULT 0,
  not_discoverable INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  min_request_interval REAL NOT NULL DEFAULT 1.2,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES telegram_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS telegram_jobs_account_id_idx ON telegram_jobs(account_id);
CREATE INDEX IF NOT EXISTS telegram_jobs_updated_at_idx ON telegram_jobs(updated_at);


CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT NOT NULL,
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  found_items INTEGER DEFAULT 0,
  retry_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  not_discoverable_items INTEGER DEFAULT 0,
  requested_command TEXT DEFAULT 'NONE',
  worker_heartbeat_at TEXT,
  worker_id TEXT,
  worker_lease_until TEXT,
  last_error_type TEXT,
  last_error_message TEXT,
  pause_requested_at TEXT,
  paused_at TEXT,
  worker_started_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS check_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  original_phone TEXT NOT NULL,
  normalized_phone TEXT,
  status TEXT NOT NULL,
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  next_retry_at TEXT,
  last_error_type TEXT,
  last_error_message TEXT,
  telegram_user_id INTEGER,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  user_was_online TEXT,
  cleanup_error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  in_flight_started_at TEXT,
  ownership_lost_at TEXT,
  recovery_after TEXT,
  processing_token TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(job_id) REFERENCES jobs(id)
);
CREATE INDEX IF NOT EXISTS idx_check_items_job_status ON check_items(job_id, status);
CREATE INDEX IF NOT EXISTS idx_check_items_retry ON check_items(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_check_items_normalized ON check_items(job_id, normalized_phone);

CREATE TABLE IF NOT EXISTS account_runtime_state (
  account_key TEXT PRIMARY KEY,
  blocked_until TEXT,
  last_request_at TEXT,
  last_rate_limit_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS desktop_job_settings (
  job_id TEXT PRIMARY KEY,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  min_request_interval REAL NOT NULL DEFAULT 1.2,
  phone_region TEXT NOT NULL DEFAULT 'VN',
  auto_resume INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_worker_state (
  account_key TEXT PRIMARY KEY,
  worker_id TEXT,
  worker_heartbeat_at TEXT,
  worker_lease_until TEXT,
  job_id TEXT,
  updated_at TEXT NOT NULL
);
`);

const telegramJobColumns = new Set(
  (sqlite.pragma("table_info(telegram_jobs)") as Array<{ name: string }>).map(
    (row) => row.name,
  ),
);
if (!telegramJobColumns.has("max_attempts")) {
  sqlite.exec(
    "ALTER TABLE telegram_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3",
  );
}
if (!telegramJobColumns.has("min_request_interval")) {
  sqlite.exec(
    "ALTER TABLE telegram_jobs ADD COLUMN min_request_interval REAL NOT NULL DEFAULT 1.2",
  );
}

const desktopSettingsColumns = new Set(
  (sqlite.pragma("table_info(desktop_job_settings)") as Array<{ name: string }>).map(
    (row) => row.name,
  ),
);
if (!desktopSettingsColumns.has("phone_region")) {
  sqlite.exec(
    "ALTER TABLE desktop_job_settings ADD COLUMN phone_region TEXT NOT NULL DEFAULT 'VN'",
  );
}
if (!desktopSettingsColumns.has("auto_resume")) {
  sqlite.exec(
    "ALTER TABLE desktop_job_settings ADD COLUMN auto_resume INTEGER NOT NULL DEFAULT 1",
  );
}

export { databasePath };
export const db = drizzle(sqlite, { schema });

export function checkDatabaseHealth(): { ok: boolean; detail: string } {
  try {
    const row = sqlite.pragma("quick_check", { simple: true });
    const ok = row === "ok";
    return { ok, detail: String(row) };
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof Error ? error.message : "SQLite health check failed",
    };
  }
}

export function checkpointDatabase(): void {
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
}

export function closeDatabase(): void {
  if (!sqlite.open) return;
  try {
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    sqlite.close();
  }
}

export * from "./schema";
export * from "./durable";
