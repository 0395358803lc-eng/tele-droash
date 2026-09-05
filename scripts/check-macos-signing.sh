#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$ROOT/release/macos"
ARCH="${1:-$(node -p "process.arch")}"
OUT="$RELEASE_DIR/MACOS-SIGNING-${ARCH}.txt"

APP="$(find "$RELEASE_DIR" -type d -name "Telegram Checker.app" -print -quit)"
if [[ -z "$APP" ]]; then
  echo "Telegram Checker.app was not found for signing inspection." >&2
  exit 1
fi

SIGN_STATUS="Unsigned"
if codesign --verify --deep --strict "$APP" >/tmp/telegram-checker-codesign.out 2>&1; then
  SIGN_STATUS="Valid"
fi
SIGN_DETAILS="$(codesign -dv --verbose=4 "$APP" 2>&1 || true)"

GATEKEEPER_STATUS="Rejected"
GATEKEEPER_DETAILS="$(spctl --assess --type execute --verbose=4 "$APP" 2>&1 || true)"
if spctl --assess --type execute "$APP" >/dev/null 2>&1; then
  GATEKEEPER_STATUS="Accepted"
fi

NOTARIZATION_STATUS="NotStapled"
NOTARIZATION_DETAILS="$(xcrun stapler validate "$APP" 2>&1 || true)"
if xcrun stapler validate "$APP" >/dev/null 2>&1; then
  NOTARIZATION_STATUS="Stapled"
fi

{
  echo "Telegram Checker macOS signing status"
  echo "Architecture=$ARCH"
  echo "CodeSigning=$SIGN_STATUS"
  echo "Gatekeeper=$GATEKEEPER_STATUS"
  echo "Notarization=$NOTARIZATION_STATUS"
  echo
  echo "[codesign]"
  echo "$SIGN_DETAILS"
  echo
  echo "[spctl]"
  echo "$GATEKEEPER_DETAILS"
  echo
  echo "[stapler]"
  echo "$NOTARIZATION_DETAILS"
} > "$OUT"

cat "$OUT"

if [[ "${REQUIRE_MACOS_SIGNING:-0}" == "1" ]]; then
  if [[ "$SIGN_STATUS" != "Valid" || "$GATEKEEPER_STATUS" != "Accepted" || "$NOTARIZATION_STATUS" != "Stapled" ]]; then
    echo "A signed, Gatekeeper-accepted, notarized build is required." >&2
    exit 1
  fi
fi

echo "macOS signing evidence: $OUT"
