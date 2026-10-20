# Security

## Report a problem

Do not open a public issue for a security problem. Report it privately: [open a security advisory](https://github.com/dariuszpaluch/ha-tv-guide/security/advisories/new). The maintainer answers as soon as possible.

Only the latest release gets fixes.

## What to know

- The poster address `/api/tv_guide/image/...` works without a Home Assistant login, because an `<img>` tag cannot send a token. It serves only posters of a loaded guide, under ids that cannot be guessed.
- The integration downloads the guide and its posters from the addresses that the guide names, also inside your network. Use only a guide source you trust.
- Logs and the diagnostics file name only the server of the guide URL, so a login in the URL stays private.
