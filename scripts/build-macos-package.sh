#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGING_DIR="$ROOT/packaging/macos"
RELEASE_DIR="$ROOT/release/macos"
ARCH="${1:-$(node -p "process.arch")}"

cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS package build must run on Darwin." >&2
  exit 1
fi

case "$ARCH" in
  arm64)
    [[ "$(uname -m)" == "arm64" ]] || { echo "arm64 package must be built on Apple Silicon." >&2; exit 1; }
    ;;
  x64)
    [[ "$(uname -m)" == "x86_64" ]] || { echo "x64 package must be built on Intel macOS." >&2; exit 1; }
    ;;
  *)
    echo "Unsupported macOS package architecture: $ARCH" >&2
    exit 1
    ;;
esac

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js 22 or newer is required." >&2
  exit 1
fi

if [[ "$(pnpm --version)" != "10.34.5" ]]; then
  echo "pnpm 10.34.5 is required." >&2
  exit 1
fi

echo "== Telegram Checker macOS package build ($ARCH) =="

pnpm install --frozen-lockfile
pnpm --filter @workspace/telegram-checker run build
bash "$ROOT/scripts/build-python-engine-macos.sh"

rm -rf "$RELEASE_DIR"

pushd "$PACKAGING_DIR" >/dev/null
npm install --no-audit --no-fund --package-lock=false
npm run build
npx electron-builder install-app-deps
npx electron-builder --mac "--$ARCH" --publish never
popd >/dev/null

DMG="$(find "$RELEASE_DIR" -maxdepth 1 -type f -name "Telegram-Checker-*-macOS-${ARCH}.dmg" -print -quit)"
ZIP="$(find "$RELEASE_DIR" -maxdepth 1 -type f -name "Telegram-Checker-*-macOS-${ARCH}.zip" -print -quit)"

if [[ -z "$DMG" || ! -f "$DMG" ]]; then
  echo "DMG artifact was not created for $ARCH." >&2
  exit 1
fi
if [[ -z "$ZIP" || ! -f "$ZIP" ]]; then
  echo "ZIP artifact was not created for $ARCH." >&2
  exit 1
fi

if (( $(stat -f%z "$DMG") < 10000000 )); then
  echo "DMG artifact is unexpectedly small." >&2
  exit 1
fi
if (( $(stat -f%z "$ZIP") < 10000000 )); then
  echo "ZIP artifact is unexpectedly small." >&2
  exit 1
fi

HASH_FILE="$RELEASE_DIR/SHA256SUMS-macOS-${ARCH}.txt"
(
  cd "$RELEASE_DIR"
  shasum -a 256 "$(basename "$DMG")" "$(basename "$ZIP")"
) > "$HASH_FILE"
cat "$HASH_FILE"

bash "$ROOT/scripts/smoke-macos-package.sh"
bash "$ROOT/scripts/check-macos-signing.sh" "$ARCH"

echo "DMG:     $DMG"
echo "ZIP:     $ZIP"
echo "SHA256:  $HASH_FILE"
