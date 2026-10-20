"""Reminders: the record, and the match of a reminder with a new guide."""

from __future__ import annotations

import logging
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.event import async_track_point_in_utc_time
from homeassistant.helpers.start import async_at_started
from homeassistant.util import dt as dt_util

from .const import MOVE_WINDOW, REMINDER_LEAD
from .delivery import ReminderKind, async_deliver, supported_language
from .model import Guide, Programme
from .search import normalize

if TYPE_CHECKING:
    # `store.py` imports `Reminder` from this module, so a normal import here would be circular.
    from .store import ReminderStore

_LOGGER = logging.getLogger(__name__)

type ReminderKey = tuple[str, str]


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
        """Build a reminder from the output of `to_dict`.

        Raises `ValueError` when the start has no offset: a time without a time zone is not
        a valid stored reminder.
        """
        start = datetime.fromisoformat(data["start"])
        if start.tzinfo is None:
            raise ValueError("The start of a reminder needs a time zone")
        return cls(
            user_id=data["user_id"],
            programme_id=data["programme_id"],
            channel_id=data["channel_id"],
            title=data["title"],
            start=start,
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
        if abs(p.start - reminder.start) <= MOVE_WINDOW and normalize(p.title) == title
    ]
    return min(candidates, key=lambda p: abs(p.start - reminder.start), default=None)


def reconcile(reminders: list[Reminder], guide: Guide) -> ReconcileResult:
    """Match every reminder with the new guide.

    A reminder is gone only when the channel has a programme at the old start and no moved
    copy of the reminder programme exists. Without a programme at the old start (the channel
    is deselected, or the source has a gap) the reminder stays as it is: this stops false
    "gone" notices.
    """
    kept: list[Reminder] = []
    gone: list[Reminder] = []
    for reminder in reminders:
        found = guide.find(reminder.programme_id) or find_moved(reminder, guide)
        if found:
            kept.append(reminder.moved_to(found))
        elif _has_programme_at_start(reminder, guide):
            gone.append(reminder)
        else:
            kept.append(reminder)
    return ReconcileResult(kept=kept, gone=gone)


def _has_programme_at_start(reminder: Reminder, guide: Guide) -> bool:
    """Whether a programme of the channel is on air at the old start of the reminder."""
    return any(p.start <= reminder.start < p.stop for p in guide.programmes.get(reminder.channel_id, []))


class TooLate(Exception):
    """The reminder time of the programme has already passed."""


