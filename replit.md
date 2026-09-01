# Telegram Checker

Telegram Checker is a browser dashboard for preparing, monitoring, reviewing, and exporting Telegram phone-number checking jobs.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/telegram-checker run dev` — run the dashboard through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/telegram-checker/` — React/Vite dashboard at the root preview path
- `artifacts/telegram-checker/src/hooks/use-sandbox.ts` — browser-local job/settings state and JSON/CSV export helpers
- `artifacts/telegram-checker/src/pages/` — overview, jobs, and settings screens
- `telegram-phone-number-checker/` — extracted Python 1.3.2 engine and its original CLI documentation
- `lib/api-spec/openapi.yaml` — shared API contract (currently health-only; dashboard is intentionally local sandbox until the Python engine is connected)

## Architecture decisions

- The first UI pass is explicitly sandboxed: sample records are labeled as sample data and no Telegram credentials are stored in the browser.
- Job and safety settings persist in browser local storage so the interface can be explored without a database or live Telegram account.
- The original Python engine is kept intact under `telegram-phone-number-checker/` rather than rewritten into the frontend.

## Product

- Overview dashboard with workspace metrics, active run controls, recent jobs, safety posture, and export actions.
- Searchable job ledger with progress breakdowns, privacy-aware result states, pause/resume, deletion confirmation, and JSON/CSV export.
- Settings screen for connection readiness, phone region, retry ceiling, request interval, auto-resume, and restoring sample data.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The dashboard is not a live Telegram connection yet; configure and connect the Python engine before treating results as operational data.
- Vite build commands require workflow-provided `PORT` and `BASE_PATH`; use the managed web workflow for preview.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
