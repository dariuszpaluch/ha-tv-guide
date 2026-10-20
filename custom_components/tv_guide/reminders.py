"""Reminders: the record, and the match of a reminder with a new guide."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .const import MOVE_WINDOW, REMINDER_LEAD
from .model import Guide, Programme
from .search import normalize


@dataclass(frozen=True, slots=True)
class Reminder:
    """One user's reminder for one programme.

    It keeps a copy of the title and the start. The search for a moved programme needs them,
    and so does the "gone" notice, because then the programme is no longer in the guide.
    """

    user_id: str
    programme_id: str
    channel_id: str
    title: str
    start: datetime
    language: str

    @classmethod
    def from_programme(cls, user_id: str, programme: Programme, language: str) -> Reminder:
        """Make a reminder for a programme of the guide."""
        return cls(
            user_id=user_id,
            programme_id=programme.id,
            channel_id=programme.channel_id,
            title=programme.title,
            start=programme.start,
            language=language,
        )

    @property
    def due(self) -> datetime:
        """When the reminder fires."""
        return self.start - REMINDER_LEAD

    def moved_to(self, programme: Programme) -> Reminder:
        """The same reminder for another airing: new id, start and title."""
        return Reminder(
            user_id=self.user_id,
            programme_id=programme.id,
            channel_id=self.channel_id,
            title=programme.title,
            start=programme.start,
            language=self.language,
        )

    def to_dict(self) -> dict[str, str]:
        """Convert to plain JSON types, to store on disk. The start keeps its offset."""
        return {
            "user_id": self.user_id,
            "programme_id": self.programme_id,
            "channel_id": self.channel_id,
            "title": self.title,
            "start": self.start.isoformat(),
            "language": self.language,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Reminder:
        """Build a reminder from the output of `to_dict`."""
        return cls(
            user_id=data["user_id"],
            programme_id=data["programme_id"],
            channel_id=data["channel_id"],
            title=data["title"],
            start=datetime.fromisoformat(data["start"]),
            language=data["language"],
        )


@dataclass(frozen=True, slots=True)
class ReconcileResult:
    """Reminders after a guide update: the ones to keep (updated) and the ones whose programme is gone."""

    kept: list[Reminder]
    gone: list[Reminder]


def find_moved(reminder: Reminder, guide: Guide) -> Programme | None:
    """The programme of the same channel and title (after `normalize`) closest to the old start.

    Only programmes within `MOVE_WINDOW` of the old start count.
    """
    title = normalize(reminder.title)
    candidates = [
        p
        for p in guide.programmes.get(reminder.channel_id, [])
        if normalize(p.title) == title and abs(p.start - reminder.start) <= MOVE_WINDOW
    ]
    return min(candidates, key=lambda p: abs(p.start - reminder.start), default=None)


def reconcile(reminders: list[Reminder], guide: Guide) -> ReconcileResult:
    """Match every reminder with the new guide.

    A reminder is gone only when its channel has programmes around the old start but none is
    the right one. A channel with no data there (deselected, a gap in the source) keeps the
    reminder as it is: this stops false "gone" notices.
    """
    kept: list[Reminder] = []
    gone: list[Reminder] = []
    for reminder in reminders:
        found = guide.find(reminder.programme_id) or find_moved(reminder, guide)
        if found:
            kept.append(reminder.moved_to(found))
        elif _has_data_around(reminder, guide):
            gone.append(reminder)
        else:
            kept.append(reminder)
    return ReconcileResult(kept=kept, gone=gone)


def _has_data_around(reminder: Reminder, guide: Guide) -> bool:
    """Whether the channel has a programme that overlaps the window around the old start."""
    low, high = reminder.start - MOVE_WINDOW, reminder.start + MOVE_WINDOW
    return any(p.start < high and p.stop > low for p in guide.programmes.get(reminder.channel_id, []))
