from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import ConfigEntryState
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

from custom_components.tv_guide.const import DOMAIN
from custom_components.tv_guide.images import IMAGE_FOLDER
from tests.conftest import URL, WAW

INFO = "TVN|2026-10-19T17:50:00Z"  # 19:50 Warsaw time, the evening of `NOW`


def _add_poster(folder: Path) -> None:
    """Put one cached poster on disk. Blocking: run it in the executor."""
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "abc_thumb.jpg").write_bytes(b"jpeg")


async def test_unload_and_remove(hass, loaded_entry, hass_storage) -> None:
    assert await hass.config_entries.async_unload(loaded_entry.entry_id)
    assert loaded_entry.state is ConfigEntryState.NOT_LOADED
    await hass.config_entries.async_remove(loaded_entry.entry_id)
    assert f"tv_guide.{loaded_entry.entry_id}" not in hass_storage


async def test_removing_the_last_entry_deletes_the_posters(hass, loaded_entry) -> None:
    folder = Path(hass.config.path(IMAGE_FOLDER))
    await hass.async_add_executor_job(_add_poster, folder)
    await hass.config_entries.async_remove(loaded_entry.entry_id)
    assert not await hass.async_add_executor_job(folder.exists)


async def test_posters_stay_while_another_entry_uses_them(hass, loaded_entry) -> None:
    MockConfigEntry(
        domain=DOMAIN, unique_id="http://other/guide.xml", data={"url": "http://other/guide.xml"}
    ).add_to_hass(hass)
    folder = Path(hass.config.path(IMAGE_FOLDER))
    await hass.async_add_executor_job(_add_poster, folder)
    await hass.config_entries.async_remove(loaded_entry.entry_id)
    assert await hass.async_add_executor_job((folder / "abc_thumb.jpg").exists)


async def test_setup_loads_reminders_and_a_guide_update_reconciles(
    clock_at_now, hass, hass_storage, aioclient_mock, guide_xml, mock_entry
) -> None:
    # The stored programme id is out of date: the same programme now has another id.
    hass_storage[f"tv_guide.{mock_entry.entry_id}.reminders"] = {
        "version": 1,
        "data": {
            "reminders": [
                {
                    "user_id": "u1",
                    "programme_id": "TVN|old-id",
                    "channel_id": "TVN",
                    "title": "Info",
                    "start": datetime(2026, 10, 19, 19, 50, tzinfo=WAW).isoformat(),
                    "language": "en",
                }
            ]
        },
    }
    aioclient_mock.get(URL, content=guide_xml)

    assert await hass.config_entries.async_setup(mock_entry.entry_id)
    await hass.async_block_till_done()
    # The guide was not loaded yet when the reminders were: nothing could be matched.
    coordinator = mock_entry.runtime_data
    assert [r.programme_id for r in coordinator.reminders.for_user("u1")] == ["TVN|old-id"]

    await coordinator.async_refresh()
    await hass.async_block_till_done(wait_background_tasks=True)

    assert [r.programme_id for r in coordinator.reminders.for_user("u1")] == [INFO]


async def test_unload_cancels_the_timers(clock_at_now, hass, loaded_entry, guide) -> None:
    programme = guide.find(INFO)
    assert programme
    await loaded_entry.runtime_data.reminders.async_add("u1", programme, "en")

    assert await hass.config_entries.async_unload(loaded_entry.entry_id)

    with patch("custom_components.tv_guide.reminders.async_deliver", AsyncMock()) as deliver:
        clock_at_now.move_to(datetime(2026, 10, 19, 19, 46, tzinfo=WAW))
        async_fire_time_changed(hass)
        await hass.async_block_till_done()
    deliver.assert_not_called()


async def test_remove_entry_deletes_the_reminder_store(clock_at_now, hass, loaded_entry, guide, hass_storage) -> None:
    programme = guide.find(INFO)
    assert programme
    await loaded_entry.runtime_data.reminders.async_add("u1", programme, "en")
    key = f"tv_guide.{loaded_entry.entry_id}.reminders"
    assert key in hass_storage

    await hass.config_entries.async_remove(loaded_entry.entry_id)

    assert key not in hass_storage
