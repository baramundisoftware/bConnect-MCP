## What and why

<!-- One topic per PR. What does it change, and why? -->

Closes #

## Scope

- [ ] **One topic.** Unrelated changes are in separate PRs.
- [ ] **Small:** roughly 400 changed lines or fewer (generated files excluded). Larger work started as an accepted change-proposal issue and is split.
- [ ] Linked to an issue a maintainer has accepted (not needed for typo/doc fixes).

## Checks

- [ ] `npm run build` and `npm test` pass locally.
- [ ] New or changed behaviour has a test.
- [ ] Docs updated where behaviour, tool names, parameters or configuration changed.
- [ ] Tried the transports it affects: stdio / HTTP gateway / not applicable.

## Security

- [ ] No credentials, tokens, estate data or internal URLs in code, tests, fixtures or this description.
- [ ] Write tools stay behind `ALLOW_WRITE_OPERATIONS`; anything returning secrets stays behind `ALLOW_SECRET_READ`.
- [ ] Nothing writes to stdout in stdio mode except JSON-RPC.
