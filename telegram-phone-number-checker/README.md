# telegram-phone-number-checker

Python tool to check if phone numbers are connected to Telegram accounts,
retrieving the connected username, name, and ID where available.

This is a local, job-oriented engine built on the original Bellingcat
checker. It adds durable SQLite checkpoints, an accurate retry queue, a
persistent rate-limit manager, pause/resume, crash recovery, and a tested job
lifecycle — so a long run can be interrupted and resumed without losing work
and without ever marking a job complete prematurely.

> ⚠️ **Use a fresh, dedicated Telegram account**, not your personal one.
> Automations may get your account blocked. A fresh account from a residential
> IP (rather than a known VPN/datacenter IP) works best.
>
> This project **deliberately does not** try to evade or bypass Telegram's rate
> limits. It always honors `FloodWait` and never rotates accounts/proxies to
> get around limits.

## Table of contents

1. [Requirements](#requirements)
2. [Installation](#installation)
3. [.env configuration](#env-configuration)
4. [Telegram login](#telegram-login)
5. [Check phone numbers](#check-phone-numbers)
6. [Import from CSV / TXT](#import-from-csv--txt)
7. [Job status](#job-status)
8. [Pause a job](#pause-a-job)
9. [Resume a job](#resume-a-job)
10. [Export results](#export-results)
11. [Database location](#database-location)
12. [Logs](#logs)
13. [Privacy / security](#privacy--security)
14. [Troubleshooting](#troubleshooting)

## Requirements

- Python 3.9+
- A Telegram account with an active phone number
- A Telegram `API_ID` / `API_HASH` from https://my.telegram.org/apps

## Installation

Install from source (this repository):

```bash
git clone <this-repo>
cd telegram-phone-number-checker
pip install -r requirements.txt
pip install -e .
```

Or install the package directly:

```bash
pip install .
```

After installation the `telegram-phone-number-checker` command is on your PATH:

```bash
telegram-phone-number-checker --help
```

For development (tests, linting):

```bash
pip install -r requirements-dev.txt
```

## .env configuration

Create a `.env` file in the project root (never commit it):

```
API_ID=
API_HASH=
PHONE_NUMBER=

DATABASE_PATH=data/checker.db

DEFAULT_PHONE_REGION=VN

MAX_ATTEMPTS=5
BASE_RETRY_DELAY_SECONDS=30
MAX_RETRY_DELAY_SECONDS=3600

MIN_REQUEST_INTERVAL_SECONDS=

AUTO_RESUME=false

WORKER_LEASE_SECONDS=60
LEASE_RENEW_FAILURE_LIMIT=3
LEASE_TAKEOVER_GRACE_SECONDS=0
IN_FLIGHT_RECOVERY_GRACE_SECONDS=60

LOG_LEVEL=INFO
```

| Variable | Purpose |
| --- | --- |
| `API_ID` / `API_HASH` | Telegram application credentials from my.telegram.org |
| `PHONE_NUMBER` | The account used to log in, e.g. `+84912345678` |
| `DATABASE_PATH` | Where the SQLite database lives (default `data/checker.db`) |
| `DEFAULT_PHONE_REGION` | ISO region used to parse numbers without `+` (default `VN`) |
| `MAX_ATTEMPTS` | Max attempts per number before it becomes `PERMANENT_ERROR` |
| `BASE_RETRY_DELAY_SECONDS` | Base exponential-backoff delay for temporary errors |
| `MAX_RETRY_DELAY_SECONDS` | Upper bound for backoff |
| `MIN_REQUEST_INTERVAL_SECONDS` | Optional safety pacing between requests (not a bypass) |
| `WORKER_LEASE_SECONDS` | Seconds a worker's job/account lease stays valid without renewal |
| `LEASE_RENEW_FAILURE_LIMIT` | Consecutive lease-renew failures before the worker fails closed |
| `LEASE_TAKEOVER_GRACE_SECONDS` | Extra wait after expiry before another worker may take over |
| `IN_FLIGHT_RECOVERY_GRACE_SECONDS` | Quarantine before retrying an uncertain in-flight request |
| `AUTO_RESUME` | Resume paused jobs on startup automatically |
| `LOG_LEVEL` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |

All `.env` values can also be passed as CLI options (the env var is the
default). See `telegram-phone-number-checker check --help`.

## Telegram login

The first time you run `check`, the tool connects with the account in
`PHONE_NUMBER`. You will be prompted for the login code that Telegram sends to
that account (and, if enabled, your two-step verification password).

The session is saved to a `*.session` file (e.g. `+84912345678.session`) so
later runs authenticate automatically.

## Check phone numbers

`check` creates a job, checks the numbers, persists progress, and finishes
the job when **every** number has a terminal result.

```bash
# one or more comma-separated numbers
telegram-phone-number-checker check --phone-numbers +84911111111,+84922222222

# override credentials / other settings for this run
telegram-phone-number-checker check \
    --api-id YOUR_API_ID \
    --api-hash YOUR_API_HASH \
    --api-phone-number +84912345678 \
    --phone-numbers +84911111111

# resume an existing job by ID
telegram-phone-number-checker check --job-id <job_id>
```

Possible per-number results:

1. **`FOUND`** — the number is connected to a Telegram account. Username, name,
   ID, and last-online status are stored and exported.
2. **`NOT_DISCOVERABLE`** — no user was returned. This covers both "the number
   has no Telegram account" and "the user restricts discovery by phone number".
   The tool never claims it is definitely "not on Telegram".
3. **`RETRY_REQUIRED`** — Telegram asked us to retry this contact later.
4. **`RATE_LIMITED`** — a `FloodWait` occurred; the tool waits out the cooldown.
5. **`TEMPORARY_ERROR`** — a transient network/RPC error; retried with backoff.
6. **`PERMANENT_ERROR`** — e.g. invalid phone (never sent to Telegram) or
   retries exhausted.

## Import from CSV / TXT

Create a job by importing a file. One number per line (TXT), or comma-separated
values (CSV). Numbers are normalized, deduplicated, and invalid ones are
recorded as `PERMANENT_ERROR` instead of being sent to Telegram.

```bash
telegram-phone-number-checker import numbers.txt --job-name "batch-1"
# -> Imported N unique phone numbers into job <job_id>
```

## Job status

```bash
telegram-phone-number-checker job status <job_id>
```

Shows status, totals, found, not-discoverable, retry queue, and error counts.

## Pause a job

Pause is safe: the currently in-flight request may finish, but no new numbers
are picked up. The pause request is persisted in the database, so a running
worker (in any process) honors it.

```bash
telegram-phone-number-checker job pause <job_id>
```

## Resume a job

```bash
telegram-phone-number-checker job resume <job_id>
```

This sets the job back to `RUNNING`. To actually continue working, run a worker
for the job:

```bash
telegram-phone-number-checker check --job-id <job_id>
```

A job is only `COMPLETED` when 100% of its numbers are terminal — it is never
marked complete while a future retry is still pending.

## Export results

```bash
telegram-phone-number-checker export <job_id> results.json --format json
telegram-phone-number-checker export <job_id> results.csv --format csv
```

Exports all numbers with their final status and (for `FOUND`) the captured
Telegram metadata. You can also pass `--output results.json` to `check` to
export automatically after a run.

## Database location

By default everything is stored in SQLite at `data/checker.db`
(override with `DATABASE_PATH`). The database holds:

- `jobs` — job metadata, lifecycle status, pause commands, heartbeat, errors
- `check_items` — one row per number (the checkpoint), with status, attempt
  count, retry time, and result data
- `account_runtime_state` — the persisted FloodWait cooldown

Because every number is its own checkpoint, a crash or restart only re-picks
numbers that were `PENDING` / due for `RETRY_REQUIRED` / `TEMPORARY_ERROR` /
`IN_FLIGHT_UNKNOWN` after its recovery grace. A `PROCESSING` item left by a
dead owner is first quarantined as `IN_FLIGHT_UNKNOWN`; it is never immediately
retried. Completed (`FOUND` / `NOT_DISCOVERABLE` / `PERMANENT_ERROR`) numbers
are never re-checked. Each active claim carries a unique `processing_token`,
which fences late writes from an old worker after takeover.

## Logs

The tool emits structured JSON logs to stdout, e.g.:

```json
{"timestamp":"...","level":"INFO","logger":"...","event":"PHONE_CHECK_STARTED","job_id":"...","item_id":1,"phone":"+8491****5678","attempt":1}
```

Phones are masked in logs and no credentials are ever logged.

## Privacy / security

- **Never** commit `.env`, `*.session`, `*.session-journal`, `*.db`, or
  `logs/` — they are git-ignored.
- Phones are masked (`+8491****5678`) in logs.
- `API_ID`, `API_HASH`, `PHONE_NUMBER`, OTP codes, passwords, session contents,
  and tokens are never written to logs.
- The release/release-builder refuses to ship `.env`, `.session`, or `.db`.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `Enter the code` at startup | First-time login; enter the code sent to your `PHONE_NUMBER`. |
| Login code exhausted / invalid | Re-run; Telegram sends a new code. |
| Job stays `PAUSED` | A previous run was paused. `job resume` then `check --job-id`. |
| `Job ... already has a live worker` | Another process is running it; pause or wait. |
| `FloodWait` / long wait | Telegram rate limit. The tool honors it and resumes automatically. |
| Numbers all `NOT_DISCOVERABLE` | They may have no account or block number-search (cannot be distinguished). |
| Job never reaches `COMPLETED` | A number is still retrying; wait for retries, or `job pause` then inspect. |

## Development

```bash
pip install -r requirements-dev.txt
pytest
```

This project uses [poetry](https://python-poetry.org/) for packaging; the
`pyproject.toml` is the source of truth for dependencies, and
`requirements*.txt` are kept in sync for pip-only workflows.
