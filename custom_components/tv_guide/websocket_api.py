"""WebSocket commands for the card. The contract is `docs/api.md`."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime
from functools import wraps
from typing import Any

import probatio as pb
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .coordinator import TvGuideCoordinator
from .model import channel_to_json, programme_to_json
from .search import airings, normalize, now_on_air, schedule, search_later, search_now

ERR_NOT_LOADED = "not_loaded"
MIN_QUERY_LENGTH = 2
DEFAULT_SEARCH_LIMIT = 40
MAX_SEARCH_LIMIT = 100
DEFAULT_AIRINGS_LIMIT = 20
MAX_AIRINGS_LIMIT = 50

type CoordinatorHandler = Callable[
    [HomeAssistant, websocket_api.ActiveConnection, dict[str, Any], TvGuideCoordinator], Awaitable[None]
]


class GuideNotFound(Exception):
    """There is no `tv_guide` entry, or no entry with the requested id."""


class GuideNotLoaded(Exception):
    """The entry exists but is not loaded, for example while Home Assistant retries the setup."""


def get_coordinator(hass: HomeAssistant, entry_id: str | None) -> TvGuideCoordinator:
    """Return the coordinator of an entry. Without `entry_id`, the first `tv_guide` entry.

    Raises:
        GuideNotFound: there is no such entry.
        GuideNotLoaded: the entry is not in the loaded state.
    """
    entries = hass.config_entries.async_entries(DOMAIN)
    entry = next((e for e in entries if entry_id is None or e.entry_id == entry_id), None)
    if entry is None:
        raise GuideNotFound(entry_id or DOMAIN)
    if entry.state is not ConfigEntryState.LOADED:
        raise GuideNotLoaded(entry.entry_id)
    return entry.runtime_data


def _parse_time(value: str) -> datetime | None:
    """Parse an ISO 8601 time with an offset. Return None for anything else.

    `parse_datetime` returns None for text that is not a time, but it raises `ValueError`
    for well-formed text with impossible values, such as hour 25. A time without an offset
    is ambiguous. The card always sends one.
    """
    try:
        parsed = dt_util.parse_datetime(value)
    except ValueError:
        return None
    return parsed if parsed and parsed.tzinfo else None


def async_register_commands(hass: HomeAssistant) -> None:
    """Register all commands. Call once, from `async_setup`."""
    for handler in (ws_info, ws_channels, ws_now, ws_schedule, ws_search, ws_airings):
        websocket_api.async_register_command(hass, handler)


def _with_coordinator(handler: CoordinatorHandler) -> websocket_api.const.AsyncWebSocketCommandHandler:
    """Find the coordinator for the command and send `not_found` or `not_loaded` when there is none."""

    @wraps(handler)
    async def wrapper(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
        try:
            coordinator = get_coordinator(hass, msg.get("entry_id"))
        except GuideNotFound:
            connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "No such TV guide entry")
            return
        except GuideNotLoaded:
            connection.send_error(msg["id"], ERR_NOT_LOADED, "The TV guide is not loaded yet")
            return
        await handler(hass, connection, msg, coordinator)

    return wrapper


@websocket_api.websocket_command({"type": f"{DOMAIN}/info", pb.Optional("entry_id"): str})
@websocket_api.async_response
@_with_coordinator
async def ws_info(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    coordinator: TvGuideCoordinator,
) -> None:
    """Send when the guide was last loaded and how often it updates, in hours."""
    last_success = coordinator.last_success
    connection.send_result(
        msg["id"],
        {
            "last_success": last_success.isoformat() if last_success else None,
            "update_interval": coordinator.config_entry.options["update_interval"],
        },
    )


@websocket_api.websocket_command({"type": f"{DOMAIN}/channels", pb.Optional("entry_id"): str})
@websocket_api.async_response
@_with_coordinator
async def ws_channels(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    coordinator: TvGuideCoordinator,
) -> None:
    """Send the selected channels, sorted by name."""
    channels = sorted(coordinator.data.channels.values(), key=lambda c: c.name.casefold())
    connection.send_result(msg["id"], [channel_to_json(c) for c in channels])


@websocket_api.websocket_command(
    {"type": f"{DOMAIN}/now", pb.Optional("entry_id"): str, pb.Required("channel_ids"): [str]}
)
@websocket_api.async_response
@_with_coordinator
async def ws_now(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    coordinator: TvGuideCoordinator,
) -> None:
    """Send the programme on air now for every requested channel."""
    on_air = now_on_air(coordinator.data, msg["channel_ids"], dt_util.now())
    connection.send_result(msg["id"], {cid: p and programme_to_json(p) for cid, p in on_air.items()})


@websocket_api.websocket_command(
    {
        "type": f"{DOMAIN}/schedule",
        pb.Optional("entry_id"): str,
        pb.Required("channel_id"): str,
        pb.Required("start"): str,
        pb.Required("end"): str,
    }
)
@websocket_api.async_response
@_with_coordinator
async def ws_schedule(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    coordinator: TvGuideCoordinator,
) -> None:
    """Send the programmes of a channel that overlap the time range."""
    start, end = _parse_time(msg["start"]), _parse_time(msg["end"])
    if start is None or end is None:
        connection.send_error(
            msg["id"], websocket_api.ERR_INVALID_FORMAT, "start and end need ISO 8601 times with an offset"
        )
        return
    programmes = schedule(coordinator.data, msg["channel_id"], start, end)
    connection.send_result(msg["id"], [programme_to_json(p) for p in programmes])


@websocket_api.websocket_command(
    {
        "type": f"{DOMAIN}/search",
        pb.Optional("entry_id"): str,
        pb.Required("query"): str,
        pb.Required("channel_ids"): [str],
        pb.Required("when"): pb.In(["now", "later"]),
        pb.Optional("limit", default=DEFAULT_SEARCH_LIMIT): pb.All(int, pb.Range(min=1, max=MAX_SEARCH_LIMIT)),
    }
)
@websocket_api.async_response
@_with_coordinator
async def ws_search(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    coordinator: TvGuideCoordinator,
) -> None:
    """Send the programmes whose title contains the query, on air now or later."""
    if len(normalize(msg["query"])) < MIN_QUERY_LENGTH:
        connection.send_error(
            msg["id"], websocket_api.ERR_INVALID_FORMAT, f"The query needs at least {MIN_QUERY_LENGTH} characters"
        )
        return
    now = dt_util.now()
    if msg["when"] == "now":
        found = search_now(coordinator.data, msg["query"], msg["channel_ids"], now)[: msg["limit"]]
    else:
        # Normalizes every title after `now`: about 0.25 s for 100 channels with 14 days, so not in the event loop.
        # The executor only reads the guide. A refresh swaps in a new `Guide`, it never changes the old one.
        found = await hass.async_add_executor_job(
            search_later, coordinator.data, msg["query"], msg["channel_ids"], now, msg["limit"]
        )
    connection.send_result(msg["id"], [programme_to_json(p) for p in found])


@websocket_api.websocket_command(
    {
        "type": f"{DOMAIN}/airings",
        pb.Optional("entry_id"): str,
        pb.Required("programme_id"): str,
        pb.Required("channel_ids"): [str],
        pb.Optional("limit", default=DEFAULT_AIRINGS_LIMIT): pb.All(int, pb.Range(min=1, max=MAX_AIRINGS_LIMIT)),
    }
)
@websocket_api.async_response
@_with_coordinator
async def ws_airings(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
    coordinator: TvGuideCoordinator,
) -> None:
    """Send later airings of the same programme title."""
    # Same cost as a "later" search: it normalizes every later title. See `ws_search`.
    found = await hass.async_add_executor_job(
        airings, coordinator.data, msg["programme_id"], msg["channel_ids"], dt_util.now(), msg["limit"]
    )
    connection.send_result(msg["id"], [programme_to_json(p) for p in found])
