"""Delivery of a reminder: the notification on the phones of the user, and the event."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.translation import async_get_translations
from homeassistant.util import dt as dt_util
from homeassistant.util import slugify

from .const import DOMAIN

if TYPE_CHECKING:
    # `reminders.py` imports this module, so a normal import here would be circular.
    from .reminders import Reminder

_LOGGER = logging.getLogger(__name__)

type ReminderKind = Literal["starting", "gone"]

EVENT_REMINDER = "tv_guide_reminder"
SUPPORTED_LANGUAGES = ("en", "pl")
DEFAULT_LANGUAGE = "en"
MOBILE_APP = "mobile_app"
TIME_FORMAT = "%H:%M"


@dataclass(frozen=True, slots=True)
class Phone:
    """A phone with the Companion app: its name and its notify service (without `notify.`)."""

    name: str
    service: str


def supported_language(language: str) -> str:
    """The language of the texts for a browser or HA language code. Unknown languages become English."""
    base = language.split("-")[0].lower()
    return base if base in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE


def find_phones(hass: HomeAssistant, user_id: str, *, warn_on_clash: bool = False) -> list[Phone]:
    """The phones of a user that can get a push notification, sorted by name.

    `mobile_app` does not promise this as a public API. It keeps one config entry per phone,
    with the user and the name of the phone, and names the notify service
    `mobile_app_<name>`. The name is not unique: two phones with one name share one service,
    and that service reaches only one of them. So a service whose name belongs to phones of
    more than one user is left out for everyone: it could send a reminder to the wrong person.
    A phone with push turned off has no service, so it is left out too.

    The warning about a clash is off by default, because the card asks for the list every
    minute. A delivery turns it on: it happens rarely, and the log then names the cause.
    """
    owners: dict[str, set[str | None]] = {}
    own: dict[str, str] = {}
    for entry in hass.config_entries.async_entries(MOBILE_APP):
        name = entry.data.get("device_name")
        if not name:
            continue
        service = slugify(f"{MOBILE_APP}_{name}")
        owners.setdefault(service, set()).add(entry.data.get("user_id"))
        if entry.data.get("user_id") == user_id:
            own.setdefault(service, name)
    phones: list[Phone] = []
    for service, name in own.items():
        if len(owners[service]) > 1:
            if warn_on_clash:
                _LOGGER.warning(
                    "Two users have a phone named %s in the Companion app, so no reminder goes to it. "
                    "Rename one of the phones.",
                    name,
                )
            continue
        if hass.services.has_service("notify", service):
            phones.append(Phone(name, service))
    return sorted(phones, key=lambda phone: phone.name)


async def async_deliver(hass: HomeAssistant, reminder: Reminder, kind: ReminderKind, channel_name: str) -> None:
    """Notify every phone of the user, then fire the event.

    A failure on one phone is logged and does not stop the others.
    """
    title, message = await _async_texts(hass, reminder, kind, channel_name)
    data = {"title": title, "message": message, "data": {"tag": f"tv_guide_{reminder.programme_id}"}}
    for phone in find_phones(hass, reminder.user_id, warn_on_clash=True):
        try:
            await hass.services.async_call("notify", phone.service, data, blocking=True)
        except HomeAssistantError as err:
            _LOGGER.warning("Cannot send the reminder to the phone %s: %s", phone.name, err)
    hass.bus.async_fire(
        EVENT_REMINDER,
        {
            "kind": kind,
            "user_id": reminder.user_id,
            "programme_id": reminder.programme_id,
            "channel_id": reminder.channel_id,
            "channel_name": channel_name,
            "title": reminder.title,
            "start": reminder.start.isoformat(),
        },
    )


async def _async_texts(
    hass: HomeAssistant, reminder: Reminder, kind: ReminderKind, channel_name: str
) -> tuple[str, str]:
    """The title and the message of the notification, in the language of the reminder.

    The texts live in the `exceptions` category of the translations: hassfest accepts free
    texts with placeholders only there.
    """
    texts = await async_get_translations(hass, supported_language(reminder.language), "exceptions", {DOMAIN})

    def text(key: str, **values: str) -> str:
        return texts[f"component.{DOMAIN}.exceptions.{key}.message"].format(**values)

    if kind == "gone":
        return channel_name, text("reminder_gone_message", title=reminder.title)
    # The title already has the start time, so the message is only the programme title.
    time = dt_util.as_local(reminder.start).strftime(TIME_FORMAT)
    return text("reminder_starting_title", channel_name=channel_name, time=time), reminder.title
