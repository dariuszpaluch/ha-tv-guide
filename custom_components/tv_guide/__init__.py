"""TV guide for Home Assistant."""

from datetime import datetime
from pathlib import Path

from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .coordinator import TvGuideConfigEntry, TvGuideCoordinator
from .images import (
    CLEANUP_INTERVAL,
    IMAGE_CACHE,
    IMAGE_FOLDER,
    UNUSED_FILE_MAX_AGE,
    ImageCache,
    TvGuideImageView,
)
from .store import GuideStore
from .websocket_api import async_register_commands

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the WebSocket commands and the poster view once. They serve every entry."""
    async_register_commands(hass)
    _setup_image_cache(hass)
    return True


def _setup_image_cache(hass: HomeAssistant) -> None:
    """Create the poster cache, serve it and delete files unused for a week, once a day."""
    cache = ImageCache(hass, Path(hass.config.path(IMAGE_FOLDER)))
    hass.data[IMAGE_CACHE] = cache
    hass.http.register_view(TvGuideImageView())

    async def cleanup(_now: datetime) -> None:
        await cache.async_cleanup(UNUSED_FILE_MAX_AGE)

    stop_timer = async_track_time_interval(hass, cleanup, CLEANUP_INTERVAL, name="tv_guide image cleanup")

    def stop(_event: Event) -> None:
        stop_timer()

    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, stop)


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
