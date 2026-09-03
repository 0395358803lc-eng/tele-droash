from pathlib import Path

from telegram_phone_number_checker import desktop_control
from telegram_phone_number_checker.database import Database
from telegram_phone_number_checker.repositories.job_repository import JobRepository


def payload(db_path: Path, **extra):
    return {"databasePath": str(db_path), **extra}


def test_create_job_with_valid_and_invalid_phone(tmp_path: Path):
    db_path = tmp_path / "checker.db"
    result = desktop_control._create(
        payload(
            db_path,
            jobId="job-1",
            name="mixed",
            phones=["+84912345678", "invalid-number"],
            maxAttempts=3,
            defaultRegion="VN",
        )
    )

    assert result["jobId"] == "job-1"
    assert result["total"] == 2

    db = Database(db_path)
    rows = db.execute(
        "SELECT status, last_error_type FROM check_items WHERE job_id = ? ORDER BY id",
        ("job-1",),
    ).fetchall()
    db.close()

    assert [row["status"] for row in rows] == ["PENDING", "PERMANENT_ERROR"]
    assert rows[1]["last_error_type"] == "INVALID_PHONE"


def test_pause_resume_and_stale_recovery(tmp_path: Path):
    db_path = tmp_path / "checker.db"
    desktop_control._create(
        payload(
            db_path,
            jobId="job-recovery",
            name="recovery test",
            phones=["+84912345678"],
            maxAttempts=3,
            defaultRegion="VN",
        )
    )

    paused = desktop_control._pause(payload(db_path, jobId="job-recovery"))
    assert paused["status"] == "PAUSED"

    resumed = desktop_control._resume(payload(db_path, jobId="job-recovery"))
    assert resumed["status"] == "RUNNING"

    recovered = desktop_control._recover_all(payload(db_path))
    assert recovered["recovered"] == 1

    status = desktop_control._status(payload(db_path, jobId="job-recovery"))
    assert status["status"] == "PAUSED"
    assert status["pending"] == 1


def test_delete_refuses_live_worker_lease(tmp_path: Path):
    db_path = tmp_path / "checker.db"
    desktop_control._create(
        payload(
            db_path,
            jobId="job-live",
            name="live lease test",
            phones=["+84912345678"],
            maxAttempts=3,
            defaultRegion="VN",
        )
    )

    db = Database(db_path)
    repo = JobRepository(db)
    assert repo.claim_worker("job-live", "worker-test", 60)
    db.close()

    try:
        desktop_control._delete(payload(db_path, jobId="job-live"))
    except RuntimeError as exc:
        assert "worker lease is active" in str(exc)
    else:
        raise AssertionError("Expected deletion to be blocked while a live worker owns the job")


def test_create_job_uses_consistent_default_max_attempts(tmp_path: Path):
    db_path = tmp_path / "checker.db"
    desktop_control._create(
        payload(
            db_path,
            jobId="job-default-attempts",
            name="default attempts",
            phones=["+84912345678"],
            defaultRegion="VN",
        )
    )

    db = Database(db_path)
    row = db.execute(
        "SELECT max_attempts FROM check_items WHERE job_id = ?",
        ("job-default-attempts",),
    ).fetchone()
    db.close()

    assert row is not None
    assert row["max_attempts"] == 3


def test_invalid_item_uses_consistent_default_max_attempts(tmp_path: Path):
    db_path = tmp_path / "checker.db"
    desktop_control._create(
        payload(
            db_path,
            jobId="job-invalid-default",
            name="invalid default",
            phones=["invalid-number"],
            defaultRegion="VN",
        )
    )

    db = Database(db_path)
    row = db.execute(
        "SELECT max_attempts, status FROM check_items WHERE job_id = ?",
        ("job-invalid-default",),
    ).fetchone()
    db.close()

    assert row is not None
    assert row["max_attempts"] == 3
    assert row["status"] == "PERMANENT_ERROR"


def test_invalid_item_preserves_explicit_job_max_attempts(tmp_path: Path):
    db_path = tmp_path / "checker.db"
    desktop_control._create(
        payload(
            db_path,
            jobId="job-invalid-explicit",
            name="invalid explicit attempts",
            phones=["invalid-number"],
            maxAttempts=1,
            defaultRegion="VN",
        )
    )

    db = Database(db_path)
    row = db.execute(
        "SELECT max_attempts, status FROM check_items WHERE job_id = ?",
        ("job-invalid-explicit",),
    ).fetchone()
    db.close()

    assert row is not None
    assert row["max_attempts"] == 1
    assert row["status"] == "PERMANENT_ERROR"
