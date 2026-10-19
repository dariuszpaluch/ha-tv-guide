# API contract

The integration (`custom_components/tv_guide`) and the card (`frontend/`) talk only through this contract. Change it here first, in its own commit, then change both sides.

Times in output are ISO 8601 strings with the offset of the source. Times in input are ISO 8601 strings with an offset or `Z`. Lists of programmes are sorted as each command says.

## Types

### Channel

```json
{ "id": "TVN", "name": "TVN", "icon": "http://epg.ovh/logo/TVN.png" }
```

`icon` can be `null`.

### Programme

```json
{
  "id": "TVN|2026-10-19T17:00:00Z",
  "channel_id": "TVN",
  "start": "2026-10-19T19:00:00+02:00",
  "stop": "2026-10-19T19:35:00+02:00",
  "title": "Fakty",
  "subtitle": null,
  "description": "Najważniejsze informacje...",
  "episode": "E519",
  "categories": ["program informacyjny"],
  "image": "/api/tv_guide/image/3f9a0c1d2e3f4a5b6c7d8e9f0a1b2c3d",
  "rating": "12",
  "star_rating": "6/10",
  "year": "2016",
  "countries": ["Maroko", "USA"]
}
```

| Field | Rule |
| --- | --- |
| `id` | `<channel_id>\|<start in UTC, YYYY-MM-DDTHH:MM:SSZ>`. When the source has two programmes with the same start on one channel, the first one is kept. |
| `title` | Never empty. A programme without a title is dropped at parse time. |
| `subtitle`, `description`, `episode`, `rating`, `star_rating`, `year` | String or `null`. |
| `episode` | The `onscreen` episode number if there is one, else the first one. |
| `rating` | `null` when the source says `0` (no age limit). |
| `year` | First 4 characters of `<date>`. |
| `categories`, `countries` | Lists, can be empty. `countries` is split on commas and cleaned of quotes. |
| `image` | HA path of the poster without a size, or `null`. The card adds `/thumb` or `/large`. |

### Guide info

```json
{ "last_success": "2026-10-19T14:00:05+02:00", "update_interval": 12 }
```

`last_success`: time of the last good download. `update_interval`: hours.

## Title matching

Used by `search` and `airings`. Normalized text = lower case, Unicode `NFKD` without non-spacing marks (Unicode category `Mn`), then the letters that `NFKD` does not split: `ł` -> `l`, `ß` -> `ss`, `ı` -> `i`, `ø` -> `o`, `đ` -> `d`, `æ` -> `ae`, `œ` -> `oe`; outer whitespace removed. The card uses the same rule for channel names.

## WebSocket commands

Every command takes an optional `entry_id: string`. Without it, the first loaded `tv_guide` entry is used. If none is loaded, the answer is `not_loaded` when an entry exists.

Errors (`connection.send_error`):

| Code | When |
| --- | --- |
| `not_found` | There is no `tv_guide` entry, or no entry with this `entry_id`. |
| `not_loaded` | The entry exists but is not loaded yet (for example, HA retries the setup because the first download failed and no stored guide exists). |
| `invalid_format` | Bad input: HA schema validation, a time that cannot be parsed, or a query shorter than 2 characters after trimming. |

### `tv_guide/info`

Input: none. Output: Guide info.

### `tv_guide/channels`

Input: none. Output: `Channel[]` of the selected channels, sorted by name.

### `tv_guide/now`

Input: `channel_ids: string[]`.
Output: `{ "<channel_id>": Programme | null }`: the programme on air now (`start <= now < stop`). A channel id that is not in the guide is in the output with `null`.

### `tv_guide/schedule`

Input: `channel_id: string`, `start: string`, `end: string`.
Output: `Programme[]` that overlap `[start, end)`, sorted by start. Unknown channel: empty list.

### `tv_guide/search`

Input: `query: string`, `channel_ids: string[]`, `when: "now" | "later"`, `limit: int` (1-100, default 40).
Output: `Programme[]`.

- Match: the normalized query is a substring of the normalized title.
- `now`: programmes on air now, in the order of `channel_ids`.
- `later`: programmes with `start > now`, soonest first, only the first one per channel and title.

### `tv_guide/airings`

Other airings of a programme with the same title, for the "More airings" list in the programme view.

Input: `programme_id: string`, `channel_ids: string[]`, `limit: int` (1-50, default 20).
Output: `Programme[]`.

- Match: normalized title equal to the normalized title of the programme (equal, not a substring: "Fakty" does not match "Fakty po południu").
- Only programmes with `start > now`, without the programme itself, on the programme's channel or on a channel in `channel_ids`.
- Order: first the programme's channel, soonest first; then the other channels, soonest first.
- A programme shorter than 15 minutes has no airings: empty list. Short programmes (weather, news flashes) have generic titles like "Pogoda" that match unrelated programmes on other channels.
- Unknown `programme_id` (for example, the guide was refreshed): empty list.

## HTTP

### `GET /api/tv_guide/image/{image_id}/{size}`

- `image_id`: first 32 hex characters of the SHA-256 of the source image URL. Anything else: `404`.
- `size`: `thumb` (336 px wide) or `large` (1200 px wide); never wider than the source. JPEG. Other sizes: `400`.
- No HA login needed (an `<img>` tag cannot send a token). Only ids of images in a loaded guide are served; only `http` and `https` source URLs.
- `200` with `Cache-Control: public, max-age=604800`; `404` for an unknown id, a broken image, or when the source fails and there is no copy on disk.

## Frontend file

The integration serves the built card at `/tv_guide_frontend/tv-guide.js` and adds it to every dashboard with `?v=<integration version>`.
