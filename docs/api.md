# API contract

The integration (`custom_components/tv_guide`) and the card (`frontend/`) talk only through this contract. Change it here first, in its own commit, then change both sides.

Times are ISO 8601 strings with an offset. Lists of programmes are sorted by `start`.

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
| `id` | `<channel_id>\|<start in UTC, YYYY-MM-DDTHH:MM:SSZ>` |
| `title` | Never empty. A programme without a title is dropped at parse time. |
| `subtitle`, `description`, `episode`, `rating`, `star_rating`, `year` | String or `null`. |
| `episode` | The `onscreen` episode number if there is one, else the first one. |
| `rating` | `null` when the source says `0` (no age limit). |
| `year` | First 4 characters of `<date>`. |
| `categories`, `countries` | Lists, can be empty. `countries` is split on commas and cleaned of quotes. |
| `image` | HA path of the poster without a size, or `null`. The card adds `/thumb` or `/large`. |

### Guide info

```json
{ "last_update": "2026-10-19T14:00:05+02:00", "last_success": "2026-10-19T14:00:05+02:00", "update_interval": 12 }
```

`last_success` is `null` when no guide was ever loaded. `update_interval` is in hours.

## WebSocket commands

Every command takes an optional `entry_id`. Without it, the first loaded `tv_guide` entry is used.

Errors (`connection.send_error`):

| Code | When |
| --- | --- |
| `not_found` | No loaded entry with this `entry_id`, or no `tv_guide` entry at all. |
| `not_loaded` | The entry exists but has no guide yet (first download not done). |
| `invalid_format` | Bad input (HA schema validation). |

### `tv_guide/info`

Input: none. Output: Guide info.

### `tv_guide/channels`

Input: none. Output: `Channel[]` of the selected channels, sorted by name.

### `tv_guide/now`

Input: `channel_ids: string[]`.
Output: `{ "<channel_id>": { "current": Programme | null, "next": Programme | null } }`. A channel id that is not in the guide is in the output with both values `null`.

### `tv_guide/schedule`

Input: `channel_id: string`, `start: string`, `end: string`.
Output: `Programme[]` that overlap `[start, end)`. Unknown channel: empty list.

### `tv_guide/search`

Input: `query: string` (at least 2 characters after trim), `channel_ids: string[]`, `when: "now" | "later"`, `limit: int` (1-100, default 40).
Output: `Programme[]`.

- Matching: the normalized query is a substring of the normalized title. Normalized = lower case, Unicode `NFKD` without combining marks, and `ł` -> `l`.
- `now`: programmes on air now (`start <= now < stop`), sorted by channel order of `channel_ids`.
- `later`: programmes with `start > now`, soonest first, only the first one per channel and title.

## HTTP

### `GET /api/tv_guide/image/{image_id}/{size}`

- `image_id`: first 32 hex characters of the SHA-256 of the source image URL.
- `size`: `thumb` (336 px wide) or `large` (1200 px wide). JPEG.
- No HA login needed (an `<img>` tag cannot send a token). Only ids of images in a loaded guide are served.
- `200` with `Cache-Control: public, max-age=604800`; `404` for an unknown id or when the source fails and there is no copy on disk; `400` for an unknown size.

## Frontend file

The integration serves the built card at `/tv_guide_frontend/tv-guide.js` and adds it to every dashboard with `?v=<integration version>`.
