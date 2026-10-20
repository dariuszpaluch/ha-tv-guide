"""Coordinator: downloads and parses the XMLTV source on a timer and keeps the guide."""

import logging
import lzma
import zipfile
import zlib
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import IO

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .model import Guide
from .parser import ParseError, parse_guide
from .source import SourceError, fetch_source, open_source
from .store import GuideStore

_LOGGER = logging.getLogger(__name__)

type TvGuideConfigEntry = ConfigEntry[TvGuideCoordinator]

# A broken gzip or xz file fails while the parser reads it, not when the stream opens.
SOURCE_READ_ERRORS = (SourceError, ParseError, OSError, EOFError, zlib.error, lzma.LZMAError, zipfile.BadZipFile)


def read_source[T](raw: bytes, parse: Callable[[IO[bytes]], T]) -> T:
    """Open the downloaded bytes and run `parse` on the stream. Blocking: call it in the executor."""
    with open_source(raw) as stream:
        return parse(stream)


class TvGuideCoordinator(DataUpdateCoordinator[Guide]):
    """Holds the guide of one config entry."""

    config_entry: TvGuideConfigEntry

    def __init__(self, hass: HomeAssistant, entry: TvGuideConfigEntry) -> None:
        """Create the coordinator. The interval comes from the entry options, in hours."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            config_entry=entry,
            update_interval=timedelta(hours=entry.options["update_interval"]),
        )
        self._store = GuideStore(hass, entry.entry_id)
        self._last_success: datetime | None = None

    @property
    def last_success(self) -> datetime | None:
        """When the guide was last loaded from the source, or None."""
        return self._last_success

    async def async_load_stored(self) -> bool:
        """Use the stored guide as the current data. Return False when it is missing or has no selected channel.

        The guide is cut to the current selection. A channel that is new in the selection has
        no programmes until the first download works. Without a common channel the stored guide
        would show nothing, so the setup waits for the download instead.
        """
        guide = await self._store.async_load()
        if guide is None or not self._selected & set(guide.channels):
            return False
        guide = guide.for_selection(self._selected)
        self.async_set_updated_data(guide)
        self._last_success = guide.fetched_at
        return True

    @property
    def _selected(self) -> set[str]:
        return set(self.config_entry.options["channels"])

    async def _async_update_data(self) -> Guide:
        """Download and parse the source, then store the guide.

        Raises:
            UpdateFailed: the download or the parsing failed. The current guide stays.
        """
        session = async_get_clientsession(self.hass)
        now = dt_util.now()
        try:
            raw = await fetch_source(session, self.config_entry.data["url"])
            guide = await self.hass.async_add_executor_job(
                read_source, raw, lambda stream: parse_guide(stream, self._selected, now)
            )
        except SOURCE_READ_ERRORS as err:
            raise UpdateFailed(f"Cannot update the guide: {err}") from err
        await self._store.async_save(guide)
        self._last_success = now
        return guide
