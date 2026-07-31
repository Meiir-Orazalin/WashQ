# Frontend authentication lifecycle

Version 1.3.1 keeps authentication state in one root React provider per
document. The provider owns the access token, server-provided expiration,
authoritative public user, status, refresh scheduling, operation generation,
and lifecycle-channel subscription. None of that state is persisted.

## States

| State                | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `initializing`       | Startup refresh plus `/auth/me` is in progress; no account UI is rendered.    |
| `synchronizing`      | A remote login event is being resolved; old token and user are already gone.  |
| `unauthenticated`    | No local token or user is available.                                          |
| `authenticating`     | Explicit login and `/auth/me` verification are in progress.                   |
| `authenticated`      | One verified token, expiration, and public user are committed together.       |
| `logging-out`        | Local memory is clear and backend logout confirmation is pending.             |
| `logout-error`       | Memory is clear, but backend logout was not confirmed.                        |
| `coordination-error` | The Web Lock could not safely coordinate a cookie mutation.                   |
| `lifecycle-error`    | Cross-tab lifecycle notification is unavailable; authentication fails closed. |
| `error`              | Restoration or synchronization failed generically without an automatic retry. |

`initializing` and `synchronizing` use neutral, announced busy UI. Error states
use alert semantics and native keyboard-accessible recovery controls.

## Transitions

```text
mount
  -> initializing
     -> refresh -> /auth/me -> authenticated
     -> invalid refresh or /me 401 -> unauthenticated
     -> indeterminate failure -> error
     -> missing lifecycle capability -> lifecycle-error

explicit login
  -> authenticating
     -> locked login -> /auth/me -> atomic commit -> authenticated
        -> broadcast session-changed after commit
     -> failure -> error or coordination-error

remote session-changed
  -> invalidate generation and clear token/expiration/user/timers
  -> synchronizing
     -> coordinated refresh -> /auth/me -> atomic commit -> authenticated
     -> invalid refresh or /me 401 -> unauthenticated
     -> indeterminate failure -> error
     -> never rebroadcast

local logout
  -> invalidate generation and clear local memory/timers
  -> logging-out
     -> wait for local refresh idle -> locked backend logout 204
     -> unauthenticated -> broadcast logout after commit
     -> unconfirmed response -> logout-error or coordination-error

remote logout
  -> invalidate generation and clear local memory/timers
  -> unauthenticated
  -> no logout, refresh, /auth/me, or rebroadcast
```

## Refresh identity rule

Startup, proactive, visibility-triggered, and remote synchronization refreshes
all use the same rule:

```text
rotate cookie under RefreshCoordinator and Web Lock
  -> validate returned expiration
  -> keep the new token staged in the current operation
  -> GET /auth/me with that token and credentials omitted
  -> atomically commit token + expiration + user
  -> schedule the next refresh
```

Routine refresh keeps the previous verified token/user pair until the new pair
has passed `/auth/me`; it never commits a new token beside the old user. If
refresh completed but `/auth/me` fails, the new token is discarded and local
authentication fails closed without an automatic refresh loop. An indeterminate
refresh transport may retain the previous matched pair only until its known
expiration under the existing no-retry policy.

The provider never decodes a JWT. Operation generations prevent stale
restoration, refresh, synchronization, login, or logout results from rebuilding
state after a newer operation.

## Cross-tab channel

`AuthLifecycleChannel` wraps `BroadcastChannel` and sends only:

```json
{ "type": "session-changed", "sourceId": "ephemeral-per-document-id" }
```

```json
{ "type": "logout", "sourceId": "ephemeral-per-document-id" }
```

The channel is not an authentication store. It closes on provider cleanup,
ignores self-originated messages, rejects malformed or extended payloads, and
contains no credentials, user data, session metadata, API responses, or
timestamps. See [ADR 0012](../decisions/0012-non-sensitive-cross-tab-auth-lifecycle-events.md).

## Document termination

Version 1.3.2 adds no state or production transition. The qualified browser
matrix verifies the existing behavior when a document closes or navigates:
queued Web Lock requests disappear, held locks are released, provider cleanup
closes the lifecycle channel, and no closed document can commit later
authentication state. A reload during `synchronizing` starts a new provider in
`initializing`; startup refresh plus `/auth/me` re-establishes the authoritative
identity without retaining the old projection.

These regressions cover browser-document close and navigation. They do not
claim operating-system process crash, process suspension, device sleep, or
machine-loss behavior.
