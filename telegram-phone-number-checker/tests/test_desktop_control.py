from pathlib import Path

from telegram_phone_number_checker import desktop_control
from telegram_phone_number_checker.database import Database
from telegram_phone_number_checker.repositories.job_repository import JobRepository


def payload(db_path: Path, **extra):
    return {"databasePath": str(db_path), **extra}


def test_create_job_persists_valid_and_invalid_items(tmp_path: Path):
    db_path = tmp_path / "checker.db"
    result = desktop_control._create(
        payload(
            db_path,
            command="create",
            jobId="job-create",
            name="create test",
            phones=["+84912345678", "invalid-number", "+84912345678"],
            maxAttempts=4,
            defaultRegion="VN",
        )
    )

    assert result == {"jobId": "job-create", "status": "CREATED", "total": 2}
    status = desktop_control._status(payload(db_path, jobId="job-create"))
    assert status["status"] == "CREATED"
    assert status["total"] == 2
    assert status["errors"] == 1
    assert status["pending"] == 1


def test_pause_resume_and_stale_recovery_preserve_checkpoint(tmp_path: Path):
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
