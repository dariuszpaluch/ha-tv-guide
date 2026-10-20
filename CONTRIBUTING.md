# Contributing

Thank you for helping. This file tells you how to set up the project, how to test a change and how to release. Read [docs/design.md](docs/design.md) first: it tells how the parts work and why.

## What you need

- Python 3.14.2+ (the version Home Assistant 2026.10 needs) and [uv](https://docs.astral.sh/uv/).
- Node.js 22+ and [pnpm](https://pnpm.io).

## Commands

| What | Command |
| --- | --- |
| Install the integration tools | `uv sync` |
| Integration tests | `uv run pytest` |
| Integration lint | `uv run ruff check . && uv run ruff format --check .` |
| Install the card tools | `cd frontend && pnpm install` |
| Card tests | `cd frontend && pnpm test` |
| Card type check and lint | `cd frontend && pnpm check` |
| Build the card | `cd frontend && pnpm build` |

`pnpm build` writes `custom_components/tv_guide/frontend/tv-guide.js`. This folder is build output and is not in git. CI builds it for each release.

## Try it in Home Assistant

1. Build the card: `cd frontend && pnpm build`.
2. Copy or link `custom_components/tv_guide` into the `custom_components` folder of your HA configuration.
3. Restart HA and add the integration.
4. After a change to the card, build again and reload the page in the browser. After a change to the integration, restart HA.

Without a built card, the integration still starts. It logs a warning that the card is not served.

## Rules

- **Contract first.** [docs/api.md](docs/api.md) is the only source for the WebSocket and HTTP API. To change the API, change `docs/api.md` first, in its own commit. Then change the integration, `frontend/src/types/api.ts` and the card.
- **Tests with every change.** Write a failing test first, then the code. Run all tests of the part you changed before each commit.
- **Python.** Type hints everywhere and docstrings on public functions. Use `async` for I/O. Blocking work (decompressing, parsing, Pillow, file I/O) runs in `hass.async_add_executor_job`. Do not add packages to `manifest.json` `requirements`: use what HA core already ships. HA 2026.10 has no `voluptuous`, so schemas use `probatio`.
- **TypeScript.** `strict: true`, no `any`. Derive types from the contract types in `frontend/src/types/api.ts`. Semicolons, `const`, arrow functions, early returns, JSDoc on all functions.
- **Card look.** Use only HA theme variables (`--primary-color`, `--card-background-color`, ...). No fixed colours, except the logo tiles. Every user-visible string goes through `t()` and exists in `en.ts` and `pl.ts`.
- **Comments and docs.** Plain English, short sentences, active voice. Explain why, not what.
- **Commits.** [Conventional commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`, `ci:`. Do not squash or rewrite published history.

## Hard cases

These cases broke before or are easy to break. Keep a test for each one.

- **The night the clocks change.** On 2026-10-25 Poland leaves summer time at 03:00. The TV day of 2026-10-24 is 25 hours long, and the XMLTV offsets change from `+0200` to `+0100` inside it. Programmes keep their order, ids stay unique, and the day lists each programme once.
- **Time format.** With the HA default time format, an English user sees `19:55` and `Wed 21`, not `07:55 PM`. With the 12-hour format the card shows `7:55 PM`.
- **A channel without guide data** (`epg_id` missing or not in the guide). The row shows "No guide", the details show "No programme guide for this channel.", and search and airings skip it without errors.
- **First start with the source down and no stored guide.** HA retries the setup, the WebSocket answers `not_loaded`, and the card shows "The guide is not loaded yet." instead of an empty list.
- **Search text.** `życie`, `zycie` and `ŻYCIE` all find "Życie na fali". `(` and `*` are plain characters. A 1-character query never reaches the server.
- **Memory during an update.** The decompressed XML (about 100 MB for epg.ovh) is never in memory as one object. The parser reads a stream.

Before a release, also try the card by hand: on a phone (the HA app) and in a desktop browser, light and dark theme, Polish and English.

## Add a language

The card:

1. Copy `frontend/src/i18n/en.ts` to a new file, for example `de.ts`, and translate the strings. Type it as `Strings`, like `pl.ts`.
2. In `frontend/src/i18n/index.ts`, add the language to `Language`, its locale to `LOCALES`, and pick it in `resolveLanguage` and `translator`.
3. Add the new language next to the Polish cases in `frontend/src/i18n/index.test.ts`.

The integration setup screens: add `custom_components/tv_guide/translations/<language>.json`, with the same keys as `en.json`.

## Release

1. Add the changes to [CHANGELOG.md](CHANGELOG.md) under the new version and the release date. Set the same version in `custom_components/tv_guide/manifest.json`.
2. Merge to `main` and check that CI passes.
3. Create a GitHub release with the tag `vX.Y.Z`.

The release workflow builds the card, writes the tag version into `manifest.json`, zips `custom_components/tv_guide` and adds `tv_guide.zip` to the release. HACS installs this zip. The card URL carries the version, so browsers load the new card after an update.

## CI

Each push runs:

- the integration tests and lint, and the card tests, check and build (`ci.yml`);
- [hassfest](https://developers.home-assistant.io/blog/2020/04/16/hassfest/) and the [HACS action](https://hacs.xyz/docs/publish/action) (`validate.yml`). They check `manifest.json`, the translations, `hacs.json` and the repository settings that HACS needs.
