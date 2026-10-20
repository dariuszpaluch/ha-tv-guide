"""Tests of the delivery: find the phones of a user, send the notification, fire the event."""

from datetime import UTC, datetime, timedelta, timezone

import pytest
from homeassistant.core import Event, HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_capture_events, async_mock_service

from custom_components.tv_guide.delivery import EVENT_REMINDER, Phone, async_deliver, find_phones, supported_language
from custom_components.tv_guide.reminders import Reminder

PROGRAMME_ID = "TVN|2026-10-20T17:00:00Z"
START = datetime(2026, 10, 20, 19, 0, tzinfo=timezone(timedelta(hours=2)))


def make_reminder(language: str = "en") -> Reminder:
    """A reminder of user `u1` for "Fakty" at 19:00 Warsaw time."""
    return Reminder(
        user_id="u1",
        programme_id=PROGRAMME_ID,
        channel_id="TVN",
        title="Fakty",
        start=START,
        language=language,
    )


def add_phone(hass: HomeAssistant, user_id: str, device_name: str) -> None:
    """Register a Companion app phone, the way `mobile_app` stores it."""
    MockConfigEntry(
        domain="mobile_app",
        data={"user_id": user_id, "device_name": device_name, "webhook_id": f"hook-{device_name}"},
    ).add_to_hass(hass)


@pytest.fixture
async def phones(hass: HomeAssistant) -> None:
    """Two phones of `u1` and one of `u2`. The "Tablet" has push turned off, so it has no service."""
    await hass.config.async_set_time_zone("Europe/Warsaw")
    add_phone(hass, "u1", "Pixel 8")
    add_phone(hass, "u1", "Tablet")
    add_phone(hass, "u2", "iPhone")


def test_find_phones_returns_only_this_users_phones_with_a_service(hass: HomeAssistant, phones: None) -> None:
    async_mock_service(hass, "notify", "mobile_app_pixel_8")
    async_mock_service(hass, "notify", "mobile_app_iphone")

    assert find_phones(hass, "u1") == [Phone("Pixel 8", "mobile_app_pixel_8")]


def test_find_phones_without_phones(hass: HomeAssistant) -> None:
    assert find_phones(hass, "nobody") == []


def test_find_phones_skips_an_entry_without_user_or_name(hass: HomeAssistant) -> None:
    MockConfigEntry(domain="mobile_app", data={"webhook_id": "x"}).add_to_hass(hass)
    async_mock_service(hass, "notify", "mobile_app_pixel_8")

    assert find_phones(hass, "u1") == []


def test_find_phones_are_sorted_by_name(hass: HomeAssistant) -> None:
    add_phone(hass, "u1", "Zeta")
    add_phone(hass, "u1", "Alpha")
    async_mock_service(hass, "notify", "mobile_app_zeta")
    async_mock_service(hass, "notify", "mobile_app_alpha")

    assert [phone.name for phone in find_phones(hass, "u1")] == ["Alpha", "Zeta"]


async def test_starting_goes_to_each_phone_and_fires_the_event(hass: HomeAssistant, phones: None) -> None:
    pixel = async_mock_service(hass, "notify", "mobile_app_pixel_8")
    iphone = async_mock_service(hass, "notify", "mobile_app_iphone")
    events = async_capture_events(hass, EVENT_REMINDER)

    await async_deliver(hass, make_reminder(), "starting", "TVN")
    await hass.async_block_till_done()

    assert [call.data for call in pixel] == [
        {
            "title": "TVN · 19:00",
            "message": "Fakty starts in 5 minutes",
            "data": {"tag": f"tv_guide_{PROGRAMME_ID}"},
        }
    ]
    assert iphone == []
    assert [event.data for event in events] == [
        {
            "kind": "starting",
            "user_id": "u1",
            "programme_id": PROGRAMME_ID,
            "channel_id": "TVN",
            "channel_name": "TVN",
            "title": "Fakty",
            "start": "2026-10-20T19:00:00+02:00",
        }
    ]


async def test_gone_text_in_polish(hass: HomeAssistant, phones: None) -> None:
    pixel = async_mock_service(hass, "notify", "mobile_app_pixel_8")

    await async_deliver(hass, make_reminder("pl"), "gone", "TVN")

    assert [(call.data["title"], call.data["message"]) for call in pixel] == [("TVN", "Fakty nie ma już w programie")]


async def test_polish_starting_text_uses_the_server_time_zone(hass: HomeAssistant, phones: None) -> None:
    pixel = async_mock_service(hass, "notify", "mobile_app_pixel_8")
    utc_start = datetime(2026, 10, 20, 17, 0, tzinfo=UTC)
    reminder = Reminder("u1", PROGRAMME_ID, "TVN", "Fakty", utc_start, "pl")

    await async_deliver(hass, reminder, "starting", "TVN")

    assert [(call.data["title"], call.data["message"]) for call in pixel] == [
        ("TVN · 19:00", "Fakty zaczyna się za 5 minut")
    ]


async def test_one_failing_phone_does_not_stop_the_others(
    hass: HomeAssistant, caplog: pytest.LogCaptureFixture
) -> None:
    await hass.config.async_set_time_zone("Europe/Warsaw")
    add_phone(hass, "u1", "Broken")
    add_phone(hass, "u1", "Pixel 8")

    async def broken(call: ServiceCall) -> None:
        raise HomeAssistantError("push failed")

    hass.services.async_register("notify", "mobile_app_broken", broken)
    pixel = async_mock_service(hass, "notify", "mobile_app_pixel_8")
    events: list[Event] = async_capture_events(hass, EVENT_REMINDER)

    await async_deliver(hass, make_reminder(), "starting", "TVN")
    await hass.async_block_till_done()

    assert len(pixel) == 1
    assert len(events) == 1
    assert "Broken" in caplog.text


@pytest.mark.parametrize(
    ("given", "expected"),
    [("pl", "pl"), ("pl-PL", "pl"), ("en-GB", "en"), ("zh-Hans", "en"), ("de", "en")],
)
def test_supported_language(given: str, expected: str) -> None:
    assert supported_language(given) == expected
