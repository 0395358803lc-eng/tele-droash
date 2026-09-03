# Telegram Checker

Telegram Checker is a local Windows dashboard for preparing, running, monitoring, resuming, reviewing, and exporting durable Telegram phone-number checking jobs.

## Run & Operate

- `pnpm desktop:dev` - start the Windows-local API and dashboard development workflow.
- `pnpm desktop:check` - validate required tools, Python syntax/dependencies, TypeScript, API build, and frontend build.
- `pnpm run typecheck` - full TypeScript typecheck across packages.
- `pnpm run build` - typecheck and build all packages.
- `pnpm --filter @workspace/api-spec run codegen` - regenerate the React client and Zod schemas from OpenAPI.
- `pnpm desktop:backup` - create a consistent SQLite backup.

Required desktop environment:

- `SESSION_SECRET` - at least 32 characters; used to encrypt Telegram credentials/session data at rest.
- `DATABASE_PATH` - SQLite database path.
- Optional `PYTHON_BIN`, `HOST`, `PORT`, and engine tuning variables.

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

The durable execution source of truth is `jobs` + `check_items`. `telegram_jobs` stores dashboard metadata such as account, name, and operational defaults. The legacy `telegram_job_results` table may exist in older databases for compatibility but is not the runtime result source of truth.

## Operational settings

Dashboard-created jobs persist these settings in `desktop_job_settings`:

- `maxAttempts` (default 3)
- `minRequestInterval` (default 1.2 seconds, minimum 0.1)
- `phoneRegion` (default `VN`)
- `autoResume` (default enabled in the dashboard)

The same persisted settings are reused when a job is manually resumed or automatically recovered after a stale worker.

## Security boundary

This project is intentionally designed for one-user local use. The development scripts bind the API to `127.0.0.1`. There is no API-key layer by design; do not expose the API port to an untrusted network or public tunnel without adding an authentication boundary.

Telegram API credentials and StringSession values are encrypted server-side with AES-256-GCM using a key derived from `SESSION_SECRET`. They are never returned to the browser.

## Consistency rules

- OpenAPI is the HTTP contract source of truth.
- Generated API/Zod files must be regenerated after OpenAPI changes.
- `jobs` / `check_items` are authoritative for durable execution status and results.
- `telegram_jobs` is dashboard metadata only; its counters are compatibility metadata and are not used to calculate displayed progress.
- Public job statuses preserve `rate_limited` and `cancelled` instead of collapsing them into other states.
- `NOT_DISCOVERABLE` means Telegram did not expose a user by phone; it must not be described as proof that the phone has no Telegram account.

## Validation

Before treating a change as complete, run:

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/telegram-checker run build
cd telegram-phone-number-checker && pytest -q
```
