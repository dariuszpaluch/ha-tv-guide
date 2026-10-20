"""Tests of the reminder manager: timers, restarts and guide updates."""

from collections.abc import Callable, Iterator
from dataclasses import replace
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from freezegun.api import FrozenDateTimeFactory
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CoreState, HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

from custom_components.tv_guide.const import DOMAIN
from custom_components.tv_guide.model import Guide, Programme
from custom_components.tv_guide.reminders import Reminder, ReminderManager, TooLate
from custom_components.tv_guide.store import ReminderStore
from tests.conftest import WAW

INFO = "TVN|2026-10-19T17:50:00Z"  # 19:50 Warsaw time, the evening of `NOW`
SPORT = "TVN|2026-10-19T17:35:00Z"  # 19:35
UWAGA = "TVN|2026-10-20T17:55:00Z"  # 19:55 the next day
NOCNE_KINO = "Polsat|2026-10-25T00:30:00Z"  # 02:30 +02:00, the night the clocks change
STORE_KEY = "tv_guide.e1.reminders"


def at(hour: int, minute: int, second: int = 0, day: int = 19) -> datetime:
    """A time of October 2026 in Warsaw."""
    return datetime(2026, 10, day, hour, minute, second, tzinfo=WAW)


class GuideHolder:
    """The guide of the manager. A test swaps it, like the coordinator does after a download."""

    def __init__(self, guide: Guide | None) -> None:
        self.guide = guide

    def __call__(self) -> Guide | None:
        return self.guide


def without(guide: Guide, title: str) -> Guide:
    """The guide with every programme of this title removed."""
    return replace(guide, programmes={c: [p for p in ps if p.title != title] for c, ps in guide.programmes.items()})


def uwaga_replaced_by_a_longer_info(guide: Guide) -> Guide:
    """The guide without "Uwaga" (19:55 on the 20th), but "Info" runs on into its slot.

    Something is still on air at the old start, so a reminder for "Uwaga" is truly gone.
    """
    info = programme(guide, "TVN|2026-10-20T17:50:00Z")
    uwaga = programme(guide, UWAGA)
    longer = replace(info, stop=uwaga.stop)
    tvn = [longer if p.id == info.id else p for p in guide.programmes["TVN"] if p.id != uwaga.id]
    return replace(guide, programmes={**guide.programmes, "TVN": tvn})


def shifted(guide: Guide, title: str, delta: timedelta) -> Guide:
    """The guide with the programmes of this title moved in time."""

    def shift(p: Programme) -> Programme:
        return replace(p, start=p.start + delta, stop=p.stop + delta) if p.title == title else p

    return replace(guide, programmes={c: [shift(p) for p in ps] for c, ps in guide.programmes.items()})


def stored(hass_storage: dict) -> list[dict]:
    """The reminders in the fake `.storage`."""
    return hass_storage[STORE_KEY]["data"]["reminders"]


@pytest.fixture(autouse=True)
def _clock(clock_at_now: FrozenDateTimeFactory) -> None:
    """Every test starts at `NOW`."""


@pytest.fixture
def deliver():
    """Replace the real delivery, so a test sees what is sent."""
    with patch("custom_components.tv_guide.reminders.async_deliver", AsyncMock()) as mock:
        yield mock


@pytest.fixture
def holder(guide: Guide) -> GuideHolder:
    return GuideHolder(guide)


@pytest.fixture
def entry(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, entry_id="e1", data={})
    entry.add_to_hass(hass)
    return entry


@pytest.fixture
def make_manager(
    hass: HomeAssistant, entry: MockConfigEntry, holder: GuideHolder
) -> Iterator[Callable[[], ReminderManager]]:
    """Build a manager on the store of the entry. Call it twice to simulate a restart.

    The timers of every manager are cancelled at the end: HA fails a test with a lingering timer.
    """
    managers: list[ReminderManager] = []

    def make() -> ReminderManager:
        managers.append(ReminderManager(hass, entry, ReminderStore(hass, entry.entry_id), holder))
        return managers[-1]

    yield make
    for manager in managers:
        manager.unload()


@pytest.fixture
async def manager(make_manager: Callable[[], ReminderManager]) -> ReminderManager:
    manager = make_manager()
    await manager.async_load()
    return manager


async def tick(hass: HomeAssistant, freezer: FrozenDateTimeFactory, when: datetime) -> None:
    """Move the clock and let the timers that are due run."""
    freezer.move_to(when)
    async_fire_time_changed(hass)
    await hass.async_block_till_done()


