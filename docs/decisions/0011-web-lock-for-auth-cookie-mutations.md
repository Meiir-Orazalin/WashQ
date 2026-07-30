# ADR 0011: Web Lock for authentication cookie mutations

## Status

Accepted

## Context

The browser stores one `washqueue_refresh` HttpOnly cookie for the WashQueue
origin and auth path. All tabs and windows in one browser profile therefore use
the same one-time refresh credential. The same-document single-flight
coordinator from Version 1.2.7 cannot serialize independent JavaScript realms.

The Version 1.2.8 release review reproduced two simultaneous refreshes. One
rotation succeeded, while the losing response rejected the predecessor and
cleared the successful replacement cookie. Depending on timing, replay handling
could also revoke the replacement family. Login and logout can race for the
same cookie for the same reason.

## Decision

- Use the browser-native Web Locks API with one stable exclusive lock named
  `washqueue-auth-cookie-mutation-v1`.
- Acquire that lock before starting every browser `POST /auth/login`,
  `POST /auth/refresh`, and `POST /auth/logout` request. Keep the full fetch and
  required response parsing inside the callback so Set-Cookie processing
  settles before release.
- Keep `/auth/me`, registration, health checks, and other non-cookie-mutating
  requests outside the lock.
- Retain the existing same-document refresh coordinator. Its single in-flight
  Promise wraps the cross-tab-locked refresh request.
- Fail closed with the sanitized `AUTH_COORDINATION_UNAVAILABLE` application
  error when Web Locks are unavailable or cannot be acquired. Never perform an
  unlocked cookie mutation as a fallback.
- Keep access tokens per-tab and memory-only. The lock carries no credential,
  user, session, or response data.

## Alternatives considered

- Same-document single flight only: rejected because independent tabs can still
  submit the same one-time cookie concurrently.
- BroadcastChannel-only signaling: rejected because notification delivery is
  not a mutual-exclusion primitive and cannot prove lock ownership.
- A localStorage mutex: rejected because check-then-set storage protocols are
  not atomic, stale leases are difficult to recover safely, and auth must not
  gain a browser-storage dependency.
- Sharing access tokens between tabs: rejected because it expands bearer-token
  exposure and violates ADR 0010 without serializing cookie writes.
- Backend grace windows or weakened replay handling: rejected because they
  reduce theft/replay protection and do not prevent stale cookie responses from
  overwriting each other.
- Web Locks: selected because the browser arbitrates an exclusive named lock
  across same-origin documents, queues callers, and releases ownership when the
  callback settles or a document terminates.

## Consequences

Cookie-mutating authentication requests from same-origin tabs execute
sequentially. Simultaneous restoration may rotate the cookie once per tab, but
each later request uses the browser's newest cookie and the family retains one
active replacement.

Browsers without Web Locks cannot perform frontend login, refresh, or logout.
They receive generic, accessible recovery UI and no cookie-mutating request is
sent. The supported-browser policy therefore requires verified Web Locks
support.

Separate tabs never share access tokens or public user state. They can retain
independent already-issued stateless access tokens, while the most recent
successful explicit login owns the one persistent refresh cookie in the shared
browser jar. Version 1.3.1 adds the separate notification decision in ADR 0012:
receiving tabs clear old memory, take this same Web Lock through the existing
refresh coordinator, and verify `/auth/me` before atomically committing their
own token and user. Confirmed remote logout clears memory without taking the
lock or sending another server request.

BroadcastChannel remains separate from this mutex decision. It carries no
credentials or identity and cannot replace lock ownership. Conversely, the
lock carries no lifecycle state and cannot notify an already-open tab that the
shared cookie identity changed.

Lock waiting is not an authentication failure and has no retry loop. A network
outcome that becomes indeterminate after request start retains the existing
non-retry behavior even though lock ownership is subsequently released.
