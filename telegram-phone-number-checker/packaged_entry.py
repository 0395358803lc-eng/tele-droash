from __future__ import annotations

import json
import platform
import sys


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("Missing Telegram engine mode.\n")
        return 2

    mode = sys.argv[1].strip().lower()
    if mode == "self-test":
        import phonenumbers
        import socks
        import telethon
        import telegram_phone_number_checker

        sys.stdout.write(
            json.dumps(
                {
                    "ok": True,
                    "python": platform.python_version(),
                    "telethon": getattr(telethon, "__version__", "unknown"),
                    "phonenumbers": getattr(phonenumbers, "__version__", "unknown"),
                    "socks": bool(socks),
                    "package": bool(telegram_phone_number_checker),
                },
                separators=(",", ":"),
            )
        )
        sys.stdout.flush()
        return 0

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