def programme(guide: Guide, programme_id: str) -> Programme:
    found = guide.find(programme_id)
    assert found
    return found


async def test_fires_five_minutes_before_the_start_and_is_deleted(
    hass, freezer, guide, deliver, manager, hass_storage
) -> None:
    await manager.async_add("u1", programme(guide, INFO), "en")
    assert stored(hass_storage) != []

    await tick(hass, freezer, at(19, 44, 59))
    deliver.assert_not_called()

    await tick(hass, freezer, at(19, 45))
    deliver.assert_awaited_once_with(
        hass, Reminder.from_programme("u1", programme(guide, INFO), "en"), "starting", "TVN"
    )
    assert manager.for_user("u1") == []
    assert stored(hass_storage) == []


async def test_too_late(hass, freezer, guide, manager) -> None:
    freezer.move_to(at(19, 30))
    with pytest.raises(TooLate):
        await manager.async_add("u1", programme(guide, SPORT), "en")
    assert manager.for_user("u1") == []

    freezer.move_to(at(19, 29, 59))
    await manager.async_add("u1", programme(guide, SPORT), "en")
    assert len(manager.for_user("u1")) == 1


async def test_two_users_keep_the_same_programme_and_each_is_notified(hass, freezer, guide, deliver, manager) -> None:
    await manager.async_add("u1", programme(guide, INFO), "en")
    await manager.async_add("u2", programme(guide, INFO), "pl")

    await tick(hass, freezer, at(19, 45))

    assert deliver.await_count == 2
    assert {call.args[1].user_id for call in deliver.await_args_list} == {"u1", "u2"}
    assert manager.for_user("u1") == manager.for_user("u2") == []


async def test_adding_again_inside_the_five_minutes_is_not_too_late(freezer, guide, manager) -> None:
    await manager.async_add("u1", programme(guide, SPORT), "en")
    freezer.move_to(at(19, 31))  # the reminder time (19:30) has passed, the timer has not run

    await manager.async_add("u1", programme(guide, SPORT), "en")

    assert len(manager.for_user("u1")) == 1
    with pytest.raises(TooLate):
        await manager.async_add("u2", programme(guide, SPORT), "en")


async def test_two_users_same_programme(hass, freezer, guide, deliver, manager) -> None:
    await manager.async_add("u1", programme(guide, INFO), "en")
    await manager.async_add("u2", programme(guide, INFO), "en")
    await manager.async_remove("u1", INFO)
    assert manager.for_user("u1") == []

    await tick(hass, freezer, at(19, 45))
    deliver.assert_awaited_once()
    assert deliver.await_args.args[1].user_id == "u2"


async def test_survives_a_restart(hass, freezer, guide, deliver, manager, make_manager) -> None:
    await manager.async_add("u1", programme(guide, INFO), "en")
    manager.unload()

    restarted = make_manager()
    await restarted.async_load()
    assert len(restarted.for_user("u1")) == 1

    await tick(hass, freezer, at(19, 45))
    deliver.assert_awaited_once()


async def test_unload_cancels_the_timers(hass, freezer, guide, deliver, manager) -> None:
    await manager.async_add("u1", programme(guide, INFO), "en")
    manager.unload()
    await tick(hass, freezer, at(19, 45))
    deliver.assert_not_called()


async def test_due_while_ha_was_off_fires_at_once(hass, freezer, guide, deliver, make_manager) -> None:
    await ReminderStore(hass, "e1").async_save([Reminder.from_programme("u1", programme(guide, INFO), "en")])
    freezer.move_to(at(19, 47))
    manager = make_manager()
    await manager.async_load()
    deliver.assert_awaited_once()
    assert deliver.await_args.args[2] == "starting"
    assert manager.for_user("u1") == []


async def test_due_at_startup_waits_until_home_assistant_has_started(
    hass, freezer, guide, deliver, make_manager, hass_storage
) -> None:
    await ReminderStore(hass, "e1").async_save([Reminder.from_programme("u1", programme(guide, INFO), "en")])
    freezer.move_to(at(19, 47))
    hass.set_state(CoreState.not_running)
    try:
        manager = make_manager()
        await manager.async_load()
        deliver.assert_not_called()
        assert stored(hass_storage) == []  # already deleted: save before send

        hass.set_state(CoreState.running)
        hass.bus.async_fire(EVENT_HOMEASSISTANT_STARTED)
        await hass.async_block_till_done()
    finally:
        hass.set_state(CoreState.running)

    deliver.assert_awaited_once()
    assert deliver.await_args.args[2] == "starting"


