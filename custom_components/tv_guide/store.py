"""Disk copy of the guide, so the card works after a restart while the source is down."""

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .model import Guide

STORAGE_VERSION = 1


class GuideStore:
    """Keeps the last parsed guide of one config entry in `.storage`."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        """Create the store for this config entry."""
        self._store: Store[dict] = Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry_id}")

    async def async_load(self) -> Guide | None:
        """Return the stored guide, or None when there is none or it cannot be read."""
        data = await self._store.async_load()
        if data is None:
            return None
        try:
            return Guide.from_dict(data)
        except KeyError, TypeError, ValueError:
            return None

    async def async_save(self, guide: Guide) -> None:
        """Write the guide to disk."""
        await self._store.async_save(guide.to_dict())

    async def async_remove(self) -> None:
        """Delete the file."""
        await self._store.async_remove()
