"""TV guide for Home Assistant."""

from homeassistant.core import HomeAssistant

from .coordinator import TvGuideConfigEntry, TvGuideCoordinator
from .store import GuideStore


async def async_setup_entry(hass: HomeAssistant, entry: TvGuideConfigEntry) -> bool:
    """Set up the guide.

    A stored guide makes the setup instant and works while the source is down;
    the refresh then runs in the background. Without a stored guide the first
    download must work, otherwise Home Assistant retries the setup.
    """
    coordinator = TvGuideCoordinator(hass, entry)
    if await coordinator.async_load_stored():
        entry.async_create_background_task(hass, coordinator.async_refresh(), "tv_guide refresh")
    else:
        await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    # The guide has no entities. A coordinator only schedules its timer while it has a listener.
    entry.async_on_unload(coordinator.async_add_listener(lambda: None))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: TvGuideConfigEntry) -> bool:
    """Unload the entry. The coordinator needs no cleanup."""
    return True


async def async_remove_entry(hass: HomeAssistant, entry: TvGuideConfigEntry) -> None:
    """Delete the stored guide with the entry."""
    await GuideStore(hass, entry.entry_id).async_remove()
