from pathlib import Path

from homeassistant.config_entries import ConfigEntryState
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.tv_guide.const import DOMAIN
from custom_components.tv_guide.images import IMAGE_FOLDER


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
