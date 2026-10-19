"""Queries over the guide: what is on now, a schedule, search and other airings."""

from __future__ import annotations

import unicodedata
from bisect import bisect_left, bisect_right
from collections.abc import Callable
from datetime import datetime, timedelta

from .model import Guide, Programme

AIRINGS_MIN_DURATION = timedelta(minutes=15)


# Letters that NFKD does not split into a base letter and a mark ("Title matching" in docs/api.md).
# The card has the same table in frontend/src/utils/normalize.ts.
_FOLD = str.maketrans({"ł": "l", "ß": "ss", "ı": "i", "ø": "o", "đ": "d", "æ": "ae", "œ": "oe"})


def normalize(text: str) -> str:
    """Text for matching: lower case, no diacritics, a few letters folded, no outer whitespace."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    without_marks = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return without_marks.translate(_FOLD).strip()


def now_on_air(guide: Guide, channel_ids: list[str], now: datetime) -> dict[str, Programme | None]:
    """Map every channel id to the programme on air at `now` (`start <= now < stop`), or None."""
    return {channel_id: _on_air(guide.programmes.get(channel_id, []), now) for channel_id in channel_ids}


def schedule(guide: Guide, channel_id: str, start: datetime, end: datetime) -> list[Programme]:
    """Programmes of a channel that overlap `[start, end)`, sorted by start."""
    items = guide.programmes.get(channel_id, [])
    # The programme on air at `start` begins before it, so step one back from the first later one.
    # Same assumption as `_on_air`: only that one programme can overlap `start`.
    first = max(bisect_right(items, start, key=_start) - 1, 0)
    last = bisect_left(items, end, key=_start)
    return [p for p in items[first:last] if p.stop > start]


def search_now(guide: Guide, query: str, channel_ids: list[str], now: datetime) -> list[Programme]:
    """Programmes on air at `now` whose title contains the query, in the order of `channel_ids`."""
    matches = _title_matcher(query)
    on_air = now_on_air(guide, channel_ids, now)
    return [p for p in on_air.values() if p is not None and matches(p)]


def search_later(guide: Guide, query: str, channel_ids: list[str], now: datetime, limit: int) -> list[Programme]:
    """Next programmes after `now` whose title contains the query, soonest first.

    Only the first airing per channel and title is listed. More airings come from `airings`.
    """
    matches = _title_matcher(query)
    found: dict[tuple[str, str], Programme] = {}
    for channel_id in dict.fromkeys(channel_ids):
        for p in _after(guide.programmes.get(channel_id, []), now):
            if matches(p):
                found.setdefault((channel_id, normalize(p.title)), p)
    return sorted(found.values(), key=_start)[:limit]


def airings(guide: Guide, programme_id: str, channel_ids: list[str], now: datetime, limit: int) -> list[Programme]:
    """Later programmes with the same title as this one, the programme's own channel first.

    Short programmes have no airings: titles like "Pogoda" would match unrelated programmes.
    """
    programme = guide.find(programme_id)
    if programme is None or programme.stop - programme.start < AIRINGS_MIN_DURATION:
        return []
    title = normalize(programme.title)

    def same_title(channel_id: str) -> list[Programme]:
        return [
            p
            for p in _after(guide.programmes.get(channel_id, []), now)
            if p.id != programme.id and normalize(p.title) == title
        ]

    other_channels = (c for c in dict.fromkeys(channel_ids) if c != programme.channel_id)
    # Stable sort: channels earlier in `channel_ids` win a tie.
    others = sorted((p for c in other_channels for p in same_title(c)), key=_start)
    return [*same_title(programme.channel_id), *others][:limit]


def _start(programme: Programme) -> datetime:
    return programme.start


def _on_air(items: list[Programme], now: datetime) -> Programme | None:
    # Assumes only the programme just before `now` can still run. A guide with deeper overlap is broken anyway.
    index = bisect_right(items, now, key=_start)
    if index == 0 or items[index - 1].stop <= now:
        return None
    return items[index - 1]


def _after(items: list[Programme], now: datetime) -> list[Programme]:
    return items[bisect_right(items, now, key=_start) :]


def _title_matcher(query: str) -> Callable[[Programme], bool]:
    needle = normalize(query)
    return lambda programme: needle in normalize(programme.title)
