import sqlite3
import threading
from pathlib import Path
from typing import Optional

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;

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

CREATE INDEX IF NOT EXISTS idx_check_items_job_status
ON check_items(job_id, status);

CREATE INDEX IF NOT EXISTS idx_check_items_retry
ON check_items(status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_check_items_normalized
ON check_items(job_id, normalized_phone);

CREATE TABLE IF NOT EXISTS account_runtime_state (
    account_key TEXT PRIMARY KEY,
    blocked_until TEXT,
    last_request_at TEXT,
    last_rate_limit_at TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_worker_state (
    account_key TEXT PRIMARY KEY,
    worker_id TEXT,
    worker_heartbeat_at TEXT,
    worker_lease_until TEXT,
    job_id TEXT,
    updated_at TEXT NOT NULL
);
"""

#: Lightweight, idempotent migrations for databases created before these
#: columns existed. ALTER TABLE ... ADD COLUMN is cheap and safe to re-run is
#: guarded by checking pragma table_info first.
MIGRATIONS = [
    (
        "check_items",
        "in_flight_started_at",
        "ALTER TABLE check_items ADD COLUMN in_flight_started_at TEXT",
    ),
    (
        "check_items",
        "ownership_lost_at",
        "ALTER TABLE check_items ADD COLUMN ownership_lost_at TEXT",
    ),
    (
        "check_items",
        "recovery_after",
        "ALTER TABLE check_items ADD COLUMN recovery_after TEXT",
    ),
    (
        "check_items",
        "processing_token",
        "ALTER TABLE check_items ADD COLUMN processing_token TEXT",
    ),
    (
        "jobs",
        "requested_command",
        "ALTER TABLE jobs ADD COLUMN requested_command TEXT DEFAULT 'NONE'",
    ),
    (
        "jobs",
        "worker_heartbeat_at",
        "ALTER TABLE jobs ADD COLUMN worker_heartbeat_at TEXT",
    ),
    (
        "jobs",
        "worker_id",
        "ALTER TABLE jobs ADD COLUMN worker_id TEXT",
    ),
    (
        "jobs",
        "worker_lease_until",
        "ALTER TABLE jobs ADD COLUMN worker_lease_until TEXT",
    ),
    (
        "jobs",
        "last_error_type",
        "ALTER TABLE jobs ADD COLUMN last_error_type TEXT",
    ),
    (
        "jobs",
        "last_error_message",
        "ALTER TABLE jobs ADD COLUMN last_error_message TEXT",
    ),
    (
        "jobs",
        "pause_requested_at",
        "ALTER TABLE jobs ADD COLUMN pause_requested_at TEXT",
    ),
    (
        "jobs",
        "paused_at",
        "ALTER TABLE jobs ADD COLUMN paused_at TEXT",
    ),
    (
        "jobs",
        "worker_started_at",
        "ALTER TABLE jobs ADD COLUMN worker_started_at TEXT",
    ),
]


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        if self.path.parent:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._run_migrations()
            self._conn.commit()

    def _column_exists(self, table: str, column: str) -> bool:
        cols = self._conn.execute(f"PRAGMA table_info({table})").fetchall()
        return any(c["name"] == column for c in cols)

    def _run_migrations(self) -> None:
        for table, column, ddl in MIGRATIONS:
            try:
                exists = self._column_exists(table, column)
            except Exception:
                exists = True
            if not exists:
                self._conn.execute(ddl)

    def connect(self) -> sqlite3.Connection:
        return self._conn

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._conn.execute(sql, params)
            return cur

    def executemany(self, sql: str, params_list) -> None:
        with self._lock:
            self._conn.executemany(sql, params_list)
            self._conn.commit()

    def commit(self) -> None:
        with self._lock:
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            try:
                self._conn.execute("PRAGMA wal_checkpoint(FULL);")
            except Exception:
                pass
            try:
                self._conn.close()
            except Exception:
                pass
