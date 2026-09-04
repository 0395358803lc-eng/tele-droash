from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

from .config import Config
from .database import Database
from .job_manager import AccountBusyError, JobBusyError, JobController, JobManager
from .models import JobStatus, now_iso
from .phone_utils import PhoneNormalizationError, normalize_phone
from .repositories.job_repository import JobRepository
from .repositories.result_repository import ResultRepository


def _payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    return json.loads(raw or "{}")


def _db(payload: dict[str, Any]) -> Database:
    value = payload.get("databasePath") or os.getenv("DATABASE_PATH") or "data/checker.db"
    return Database(Path(str(value)))


def _emit(value: Any) -> None:
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()


def _create(payload: dict[str, Any]) -> dict[str, Any]:
    db = _db(payload)
    try:
        job_id = str(payload["jobId"])
        name = str(payload.get("name") or f"job_{now_iso()}")
        phones = payload.get("phones") or []
        max_attempts = max(1, min(10, int(payload.get("maxAttempts") or 3)))
        default_region = str(payload.get("defaultRegion") or "VN")

        if not isinstance(phones, list) or not phones:
            raise ValueError("phones must be a non-empty list")

        job_repo = JobRepository(db)
        result_repo = ResultRepository(db)
        if job_repo.get(job_id) is not None:
            raise ValueError(f"Job already exists: {job_id}")

        valid: list[tuple[str, str]] = []
        invalid: list[str] = []
        seen: set[str] = set()
        for value in phones:
            raw = str(value).strip()
            if not raw:
                continue
            try:
                normalized = normalize_phone(raw, default_region=default_region)
            except PhoneNormalizationError:
                invalid.append(raw)
                continue
            if normalized in seen:
                continue
            seen.add(normalized)
            valid.append((raw, normalized))

        total = len(valid) + len(invalid)
        if total == 0:
            raise ValueError("No phone numbers remain after normalization")

        job_repo.create(job_id, name=name, total_items=total)
        for raw, normalized in valid:
            result_repo.insert(job_id, raw, normalized, max_attempts)
        for raw in invalid:
            result_repo.insert_invalid(job_id, raw, max_attempts)
        job_repo.reconcile_stats(job_id)
        return {"jobId": job_id, "status": "CREATED", "total": total}
    finally:
        db.close()


def _status(payload: dict[str, Any]) -> dict[str, Any]:
    db = _db(payload)
    try:
        info = JobController(db).status(str(payload["jobId"]))
        job = JobRepository(db).get(str(payload["jobId"]))
        if job is not None:
            info["last_error_type"] = job.last_error_type
            info["last_error_message"] = job.last_error_message
            info["updated_at"] = job.updated_at
        return info
    finally:
        db.close()


def _results(payload: dict[str, Any]) -> dict[str, Any]:
    db = _db(payload)
    try:
        rows = ResultRepository(db).all_items(str(payload["jobId"]))
        return {"results": rows}
    finally:
        db.close()


def _pause(payload: dict[str, Any]) -> dict[str, Any]:
    db = _db(payload)
    try:
        JobController(db).pause(str(payload["jobId"]))
        return _status_with_db(db, str(payload["jobId"]))
    finally:
        db.close()


def _suspend(payload: dict[str, Any]) -> dict[str, Any]:
    db = _db(payload)
    try:
        JobController(db).suspend(str(payload["jobId"]))
        return _status_with_db(db, str(payload["jobId"]))
    finally:
        db.close()


def _resume(payload: dict[str, Any]) -> dict[str, Any]:
    db = _db(payload)
    try:
        JobController(db).resume(str(payload["jobId"]))
        return _status_with_db(db, str(payload["jobId"]))
    finally:
        db.close()


def _cancel(payload: dict[str, Any]) -> dict[str, Any]:
    db = _db(payload)
    try:
        job_id = str(payload["jobId"])
        repo = JobRepository(db)
        job = repo.get(job_id)
        if job is None:
            raise ValueError(f"Unknown job: {job_id}")
        if job.status in (JobStatus.COMPLETED, JobStatus.CANCELLED):
            return _status_with_db(db, job_id)
        if repo.has_live_worker_lease(job_id):
            repo.set_requested_command(job_id, "CANCEL")
        else:
            repo.update_status(job_id, JobStatus.CANCELLED)
            repo.clear_requested_command(job_id)
        return _status_with_db(db, job_id)
    finally:
        db.close()


