"""Diagnostics for bug reports: the state of the guide, without the login in the source URL."""

from typing import Any

from homeassistant.core import HomeAssistant

from .coordinator import TvGuideConfigEntry
from .model import Guide
from .source import safe_url


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: TvGuideConfigEntry) -> dict[str, Any]:
    """Return what a maintainer needs to see why a channel shows no guide or the guide is old."""
    coordinator = entry.runtime_data
    last_success = coordinator.last_success
    last_error = coordinator.last_exception
    return {
        "source": safe_url(entry.data["url"]),
        "options": dict(entry.options),
        "last_update_success": coordinator.last_update_success,
        # The error text names only the server, see `safe_url`.
        "last_error": f"{type(last_error).__name__}: {last_error}" if last_error else None,
        "last_success": last_success.isoformat() if last_success else None,
        "guide": _guide_summary(coordinator.data, entry.options["channels"]) if coordinator.data else None,
    }


def _guide_summary(guide: Guide, selected: list[str]) -> dict[str, Any]:
    """Counts and the time range of the guide. Titles and descriptions are left out: they do not help."""
    programmes = [programme for channel in guide.programmes.values() for programme in channel]
    return {
        "fetched_at": guide.fetched_at.isoformat(),
        "channels_in_source": len(guide.available_channels),
        "selected_not_in_source": [channel for channel in selected if channel not in guide.available_channels],
        "programmes": {channel: len(guide.programmes.get(channel, [])) for channel in selected},
        "first_start": min(programme.start for programme in programmes).isoformat() if programmes else None,
        "last_stop": max(programme.stop for programme in programmes).isoformat() if programmes else None,
    }
