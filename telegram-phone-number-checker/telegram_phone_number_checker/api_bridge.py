"""Small JSON-line bridge used by the web API.

Secrets are passed on stdin and the bridge emits only structured state on
stdout. It deliberately does not use the interactive CLI login flow.
"""

import asyncio
import json
import logging
import sys
from typing import Any

from telethon import TelegramClient, errors
from telethon.tl import functions, types
from telethon.sessions import StringSession

logging.disable(logging.CRITICAL)


def safe_error(exc: Exception) -> dict[str, str]:
    name = exc.__class__.__name__
    mapping = {
        "PhoneCodeInvalidError": "Mã OTP không hợp lệ.",
        "PhoneCodeExpiredError": "Mã OTP đã hết hạn. Hãy yêu cầu mã mới.",
        "PhoneNumberInvalidError": "Số điện thoại không hợp lệ.",
        "PhoneNumberBannedError": "Số điện thoại này bị Telegram hạn chế.",
        "ApiIdInvalidError": "API ID không hợp lệ.",
        "ApiIdPublishedFloodError": "API ID đang bị Telegram giới hạn.",
        "FloodWaitError": "Telegram đang yêu cầu chờ trước khi thử lại.",
        "SessionPasswordNeededError": "Tài khoản yêu cầu mật khẩu xác minh hai bước.",
        "PasswordHashInvalidError": "Mật khẩu xác minh hai bước không hợp lệ.",
        "AuthKeyUnregisteredError": "Phiên Telegram không còn hợp lệ.",
    }
    return {"errorType": name, "message": mapping.get(name, "Telegram từ chối yêu cầu.")}


async def run(payload: dict[str, Any]) -> dict[str, Any]:
    command = payload.get("command")
    api_id = int(payload["apiId"])
    api_hash = str(payload["apiHash"])
    phone = str(payload.get("phoneNumber", ""))
    session = StringSession(payload.get("sessionString") or "")
    client = TelegramClient(session, api_id, api_hash)
    try:
        await client.connect()
        if command == "start":
            sent = await client.send_code_request(phone)
            return {
                "state": "awaiting_code",
                "phoneCodeHash": sent.phone_code_hash,
                "sessionString": client.session.save(),
            }
        if command == "verify":
            try:
                await client.sign_in(
                    phone,
                    code=str(payload["code"]),
                    phone_code_hash=str(payload["phoneCodeHash"]),
                )
            except errors.SessionPasswordNeededError:
                password = payload.get("password")
                if not password:
                    return {"state": "awaiting_2fa", "sessionString": client.session.save()}
                await client.sign_in(password=str(password))
            me = await client.get_me()
            return {
                "state": "connected",
                "sessionString": client.session.save(),
                "displayName": " ".join(
                    part for part in [getattr(me, "first_name", None), getattr(me, "last_name", None)] if part
                ) or None,
                "username": getattr(me, "username", None),
            }
        if command == "status":
            if not await client.is_user_authorized():
                return {"state": "disconnected"}
            me = await client.get_me()
            return {
                "state": "connected",
                "sessionString": client.session.save(),
                "displayName": " ".join(
                    part for part in [getattr(me, "first_name", None), getattr(me, "last_name", None)] if part
                ) or None,
                "username": getattr(me, "username", None),
            }
        if command == "check":
            results = []
            max_attempts = max(1, min(10, int(payload.get("maxAttempts") or 3)))
            min_request_interval = max(0.1, min(60.0, float(payload.get("minRequestInterval") or 1.2)))
            for index, phone_to_check in enumerate(payload.get("phones") or []):
                checked = {
                    "phone": phone_to_check,
                    "status": "not_discoverable",
                    "username": None,
                    "displayName": None,
                    "telegramId": None,
                    "lastOnline": None,
                    "errorMessage": None,
                    "retryAfterSeconds": None,
                }
                contact = types.InputPhoneContact(
                    client_id=index,
                    phone=str(phone_to_check),
                    first_name="",
                    last_name="",
                )
                for attempt in range(max_attempts):
                    if index or attempt:
                        await asyncio.sleep(min_request_interval)
                    try:
                        imported = await client(functions.contacts.ImportContactsRequest([contact]))
                        users = list(getattr(imported, "users", None) or [])
                        retries = list(getattr(imported, "retry_contacts", None) or [])
                        if index in retries or phone_to_check in retries:
                            checked["status"] = "rate_limited"
                            checked["errorMessage"] = "Telegram yêu cầu thử lại số này sau."
                        elif len(users) == 1:
                            user = users[0]
                            checked["status"] = "found"
                            checked["telegramId"] = str(getattr(user, "id", "")) or None
                            checked["username"] = getattr(user, "username", None)
                            checked["displayName"] = " ".join(
                                part for part in [getattr(user, "first_name", None), getattr(user, "last_name", None)] if part
                            ) or None
                            user_status = getattr(user, "status", None)
                            if isinstance(user_status, types.UserStatusOffline):
                                checked["lastOnline"] = user_status.was_online.isoformat()
                            elif isinstance(user_status, types.UserStatusOnline):
                                checked["lastOnline"] = "Đang trực tuyến"
                            await client(functions.contacts.DeleteContactsRequest(id=[getattr(user, "id", None)]))
                        elif len(users) > 1:
                            checked["status"] = "error"
                            checked["errorMessage"] = "Telegram trả về nhiều hồ sơ bất thường."
                        break
                    except errors.FloodWaitError as exc:
                        checked["status"] = "rate_limited"
                        checked["retryAfterSeconds"] = int(exc.seconds)
                        checked["errorMessage"] = "Telegram đang giới hạn tốc độ yêu cầu."
                        break
                    except Exception:
                        if attempt == max_attempts - 1:
                            checked["status"] = "error"
                            checked["errorMessage"] = "Không thể kiểm tra số này qua Telegram."
                results.append(checked)
            return {"state": "connected", "results": results}
        raise ValueError("Unsupported bridge command")
    except Exception as exc:
        return {"state": "error", **safe_error(exc)}
    finally:
        await client.disconnect()


def main() -> None:
    try:
        payload = json.loads(sys.stdin.readline())
        result = asyncio.run(run(payload))
        print(json.dumps(result, ensure_ascii=False), flush=True)
    except Exception:
        print(json.dumps({"state": "error", "message": "Không thể khởi chạy bộ máy Telegram."}), flush=True)


if __name__ == "__main__":
    main()