import logging
from pathlib import Path
from typing import Optional

from telethon import TelegramClient, errors
from telethon.tl import functions, types

from .models import CheckResponse, CheckStatus, ErrorType

logger = logging.getLogger(__name__)


class ProxyConfigError(ValueError):
    pass


def get_human_readable_user_status(status: types.TypeUserStatus):
    match status:
        case types.UserStatusOnline():
            return "Currently online"
        case types.UserStatusOffline():
            return status.was_online.strftime("%Y-%m-%d %H:%M:%S %Z")
        case types.UserStatusRecently():
            return "Last seen recently"
        case types.UserStatusLastWeek():
            return "Last seen last week"
        case types.UserStatusLastMonth():
            return "Last seen last month"
        case _:
            return "Unknown"


def parse_proxy(proxy_url: str):
    """Parse a proxy URL (e.g. 'socks5://user:pass@host:1080') into the tuple
    Telethon/PySocks expects. Requires the optional PySocks dependency.
    """
    from urllib.parse import urlsplit

    try:
        import socks
    except ImportError as e:
        raise ProxyConfigError(
            "Proxy support requires PySocks. Install it with: "
            "pip install telegram-phone-number-checker[proxy]"
        ) from e

    parsed = urlsplit(proxy_url)
    scheme_to_type = {
        "socks5": socks.SOCKS5,
        "socks4": socks.SOCKS4,
        "http": socks.HTTP,
    }
    if parsed.scheme not in scheme_to_type:
        raise ProxyConfigError(
            f"Unsupported proxy scheme '{parsed.scheme}'. Use socks5://, socks4://, or http://."
        )
    if not parsed.hostname or not parsed.port:
        raise ProxyConfigError(
            "Proxy URL must include a host and port, e.g. socks5://host:1080"
        )
    return (
        scheme_to_type[parsed.scheme],
        parsed.hostname,
        parsed.port,
        True,
        parsed.username,
        parsed.password,
    )


class TelegramService:
    """Thin transport + response classifier around the Telegram core flow.

    Responsibilities: connect, send request, classify the raw Telegram
    response into a structured CheckResponse. It NEVER decides retries or
    pacing — that is the JobManager's job.
    """

    def __init__(
        self,
        api_id: str,
        api_hash: str,
        phone_number: str,
        proxy: Optional[str] = None,
        session_dir: str = ".",
        session_string: Optional[str] = None,
    ):
        self._api_id = api_id
        self._api_hash = api_hash
        self._phone_number = phone_number
        self._proxy = parse_proxy(proxy) if proxy else None
        self._client: Optional[TelegramClient] = None
        self._session_dir = session_dir
        self._session_string = session_string

    async def connect(self) -> None:
        from getpass import getpass

        if self._session_string:
            from telethon.sessions import StringSession
            session = StringSession(self._session_string)
        else:
            session = Path(self._session_dir) / self._phone_number
        client = TelegramClient(
            session,
            int(self._api_id),
            self._api_hash,
            proxy=self._proxy,
        )
        await client.connect()
        if not await client.is_user_authorized():
            if self._session_string:
                await client.disconnect()
                raise RuntimeError("Stored Telegram session is no longer authorized")
            await client.send_code_request(self._phone_number)
            try:
                await client.sign_in(
                    self._phone_number, input("Enter the code (sent on telegram): ")
                )
            except errors.SessionPasswordNeededError:
                pw = getpass(
                    "Two-Step Verification enabled. Please enter your account password: "
                )
                await client.sign_in(password=pw)
        self._client = client
        logger.info("Telegram client connected")

    async def disconnect(self) -> None:
        if self._client is not None:
            await self._client.disconnect()
            self._client = None
            logger.info("Telegram client disconnected")

    async def check_phone(self, phone: str, client_id: int = 0) -> CheckResponse:
        if self._client is None:
            return CheckResponse(
                status=CheckStatus.TEMPORARY_ERROR,
                phone=phone,
                error_type=ErrorType.UNKNOWN.value,
                error_message="Telegram client is not connected",
            )
        return await self._do_check_phone(phone, client_id)

    async def _do_check_phone(self, phone: str, client_id: int) -> CheckResponse:
        contact = types.InputPhoneContact(
            client_id=client_id, phone=phone, first_name="", last_name=""
        )
        try:
            import_response = await self._client(
                functions.contacts.ImportContactsRequest([contact])
            )
        except errors.FloodWaitError as e:
            return CheckResponse(
                status=CheckStatus.RATE_LIMITED,
                phone=phone,
                retry_after_seconds=int(e.seconds),
                error_type=ErrorType.FLOOD_WAIT.value,
                error_message=f"FloodWait for {e.seconds}s",
            )
        except errors.RpcCallFailError as e:
            return CheckResponse(
                status=CheckStatus.TEMPORARY_ERROR,
                phone=phone,
                error_type=ErrorType.TELEGRAM_ERROR.value,
                error_message=f"Telegram RPC call failed: {e}",
            )
        except (TimeoutError, ConnectionError, OSError) as e:
            return CheckResponse(
                status=CheckStatus.TEMPORARY_ERROR,
                phone=phone,
                error_type=ErrorType.NETWORK_TIMEOUT.value,
                error_message=str(e),
            )
        except Exception as e:
            return CheckResponse(
                status=CheckStatus.TEMPORARY_ERROR,
                phone=phone,
                error_type=ErrorType.UNKNOWN.value,
                error_message=str(e),
            )

        return await self._classify_import_response(import_response, phone, client_id)

    async def _classify_import_response(
        self, import_response, phone: str, client_id: int
    ) -> CheckResponse:
        users = list(getattr(import_response, "users", None) or [])
        retry_ids = list(getattr(import_response, "retry_contacts", None) or [])

        # Telegram explicitly asks to retry these contacts.
        if client_id in retry_ids or phone in retry_ids:
            return CheckResponse(
                status=CheckStatus.RETRY_REQUIRED,
                phone=phone,
                error_type=ErrorType.TELEGRAM_ERROR.value,
                error_message="contact listed in retry_contacts",
            )

        if len(users) == 1:
            user = users[0]
            resp = CheckResponse(
                status=CheckStatus.FOUND,
                phone=phone,
                telegram_user_id=getattr(user, "id", None),
                username=getattr(user, "username", None),
                first_name=getattr(user, "first_name", None),
                last_name=getattr(user, "last_name", None),
                user_was_online=get_human_readable_user_status(
                    getattr(user, "status", None)
                ),
            )
            try:
                await self._delete_contact(user)
            except Exception as e:
                logger.warning("Contact cleanup failed but lookup succeeded: %s", e)
                resp.cleanup_error = f"DeleteContactsRequest failed: {e}"
            return resp

        if len(users) == 0:
            return CheckResponse(
                status=CheckStatus.NOT_DISCOVERABLE,
                phone=phone,
                error_message="No user returned and contact not in retry_contacts",
            )

        return CheckResponse(
            status=CheckStatus.PERMANENT_ERROR,
            phone=phone,
            error_type=ErrorType.UNKNOWN.value,
            error_message="Matched multiple Telegram accounts unexpectedly",
        )

    async def _delete_contact(self, user) -> None:
        """Core Bellingcat step: delete the contact to get richer user data.

        If this fails it must NOT destroy an already-FOUND lookup result.
        The caller keeps the FOUND status; only cleanup_error is recorded.
        """
        await self._client(
            functions.contacts.DeleteContactsRequest(id=[getattr(user, "id", None)])
        )
