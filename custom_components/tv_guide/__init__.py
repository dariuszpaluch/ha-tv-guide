"""TV guide for Home Assistant."""

import logging
import shutil
from datetime import datetime
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

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
from .store import GuideStore, ReminderStore
from .websocket_api import async_register_commands

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

CARD_FOLDER = Path(__file__).parent / "frontend"
CARD_URL_PATH = "/tv_guide_frontend"
CARD_FILE = "tv-guide.js"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the WebSocket commands, the poster view and the card once. They serve every entry."""
    async_register_commands(hass)
    _setup_image_cache(hass)
    await _async_setup_card(hass)
    return True


async def _async_setup_card(hass: HomeAssistant) -> None:
    """Serve the built card and ask the Home Assistant frontend to load it on every page.

    The `frontend/` folder is build output. A dev checkout or a CI run has none:
    HA cannot register a static path for a missing folder, so skip the card then.
    """
    if not await hass.async_add_executor_job(CARD_FOLDER.is_dir):
        _LOGGER.warning(
            "The TV guide card is not served: %s is missing. Install the release zip or run 'pnpm build'",
            CARD_FOLDER,
        )
        return
    version = (await async_get_integration(hass, DOMAIN)).version
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL_PATH, str(CARD_FOLDER), cache_headers=False)]
    )
    # The version in the URL makes browsers fetch the new card after an update.
    frontend.add_extra_js_url(hass, f"{CARD_URL_PATH}/{CARD_FILE}?v={version}")


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
    # Registered before the load plans any timer: when the first download fails, Home Assistant
    # runs the unload callbacks and retries, and the timers of this attempt must not stay alive.
    # Unload callbacks run in reverse order, so the listener below goes first: after the timers
    # are cancelled, a guide update must not plan new ones.
    entry.async_on_unload(coordinator.reminders.unload)
    await coordinator.reminders.async_load()
    if await coordinator.async_load_stored():
        entry.async_create_background_task(hass, coordinator.async_refresh(), "tv_guide refresh")
    else:
        await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    # The guide has no entities. A coordinator only schedules its timer while it has a listener.
    # This listener keeps the timer alive and checks the reminders after each update.
    entry.async_on_unload(coordinator.async_add_listener(coordinator.reminders.handle_guide_update))
    # The first guide came before the listener existed, so match the loaded reminders with it now.
    if coordinator.data is not None:
        coordinator.reminders.handle_guide_update()
    return True


async def async_unload_entry(hass: HomeAssistant, entry: TvGuideConfigEntry) -> bool:
    """Unload the entry. The unload callbacks of the entry stop the listener and the reminder timers."""
    return True


async def async_remove_entry(hass: HomeAssistant, entry: TvGuideConfigEntry) -> None:
    """Delete the stored guide and reminders with the entry, and the posters with the last entry.

    All entries share one poster folder. Its daily cleanup runs only while the
    integration is loaded, so without this the posters would stay on disk forever.
    """
    await GuideStore(hass, entry.entry_id).async_remove()
    await ReminderStore(hass, entry.entry_id).async_remove()
    others = [other for other in hass.config_entries.async_entries(DOMAIN) if other.entry_id != entry.entry_id]
    if not others:
        folder = hass.config.path(IMAGE_FOLDER)
        await hass.async_add_executor_job(lambda: shutil.rmtree(folder, ignore_errors=True))
