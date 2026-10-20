# Reminders - design

Date: 2026-10-20. Status: approved, implemented.

## What problem does it solve?

You see a programme in the card that starts later. You want to watch it, but you forget. With a reminder, your phone tells you 5 minutes before the programme starts.

## Decisions

| Question | Decision |
| --- | --- |
| Who gets the notification | The phones of the HA user who set the reminder. The integration finds them. Nothing to set up. |
| When | 5 minutes before the start. Fixed, no setting. |
| How the integration fires on time | One HA timer per reminder. One function plans all timers again after every change. |
| After it fires | The reminder is deleted. |
| Programme on now, or it starts in 5 minutes or less | No bell. The server refuses it too. |
| Programme moved in the guide | Find the same channel and title within ±3 hours of the old start. Take the closest one. Move the reminder there. |
| Programme gone from the guide | Send one notice ("‹title› is no longer in the guide") and delete the reminder. |
| Language of the notification | The language of the user's HA profile. The card sends it when it adds the reminder. English or Polish, English for anything else. |
| Your own automations | Each notification also fires the event `tv_guide_reminder`. |

Not in this version: a "Switch" button in the notification, a poster in the notification, a list of all reminders in the card, a tap that opens the dashboard, a lead time other than 5 minutes.

## How the integration finds the phones

The Companion app registers each phone with HA. HA keeps a `mobile_app` config entry for each phone. The entry stores:

- `user_id`: the HA user who logged in on the phone (`mobile_app/http_api.py`, `data[CONF_USER_ID] = user.id`).
- `device_name`: the name of the phone.

HA names the notify service of a phone `notify.` + `slugify("mobile_app_" + device_name)` (`notify/legacy.py`).

So, for a user:

1. List `hass.config_entries.async_entries("mobile_app")`.
2. Keep the entries with `data["user_id"] == user_id`.
3. Build the service name from `data["device_name"]`.
4. Keep the names where `hass.services.has_service("notify", name)`. A phone with push turned off has no service.

Risk: `mobile_app` does not promise this as a public API. HA's own code uses it, and it has been stable for years. The tests pin it with a fake `mobile_app` entry and a fake notify service. A change in HA breaks the tests, not users in silence.

## Parts

### Integration

**`reminders.py` (new).** All reminder logic. Two layers:

- Pure functions, no `hass`. Easy to test.
  - `reconcile(reminders, guide, now) -> ReconcileResult`: for each reminder, find the programme by `id`. If it is not there, look for a moved copy. Return the updated reminders, and the reminders that are gone.
  - `find_moved(reminder, guide) -> Programme | None`: same channel, same title after `normalize` (the rule in `docs/api.md`, "Title matching"), start within ±3 hours, the closest start wins.
  - A reminder is "gone" only when the guide has programmes on its channel around the old start. If the channel has no data there (deselected channel, a short gap in the source), the reminder stays as it is. This stops false "gone" notices.
- `ReminderManager`: one per config entry. It owns the store, the timers and the delivery.
  - `async_load()`: read the store, plan the timers.
  - `async_add(user_id, programme, language)`, `async_remove(user_id, programme_id)`, `for_user(user_id)`.
  - `async_guide_updated()`: a coordinator listener. It runs `reconcile`, saves, sends the "gone" notices and plans the timers.
  - `_plan_timers()`: cancel all timers. For each reminder, set `async_track_point_in_utc_time` at start minus 5 minutes. A reminder whose time has passed but whose programme has not started fires at once. A reminder whose programme has started is deleted without a notification.
  - `async_unload()`: cancel all timers.

**Reminder record.** Stored on disk, in `.storage/tv_guide.<entry_id>.reminders`, a separate `Store` from the guide (the guide file is large and is written only after a download):

```json
{
  "reminders": [
    {
      "user_id": "abc123",
      "programme_id": "TVN|2026-10-19T18:00:00Z",
      "channel_id": "TVN",
      "title": "Fakty",
      "start": "2026-10-19T20:00:00+02:00",
      "language": "pl"
    }
  ]
}
```

The record keeps a copy of the title and the start. The "moved" search needs them, and so does the "gone" notice, because then the programme is no longer in the guide. One user has at most one reminder per programme.

**Delivery (`delivery.py`, new).** Not `notify.py`: HA treats a `notify.py` in an integration as a notify platform.

- `find_phones(hass, user_id) -> list[str]`: the steps from "How the integration finds the phones".
- `async_send(hass, reminder, kind)`: build the title and the text in the reminder's language. Call each phone's notify service. A failure on one phone is logged and does not stop the others. Then fire the `tv_guide_reminder` event.
- Texts come from `translations/*.json`, category `exceptions`, with `async_get_translations`. `exceptions` is the only category that hassfest accepts for free texts with placeholders.
- Notification for "starting": title `TVN · 20:00`, text `Fakty starts in 5 minutes`. For "gone": title `TVN`, text `Fakty is no longer in the guide`. The time is in the HA server's time zone, 24-hour.
- Notification data: `tag: "tv_guide_<programme_id>"`, so a second notice for the same programme replaces the first one on the phone.
- Event data: `kind` (`starting` or `gone`), `user_id`, `programme_id`, `channel_id`, `channel_name`, `title`, `start`.

