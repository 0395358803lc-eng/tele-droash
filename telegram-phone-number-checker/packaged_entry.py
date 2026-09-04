from __future__ import annotations

import sys


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("Missing Telegram engine mode.\n")
        return 2

    mode = sys.argv[1].strip().lower()
    if mode == "desktop-control":
        from telegram_phone_number_checker.desktop_control import main as control_main

        return int(control_main())

    if mode == "api-bridge":
        from telegram_phone_number_checker.api_bridge import main as bridge_main

        bridge_main()
        return 0

    sys.stderr.write(f"Unknown Telegram engine mode: {mode}\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
