import threading
from datetime import datetime, timedelta, timezone

from custom_components.tv_guide.model import Guide
from custom_components.tv_guide.reminders import Reminder
from custom_components.tv_guide.store import GuideStore, ReminderStore


async def test_store_round_trip(hass, guide: Guide) -> None:
    await GuideStore(hass, "e1").async_save(guide)
    assert await GuideStore(hass, "e1").async_load() == guide


async def test_store_converts_the_guide_outside_the_event_loop(hass, guide: Guide, monkeypatch) -> None:
    # Building the dict and parsing it back take hundreds of ms for a big guide.
    threads: dict[str, int] = {}
    to_dict, from_dict = Guide.to_dict, Guide.from_dict

    def spy_to_dict(self: Guide):
        threads["to_dict"] = threading.get_ident()
        return to_dict(self)

    def spy_from_dict(data):
        threads["from_dict"] = threading.get_ident()
        return from_dict(data)

    monkeypatch.setattr(Guide, "to_dict", spy_to_dict)
    monkeypatch.setattr(Guide, "from_dict", staticmethod(spy_from_dict))
    store = GuideStore(hass, "e1")
    await store.async_save(guide)
    assert await store.async_load() == guide
    assert set(threads) == {"to_dict", "from_dict"}
    assert hass.loop_thread_id not in threads.values()


async def test_store_empty(hass) -> None:
    assert await GuideStore(hass, "e1").async_load() is None


async def test_store_remove(hass, guide: Guide, hass_storage) -> None:
    store = GuideStore(hass, "e1")
    await store.async_save(guide)
    assert "tv_guide.e1" in hass_storage
    await store.async_remove()
    assert "tv_guide.e1" not in hass_storage


def make_reminder() -> Reminder:
    return Reminder(
        user_id="u1",
        programme_id="TVN|2026-10-20T17:55:00Z",
        channel_id="TVN",
        title="Uwaga",
        start=datetime(2026, 10, 20, 19, 55, tzinfo=timezone(timedelta(hours=2))),
        language="pl",
    )


async def test_reminder_store_round_trip(hass, hass_storage) -> None:
    await ReminderStore(hass, "e1").async_save([make_reminder()])
    assert "tv_guide.e1.reminders" in hass_storage
    assert await ReminderStore(hass, "e1").async_load() == [make_reminder()]


async def test_reminder_store_empty(hass) -> None:
    assert await ReminderStore(hass, "e1").async_load() == []


async def test_reminder_store_damaged_file(hass, hass_storage, caplog) -> None:
    hass_storage["tv_guide.e1.reminders"] = {"version": 1, "data": {"reminders": [{"bad": 1}]}}
    assert await ReminderStore(hass, "e1").async_load() == []
    assert "reminders" in caplog.text


async def test_reminder_store_remove(hass, hass_storage) -> None:
    store = ReminderStore(hass, "e1")
    await store.async_save([make_reminder()])
    await store.async_remove()
    assert "tv_guide.e1.reminders" not in hass_storage