async def test_unload_cancels_a_send_that_waits_for_the_start(hass, freezer, guide, deliver, make_manager) -> None:
    await ReminderStore(hass, "e1").async_save([Reminder.from_programme("u1", programme(guide, INFO), "en")])
    freezer.move_to(at(19, 47))
    hass.set_state(CoreState.not_running)
    try:
        manager = make_manager()
        await manager.async_load()
        manager.unload()

        hass.set_state(CoreState.running)
        hass.bus.async_fire(EVENT_HOMEASSISTANT_STARTED)
        await hass.async_block_till_done()
    finally:
        hass.set_state(CoreState.running)

    deliver.assert_not_called()


async def test_one_failing_delivery_does_not_stop_the_others(
    hass, freezer, guide, deliver, make_manager, caplog
) -> None:
    info = programme(guide, INFO)
    await ReminderStore(hass, "e1").async_save(
        [Reminder.from_programme("u1", info, "en"), Reminder.from_programme("u2", info, "en")]
    )
    freezer.move_to(at(19, 47))
    deliver.side_effect = [RuntimeError("boom"), None]
    manager = make_manager()

    await manager.async_load()

    assert deliver.await_count == 2
    assert "Cannot send" in caplog.text
    assert manager.for_user("u1") == manager.for_user("u2") == []


async def test_a_failing_delivery_from_a_timer_is_logged(hass, freezer, guide, deliver, manager, caplog) -> None:
    deliver.side_effect = RuntimeError("boom")
    await manager.async_add("u1", programme(guide, INFO), "en")

    await tick(hass, freezer, at(19, 45))

    deliver.assert_awaited_once()
    assert "Cannot send" in caplog.text


async def test_a_failing_gone_notice_does_not_stop_the_next(hass, guide, deliver, manager, holder) -> None:
    await manager.async_add("u1", programme(guide, UWAGA), "en")
    await manager.async_add("u2", programme(guide, UWAGA), "en")
    holder.guide = uwaga_replaced_by_a_longer_info(guide)
    deliver.side_effect = [RuntimeError("boom"), None]

    manager.handle_guide_update()
    await hass.async_block_till_done()

    assert deliver.await_count == 2
    assert [call.args[2] for call in deliver.await_args_list] == ["gone", "gone"]


async def test_an_add_that_finishes_after_unload_plans_no_timer(hass, freezer, guide, deliver, manager) -> None:
    manager.unload()
    await manager.async_add("u1", programme(guide, INFO), "en")

    await tick(hass, freezer, at(19, 45))

    deliver.assert_not_called()


async def test_an_unload_during_the_save_sends_nothing(hass, freezer, guide, deliver, make_manager) -> None:
    await ReminderStore(hass, "e1").async_save([Reminder.from_programme("u1", programme(guide, INFO), "en")])
    freezer.move_to(at(19, 47))
    manager = make_manager()
    with patch.object(ReminderStore, "async_save", AsyncMock(side_effect=lambda _reminders: manager.unload())):
        await manager.async_load()
    await hass.async_block_till_done()

    deliver.assert_not_called()


async def test_started_while_ha_was_off_is_dropped_silently(
    hass, freezer, guide, deliver, make_manager, hass_storage
) -> None:
    await ReminderStore(hass, "e1").async_save([Reminder.from_programme("u1", programme(guide, INFO), "en")])
    freezer.move_to(at(19, 51))
    manager = make_manager()
    await manager.async_load()
    deliver.assert_not_called()
    assert manager.for_user("u1") == []
    assert stored(hass_storage) == []


async def test_guide_update_moves_the_timer(hass, freezer, guide, deliver, manager, holder) -> None:
    await manager.async_add("u1", programme(guide, UWAGA), "en")
    holder.guide = shifted(guide, "Uwaga", timedelta(minutes=10))
    manager.handle_guide_update()
    await hass.async_block_till_done()

    [reminder] = manager.for_user("u1")
    assert reminder.start == at(20, 5, day=20)

    await tick(hass, freezer, at(19, 50, day=20))
    deliver.assert_not_called()
    await tick(hass, freezer, at(20, 0, day=20))
    deliver.assert_awaited_once()
    assert deliver.await_args.args[2] == "starting"


