import asyncio
from pathlib import Path

import pytest

from telegram_phone_number_checker.checkpoint import CheckpointManager
from telegram_phone_number_checker.config import Config
from telegram_phone_number_checker.database import Database
from telegram_phone_number_checker.job_manager import JobController, JobManager, JobPausedError
from telegram_phone_number_checker.models import CheckStatus, JobStatus, iso_from_offset
from telegram_phone_number_checker.rate_limiter import RateLimitManager, account_key_from_phone
from telegram_phone_number_checker.repositories.job_repository import JobRepository
from telegram_phone_number_checker.repositories.result_repository import ResultRepository
from telegram_phone_number_checker.retry_queue import RetryQueue
from telegram_phone_number_checker.worker import AccountBusyError, JobBusyError, Worker


class NeverConnectTelegram:
    def __init__(self):
        self.connected = False

    async def connect(self):
        self.connected = True
        raise AssertionError("Telegram must not be contacted in this test")

    async def disconnect(self):
        return None

    async def check_phone(self, phone: str, client_id: int = 0):
        raise AssertionError("Telegram must not be contacted in this test")


def make_worker(db: Database, phone: str, lease_seconds: int = 60) -> Worker:
    job_repo = JobRepository(db)
    result_repo = ResultRepository(db)
    telegram = NeverConnectTelegram()
    checkpoint = CheckpointManager(result_repo)
    retry = RetryQueue(result_repo, max_attempts=3, base_delay=1, max_delay=10)
    rate = RateLimitManager(0.1, db=db, account_key=account_key_from_phone(phone))
    return Worker(
        telegram,
        result_repo,
        checkpoint,
        retry,
        rate,
        job_repo=job_repo,
        account_key=account_key_from_phone(phone),
        lease_seconds=lease_seconds,
    )


def test_second_worker_cannot_claim_same_live_job(tmp_path: Path):
    db = Database(tmp_path / "checker.db")
    repo = JobRepository(db)
    repo.create("job-a", "A", 0)

    first = make_worker(db, "+84900000001")
    second = make_worker(db, "+84900000002")
    first.claim("job-a")

    with pytest.raises(JobBusyError):
        second.claim("job-a")

    assert repo.is_job_owned_by("job-a", first.worker_id)
    first.release()
    db.close()


def test_same_account_cannot_run_two_jobs_and_failed_claim_rolls_back_job(tmp_path: Path):
    db = Database(tmp_path / "checker.db")
    repo = JobRepository(db)
    repo.create("job-a", "A", 0)
    repo.create("job-b", "B", 0)
    phone = "+84900000003"

    first = make_worker(db, phone)
    second = make_worker(db, phone)
    first.claim("job-a")

    with pytest.raises(AccountBusyError):
        second.claim("job-b")

    assert repo.is_job_owned_by("job-a", first.worker_id)
    assert not repo.has_live_worker_lease("job-b")
    first.release()
    db.close()


def test_old_owner_result_write_is_rejected_after_takeover(tmp_path: Path):
    db = Database(tmp_path / "checker.db")
    jobs = JobRepository(db)
    results = ResultRepository(db)
    jobs.create("job-fence", "fence", 1)
    item = results.insert("job-fence", "+84900000004", "+84900000004", 3)

    assert jobs.claim_worker("job-fence", "old-worker", 60)
    token = results.mark_processing(item.id, "job-fence", "old-worker")
    assert token

    # Simulate the old worker dying and its lease expiring, then a successor takeover.
    db.execute(
        "UPDATE jobs SET worker_lease_until = ? WHERE id = ?",
        (iso_from_offset(-5), "job-fence"),
    )
    db.commit()
    assert jobs.claim_worker("job-fence", "new-worker", 60)

    written = results.save_result(
        item.id,
        CheckStatus.FOUND,
        attempt_count=1,
        completed=True,
        processing_token=token,
        job_id="job-fence",
        worker_id="old-worker",
    )
    assert written is False

    current = results.get(item.id)
    assert current is not None
    assert current.status == CheckStatus.PROCESSING
    assert current.processing_token == token
    db.close()