def _delete(payload: dict[str, Any]) -> dict[str, Any]:
    db = _db(payload)
    try:
        job_id = str(payload["jobId"])
        repo = JobRepository(db)
        if repo.has_live_worker_lease(job_id):
            raise RuntimeError("Cannot delete a job while its worker lease is active")
        db.execute("DELETE FROM check_items WHERE job_id = ?", (job_id,))
        db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        db.commit()
        return {"deleted": True, "jobId": job_id}
    finally:
        db.close()


def _recover_all(payload: dict[str, Any]) -> dict[str, Any]:
    db = _db(payload)
    try:
        cfg = Config.from_cli(database_path=str(payload.get("databasePath") or os.getenv("DATABASE_PATH") or "data/checker.db"))
        repo = JobRepository(db)
        stale_job_ids = list(repo.list_running_without_worker())
        manager = JobManager(cfg, db)
        for job_id in stale_job_ids:
            asyncio.run(manager.recover(job_id))
        return {"recovered": len(stale_job_ids), "jobIds": stale_job_ids}
    finally:
        db.close()


def _status_with_db(db: Database, job_id: str) -> dict[str, Any]:
    info = JobController(db).status(job_id)
    job = JobRepository(db).get(job_id)
    if job is not None:
        info["last_error_type"] = job.last_error_type
        info["last_error_message"] = job.last_error_message
        info["updated_at"] = job.updated_at
    return info


async def _run_async(payload: dict[str, Any]) -> dict[str, Any]:
    db = _db(payload)
    try:
        api_id = payload.get("apiId") or os.getenv("API_ID")
        api_hash = payload.get("apiHash") or os.getenv("API_HASH")
        phone = payload.get("phoneNumber") or os.getenv("PHONE_NUMBER")
        session_string = payload.get("sessionString") or os.getenv("TELEGRAM_SESSION_STRING")
        if not all((api_id, api_hash, phone, session_string)):
            raise RuntimeError("Durable worker credentials are incomplete")

        cfg = Config.from_cli(
            api_id=api_id,
            api_hash=api_hash,
            api_phone_number=phone,
            database_path=str(payload.get("databasePath") or os.getenv("DATABASE_PATH") or "data/checker.db"),
        )
        cfg.session_string = session_string
        cfg.max_attempts = max(1, min(10, int(payload.get("maxAttempts") or os.getenv("MAX_ATTEMPTS") or 3)))
        interval = payload.get("minRequestInterval") or os.getenv("MIN_REQUEST_INTERVAL_SECONDS")
        if interval is not None:
            cfg.min_request_interval_seconds = max(0.1, float(interval))

        job_id = str(payload["jobId"])
        manager = JobManager(cfg, db)
        try:
            auto_resume = payload.get("autoResume")
            if auto_resume is None:
                auto_resume = cfg.auto_resume
            status = await manager.run(job_id, auto_resume=bool(auto_resume))
        except (AccountBusyError, JobBusyError) as exc:
            JobRepository(db).update_status(job_id, JobStatus.PAUSED)
            JobRepository(db).record_job_error(job_id, type(exc).__name__, str(exc))
            return {"jobId": job_id, "status": "PAUSED", "reason": type(exc).__name__}
        except Exception as exc:
            repo = JobRepository(db)
            current = repo.get(job_id)
            if current is not None and current.status not in (JobStatus.COMPLETED, JobStatus.CANCELLED):
                repo.update_status(job_id, JobStatus.FAILED)
                repo.record_job_error(job_id, type(exc).__name__, str(exc)[:1000])
            return {"jobId": job_id, "status": "FAILED", "reason": type(exc).__name__}
        return {"jobId": job_id, "status": status.value}
    finally:
        db.close()


def main() -> int:
    payload = _payload()
    command = str(payload.get("command") or "")
    handlers = {
        "create": _create,
        "status": _status,
        "results": _results,
        "pause": _pause,
        "suspend": _suspend,
        "resume": _resume,
        "cancel": _cancel,
        "delete": _delete,
        "recover-all": _recover_all,
    }
    try:
        if command == "run":
            result = asyncio.run(_run_async(payload))
        elif command in handlers:
            result = handlers[command](payload)
        else:
            raise ValueError(f"Unknown command: {command}")
        _emit({"ok": True, **result})
        return 0
    except Exception as exc:
        _emit({"ok": False, "errorType": type(exc).__name__, "message": str(exc)[:1000]})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