async def test_gone_sends_one_notice_after_saving(hass, freezer, guide, deliver, manager, holder, hass_storage) -> None:
    await manager.async_add("u1", programme(guide, UWAGA), "en")
    holder.guide = uwaga_replaced_by_a_longer_info(guide)
    held_when_sent: list[list[dict]] = []
    deliver.side_effect = lambda *_: held_when_sent.append(list(stored(hass_storage)))

    manager.handle_guide_update()
    await hass.async_block_till_done()

    deliver.assert_awaited_once()
    assert deliver.await_args.args[2] == "gone"
    assert held_when_sent == [[]]
    assert manager.for_user("u1") == []

    await tick(hass, freezer, at(19, 50, day=20))
    deliver.assert_awaited_once()


async def test_guide_update_after_firing_sends_nothing(hass, freezer, guide, deliver, manager, holder) -> None:
    await manager.async_add("u1", programme(guide, INFO), "en")
    await tick(hass, freezer, at(19, 45))
    deliver.assert_awaited_once()

    holder.guide = without(guide, "Info")
    manager.handle_guide_update()
    await hass.async_block_till_done()
    deliver.assert_awaited_once()


async def test_dst_night(hass, freezer, guide, deliver, manager) -> None:
    await manager.async_add("u1", programme(guide, NOCNE_KINO), "en")
    await tick(hass, freezer, datetime.fromisoformat("2026-10-25T00:24:59+00:00"))
    deliver.assert_not_called()
    await tick(hass, freezer, datetime.fromisoformat("2026-10-25T00:25:00+00:00"))
    deliver.assert_awaited_once()


async def test_language_is_normalized(guide, manager) -> None:
    await manager.async_add("u1", programme(guide, INFO), "pl-PL")
    await manager.async_add("u1", programme(guide, UWAGA), "zh-Hans")
    assert [r.language for r in manager.for_user("u1")] == ["pl", "en"]


async def test_adding_twice_changes_nothing(hass, freezer, guide, deliver, manager) -> None:
    await manager.async_add("u1", programme(guide, INFO), "en")
    await manager.async_add("u1", programme(guide, INFO), "pl")
    [reminder] = manager.for_user("u1")
    assert reminder.language == "en"

    await tick(hass, freezer, at(19, 45))
    deliver.assert_awaited_once()


async def test_for_user_is_sorted_and_private(guide, manager) -> None:
    await manager.async_add("u1", programme(guide, UWAGA), "en")
    await manager.async_add("u1", programme(guide, INFO), "en")
    await manager.async_add("u2", programme(guide, SPORT), "en")
    assert [r.programme_id for r in manager.for_user("u1")] == [INFO, UWAGA]
    assert [r.programme_id for r in manager.for_user("u2")] == [SPORT]


async def test_removing_a_missing_reminder_is_not_an_error(manager) -> None:
    await manager.async_remove("u1", INFO)


async def test_no_guide_yet_keeps_the_reminders_and_names_the_channel_by_id(
    hass, freezer, guide, deliver, manager, holder
) -> None:
    await manager.async_add("u1", programme(guide, INFO), "en")
    holder.guide = None
    manager.handle_guide_update()
    await hass.async_block_till_done()
    assert len(manager.for_user("u1")) == 1

    await tick(hass, freezer, at(19, 45))
    assert deliver.await_args.args[3] == "TVN"


async def test_two_reminders_moved_onto_one_programme_are_merged(hass, guide, deliver, make_manager, holder) -> None:
    info = programme(guide, "TVN|2026-10-20T17:50:00Z")
    stale = [
        replace(
            Reminder.from_programme("u1", info, "en"),
            programme_id="TVN|old-1",
            start=info.start - timedelta(minutes=10),
        ),
        replace(
            Reminder.from_programme("u1", info, "en"), programme_id="TVN|old-2", start=info.start - timedelta(minutes=5)
        ),
    ]
    await ReminderStore(hass, "e1").async_save(stale)
    manager = make_manager()
    await manager.async_load()

    manager.handle_guide_update()
    await hass.async_block_till_done()
    assert [r.programme_id for r in manager.for_user("u1")] == [info.id]
    deliver.assert_not_called()


async def test_firing_saves_before_sending(hass, freezer, guide, deliver, manager, hass_storage) -> None:
    await manager.async_add("u1", programme(guide, INFO), "en")
    held_when_sent: list[list[dict]] = []
    deliver.side_effect = lambda *_: held_when_sent.append(list(stored(hass_storage)))

    await tick(hass, freezer, at(19, 45))

    assert held_when_sent == [[]]
