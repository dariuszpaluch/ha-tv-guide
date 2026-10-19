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
| `switch_action` | - | Action that switches the channel. `{number}` in `data` becomes the channel number. |
| `sections` | - | Groups of channels in the list. Each channel: `number`, `name`, `epg_id`, optional `logo` and `logo_tile` (`dark` or `light`). |
| `entry_id` | first guide | The `tv_guide` entry to use, when you have more than one guide. |
| `tv_day_starts_at` | `5` | Hour when a TV day starts. Programmes after midnight belong to the evening before. |
| `height` | `600px` | Height of the channel list. |

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
tests/                        integration tests (pytest)
frontend/                     card source (TypeScript, Lit, Vite, Vitest)
docs/
  design.md                   what it does and why
  api.md                      contract between the integration and the card
  superpowers/plans/          work plans
  mockup/                     design mockup of the card
```

## License

MIT, see [LICENSE](LICENSE).
