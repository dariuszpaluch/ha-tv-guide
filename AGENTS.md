# Agent instructions

TV guide for Home Assistant: a custom integration (`custom_components/tv_guide`, Python) and a Lovelace card (`frontend/`, TypeScript + Lit) in one repository. One HACS install gives both: the integration serves the built card.

Read before you change anything:

- [docs/design.md](docs/design.md): how it works and why, and what each file does.
- [docs/api.md](docs/api.md): the contract between the integration and the card.
- [CONTRIBUTING.md](CONTRIBUTING.md): commands, rules, hard cases to test, how to release.

The rules in `CONTRIBUTING.md` apply to you. In addition:

- **API changes.** If a task needs a change to `docs/api.md`, stop and report it. Do not change the contract on your own.
- **Commits.** No `Co-Authored-By` trailer. Never amend or squash.
- **User docs.** A change that users can see also updates `README.md` and `CHANGELOG.md`.