**Wiring.**

- The coordinator gets a `reminders: ReminderManager` attribute. `entry.runtime_data` stays the coordinator. This avoids a change in every place that reads `runtime_data`.
- `async_setup_entry`: load the reminders before the guide. Replace the no-op listener with `reminders.async_guide_updated`. It keeps the coordinator timer alive, as before, and now it does real work. Cancel the timers on unload.
- `async_remove_entry`: delete the reminder store too.
- Diagnostics: add the number of reminders. No user ids, no titles.

### WebSocket API (needs your approval: `docs/api.md` changes)

New type:

```
Reminder { programme_id, channel_id, title, start }
Reminders { reminders: Reminder[], phones: string[] }
```

`phones` is the list of the user's phone names that will get the notification. An empty list lets the card warn: "No phone with the Home Assistant app found for your user".

| Command | Input | Result |
| --- | --- | --- |
| `tv_guide/reminders/list` | `entry_id?` | `Reminders` of the user who sends the command |
| `tv_guide/reminders/add` | `entry_id?`, `programme_id`, `language` | `Reminders` after the change. Adding the same programme again is not an error. |
| `tv_guide/reminders/remove` | `entry_id?`, `programme_id` | `Reminders` after the change. Removing a missing reminder is not an error. |

The user comes from the WebSocket connection (`connection.user`), never from the input.

New error code `too_late`: `add` for a programme that starts in 5 minutes or less, or has started. `add` for an unknown `programme_id` gives `not_found`.

Every reminder command answers with the full list, so the card needs one round trip and never gets out of step.

### Card

- `GuideClient`: `reminders()`, `addReminder(programmeId, language)`, `removeReminder(programmeId)`. No cache.
- `tv-guide.ts`: a `reminders` state. `refresh()` loads it every 60 seconds, apart from the guide calls, so a reminders failure does not break the guide. After a reminder fires on the server, the bell turns off on the next refresh.
- Programme view: a bell button in the header, before the close button. `aria-pressed` shows its state. No bell when the programme starts in 5 minutes or less. When the bell is on and `phones` is empty, a short warning shows under the times.
- Channel view: a small bell under the time of each programme with a reminder.
- New event `tvg-reminder` `{ programmeId, on }` from the bell to the root card. A failure shows a `hass-notification` toast, like a failed switch.
- New strings in `frontend/i18n/` (`en`, `pl`, `qqq`): `remindMe`, `reminderSet`, `noPhone`, `reminderFailed`.
- New icon: `bell` and `bellRing` (MDI `mdiBellOutline`, `mdiBellRing`).

## Error cases

| Case | What happens |
| --- | --- |
| The user has no phone with the app | The reminder works. Only the event fires. The card shows the warning. |
| One phone's notify call fails | Log a warning. The other phones and the event still get it. |
| HA was off when the reminder was due | At startup: the programme has not started, so the reminder fires at once. It has started, so the reminder is deleted without a notification. |
| A guide download fails | No reconcile runs. The coordinator listener is not called for a failed update. |
| A channel is removed from the selection | Its reminders stay. They fire on time from the stored copy. |
| The stored reminders file is damaged | Start with no reminders and log a warning. |
| The config entry is removed | The reminder file is deleted. |

## Testing

- `tests/test_reminders.py`: `reconcile` and `find_moved` with plain data. Cases: same id, moved by 10 minutes, moved by 4 hours (gone), two candidates (closest wins), channel without data (kept), title with other case and spaces (matched).
- `tests/test_reminders_manager.py` with `hass` and `freezer`: the timer fires at start minus 5 minutes; the reminder is deleted; it survives a restart (stored, loaded again, fires); a late start after a restart fires at once; a started programme is deleted without a notification; a guide update moves the timer; a gone programme sends one notice.
- `tests/test_delivery.py`: fake `mobile_app` config entries and fake notify services (`async_mock_service`). Only the user's phones get it; a phone without a service is skipped; one failing phone does not stop the others; the event fires; Polish text for `pl`, English for `de`.
- `tests/test_websocket_api.py`: the three commands, `too_late`, `not_found`, two users see only their own reminders.
- Card: `guide-client.test.ts` (messages), `tvg-programme-view.test.ts` (bell shown, hidden, pressed, warning), `tvg-channel-view.test.ts` (small bell), `tv-guide.test.ts` (refresh loads reminders, a tap calls add and remove, a failure shows a toast, a reminders failure does not break the guide).
- Coverage stays at 95% or more.

## Docs

- `docs/api.md`: the new type, commands and error code, in its own commit, after approval.
- `docs/design.md`: move "Reminders" out of "Ideas for later" into the real design. Add `reminders.py` and `delivery.py` to the file table. Keep the "Later still" ideas.
- `README.md`: a "Reminders" section: tap the bell, the phones of your HA user get it, 5 minutes before, the event for automations.
- `CHANGELOG.md`: a new minor version, `0.2.0`.
