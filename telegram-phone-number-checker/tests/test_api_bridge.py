import asyncio

import pytest

from telegram_phone_number_checker import api_bridge


class FakeSession:
    def __init__(self, value):
        self.value = value

    def save(self):
        return self.value


class FakeClient:
    def __init__(self, value):
        self.session = FakeSession(value)


def test_invalid_stored_string_session_returns_structured_error():
    result = asyncio.run(
        api_bridge.run(
            {
                "command": "verify",
                "apiId": "12345",
                "apiHash": "0123456789abcdef0123456789abcdef",
                "phoneNumber": "+84912345678",
                "code": "12345",
                "phoneCodeHash": "hash",
                "sessionString": "not-a-valid-telethon-session",
            }
        )
    )

    assert result["state"] == "error"
    assert result["errorType"] == "BridgeSessionError"
    assert "Phiên Telegram" in result["message"]


def test_saved_session_is_round_trip_validated():
    with pytest.raises(api_bridge.BridgeSessionError):
        api_bridge._validated_saved_session(FakeClient("invalid-session"))


def test_empty_saved_session_is_rejected():
    with pytest.raises(api_bridge.BridgeSessionError):
        api_bridge._validated_saved_session(FakeClient(""))


def test_bridge_protocol_error_has_specific_message():
    error = api_bridge.BridgeProtocolError("Telegram engine nhận JSON không hợp lệ.")
    result = api_bridge.safe_error(error)

    assert result["errorType"] == "BridgeProtocolError"
    assert result["message"] == "Telegram engine nhận JSON không hợp lệ."
