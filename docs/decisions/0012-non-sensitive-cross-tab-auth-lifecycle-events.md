# ADR 0012: Non-sensitive cross-tab authentication lifecycle events

## Status

Accepted

## Context

ADR 0010 keeps access tokens and public user state in one document's memory.
ADR 0011 serializes login, refresh, and logout because every same-origin tab
shares one `washqueue_refresh` HttpOnly cookie. The newest successful explicit
login therefore selects the account used by later cookie rotations.

Before Version 1.3.1, another tab could log in as a different customer while an
open tab retained its old access token and public user. That tab's next refresh
could return a token for the newly selected account while routine refresh kept
the previous user projection. The displayed identity and Bearer-token subject
could then disagree.

## Decision

- Use the native `BroadcastChannel` API on the stable
  `washqueue-auth-events-v1` channel for notification only.
- Send exactly `session-changed` or `logout` plus an ephemeral, per-document
  `sourceId`. The identifier is generated in memory and is not persisted.
- Never send access tokens, refresh tokens, cookies, user data, session IDs,
  family IDs, credentials, API responses, or mutable identity claims.
- Broadcast `session-changed` only after explicit login, `/auth/me`
  verification, and committed authenticated state.
- Broadcast `logout` only after backend logout returns 204 and confirms the
  cookie-clear contract.
- Ignore the sender's own event. Remote handling never rebroadcasts.
- On remote `session-changed`, clear the old token and user immediately, enter
  `synchronizing`, rotate through the existing same-document
  `RefreshCoordinator` and cross-tab Web Lock, call `/auth/me` with the new
  memory-only token, then atomically commit token, expiration, and user.
- On remote `logout`, clear memory and timers immediately and become
  unauthenticated without calling logout, refresh, or `/auth/me`.
- After every successful refresh path, use `/auth/me` as the authoritative
  identity source before committing the refreshed token.
- Continue to use operation generations. A newer explicit login, local logout,
  remote logout, or lifecycle event invalidates stale asynchronous results.
- Feature-detect `BroadcastChannel`. Browsers without it fail closed with
  generic coordination UI and do not use localStorage, polling, token sharing,
  or another event-bus fallback.

## Alternatives considered

- Share access tokens or current-user records: rejected because it expands
  credential and personal-data exposure and violates ADR 0010.
- localStorage events: rejected because authentication must not gain persisted
  state or a storage-backed event bus.
- Poll the cookie or `/auth/me`: rejected because JavaScript cannot and must
  not read the HttpOnly cookie, while polling adds traffic and retry semantics
  without an authentication authority.
- Decode the refreshed JWT: rejected because browser claims are not the
  authoritative mutable user projection and token parsing would duplicate the
  backend verification boundary.
- Use BroadcastChannel as a mutex or state store: rejected because notification
  does not prove exclusive cookie ownership and messages are not durable state.
  ADR 0011's Web Lock remains the mutation-serialization primitive.

## Consequences

Supported same-origin tabs promptly converge on the account selected by the
latest explicit login without sharing credentials or user data. Each receiving
tab obtains its own memory-only access token, and the Web Lock serializes every
refresh-cookie rotation. Same-user login still causes refresh plus `/auth/me`
because event metadata intentionally carries no identity.

Remote logout immediately removes authenticated UI in other tabs. A failed or
indeterminate backend logout is not announced as confirmed; other tabs instead
follow ordinary refresh failure semantics if the cookie changed.

`BroadcastChannel` joins Web Locks as a required supported-browser capability.
Lifecycle messages are transient: startup restoration and mandatory
refresh-plus-`/auth/me` verification remain necessary when a page opens after
an event or when delivery was unavailable.