class ReminderManager:
    """The reminders of one config entry: the list, the disk copy and one timer per reminder.

    A reminder leaves the list and the disk copy before its notification is sent. A restart
    between the two cannot send the same notification twice.
    """

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        store: ReminderStore,
        guide: Callable[[], Guide | None],
    ) -> None:
        """Create the manager. `guide` gives the current guide, or None before the first one."""
        self._hass = hass
        self._entry = entry
        self._store = store
        self._guide = guide
        self._reminders: list[Reminder] = []
        self._timers: dict[ReminderKey, CALLBACK_TYPE] = {}
        self._started_waiters: list[CALLBACK_TYPE] = []
        self._unloaded = False

    async def async_load(self) -> None:
        """Read the reminders from disk and plan their timers."""
        self._reminders = await self._store.async_load()
        await self._async_plan_timers()

    @property
    def count(self) -> int:
        """How many reminders all users have. For diagnostics."""
        return len(self._reminders)

    def for_user(self, user_id: str) -> list[Reminder]:
        """The reminders of one user, the soonest first."""
        return sorted((r for r in self._reminders if r.user_id == user_id), key=lambda r: r.start)

    async def async_add(self, user_id: str, programme: Programme, language: str) -> None:
        """Add a reminder. A second one for the same user and programme changes nothing.

        Raises `TooLate` when the reminder time has passed.
        """
        if any(r.user_id == user_id and r.programme_id == programme.id for r in self._reminders):
            return
        if programme.start - REMINDER_LEAD <= dt_util.utcnow():
            raise TooLate
        self._reminders = [*self._reminders, Reminder.from_programme(user_id, programme, supported_language(language))]
        await self._store.async_save(self._reminders)
        await self._async_plan_timers()

    async def async_remove(self, user_id: str, programme_id: str) -> None:
        """Remove a reminder. A missing one is not an error."""
        kept = [r for r in self._reminders if (r.user_id, r.programme_id) != (user_id, programme_id)]
        if len(kept) == len(self._reminders):
            return
        self._reminders = kept
        await self._store.async_save(self._reminders)
        await self._async_plan_timers()

    @callback
    def handle_guide_update(self) -> None:
        """Match the reminders with the new guide. A listener of the coordinator."""
        self._entry.async_create_background_task(self._hass, self._async_reconcile(), "tv_guide reminders")

    @callback
    def unload(self) -> None:
        """Cancel all timers, and the sends that wait for the start of Home Assistant."""
        self._unloaded = True
        self._cancel_timers()
        for cancel in self._started_waiters:
            cancel()
        self._started_waiters.clear()

    async def _async_reconcile(self) -> None:
        """Move the reminders of moved programmes, and tell the user about the gone ones."""
        guide = self._guide()
        if guide is None:
            return
        result = reconcile(self._reminders, guide)
        # Two reminders of one user can land on the same moved programme. Keep the first.
        unique: dict[ReminderKey, Reminder] = {}
        for reminder in result.kept:
            unique.setdefault((reminder.user_id, reminder.programme_id), reminder)
        self._reminders = list(unique.values())
        await self._store.async_save(self._reminders)
        await self._async_plan_timers()
        for reminder in result.gone:
            await self._async_deliver(reminder, "gone")

    async def _async_plan_timers(self) -> None:
        """Plan the timers again for the whole list.

        A reminder whose programme has started is dropped without a notice. One that is due
        but whose programme has not started is sent as soon as Home Assistant has started: at
        startup the `mobile_app` notify services may not exist yet.
        """
        if self._unloaded:
            return
        self._cancel_timers()
        now = dt_util.utcnow()
        before = len(self._reminders)
        due_now = [r for r in self._reminders if r.start > now >= r.due]
        self._reminders = [r for r in self._reminders if r.due > now]
        for reminder in self._reminders:
            self._timers[reminder.user_id, reminder.programme_id] = async_track_point_in_utc_time(
                self._hass, self._timer_action(reminder), reminder.due
            )
        if len(self._reminders) != before:
            await self._store.async_save(self._reminders)
        # The save above waits, so an unload can have happened meanwhile.
        if due_now and not self._unloaded:
            self._send_when_started(due_now)

    def _send_when_started(self, reminders: list[Reminder]) -> None:
        """Send the reminders in a background task of the entry, once Home Assistant is running.

        This runs at once when Home Assistant is already running. `unload` cancels a send that
        still waits.
        """

        @callback
        def send(_hass: HomeAssistant) -> None:
            self._entry.async_create_background_task(self._hass, self._async_send_all(reminders), "tv_guide reminders")

        self._started_waiters.append(async_at_started(self._hass, send))

    async def _async_send_all(self, reminders: list[Reminder]) -> None:
        """Send the "starting" notice of each reminder. They are already deleted and saved."""
        for reminder in reminders:
            await self._async_deliver(reminder, "starting")

    def _timer_action(self, reminder: Reminder) -> Callable[[datetime], Coroutine[Any, Any, None]]:
        """The function a timer calls: it fires this reminder, and only this one."""

        async def fire(_now: datetime) -> None:
            if reminder not in self._reminders:
                return
            self._timers.pop((reminder.user_id, reminder.programme_id), None)
            self._reminders = [r for r in self._reminders if r != reminder]
            await self._store.async_save(self._reminders)
            await self._async_deliver(reminder, "starting")

        return fire

    def _cancel_timers(self) -> None:
        for cancel in self._timers.values():
            cancel()
        self._timers.clear()

    async def _async_deliver(self, reminder: Reminder, kind: ReminderKind) -> None:
        """Send the notification. The caller has already removed and saved the reminder.

        A failure is logged and goes no further: the other reminders must still be sent.
        """
        guide = self._guide()
        channel = guide.channels.get(reminder.channel_id) if guide else None
        try:
            await async_deliver(self._hass, reminder, kind, channel.name if channel else reminder.channel_id)
        except Exception:
            _LOGGER.exception("Cannot send the %s notice of the reminder for %s", kind, reminder.title)
