# Design

How TV guide works and why it is built this way. Read this before you change the code. For the commands, the tests and the rules, see [CONTRIBUTING.md](../CONTRIBUTING.md). The contract between the integration and the card is in [api.md](api.md).

## What problem it solves

A Home Assistant dashboard can switch a cable box or a TV to a channel, but it cannot show what is on. TV guide adds a guide to Home Assistant: what is on now, what comes next, the schedule for the next days, and search in channels and programmes. A tap switches the channel through any HA action (a script, a remote, a media player).

The guide data comes from any [XMLTV](https://wiki.xmltv.org/index.php/XMLTVFormat) source, for example [epg.ovh](https://epg.ovh) for Poland.

## How it works

```
XMLTV source (e.g. epg.ovh/pl.gz)
   │  HA server: download every N hours, keep selected channels, store a copy on disk
   ▼
tv_guide integration ── guide in memory
   │ ▲                             │
   │ │ WebSocket (hass.connection) │ HTTP /api/tv_guide/image/<id>/<size>
   ▼ │                             ▼
tv-guide card in the HA app or browser ◀── posters, resized and cached on disk
   │  tap on the left area / "Switch to N"
   ▼
HA action from the card config, e.g. script.cable_box_go_to_channel {channel: N}
```

The phone never contacts the XMLTV source or the poster server. Only channel logos from the guide are an exception: the browser loads them straight from the guide's server (see [Card](#card)).

There are two parts in one repository:

- **Integration `tv_guide`** (`custom_components/tv_guide/`, Python). It downloads and parses the guide, stores it, answers the card over WebSocket and serves the posters.
- **Card `custom:tv-guide`** (`frontend/`, TypeScript and Lit). It shows the guide and runs the switch action. The integration serves the built card, so one HACS install gives both.

The two parts meet only at [api.md](api.md). The card has its own copy of the contract types in `frontend/src/types/api.ts`.

## Why it is built this way

- **Own integration, not sensors.** Other XMLTV integrations give one sensor per channel and keep the whole guide in memory. Measured on the epg.ovh Polish guide (791 channels, 108,465 programmes): a full parse into model objects took 20.5 s and about 390 MB at peak. A parse that keeps only the 121 selected channels took 1.5 s and about 30 MB.
- **WebSocket API, no sensors.** 5 days for 128 channels is about 8 MB. That is too large for sensor attributes (16 KB limit, and the recorder would store them) and for one download to a phone. Search runs on the server, where the guide already is. WebSocket calls use the user's HA login, so they also work through Nabu Casa.
- **Guide cache on disk.** The guide covers about 5 days ahead. With the last good copy on disk, the card keeps working through a source outage of a few days, and it has data at once after a restart.
- **Poster cache.** The phone gets posters from HA, not from the poster server. HA downloads a poster the first time someone opens it, makes it smaller and serves it from disk after that. A poster already seen still shows when the poster server is down.
- **One HACS install.** The integration serves the card's JS file and adds it to every dashboard, so there is no Lovelace resource to add by hand.
- **No extra Python packages.** `manifest.json` `requirements` is empty. The code uses only the standard library and packages that Home Assistant core already ships (aiohttp, yarl, Pillow, probatio).

## Integration

| File | What it does |
| --- | --- |
| `__init__.py` | Sets up the entries. Registers the WebSocket commands, the poster view and the card once for all entries. |
| `config_flow.py` | Asks for the XMLTV URL, downloads the guide once and lists its channels to select. Options: channels and update interval. |
| `source.py` | Downloads the source (64 MB limit) and opens it as a stream: plain, `.gz`, `.xz` or `.zip`. |
| `parser.py` | Streaming XMLTV parser. Keeps only the selected channels. |
| `model.py` | `Channel`, `Programme` and `Guide`, and their JSON shapes from the contract. |
| `store.py` | Saves and loads the last good guide and a separate reminder file with HA `Store`. |
| `coordinator.py` | Downloads the guide on a timer, keeps the last good one, falls back to the stored copy. |
| `search.py` | Queries: on now, schedule, search, more airings, title matching. |
| `reminders.py` | Stores reminders per user, matches them after guide updates and sets their timers. |
| `delivery.py` | Finds the user's phones, sends translated notifications and fires the reminder event. |
| `websocket_api.py` | The `tv_guide/*` commands from the contract. |
| `images.py` | Poster view and poster cache. |
| `diagnostics.py` | The diagnostics file for bug reports. It names only the server of the guide URL. |

### Config entry

- `url`: the XMLTV source.
- `channels`: the selected XMLTV channel ids. The config flow lists the channels of the downloaded guide by display name.
- `update_interval`: hours, default 12.

### Parsing

- The parser uses `xml.etree.ElementTree.iterparse` straight on the decompressing stream. The decompressed XML (about 100 MB for epg.ovh) is never in memory as one object. Parsing runs in the executor.
- Only programmes of the selected channels are kept. The names of all channels in the source are kept for the options flow.
- Programmes that ended more than 1 day ago are dropped. Programmes without a title are dropped. A second programme with the same channel and start is dropped.
- A programme without an end time ends when the next one on its channel starts.
- The server knows nothing about TV days. The card sends the time range of the day it shows.

### Guide cache

- After each good download, the guide is saved with `Store`, filtered to the selected channels (about 10 MB of JSON for 120 channels with descriptions). Building and reading this dict runs in the executor.
- At start, the stored guide is loaded first, then the download runs. After a change of the channel selection, the stored guide is cut to the new selection. A new channel has no programmes until the next good download. If no stored channel is selected any more, the setup waits for the download.
- A failed download keeps the current guide. The HA coordinator logs an error once, until a download works again. `tv_guide/info` reports `last_success`, and the card shows a notice when it is old.

### Poster cache

- First request: download the source, resize, store, serve. There is one download at a time per image (a lock per id). Later requests are served from disk with a browser cache of 7 days.
- Sizes: `thumb` is 336 px wide (the 112 px poster in the schedule, at 3x). `large` is 1200 px wide (the programme view, at 3x). Never wider than the source. JPEG, quality 80. Pillow runs in the executor.
- Folder: `<config>/.cache/tv_guide/images/`. HA backups skip `.cache/*`, so posters do not fill the backups.
- Once a day, files not served for 7 days are deleted.
- When the last entry is removed, the poster folder is deleted. The daily cleanup runs only while the integration is loaded, so the posters would stay forever.
- When the source fails and there is no copy on disk, the view answers `404` and the card shows a placeholder icon.
- The poster URL needs no HA login, because an `<img>` tag cannot send a token. The view serves only ids of posters in a loaded guide, and the ids are hashes that cannot be guessed.

## Reminders

Each config entry has a `ReminderManager`. Each reminder belongs to the HA user who set it. The user comes from the WebSocket connection. One user can set one reminder per programme. Removing it does not remove another user's reminder for the same programme.

Reminders have their own HA `Store` at `<config>/.storage/tv_guide.<entry_id>.reminders`. This keeps frequent reminder writes separate from the large guide file. Each record keeps the user, programme id, channel id, title, start and language. Removing the config entry deletes this file too.

The manager sets one HA timer per reminder, exactly 5 minutes before the start. There is no lead time setting. It plans all timers again after a change or a restart. If the reminder is due but the programme has not started, it fires at once. If the programme has started, the reminder is deleted without a notice. The manager removes and saves a reminder before delivery, so a restart cannot send it twice. Unloading the entry cancels the timers.

After a guide update, the manager first looks for the programme id. If it is missing, it looks on the same channel for the same normalized title within 3 hours before or after the old start. The closest start wins. A match updates the reminder and its timer. Without a match, the manager sends one "no longer in the guide" notice and deletes the reminder. It does this only if a programme of the channel is on air at the old start. Without one (the channel is deselected, or the source has a gap), it keeps the reminder and its stored start. A failed download does not change reminders.

Delivery finds `mobile_app` config entries whose `user_id` matches the reminder. It builds each notify service name with `slugify("mobile_app_" + device_name)` and keeps only services that exist. No notify service needs to be set in the card. This uses internal Companion app data, so changes in HA may need changes here. A failed notify call is logged and does not stop delivery to the other phones.

The notification uses the HA profile language sent by the card when the reminder was set. Polish, including `pl-PL`, gets Polish text. Other languages get English. Notification times use the HA server's time zone and a 24-hour clock. The notification tag is `tv_guide_<programme_id>`.

After the phone calls, delivery fires `tv_guide_reminder` on the HA event bus. It also fires when no phone is found. Its `kind` is `starting` or `gone`. It carries `user_id`, `programme_id`, `channel_id`, `channel_name`, `title` and `start`. The channel name falls back to the channel id when the guide does not know it. See [api.md](api.md#event-tv_guide_reminder) for the fields.

The card shows a bell in programme details only when the start is more than 5 minutes away. Tap it to add or remove your reminder. A small bell under the time marks the programme in the channel schedule. If no phone is found, programme details show a warning when the reminder is set. The card refreshes reminders every 60 seconds. A reminder request that fails does not stop the guide from loading.

## Card

| Folder | What is in it |
| --- | --- |
| `loader.ts` | Entry of the built file. It waits until HA defines `home-assistant`, then loads the card. HA replaces `window.customElements` with a polyfill when its app starts, and elements defined before that are lost. |
| `tv-guide.ts` | The root card: config, refresh every 60 seconds, list, search and the sheet. |
| `components/` | Lit elements: rows, day chips, the sheet and its two views, the search box. |
| `controllers/` | The swipe controller for the sheet gestures. |
| `data/` | Pure functions: guide client, search steps, time and TV day, stale check, logos. |
| `i18n.ts` | `t()`: picks the language and fills in the placeholders. The texts are in `frontend/i18n/` (`en.json`, `pl.json`, and `qqq.json` with notes for translators). |
| `utils/` | Text normalizing, match highlighting, logo tone. |
| `types/` | Contract types (`api.ts`) and the Home Assistant types the card uses (`hass.ts`). |

### Behaviour

- **List row with two tap areas.** The left area (number and logo) switches the channel. The right area (name, programme on now, progress bar, `›`) opens the channel details.
- **Details sheet with two views.**
  - Channel view: day chips, then the schedule for that day. Each programme has a small poster. The programme on now has a bigger poster, two lines of description and a progress bar. Earlier programmes of today are folded behind "Show N earlier".
  - Programme view: poster, title, time, time left or start time, category, age rating, year, country, star rating, description and a switch button. It slides over the channel view.
- **More airings** below the description: other airings of programmes with the same title, soonest first. First on the same channel, then on the other channels of the card. Each group shows 3 airings and "Show all (N)", because a daily series can have more than 20. Programmes shorter than 15 minutes have no "More airings": their titles ("Pogoda", "Sport") match unrelated programmes on other channels.
- **Gestures.** Swipe right on the programme view to go back. Drag the grab bar or a header down to close the sheet. A drag is never also a tap.
- **TV day.** A TV day runs from 05:00 to 05:00 by default, like printed TV guides (`tv_day_starts_at`). There is no "yesterday": a cable box cannot play past programmes. On the night the clocks change, a TV day is 23 or 25 hours long.
- **Search in three steps.** Each step shows when it is ready, and a newer query cancels an older one:
  1. channels (name or number),
  2. programmes on now,
  3. later programmes, soonest first, all days in the guide, one result per channel and title.

  A tap on a result opens the channel or the programme. Enter switches to the first result. Programme search starts at 2 characters.
- **Language** comes from the user's HA profile (`hass.locale.language`). Polish and English are built in. Any other language gets English.
- **Times** follow the HA profile (Profile → Time format). The HA default ("use language setting") gives 24-hour times. For English the card uses the `en-GB` locale, which has the 24-hour clock. The time zone follows the HA profile too (server or device).
- **Theme.** The card uses only HA theme variables (`--primary-color`, `--card-background-color`, ...). Dark mode for the logo tiles comes from `hass.themes.darkMode`.
- **Logos** are shown in a 52×30 box. A logo from the card config wins over the icon from the guide. The card checks if a logo is mostly light or mostly dark and puts it on a tile that contrasts. `logo_tile` sets the tile by hand. Logos from the guide load straight from the guide's server, not through HA.
- **Stale guide.** When the last good download is older than two update intervals, the card shows "Guide from <date, time>" above the list.
- **Channel not selected.** A channel in the card that is not selected in the integration shows "Not selected in the integration". A channel without guide data shows "No guide".

## Ideas for later

- A "Switch" button in the notification. The switch action must then move from the card config to the integration.
- A poster in the notification. It needs an external URL.
- A list of all reminders in the card.
