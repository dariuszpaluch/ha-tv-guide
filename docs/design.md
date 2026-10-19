# TV guide for Home Assistant - design

Status: draft, waiting for review. Date: 2026-10-19.

The API contract is in [api.md](api.md). Rules for contributors and agents are in [AGENTS.md](../AGENTS.md). The work plan is in [plans/](superpowers/plans/).

## What problem it solves

A Home Assistant dashboard can switch a cable box or TV to a channel, but it cannot show what is on. This project adds a TV guide to Home Assistant: what is on now, what comes next, the schedule for the next days, and search in channels and programmes. A tap switches the channel through any HA action (a script, a remote, a media player).

The guide data comes from any XMLTV source, for example [epg.ovh](https://epg.ovh) for Poland.

## Decisions

### Card

The mockup is the reference for layout, styles and behaviour: [mockup/design-a.src.html](mockup/design-a.src.html). It needs mock data to run; read it as a specification.

- **List row, two tap areas.** Left (number and logo) switches the channel. Right (name, programme on now, progress bar, `›`) opens the channel details.
- **Details sheet, two views.**
  - Channel view: day chips, then the schedule for that day. Each programme has a small poster. The programme on now has a bigger poster, two lines of description and a progress bar. Earlier programmes of today are folded behind "Show N earlier".
  - Programme view: poster, title, time, time left or start time, category, age rating, year, country, star rating, description, switch button. It slides over the channel view.
- **Gestures.** Swipe right on the programme view goes back. Drag the grab bar or a header down to close the sheet. A drag is never also a tap.
- **TV day** runs from 05:00 to 05:00 by default, like printed TV guides. No "yesterday": a cable box cannot play past programmes.
- **Search in three steps.** Each step shows when it is ready; a newer query cancels an older one:
  1. channels (name or number),
  2. programmes on now,
  3. later programmes, soonest first, all days in the guide, one result per channel and title.

  A result is a channel row or a programme row. A tap opens the channel details or the programme details. Enter switches to the first result. Programme search starts at 2 characters.
- **Language** comes from the user's HA profile (`hass.locale.language`). Polish and English; any other language falls back to English. Day and time formats come from `Intl` with that locale.
- **Theme** comes from HA: the card uses only HA theme variables (`--primary-color`, `--card-background-color`, ...). Dark mode for the logo tiles comes from `hass.themes.darkMode`.
- **Logos** are shown only in a 52×30 box. A logo from the card config wins over the icon from the guide.
- **Stale guide.** When the last good download is older than two update intervals, the card shows "Guide from <date, time>" above the list.

### Backend

- **Own integration `tv_guide`** in the same repository as the card. Existing XMLTV integrations give per-channel sensors only, and keep the whole guide in memory. Measured on the epg.ovh Polish guide (791 channels, 108,465 programmes): a full parse into model objects took 20.5 s and about 390 MB at peak; a parse that keeps only the 121 selected channels took 1.5 s and about 30 MB.
- **WebSocket API** for the card, no sensors. 5 days for 128 channels is about 8 MB: too large for sensor attributes (16 KB limit, recorder database) and for one download to a phone. Search runs on the server, where the guide already is. WebSocket calls use the user's HA login, so they also work through Nabu Casa.
- **Guide cache.** The last good guide, filtered to the selected channels, is stored on disk. HA uses it at start and when the source does not answer. The guide covers about 5 days ahead, so the card keeps working through a source outage of a few days.
- **Poster cache.** The phone gets posters from HA, not from the poster server. HA downloads a poster the first time someone looks at it, makes it smaller, stores it and serves it from disk after that. A poster already seen still shows when the poster server is down.
- **One HACS install.** The integration serves the card's JS file and adds it to the frontend, so there is no manual Lovelace resource.

## Architecture

```
XMLTV source (e.g. epg.ovh/pl.gz)
   │  HA server: download every N hours, keep selected channels, store a copy on disk
   ▼
tv_guide integration ── guide in memory
   │ ▲                          │
   │ │ WebSocket (hass.callWS)  │ HTTP /api/tv_guide/image/<id>/<size>
   ▼ │                          ▼
tv-guide card in the HA app or browser ◀── posters, resized and cached on disk
   │  tap on the left area / "Switch to N"
   ▼
HA action from the card config, e.g. script.cable_box_go_to_channel {channel: N}
```

The phone never contacts the XMLTV source or the poster server.

## Integration behaviour

### Config entry

- `url`: XMLTV source.
- `channels`: selected XMLTV channel ids. The config flow lists the channels of the downloaded guide by display name.
- `update_interval`: hours, default 12.

### Parsing

- Streaming parse with the standard library (`xml.etree.ElementTree.iterparse`), no extra requirement; only programmes of the selected channels are kept.
- Programmes that ended more than 1 day ago are dropped. Programmes without a title are dropped.
- The server knows nothing about TV days. The card sends the time range of the day it shows.

### Guide cache

- Stored with `Store` after each good download, filtered to the selected channels (about 2-3 MB of JSON).
- At start: load the stored guide first, then download. The card has data at once.
- A failed download keeps the current guide and logs a warning. `tv_guide/info` reports `last_success`.

### Poster cache

- First request: download the source, resize to both sizes, store, serve. One download at a time per image (a lock per id). Later requests: serve from disk, browser cache 7 days.
- Sizes: `thumb` 336 px wide (the 112 px poster in the schedule, 3x), `large` 1200 px wide (the programme view, 3x). JPEG, quality 80. Resize with Pillow in the executor.
- Folder: `<config>/.cache/tv_guide/images/`. Check that HA backups skip this folder; if not, choose a folder they skip.
- Cleanup once a day: delete files not served for 7 days.
- Source down and no copy on disk: 404, and the card shows a placeholder icon.

## Card config

```yaml
type: custom:tv-guide
entry_id: 01J...             # optional, when there is more than one guide
switch_action:               # HA action; {number} is replaced with the channel number
  perform_action: script.cable_box_go_to_channel
  data:
    channel: "{number}"
tv_day_starts_at: 5          # hour, default 5
unavailable_digits: ["7"]    # optional: channels with these digits cannot be switched to
height: 600px                # optional
sections:
  - title: Main
    channels:
      - number: 1
        name: TVP 1 HD
        epg_id: TVP 1         # XMLTV channel id; without it the channel shows "No guide"
        logo: /local/images/tv-logos/tvp1.png   # optional; default is the icon from the guide
        logo_tile: dark       # optional: force a dark or light tile behind the logo
```

## Testing

- **Integration:** pytest with `pytest-homeassistant-custom-component`. Small XMLTV fixtures for the parser, search and the API. Image view tests with a mocked source server.
- **Card:** Vitest with happy-dom, for the pure functions (`data/`, `i18n/`, `utils/`) and for the components (rows, sheet views, swipe controller).
- **Manual:** a test dashboard on a phone (HA app on iOS and Android) and a desktop browser, light and dark, Polish and English, at home and through Nabu Casa.

## Order of work

1. Integration: source, parser, model, guide cache, WebSocket API, with tests.
2. Integration: poster view and cache, with tests.
3. Card: project setup, data layer and i18n, with tests.
4. Card: components, built from the mockup; the integration serves the built file.
5. HACS metadata, release workflow, first release.

## Follow-up (not in the first release)

**Reminders.** A bell on a programme; HA sends a notification shortly before it starts.

- Card: bell in the programme view (maybe also in the schedule). Calls `tv_guide/reminders/add` and `tv_guide/reminders/remove` with the programme `id`.
- Integration: stores reminders on disk per HA user, sets a timer (default 5 min before the start), restores the timers after a restart.
- Delivery: a notify service from the config (e.g. `notify.mobile_app_<phone>`) and an event `tv_guide_reminder` for own automations.
- Moved programmes: after each guide refresh, find the same programme (same channel and title, near the old start) and move the timer; if it is gone, notify that it was removed.
- Later: "Switch" button in the notification (the switch action must then move from the card config to the integration), poster in the notification (needs an external URL), list of reminders in the card.
- Size: the basic version is about three plan tasks (integration store and timers, WebSocket commands, bell in the card), each with tests; the later items about the same again.

## Decided

- Names: repository `ha-tv-guide`, integration domain `tv_guide`, card `custom:tv-guide`.
- Card and integration in one repository, one HACS install.
- Posters through the HA poster cache, resized; no direct links to the poster server.
