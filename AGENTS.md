# Agent instructions

TV guide for Home Assistant: a custom integration (`custom_components/tv_guide`, Python) and a Lovelace card (`frontend/`, TypeScript + Lit) in one repository. One HACS install gives both: the integration serves the built card.

Read before you change anything:

- [docs/design.md](docs/design.md): what it does and why.
- [docs/api.md](docs/api.md): the contract between the integration and the card.
- [docs/superpowers/plans/](docs/superpowers/plans/): the work plan and who does which task.

## Structure

```
custom_components/tv_guide/   integration
  frontend/tv-guide.js        built card (build output, not in git)
tests/                        pytest tests of the integration
frontend/                     card source, Vite, Vitest
docs/                         design, API contract, plans, mockup
```

## Rules

- **Contract first.** `docs/api.md` is the only source for the WebSocket and HTTP API. Do not change the API in code without changing `docs/api.md` first, in its own commit. If a task needs a change, stop and report it.
- **Tests with every change.** Write the failing test first, then the code. Run the whole test suite of the part you changed before each commit.
- **Python:** type hints everywhere, docstrings on public functions, `async` for I/O, blocking work (parsing, Pillow) in `hass.async_add_executor_job`. No extra package in `manifest.json` `requirements`: use what Home Assistant core already has.
- **TypeScript:** `strict: true`, no `any`. Derive types from the contract types in `frontend/src/types/api.ts`. Semicolons, `const`, arrow functions, early returns. JSDoc on all functions.
- **Card look:** only HA theme variables (`--primary-color`, `--card-background-color`, ...), no fixed colours except the logo tiles. Every user-visible string goes through `t()` and exists in `en.ts` and `pl.ts`.
- **Comments and docs:** plain English, short sentences, active voice. Explain why, not what.
- **Commits:** conventional commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`, `chore:`). No `Co-Authored-By` trailer. Never amend or squash.

## Commands

| What | Command |
| --- | --- |
| Integration tests | `uv run pytest` |
| Integration lint | `uv run ruff check . && uv run ruff format --check .` |
| Card tests | `cd frontend && pnpm test` |
| Card type check and lint | `cd frontend && pnpm check` |
| Build the card | `cd frontend && pnpm build` (writes `custom_components/tv_guide/frontend/tv-guide.js`) |
