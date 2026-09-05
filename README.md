# Telegram Checker

Telegram Checker is a local Windows and macOS desktop dashboard for preparing, running, monitoring, resuming, reviewing, and exporting durable Telegram phone-number checking jobs.

## First-time setup

After cloning or downloading the repository on Windows, double-click:

```text
setup.bat
```

`setup.bat` is the recommended one-click bootstrap. It checks for Node.js 22+, Python 3.11+, and the project-tested `pnpm` version. When Node.js or Python is missing, it installs them through Windows Package Manager (`winget`). It then installs the Node workspace, creates the isolated Python environment at `telegram-phone-number-checker/.venv`, installs the hash-locked Python runtime/test dependencies, configures the persistent Windows-user `SESSION_SECRET` / `DATABASE_PATH` / `PYTHON_BIN`, and runs the complete validation suite.

If `winget` is unavailable on a machine that is missing Node.js or Python, install/update **App Installer** from Microsoft Store and run `setup.bat` again.

Do not delete or replace `SESSION_SECRET` after Telegram accounts have been added. Existing encrypted credentials and StringSession data depend on that key.

For command-line/automation use, the equivalent project setup remains available as `pnpm desktop:setup` after Node.js/pnpm are installed. `setup.bat --no-pause` runs the one-click bootstrap without the final pause and is useful for automated verification.


## Packaged Windows application

Release builds no longer require the end user to install Node.js, pnpm, or Python. The packaged desktop application contains:

- an Electron Windows shell with its own Node runtime,
- the built React dashboard served by the bundled localhost API,
- native SQLite support,
- a PyInstaller-built `telegram-engine.exe` sidecar containing the Telegram/Telethon runtime.

Build both Windows deliverables with:

```powershell
pnpm desktop:package
```

The build creates:

- `release/windows/Telegram-Checker-Setup-<version>-x64.exe` - NSIS installer with Start Menu/Desktop shortcuts,
- `release/windows/Telegram-Checker-Portable-<version>-x64.exe` - portable executable,
- `release/windows/SHA256SUMS.txt` - SHA-256 checksums.

Before reporting package success, the build launches the unpacked Electron executable in smoke-test mode. That smoke test loads the packaged native SQLite module, starts the localhost API, verifies `/api/healthz`, executes the bundled Telegram engine self-test, and performs a clean shutdown.

On first packaged launch, the application stores its SQLite database under the Electron Windows user-data directory. If a legacy `DATABASE_PATH` and `SESSION_SECRET` from the `start.bat` installation are available, the application migrates the database and preserves the encryption secret so existing Telegram sessions remain readable.

The CI-produced Windows executables are not Authenticode-signed unless a trusted code-signing certificate is explicitly configured for the release environment. Windows SmartScreen may therefore warn on newly downloaded builds even when their SHA-256 checksum matches the published `SHA256SUMS.txt`.

### Production release policy

Windows and macOS package versions must match. `packaging/windows/package.json` and `packaging/macos/package.json` are checked together before a production release can be published.

Platform workflows only build, validate, smoke-test, checksum, and upload temporary GitHub Actions artifacts. The dedicated `Production Release` workflow is the only workflow allowed to publish a versioned GitHub Release. It starts after the macOS workflow succeeds on `main`, waits for the matching Windows CI and Windows Package runs for the exact same commit SHA, downloads all three native artifact sets, verifies their published SHA-256 checksum files, and then creates one immutable tag/release containing:

- Windows x64 Setup and Portable executables,
- macOS Apple Silicon arm64 DMG and ZIP,
- macOS Intel x64 DMG and ZIP,
- Windows Authenticode evidence,
- macOS signing/Gatekeeper/notarization evidence for both architectures,
- per-platform and combined SHA-256 checksum files.

Existing release tags are never moved and existing releases are never overwritten. A later `main` commit with an unchanged version therefore cannot silently replace binaries that users may already have downloaded.

`v1.0.0` remains the original Windows-only release. `v1.1.0` is the first intended unified Windows + macOS release.

Current CI artifacts do not have trusted Windows Authenticode or Apple Developer ID/notarization credentials configured. Windows SmartScreen or macOS Gatekeeper may therefore warn until those production signing credentials are added.

## Packaged macOS application

The macOS package uses the same React dashboard, localhost API, SQLite database model, durable worker lifecycle, and Telethon engine as the Windows application. End users do not need to install Node.js, pnpm, or Python.

Supported macOS runtime:

- macOS 13 Ventura or newer,
- Apple Silicon `arm64`,
- Intel `x64`.

Build and validate on macOS with:

```bash
pnpm desktop:macos:check
pnpm desktop:package:macos
```

The native CI matrix builds each architecture on matching Apple hardware/runner instead of cross-compiling the PyInstaller sidecar or native SQLite module.

Artifacts:

- `Telegram-Checker-<version>-macOS-arm64.dmg` - Apple Silicon installer image,
- `Telegram-Checker-<version>-macOS-arm64.zip` - Apple Silicon archive,
- `Telegram-Checker-<version>-macOS-x64.dmg` - Intel installer image,
- `Telegram-Checker-<version>-macOS-x64.zip` - Intel archive,
- architecture-specific SHA-256 and `MACOS-SIGNING` evidence files.

Packaged application data is stored through Electron's macOS user-data directory, normally under `~/Library/Application Support/Telegram Checker`. The SQLite database and encrypted session-secret record are therefore preserved independently from the DMG/ZIP file.

Every package build must pass a packaged runtime smoke test that starts the bundled app executable, loads native SQLite, starts the localhost API, verifies `/api/healthz`, runs the packaged Telegram engine self-test, and shuts down cleanly.

Current CI builds intentionally skip Developer ID signing and Apple notarization until Apple Developer credentials are configured. Unsigned/non-notarized builds may be blocked by Gatekeeper. The `MACOS-SIGNING-<arch>.txt` file records code-signing, Gatekeeper, and notarization status for each artifact.

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

`desktop:audit` requires internet access and runs `pip-audit` in a separate environment so audit tooling cannot mutate the application virtual environment. `desktop:check` does not rely on vulnerability feeds and is suitable for routine local validation.

GitHub Actions runs the Windows source validation workflow on pushes to `main` / `fix/**` and on pull requests targeting `main`. The Windows Package workflow builds and smoke-tests installer/portable artifacts on feature pushes and pull requests; `v*` tags can publish the validated executables and checksum file as a GitHub Release.
