from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a consistent SQLite backup.")
    parser.add_argument("--source", default="data/checker.db")
    parser.add_argument("--destination-dir", default="data/backups")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    if not source.exists():
        raise SystemExit(f"SQLite database does not exist: {source}")

    destination_dir = Path(args.destination_dir).resolve()
    destination_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    destination = destination_dir / f"checker-{stamp}.db"

    with sqlite3.connect(source) as src, sqlite3.connect(destination) as dst:
        src.execute("PRAGMA busy_timeout=5000")
        src.backup(dst)
        integrity = dst.execute("PRAGMA quick_check").fetchone()
        if not integrity or integrity[0] != "ok":
            raise RuntimeError(f"Backup integrity check failed: {integrity}")

    print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