def test_in_flight_quarantine_blocks_reprocessing_until_grace_expires(tmp_path: Path):
    db = Database(tmp_path / "checker.db")
    jobs = JobRepository(db)
    results = ResultRepository(db)
    jobs.create("job-quarantine", "quarantine", 1)
    item = results.insert("job-quarantine", "+84900000007", "+84900000007", 3)
    assert jobs.claim_worker("job-quarantine", "worker-old", 60)
    token = results.mark_processing(item.id, "job-quarantine", "worker-old")
    assert token

    assert results.mark_in_flight_unknown(item.id, token, iso_from_offset(60))
    quarantined = results.get(item.id)
    assert quarantined is not None
    assert quarantined.status == CheckStatus.IN_FLIGHT_UNKNOWN
    assert results.next_due_item("job-quarantine") is None

    db.execute(
        "UPDATE check_items SET recovery_after = ? WHERE id = ?",
        (iso_from_offset(-1), item.id),
    )
    db.commit()
    due = results.next_due_item("job-quarantine")
    assert due is not None
    assert due.id == item.id
    db.close()


def test_persisted_floodwait_is_visible_to_new_rate_limiter_instance(tmp_path: Path):
    db = Database(tmp_path / "checker.db")
    key = account_key_from_phone("+84900000005")
    first = RateLimitManager(0.1, db=db, account_key=key)
    first.register_rate_limit(30)

    second = RateLimitManager(0.1, db=db, account_key=key)
    second.initialize()

    assert second.is_blocked()
    assert second.remaining_block_seconds() > 20
    row = db.execute(
        "SELECT blocked_until, last_rate_limit_at FROM account_runtime_state WHERE account_key = ?",
        (key,),
    ).fetchone()
    assert row is not None
    assert row["blocked_until"] is not None
    assert row["last_rate_limit_at"] is not None
    db.close()


def test_auto_resume_false_refuses_paused_job_before_telegram_connect(tmp_path: Path):
    db_path = tmp_path / "checker.db"
    db = Database(db_path)
    jobs = JobRepository(db)
    jobs.create("job-paused", "paused", 0)
    jobs.update_status("job-paused", JobStatus.PAUSED)

    cfg = Config(
        api_id="1",
        api_hash="hash",
        api_phone_number="+84900000006",
        database_path=db_path,
        auto_resume=False,
    )
    manager = JobManager(cfg, db)
    telegram = NeverConnectTelegram()

    async def run_case():
        with pytest.raises(JobPausedError):
            await manager.run(
                "job-paused",
                auto_resume=False,
                telegram_factory=lambda: telegram,
            )

    asyncio.run(run_case())
    assert telegram.connected is False
    assert jobs.get("job-paused").status == JobStatus.PAUSED
    db.close()


def test_pause_then_resume_requires_old_worker_to_release_lease(tmp_path: Path):
    db = Database(tmp_path / "checker.db")
    jobs = JobRepository(db)
    jobs.create("job-pause", "pause", 0)
    assert jobs.claim_worker("job-pause", "worker-live", 60)
    assert jobs.mark_started_if_owned("job-pause", "worker-live")

    controller = JobController(db)
    controller.pause("job-pause")

    job = jobs.get("job-pause")
    assert job.status == JobStatus.RUNNING
    assert job.requested_command == "PAUSE"

    with pytest.raises(JobBusyError):
        controller.resume("job-pause")

    jobs.acknowledge_pause("job-pause", "worker-live")
    controller.resume("job-pause")
    resumed = jobs.get("job-pause")
    assert resumed.status == JobStatus.RUNNING
    assert resumed.requested_command == "NONE"
    assert not jobs.has_live_worker_lease("job-pause")
    db.close()


