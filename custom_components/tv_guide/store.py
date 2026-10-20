"""Disk copy of the guide, so the card works after a restart while the source is down."""

import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .model import Guide
from .reminders import Reminder

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1


class GuideStore:
    """Keeps the last parsed guide of one config entry in `.storage`."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        """Create the store for this config entry."""
        self._hass = hass
        self._store: Store[dict] = Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry_id}")

    async def async_load(self) -> Guide | None:
        """Return the stored guide, or None when there is none or it cannot be read."""
        data = await self._store.async_load()
        if data is None:
            return None
        try:
            # Parsing every time string of a big guide would block the event loop for a while.
            return await self._hass.async_add_executor_job(Guide.from_dict, data)
        except KeyError, TypeError, ValueError:
            return None

    async def async_save(self, guide: Guide) -> None:
        """Write the guide to disk. `Store` encodes the JSON in the executor, and so does the dict conversion."""
        await self._store.async_save(await self._hass.async_add_executor_job(guide.to_dict))

    async def async_remove(self) -> None:
        """Delete the file."""
        await self._store.async_remove()


class ReminderStore:
    """Keeps the reminders of one config entry in `.storage`, apart from the large guide file."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        """Create the store for this config entry."""
        self._store: Store[dict] = Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry_id}.reminders")

    async def async_load(self) -> list[Reminder]:
        """Return the stored reminders. A missing or damaged file gives none."""
        data = await self._store.async_load()
        if data is None:
            return []
        try:
            return [Reminder.from_dict(item) for item in data["reminders"]]
        except KeyError, TypeError, ValueError:
            _LOGGER.warning("The stored reminders are damaged, starting with none")
            return []

    async def async_save(self, reminders: list[Reminder]) -> None:
        """Write the reminders to disk."""
        await self._store.async_save({"reminders": [reminder.to_dict() for reminder in reminders]})

    async def async_remove(self) -> None:
        """Delete the file."""
        await self._store.async_remove()
