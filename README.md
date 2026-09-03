# Telegram Checker

Telegram Checker is a local Windows dashboard for preparing, running, monitoring, resuming, reviewing, and exporting durable Telegram phone-number checking jobs.

## First-time setup

After cloning or downloading the repository on Windows, double-click:

```text
setup.bat
```

`setup.bat` is the recommended one-click bootstrap. It checks for Node.js 20+, Python 3.11+, and the project-tested `pnpm` version. When Node.js or Python is missing, it installs them through Windows Package Manager (`winget`). It then installs the Node workspace, creates the isolated Python environment at `telegram-phone-number-checker/.venv`, installs Python dependencies, configures the persistent Windows-user `SESSION_SECRET` / `DATABASE_PATH` / `PYTHON_BIN`, and runs the complete validation suite.

If `winget` is unavailable on a machine that is missing Node.js or Python, install/update **App Installer** from Microsoft Store and run `setup.bat` again.

Do not delete or replace `SESSION_SECRET` after Telegram accounts have been added. Existing encrypted credentials and StringSession data depend on that key.

For command-line/automation use, the equivalent project setup remains available as `pnpm desktop:setup` after Node.js/pnpm are installed. `setup.bat --no-pause` runs the one-click bootstrap without the final pause and is useful for automated verification.

## Run & operate

- `start.bat` - recommended normal-use launcher after setup; starts the complete local application.
- `pnpm desktop:start` - command-line equivalent; starts the built API and dashboard locally on `127.0.0.1` (`3000` / `5173`).
- `pnpm desktop:dev` - start the local development workflow.
- `pnpm desktop:check` - run Python dependency consistency, Python compile/tests, SQLite integrity, TypeScript typecheck, API build, and frontend build.
- `pnpm desktop:audit` - run online Node and Python dependency security audits.
- `pnpm desktop:backup` - create an integrity-checked SQLite backup under `data/backups/`.
- `pnpm run typecheck` - full TypeScript typecheck across packages.
- `pnpm run build` - typecheck and build all packages.
- `pnpm --filter @workspace/api-spec run codegen` - regenerate the React client and Zod schemas from OpenAPI.

Required desktop environment is normally configured by `desktop:setup`:

- `SESSION_SECRET` - persistent value of at least 32 characters used to encrypt Telegram credentials/session data at rest.
- `DATABASE_PATH` - SQLite database path.
- `PYTHON_BIN` - project `.venv` Python interpreter.

## Stack

- pnpm workspaces, TypeScript 5.9
- Dashboard: React + Vite
- API: Express 5
- Database: SQLite (`better-sqlite3`) + Drizzle ORM
- Durable engine: Python + Telethon
- Validation: OpenAPI, generated Zod schemas, `drizzle-zod`
- API codegen: Orval

## Current architecture

- `artifacts/telegram-checker/` - live dashboard UI.
- `artifacts/api-server/` - localhost API that owns Telegram-account metadata, encrypted sessions, durable job orchestration, and the Python bridge.
- `lib/api-spec/openapi.yaml` - source of truth for the HTTP contract.
- `lib/api-client-react/` and `lib/api-zod/` - generated from OpenAPI; do not hand-edit generated files.
- `lib/db/` - SQLite bootstrap, Drizzle metadata schema, and durable read helpers.
- `telegram-phone-number-checker/` - durable Python worker engine.

The durable execution source of truth is `jobs` + `check_items`. `telegram_jobs` stores dashboard metadata such as account, name, and operational defaults. Older databases may still contain the legacy `telegram_job_results` table for compatibility, but it is not the runtime result source of truth and new databases do not create it.

## Operational settings

Dashboard-created jobs persist these settings in `desktop_job_settings`:

- `maxAttempts` (default 3)
- `minRequestInterval` (default 1.2 seconds, minimum 0.1)
- `phoneRegion` (default `VN`)
- `autoResume` (default enabled in the dashboard)

The same persisted settings are reused when a job is manually resumed or automatically recovered after a stale worker.

## Security boundary

This project is intentionally designed for one-user local use. Runtime scripts bind the API and dashboard to `127.0.0.1`. There is no API-key layer by design; do not expose either port to an untrusted network or public tunnel without adding an authentication boundary.

Telegram API credentials and StringSession values are encrypted server-side with AES-256-GCM using a key derived from `SESSION_SECRET`. They are never returned to the browser.

The project uses an isolated Python `.venv` so unrelated packages installed in the global Python environment cannot affect the checker runtime. `.venv`, runtime databases, worker logs, build outputs, and dependency directories are ignored by Git.

## Consistency rules

- OpenAPI is the HTTP contract source of truth.
- Generated API/Zod files must be regenerated after OpenAPI changes.
- `jobs` / `check_items` are authoritative for durable execution status and results.
- `telegram_jobs` is dashboard metadata only; its counters are compatibility metadata and are not used to calculate displayed progress.
- Public job statuses preserve `rate_limited` and `cancelled` instead of collapsing them into other states.
- `NOT_DISCOVERABLE` means Telegram did not expose a user by phone; it must not be described as proof that the phone has no Telegram account.

## Validation and maintenance

Before treating a change as complete:

```powershell
pnpm desktop:check
pnpm desktop:audit
pnpm desktop:backup
```

`desktop:audit` requires internet access. `desktop:check` does not rely on vulnerability feeds and is suitable for routine local validation.
