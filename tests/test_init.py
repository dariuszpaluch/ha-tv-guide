from homeassistant.config_entries import ConfigEntryState


async def test_unload_and_remove(hass, loaded_entry, hass_storage) -> None:
    assert await hass.config_entries.async_unload(loaded_entry.entry_id)
    assert loaded_entry.state is ConfigEntryState.NOT_LOADED
    await hass.config_entries.async_remove(loaded_entry.entry_id)
    assert f"tv_guide.{loaded_entry.entry_id}" not in hass_storage