def test_stale_running_job_honors_auto_resume_false_after_recovery(tmp_path: Path):
    db_path = tmp_path / "checker.db"
    db = Database(db_path)
    jobs = JobRepository(db)
    results = ResultRepository(db)
    jobs.create("job-stale-no-resume", "stale no resume", 1)
    results.insert("job-stale-no-resume", "+84900000008", "+84900000008", 3)
    assert jobs.claim_worker("job-stale-no-resume", "dead-worker", 60)
    assert jobs.mark_started_if_owned("job-stale-no-resume", "dead-worker")
    db.execute(
        "UPDATE jobs SET worker_lease_until = ? WHERE id = ?",
        (iso_from_offset(-5), "job-stale-no-resume"),
    )
    db.commit()

    cfg = Config(
        api_id="1",
        api_hash="hash",
        api_phone_number="+84900000008",
        database_path=db_path,
        auto_resume=False,
    )
    manager = JobManager(cfg, db)
    telegram = NeverConnectTelegram()

    async def run_case():
        with pytest.raises(JobPausedError):
            await manager.run(
                "job-stale-no-resume",
                auto_resume=False,
                telegram_factory=lambda: telegram,
            )

    asyncio.run(run_case())
    current = jobs.get("job-stale-no-resume")
    assert current is not None
    assert current.status == JobStatus.PAUSED
    assert current.worker_id is None
    assert current.worker_lease_until is None
    assert telegram.connected is False
    db.close()


def test_terminal_only_job_completes_without_telegram_connection(tmp_path: Path):
    db_path = tmp_path / "checker.db"
    db = Database(db_path)
    jobs = JobRepository(db)
    results = ResultRepository(db)
    jobs.create("job-terminal-only", "terminal only", 1)
    results.insert_invalid("job-terminal-only", "invalid-number", max_attempts=1)
    jobs.reconcile_stats("job-terminal-only")

    cfg = Config(
        api_id="1",
        api_hash="hash",
        api_phone_number="+84900000009",
        database_path=db_path,
        auto_resume=True,
    )
    manager = JobManager(cfg, db)
    telegram = NeverConnectTelegram()

    async def run_case():
        status = await manager.run(
            "job-terminal-only",
            auto_resume=True,
            telegram_factory=lambda: telegram,
        )
        assert status == JobStatus.COMPLETED

    asyncio.run(run_case())
    current = jobs.get("job-terminal-only")
    assert current is not None
    assert current.status == JobStatus.COMPLETED
    assert current.worker_id is None
    assert current.worker_lease_until is None
    assert telegram.connected is False
    db.close()


def test_shutdown_suspend_releases_leases_and_remains_auto_recoverable(tmp_path: Path):
    db_path = tmp_path / "checker.db"
    db = Database(db_path)
    jobs = JobRepository(db)
    results = ResultRepository(db)
    job_id = "job-shutdown-suspend"
    phone = "+84900000010"

    jobs.create(job_id, "shutdown suspend", 1)
    results.insert(job_id, "+84911111111", "+84911111111", 3)

    cfg = Config(
        api_id="1",
        api_hash="hash",
        api_phone_number=phone,
        database_path=db_path,
        auto_resume=True,
        min_request_interval_seconds=0.1,
    )
    manager = JobManager(cfg, db)
    controller = JobController(db)

    class SuspendOnConnectTelegram:
        def __init__(self):
            self.connected = False
            self.disconnected = False

        async def connect(self):
            self.connected = True
            controller.suspend(job_id)

        async def disconnect(self):
            self.disconnected = True

        async def check_phone(self, checked_phone: str, client_id: int = 0):
            raise AssertionError("SUSPEND must stop before Telegram lookup")

    telegram = SuspendOnConnectTelegram()

    async def run_case():
        status = await manager.run(
            job_id,
            auto_resume=True,
            telegram_factory=lambda: telegram,
        )
        assert status == JobStatus.RUNNING

    asyncio.run(run_case())

    suspended = jobs.get(job_id)
    assert suspended is not None
    assert suspended.status == JobStatus.RUNNING
    assert suspended.worker_id is None
    assert suspended.worker_lease_until is None
    assert suspended.requested_command == "NONE"
    assert telegram.connected is True
    assert telegram.disconnected is True

    asyncio.run(manager.recover(job_id))
    recovered = jobs.get(job_id)
    assert recovered is not None
    assert recovered.status == JobStatus.PAUSED
    assert recovered.worker_id is None
    assert recovered.worker_lease_until is None
    db.close()
