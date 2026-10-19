# TV guide for Home Assistant

> Status: in development, not ready to install.

A TV guide in your Home Assistant dashboard: what is on now, what comes next, the schedule for the next days, and search in channels and programmes. A tap switches your TV or cable box to the channel with any Home Assistant action: a script, a remote, a media player.

It has two parts, installed together:

- **Integration `tv_guide`** downloads a guide in the [XMLTV](https://wiki.xmltv.org/index.php/XMLTVFormat) format (for example [epg.ovh](https://epg.ovh) for Poland), keeps the channels you select, and answers the card. It keeps the last good guide and the posters on disk, so the card works when the source is down.
- **Card `custom:tv-guide`**: channel list with the programme on now, a details sheet with the schedule for each day, programme details, and search.

The card is in English and Polish and follows your Home Assistant theme, time format and time zone.

## Requirements

- Home Assistant 2026.10 or newer.
- [HACS](https://hacs.xyz) (for the normal install).
- A URL of an XMLTV guide, plain or compressed (`.gz`, `.xz`, `.zip`).

## Outside Poland

The integration works with any XMLTV guide. Nothing in it is tied to Poland.

- Find a guide for your country, for example [xmltvfr.fr](https://xmltvfr.fr) for France, or build one with [iptv-org/epg](https://github.com/iptv-org/epg). Many IPTV providers give an XMLTV URL too, and the one you use in Kodi, Tvheadend or Jellyfin works here.
- Channel numbers can be text, for example a US sub-channel: `number: "5.1"` (in quotes, so YAML keeps it as text).
- Age ratings show as the guide gives them (`PG-13`, `FSK 12`). A plain number such as `12` shows as `12+`.
- The card is in English and Polish. Other languages get English. Translations are welcome: add a file next to `frontend/src/i18n/en.ts`.
- The example in [examples/card.yaml](examples/card.yaml) is for the Polish guide. For another guide, copy the channel ids from the integration's channel list.

## Install

1. In HACS, open the menu → **Custom repositories**, add `https://github.com/dariuszpaluch/ha-tv-guide` with the type **Integration**.
2. Install **TV guide** and restart Home Assistant.
3. **Settings → Devices & services → Add integration → TV guide.** Enter the XMLTV URL, then select your channels.

The card is added to the dashboards by the integration. You do not add a Lovelace resource.

## Configuration

### Integration

| Option | Default | Description |
| --- | --- | --- |
| XMLTV URL | - | Source of the guide. |
| Channels | - | The channels to keep. Only these are in memory and on disk. |
| Update interval | 12 h | How often the guide is downloaded. |

### Card

```yaml
type: custom:tv-guide
switch_action:               # any HA action; {number} is replaced with the channel number
  perform_action: script.cable_box_go_to_channel
  data:
    channel: "{number}"
sections:
  - title: Main
    channels:
      - number: 1
        name: TVP 1 HD
        epg_id: TVP 1         # channel id in the XMLTV guide
      - number: 3
        name: TVN HD
        epg_id: TVN
        logo: /local/images/tv-logos/tvn.png   # optional, default is the icon from the guide
```

| Option | Default | Description |
| --- | --- | --- |
| `switch_action` | - | Action that switches the channel. It takes `perform_action` and `data` only. `{number}` in `data` becomes the channel number. |
| `sections` | - | Groups of channels in the list. Each channel: `number` (a whole number, or text in quotes such as `"5.1"`), `name`, `epg_id`, optional `logo` and `logo_tile` (`dark` or `light`). |
| `entry_id` | first guide | The `tv_guide` entry to use, when you have more than one guide. |
| `tv_day_starts_at` | `5` | Hour when a TV day starts. Programmes after midnight belong to the evening before. |
| `height` | `600px` | Height of the whole card frame: the search box and the list. |

#### Your channel list

The channels are in two places: the integration keeps the guide of the channels you tick, and the card lists them with the numbers of your box. Both use the same guide id (`epg_id`).

1. Start from [examples/card.yaml](examples/card.yaml). It has about 40 popular channels of the Polish guide [epg.ovh](https://epg.ovh) with the right ids.
2. Change `number` to the numbers of your box and delete the channels you do not have.
3. In the integration options, tick the same channels.
4. Add the card: edit a dashboard, add a card, choose "Manual" and paste the file.

To add a channel that is not in the example, tick it in the integration options and copy its guide id into the card. The list shows `Name (id: ...)` when the id is not the same as the name. A channel that is in the card but not ticked in the integration shows "Not selected in the integration".

#### Switch action

`switch_action` takes `perform_action` and `data`. Put the entity in `data`, as `entity_id`. The `target:` key is not supported. For a remote or a media player:

```yaml
switch_action:
  perform_action: remote.send_command
  data:
    entity_id: remote.living_room
    command: "{number}"
```

```yaml
switch_action:
  perform_action: media_player.play_media
  data:
    entity_id: media_player.living_room_tv
    media_content_type: channel
    media_content_id: "{number}"
```

### Good to know

- The card shows "The guide is not loaded yet." until the integration has downloaded the guide once. Then it works even when the source is down.
- Channel logos from the guide are loaded by the browser straight from the server of the guide. If your Home Assistant uses https (for example Nabu Casa), the browser can block a plain `http` logo. For a safe and better look, set `logo` for each channel in the card config.
- Use only a guide source you trust. The integration downloads the guide and the poster pictures that the guide points to.

## Data and images

This project contains code only. It has no guide data, posters or logos, and it does not share them.

- You choose the guide source. The guide data, the posters and the logos belong to their owners (the guide provider, broadcasters, picture agencies). Follow the terms of the source you use.
- The integration downloads the guide to your own Home Assistant. It downloads a poster only when someone opens it, keeps a small copy for your Home Assistant only, and deletes copies not used for 7 days.
- The poster address works without a login, because an `<img>` tag cannot send a token. It serves only posters of the guide you loaded, under ids that cannot be guessed. Do not use the integration to give the guide or the posters to other people.
- The built card includes [Lit](https://lit.dev) (BSD-3-Clause). Its licence text is in `frontend/THIRD_PARTY_LICENSES.md` in the release zip.

## Development

Requirements: Python 3.14.2+ (the version Home Assistant 2026.10 needs), [uv](https://docs.astral.sh/uv/), Node.js 22+, [pnpm](https://pnpm.io).

```bash
uv sync                      # integration dependencies and test tools
uv run pytest                # integration tests
cd frontend && pnpm install
pnpm test                    # card tests
pnpm check                   # type check and lint
pnpm build                   # builds custom_components/tv_guide/frontend/tv-guide.js
```

To try it in a Home Assistant instance, build the card, then copy or link `custom_components/tv_guide` into the `custom_components` folder of your HA configuration and restart HA.

## Project structure

```
custom_components/tv_guide/   integration (Python)
  frontend/tv-guide.js        built card (build output)
  frontend/THIRD_PARTY_LICENSES.md  licences of the bundled packages (build output)
tests/                        integration tests (pytest)
examples/card.yaml            card config to start from
frontend/                     card source (TypeScript, Lit, Vite, Vitest)
docs/
  design.md                   what it does and why
  api.md                      contract between the integration and the card
  superpowers/plans/          work plans
  mockup/                     design mockup of the card
```

## License

MIT, see [LICENSE](LICENSE).
