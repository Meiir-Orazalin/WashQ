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

## Protected feature cache (Version 1.4.1)

`/vehicles` has no Next.js authentication middleware; backend authentication is
the security boundary. The page mounts an identity-keyed feature subtree only
for `authenticated` plus a verified current user. Every other state hides the
form and list immediately, with existing accessible authentication/recovery UI
or sign-in/home links.

The provider no longer exposes its access token as a context field. Its narrow
`runWithAccessToken(operation)` callback reads the current memory-only token at
invocation, verifies the rendered identity and operation generation, and rejects
results after either changes. It is not an automatic-refresh interceptor.
Only a generic 401 for the still-current token clears authentication; a delayed
old-token 401 cannot invalidate a new identity or refreshed token.

The vehicle hook owns TanStack server state under `['vehicles', currentUser.id]`.
Queries are enabled only for that authenticated owner, have no retries or
previous-user placeholders, and pass an AbortSignal to the credential-omitting
transport. Creation invalidates only the current owner's list and caches no
response token. Unmount/identity changes abort creation and listing, cancel the
previous query and remove its data. Guarded render, abort signals and provider
generation checks jointly prevent late responses from reintroducing user A
under user B. No vehicle-specific cache logic lives in AuthenticationProvider.

The existing BroadcastChannel event clears old authentication before remote
refresh plus `/auth/me`; that transition unmounts the old vehicle boundary before
the authoritative new user can mount its own query. Confirmed cross-tab logout
uses the same removal path without extra remote logout/refresh requests.

### Editing and deletion (Version 1.4.2)

Edit forms and explicit delete confirmations live inside that same keyed vehicle
subtree. `useVehicleMutations` captures the owner and vehicle ID, owns an abort
controller and synchronous duplicate-submit latch, and uses retry-free TanStack
mutations. Keys are `['vehicles', userId, vehicleId, 'mutation']`; variables contain
only operation and patch, and results contain only safe outcome labels. Tokens
remain exclusively inside the existing callback and transport invocation.

Successful writes invalidate/refetch only `['vehicles', capturedUserId]`; there
are no optimistic updates or rollback snapshots. Expected 404s become a `missing`
outcome inside `runWithAccessToken`, ensuring even those outcomes pass the
provider's authoritative identity/generation check. Only a still-mounted,
non-aborted operation can show feedback or invalidate. Missing results refetch
the stale list and show `This vehicle is no longer available.` without retry.

Every non-authenticated status unmounts edit state, delete confirmation and their
mutation observers. Cleanup aborts pending feature work; the existing list
boundary cancels and removes prior-owner queries. Late A success/401/404 cannot
show feedback, invalidate B's list, reopen A's form or sign out B. A committed
server mutation cannot necessarily be undone by browser abort: it remains scoped
to A and is discarded by B's UI. No vehicle logic enters AuthenticationProvider.
