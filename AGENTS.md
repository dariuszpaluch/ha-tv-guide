# Agent instructions

You work on **TV guide**, an add-on for [Home Assistant](https://www.home-assistant.io) (HA). This file gives you the background you need when you start with no context.

## Background

- **Home Assistant** is an open-source home automation server, written in Python with `asyncio`. An **integration** is a Python package that adds a feature. Custom integrations live in `custom_components/<domain>/`. A user adds an integration in the UI (a **config entry**, set up by a **config flow**).
- **Dashboards** (also called Lovelace) show **cards**. A custom card is a web component in a JS file that the browser loads. Users write the card config in YAML.
- **HACS** is the community store for HA. It installs this repository from the `tv_guide.zip` of a GitHub release.
- **XMLTV** is a common XML format for TV guides. The integration reads it. A typical source is [epg.ovh](https://epg.ovh/pl.gz) (Poland, about 100 MB of XML after unpacking).

## What this repository is

Two parts, one HACS install:

- **Integration `tv_guide`** (`custom_components/tv_guide/`, Python). It runs on the HA server. It downloads the guide, keeps the selected channels, stores the last good guide on disk, answers WebSocket commands and serves resized posters.
- **Card `custom:tv-guide`** (`frontend/`, TypeScript and Lit). It runs in the browser or the HA mobile app. It shows the guide and switches the channel with an HA action from its config.

The parts talk only through the contract in [docs/api.md](docs/api.md): WebSocket commands `tv_guide/*` and the poster URL `/api/tv_guide/image/...`. The integration also serves the built card, so users add no Lovelace resource.

Read before you change anything:

- [docs/design.md](docs/design.md): how it works, why, and what each file does.
- [docs/api.md](docs/api.md): the contract between the integration and the card.
- [CONTRIBUTING.md](CONTRIBUTING.md): commands, rules, hard cases to test, how to release. Its rules apply to you.
- [README.md](README.md): what users see and configure.

## Versions and gotchas

- HA **2026.10** or newer, Python **3.14**. The tests pin HA with `pytest-homeassistant-custom-component` in `pyproject.toml`.
- Schemas use **`probatio`**, as HA core does. Do not import `voluptuous`.
- No new packages in `manifest.json` `requirements`. Use the standard library and what HA core ships: `aiohttp`, `yarl`, `Pillow`, `probatio`.
- Never block the event loop. Parsing, decompressing, Pillow and file I/O run in `hass.async_add_executor_job`. HA logs a warning for blocking calls.
- The guide is large. Parse it as a stream and keep only the selected channels. Never read the whole XML into memory.
- Times: the guide has offsets that change at night when the clocks change. Keep times aware of the time zone. The card uses the time zone and time format of the HA profile.
- `custom_components/tv_guide/frontend/` is build output and is not in git. Without it, the integration starts and logs a warning.
- The card URL carries the integration version from `manifest.json`. The release workflow sets it from the git tag.

## Testing

You do not need a running Home Assistant.

- The integration tests use the `hass` fixture of `pytest-homeassistant-custom-component`. The shared test data is in `tests/conftest.py` and `tests/fixtures/`.
- The card tests use Vitest with happy-dom. The tests are in `frontend/tests/`, in the same folders as the code in `frontend/src/`. The shared guide data is in `frontend/tests/fixtures.ts`. `frontend/tests/tv-guide.test.ts` builds a fake `hass` object with a fake server (`makeHass`).
- The test clock is 2026-10-19 19:20 in `Europe/Warsaw`.

## Where to start

| Task | Files |
| --- | --- |
| Guide parsing | `parser.py`, `model.py`, `tests/test_parser.py` |
| Download and storage | `source.py`, `coordinator.py`, `store.py` |
| Search, schedule, airings | `search.py` (server), `frontend/src/data/search.ts` (card steps) |
| A WebSocket command | `docs/api.md` first, then `websocket_api.py` and `frontend/src/types/api.ts` |
| Posters | `images.py` |
| Setup screens | `config_flow.py`, `translations/` (`en.json`, `pl.json`, `qqq.json`) |
| Card config | `frontend/src/config.ts`, `README.md`, `examples/card.yaml` |
| Card look | `frontend/src/components/`, `frontend/src/tv-guide-styles.ts` |
| A visible text in the card | `frontend/i18n/` (`en.json`, `pl.json`, `qqq.json`), read by `frontend/src/i18n.ts` |

## Extra rules for agents

- **API changes.** If a task needs a change to `docs/api.md`, stop and report it. Do not change the contract on your own.
- **Commits.** Conventional commits. No `Co-Authored-By` trailer. Never amend or squash.
- **User docs.** A change that users can see also updates `README.md` and `CHANGELOG.md`.
- **Language.** Code, comments and docs are in English. The card has English and Polish strings.
