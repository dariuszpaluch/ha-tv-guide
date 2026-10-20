"""Streaming XMLTV parser.

The parser reads a stream element by element. The decompressed XML (about 100 MB for
epg.ovh) is never in memory as one object, and only the selected channels are kept.
"""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime
from typing import IO

from .const import KEEP_ENDED
from .model import Channel, Guide, Programme

_LOGGER = logging.getLogger(__name__)

XMLTV_TIME_FORMAT = "%Y%m%d%H%M%S %z"
XMLTV_TIME_FORMAT_NO_OFFSET = "%Y%m%d%H%M%S"
ONSCREEN = "onscreen"
YEAR_LENGTH = 4
NO_AGE_LIMIT = "0"


class ParseError(Exception):
    """The source is not valid XMLTV."""


def parse_channels(stream: IO[bytes]) -> list[Channel]:
    """Return every channel of the source, for the config flow."""
    return [_channel(e) for e in _elements(stream, "channel")]


def parse_guide(stream: IO[bytes], channel_ids: set[str], now: datetime) -> Guide:
    """Parse the programmes of the selected channels.

    Programmes that ended more than `KEEP_ENDED` before `now`, programmes without a title and
    a second programme with the same channel and start are dropped. A programme with a time
    that cannot be read is skipped, and one warning with the count is logged at the end.
    The XMLTV format allows a programme without `stop`: it ends when the next one on the channel
    starts. The last programme of a channel without `stop` is dropped, because its end is unknown.
    """
    channels: dict[str, Channel] = {}
    available: dict[str, str] = {}
    found: dict[str, dict[datetime, Programme]] = {cid: {} for cid in channel_ids}
    open_ended: set[tuple[str, datetime]] = set()
    oldest = now - KEEP_ENDED
    skipped = 0
    for element in _elements(stream, "channel", "programme"):
        if element.tag == "channel":
            channel = _channel(element)
            available[channel.id] = channel.name
            if channel.id in channel_ids:
                channels[channel.id] = channel
            continue
        channel_id = element.get("channel", "")
        if channel_id not in channel_ids:
            continue
        try:
            programme = _programme(element)
        except ValueError:
            skipped += 1
            continue
        if not programme:
            continue
        no_stop = element.get("stop") is None
        # The stop of a programme without one is known only after the sort, so check its age then.
        if (no_stop or programme.stop >= oldest) and programme.start not in found[channel_id]:
            found[channel_id][programme.start] = programme
            if no_stop:
                open_ended.add((channel_id, programme.start))
    if skipped:
        _LOGGER.warning("Skipped %d programmes with a bad start or stop time", skipped)
    return Guide(
        channels=channels,
        programmes={cid: _close_open_ended(cid, found[cid], open_ended, oldest) for cid in channels},
        available_channels=available,
        fetched_at=now,
    )


def _close_open_ended(
    channel_id: str, found: dict[datetime, Programme], open_ended: set[tuple[str, datetime]], oldest: datetime
) -> list[Programme]:
    """Sort the programmes of a channel and give each one without `stop` the start of the next one."""
    ordered = sorted(found.values(), key=lambda p: p.start)
    closed: list[Programme] = []
    for index, programme in enumerate(ordered):
        if (channel_id, programme.start) in open_ended:
            if index + 1 == len(ordered):
                continue
            programme = replace(programme, stop=ordered[index + 1].start)
        if programme.stop >= oldest:
            closed.append(programme)
    return closed


def _elements(stream: IO[bytes], *tags: str) -> Iterator[ET.Element]:
    """Yield the finished direct children of the root with these tags.

    Every direct child of the root is cleared after use, also the ones that are not wanted.
    Without that, the root would keep them and the memory would grow with the size of the file.
    """
    root: ET.Element | None = None
    depth = 0
    try:
        for event, element in ET.iterparse(stream, events=("start", "end")):
            if event == "start":
                root = element if root is None else root
                depth += 1
                continue
            depth -= 1
            if depth != 1:
                continue
            if element.tag in tags:
                yield element
            root.clear()
    except ET.ParseError as error:
        raise ParseError(f"Invalid XMLTV: {error}") from error


def _channel(element: ET.Element) -> Channel:
    channel_id = element.get("id", "")
    icon = element.find("icon")
    return Channel(
        id=channel_id,
        name=next((name for e in element.findall("display-name") if (name := _text(e))), channel_id),
        icon=icon.get("src") if icon is not None else None,
    )


def _xmltv_time(value: str) -> datetime:
    """Read an XMLTV time. A time without an offset is UTC, as the XMLTV format says."""
    try:
        return datetime.strptime(value, XMLTV_TIME_FORMAT)
    except ValueError:
        return datetime.strptime(value, XMLTV_TIME_FORMAT_NO_OFFSET).replace(tzinfo=UTC)


def _programme(element: ET.Element) -> Programme | None:
    """Build a programme, or None when it has no title.

    Raises ValueError when the start or stop time cannot be read. A missing `stop` is not an error:
    the programme gets `stop = start` and the caller fills it in from the next programme.
    """
    title = _text(element.find("title"))
    if not title:
        return None
    start = _xmltv_time(element.get("start", ""))
    stop_text = element.get("stop")
    stop = start if stop_text is None else _xmltv_time(stop_text)
    icon = element.find("icon")
    rating = _text(element.find("rating/value"))
    year = _text(element.find("date"))
    return Programme(
        channel_id=element.get("channel", ""),
        start=start,
        stop=stop,
        title=title,
        subtitle=_text(element.find("sub-title")),
        description=_text(element.find("desc")),
        episode=_episode(element),
        categories=tuple(t for c in element.findall("category") if (t := _text(c))),
        image_url=icon.get("src") if icon is not None else None,
        rating=None if rating == NO_AGE_LIMIT else rating,
        star_rating=_text(element.find("star-rating/value")),
        year=year[:YEAR_LENGTH] if year else None,
        countries=tuple(c for e in element.findall("country") for c in _split_countries(_text(e))),
    )


def _episode(element: ET.Element) -> str | None:
    """The `onscreen` episode number if there is one, else the first one."""
    numbers = element.findall("episode-num")
    onscreen = next((n for n in numbers if n.get("system") == ONSCREEN), None)
    chosen = onscreen if onscreen is not None else (numbers[0] if numbers else None)
    return _text(chosen)


def _split_countries(text: str | None) -> list[str]:
    """Split on commas and remove quotes: `"Maroko","USA"` gives Maroko and USA."""
    if not text:
        return []
    return [name for part in text.split(",") if (name := part.strip().strip('"').strip())]


def _text(element: ET.Element | None) -> str | None:
    """Stripped text of an element, or None when it is missing or empty."""
    if element is None or element.text is None:
        return None
    return element.text.strip() or None
