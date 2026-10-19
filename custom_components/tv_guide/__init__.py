"""TV guide for Home Assistant."""

from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .coordinator import TvGuideConfigEntry, TvGuideCoordinator
from .store import GuideStore
from .websocket_api import async_register_commands

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the WebSocket commands once. They serve every entry."""
    async_register_commands(hass)
    return True


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
