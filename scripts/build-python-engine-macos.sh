#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$ROOT/telegram-phone-number-checker"
RELEASE_DIR="$ROOT/release/python-macos"
WORK_DIR="$ROOT/.build/pyinstaller-macos"
VENV="$WORK_DIR/.venv"
PYTHON="${PYTHON:-python3}"
ENGINE="$RELEASE_DIR/telegram-engine"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The macOS Telegram engine must be built on Darwin." >&2
  exit 1
fi

rm -rf "$WORK_DIR" "$RELEASE_DIR"
mkdir -p "$WORK_DIR" "$RELEASE_DIR"

echo "== Building packaged Telegram Python engine for macOS =="

"$PYTHON" -m venv "$VENV"
VPY="$VENV/bin/python"

"$VPY" -m pip install --disable-pip-version-check --upgrade pip
"$VPY" -m pip install --disable-pip-version-check --require-hashes -r "$PROJECT/requirements.txt"
"$VPY" -m pip install --disable-pip-version-check "PySocks==1.7.1" "pyinstaller==6.22.2"
"$VPY" -m pip install --disable-pip-version-check --no-deps -e "$PROJECT"

pushd "$PROJECT" >/dev/null
"$VPY" -m PyInstaller \
  --noconfirm \
  --clean \
  --onefile \
  --name telegram-engine \
  --distpath "$RELEASE_DIR" \
  --workpath "$WORK_DIR/work" \
  --specpath "$WORK_DIR/spec" \
  --paths "$PROJECT" \
  --collect-submodules telethon \
  --collect-submodules phonenumbers \
  --collect-data phonenumbers \
  --hidden-import socks \
  ./packaged_entry.py
popd >/dev/null

if [[ ! -x "$ENGINE" ]]; then
  chmod +x "$ENGINE" 2>/dev/null || true
fi
if [[ ! -x "$ENGINE" ]]; then
  echo "telegram-engine was not created as an executable." >&2
  exit 1
fi

SELF_TEST="$("$ENGINE" self-test)"
python3 - "$SELF_TEST" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload.get("ok") is True, payload
assert payload.get("socks") is True, payload
print("Telegram engine self-test:", json.dumps(payload, separators=(",", ":")))
PY

EXPECTED_ARCH="$(uname -m)"
ENGINE_ARCHS="$(lipo -archs "$ENGINE")"
case "$EXPECTED_ARCH" in
  arm64)
    [[ "$ENGINE_ARCHS" == *"arm64"* ]] || { echo "Expected arm64 engine, got: $ENGINE_ARCHS" >&2; exit 1; }
    ;;
  x86_64)
    [[ "$ENGINE_ARCHS" == *"x86_64"* ]] || { echo "Expected x86_64 engine, got: $ENGINE_ARCHS" >&2; exit 1; }
    ;;
  *)
    echo "Unsupported macOS architecture: $EXPECTED_ARCH" >&2
    exit 1
    ;;
esac

file "$ENGINE"
echo "Telegram engine: $ENGINE"
