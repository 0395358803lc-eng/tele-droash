#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$ROOT/release/macos"
SMOKE_ROOT="$ROOT/.build/macos-smoke"

APP_EXEC="$(find "$RELEASE_DIR" -type f -path "*/Telegram Checker.app/Contents/MacOS/Telegram Checker" -print -quit)"
if [[ -z "$APP_EXEC" || ! -x "$APP_EXEC" ]]; then
  echo "Packaged Telegram Checker.app executable was not found." >&2
  exit 1
fi

rm -rf "$SMOKE_ROOT"
mkdir -p "$SMOKE_ROOT/home" "$SMOKE_ROOT/tmp"

echo "Starting packaged macOS runtime smoke test: $APP_EXEC"

python3 - "$APP_EXEC" "$SMOKE_ROOT" <<'PY'
import os
import subprocess
import sys

exe = sys.argv[1]
root = sys.argv[2]
env = os.environ.copy()
env["TELEGRAM_CHECKER_SMOKE_TEST"] = "1"
env["HOME"] = os.path.join(root, "home")
env["TMPDIR"] = os.path.join(root, "tmp")

try:
    result = subprocess.run(
        [exe],
        env=env,
        cwd=os.path.dirname(exe),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=90,
    )
except subprocess.TimeoutExpired as exc:
    print(exc.stdout or "")
    raise SystemExit("Packaged macOS runtime smoke test timed out.")

print(result.stdout or "")
if result.returncode != 0:
    raise SystemExit(f"Packaged macOS runtime smoke test failed with exit code {result.returncode}.")
PY

echo "Packaged macOS runtime smoke test: PASS"
