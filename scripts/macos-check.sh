#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/telegram-phone-number-checker"
VENV="$ROOT/.build/macos-check-venv"
PYTHON="${PYTHON:-python3}"

cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS validation must run on Darwin." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi

if [[ "$(pnpm --version)" != "10.34.5" ]]; then
  echo "pnpm 10.34.5 is required." >&2
  exit 1
fi

export SESSION_SECRET="${SESSION_SECRET:-macos-validation-secret-0123456789abcdef0123456789abcdef}"
export DATABASE_PATH="${DATABASE_PATH:-$ROOT/.build/macos-check.db}"

echo "== Telegram Checker macOS validation =="
echo "Architecture: $(uname -m)"
echo "Node: $(node --version)"
echo "pnpm: $(pnpm --version)"
echo "Python: $($PYTHON --version)"

pnpm install --frozen-lockfile

rm -rf "$VENV"
"$PYTHON" -m venv "$VENV"
VPY="$VENV/bin/python"
"$VPY" -m pip install --disable-pip-version-check --upgrade pip
"$VPY" -m pip install --disable-pip-version-check --require-hashes -r "$PROJECT/requirements-dev.txt"
"$VPY" -m pip install --disable-pip-version-check --no-deps -e "$PROJECT"
export PYTHON_BIN="$VPY"

pnpm --filter @workspace/api-server exec node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.prepare('select 1').get(); db.close(); console.log('better-sqlite3 native binding: ok')"

pushd "$PROJECT" >/dev/null
"$VPY" -m pip check
"$VPY" -c "import telethon, phonenumbers, dotenv, socks, telegram_phone_number_checker"
"$VPY" -m compileall -q telegram_phone_number_checker
"$VPY" -m pytest -q
popd >/dev/null

pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run test:integration
pnpm --filter @workspace/telegram-checker run build

echo "macOS validation completed successfully."
