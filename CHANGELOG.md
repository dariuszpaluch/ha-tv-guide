# Changelog

## 0.3.0 - 2026-10-20

### Card

- The channel list shows what comes next on each channel, with its start time.
- A TV with antenna waves shows in the middle of the list and the schedule while they load.
- Search waits 250 ms after the last letter before it asks the server, so fast typing sends one search, not one per letter.

### Integration

- New command `tv_guide/next`: the first programme after now on each channel.

## 0.2.0 - 2026-10-20

### Card

- Set or remove a reminder with the bell in programme details. A bell under the time marks it in the channel schedule.
- Shows a warning when no phone is found for your HA user.
- Channel details open full screen on a phone and as a centered dialog on a bigger screen. Before, they opened inside the card.
- The schedule shows the whole day and opens at the programme on now, with one programme above it. "Show N earlier" is gone.
- After you close a programme, the schedule shows that programme. A new day starts at the top.
- The card has no frame around the search box and the list, so it lines up with the other cards.
- The channel numbers in the list are blue.

### Integration

- Sends a notification to your Companion app phones 5 minutes before the programme starts.
- Stores reminders per user and restores their timers after a restart.
- Follows moved programmes and sends one notice when a programme leaves the guide.
- Fires `tv_guide_reminder` for your automations, also when no phone is found.

## 0.1.1 - 2026-10-20

### Card

- The card loads every time. Before, it showed as an error in about 2 of 3 page loads: Home Assistant replaces the browser's list of custom elements when its app starts, and the card was sometimes defined before that. The card now waits for the app.

## 0.1.0 - 2026-10-20

First release.

### Integration

- Downloads an XMLTV guide, plain or compressed (`.gz`, `.xz`, `.zip`).
- Reads the guide as a stream, so a large file does not fill the memory.
- A programme without an end time ends when the next one starts. The channel name is the first display name that is not empty.
- Keeps only the channels you select. The channel list shows the guide id when it is not the same as the name.
- Without `entry_id` the card uses the first loaded guide, so a disabled guide in front does not break it.
- Stores the last good guide on disk. The card works when the source is down, also after you change the channel selection.
- WebSocket API for the card: `info`, `channels`, `now`, `schedule`, `search` and `airings`.
- Poster cache: posters are downloaded once, resized and served by Home Assistant.
- Serves the built card, so you add no Lovelace resource.
- Diagnostics for bug reports: the state of the guide, without the login in the guide URL.
- Logs and errors name only the server of the guide URL, never its path or query.
- Removing the last guide also deletes the cached posters.

### Card

- Channel list with the programme on now and a progress bar.
- Details sheet with the schedule for each day.
- Programme details and more airings of the same programme.
- Search in three steps: channels, then programmes on now, then programmes later.
- A tap switches the channel with any Home Assistant action. A failed switch shows one message, not two.
- A channel that is not selected in the integration says so.
- Example config with about 40 Polish channels (`examples/card.yaml`).
- Channel numbers can be text, such as `5.1`.
- Age ratings such as `PG-13` show as the guide gives them.
- Search folds `ß`, `ı`, `ø`, `đ`, `æ` and `œ`, so it works for more languages.
- English and Polish.
- A channel you select in the integration options shows its guide within a minute, without a page reload.
- Accepts the layout, visibility and `card_mod` keys that Home Assistant adds to a card config.
- Follows the Home Assistant theme, time zone and time format (12 or 24 hour).
