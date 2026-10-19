# Changelog

## 0.1.0 - 2026-10-19

First release.

### Integration

- Downloads an XMLTV guide, plain or compressed (`.gz`, `.xz`, `.zip`).
- Reads the guide as a stream, so a large file does not fill the memory.
- Keeps only the channels you select. The channel list shows the guide id when it is not the same as the name.
- Stores the last good guide on disk. The card works when the source is down.
- WebSocket API for the card: `info`, `channels`, `now`, `schedule`, `search` and `airings`.
- Poster cache: posters are downloaded once, resized and served by Home Assistant.
- Serves the built card, so you add no Lovelace resource.

### Card

- Channel list with the programme on now and a progress bar.
- Details sheet with the schedule for each day.
- Programme details and more airings of the same programme.
- Search in three steps: channels, then programmes on now, then programmes later.
- A tap switches the channel with any Home Assistant action.
- A channel that is not selected in the integration says so.
- Example config with about 40 Polish channels (`examples/card.yaml`).
- English and Polish.
- Follows the Home Assistant theme, time zone and time format (12 or 24 hour).
