# Authentication architecture

Version 1.2.1 establishes authentication configuration and token/session
infrastructure. Version 1.2.2 adds backend customer login and initial refresh
session issuance. Version 1.2.3 adds one-time refresh-token rotation and
family-scoped replay detection. Version 1.2.4 adds idempotent logout of the
current refresh session. Version 1.2.5 adds access-token authentication for the
current-user endpoint. Version 1.2.6 adds the initial frontend login flow and
memory-only authentication state. Version 1.2.7 adds controlled startup
restoration and same-document proactive refresh. Version 1.2.8 adds coordinated
frontend logout and performs the final authentication release review. Version
1.2.9 serializes browser login, refresh, and logout cookie mutations across
same-origin tabs with a Web Lock. Version 1.3.1 adds non-sensitive cross-tab
lifecycle notification and makes refresh plus `/auth/me` the identity authority
for every frontend refresh path. Version 1.3.2 adds repeatable built-browser
lifecycle and database assertions without changing production authentication
behavior. Global guards and protected business endpoints remain absent.

## Boundaries

Authentication follows the modular-monolith dependency direction:

```text
authentication use case
  -> application ports
     -> access-token service
     -> refresh-token generator
     -> refresh-token hasher
     -> refresh-session repository
        -> infrastructure adapters
           -> jose
           -> Node cryptography
           -> Prisma
```

Application types are framework-independent. JWT claims, token-library errors,
Prisma models, raw refresh tokens, and HTTP response objects do not cross these
ports.

## Access tokens

Access tokens are short-lived HS256-signed JWTs. The verified application
payload contains only:

- subject/user UUID;
- the `access` token discriminator;
- issued-at time;
- expiration time.

Email, names, roles, memberships, vehicles, and other mutable data are
deliberately excluded. Issuance and verification are available only through the
`AccessTokenService` port. The signing secret remains server-side.

## Customer login

`POST /api/v1/auth/login` follows this order:

```text
shared request validation
  -> normalized email lookup
  -> password or dummy-password verification
  -> access-token issuance
  -> opaque refresh-token generation and hashing
  -> refresh-session persistence
  -> public response mapping and HttpOnly cookie
```

Unknown email, incorrect password, and password-verification failures produce
the same `INVALID_CREDENTIALS` application result. Unknown emails perform
Argon2id verification against a valid non-secret dummy hash without artificial
sleeps.

The controller does not write the refresh cookie until the use case has
persisted the refresh session and the public JSON response has passed its shared
contract.

## Refresh tokens and sessions

Refresh tokens are opaque values generated from 32 cryptographically secure
random bytes. Only a SHA-256 digest with the `sha256:` format discriminator is
passed to persistence. SHA-256 is appropriate here because the input is a
uniformly random 256-bit bearer secret; password hashing remains separately
protected by Argon2id.

Each refresh session belongs to one user and has an explicit expiration and
optional revocation timestamp. A user may own multiple sessions. Deleting the
user cascades to their sessions.

Every login starts a new UUID session family. A successful rotation creates one
replacement in the same family, revokes the prior session, and links it through
`replacedBySessionId` in one repository transaction. The Prisma adapter locks
the old PostgreSQL row and checks its previously observed update timestamp, so
at most one simultaneous request succeeds.

Presenting an already-linked token later is replay evidence. The use case
revokes active sessions only in that family; independent login families remain
active. A losing in-flight concurrent request receives the same invalid-refresh
result without revoking the successful replacement. See
[ADR 0009](../decisions/0009-refresh-token-rotation-and-family-replay-revocation.md).

The raw token crosses only the application-to-presentation boundary after
successful session persistence. It is written to the `washqueue_refresh`
HttpOnly cookie and is never included in JSON. See the
[session cookie policy](session-cookie-policy.md).

## Refresh flow

`POST /api/v1/auth/refresh` follows this order:

```text
cookie parsing and browser-Origin validation
  -> presented-token hashing and session lookup
  -> active, unexpired, existing-user check
  -> replacement-token generation and hashing
  -> access-token issuance
  -> atomic old-session revocation and replacement creation
  -> strict public response mapping and cookie overwrite
```

Missing, malformed, unknown, expired, revoked, deleted-user, and replayed
sessions produce the same `INVALID_REFRESH_SESSION` response and clear the
refresh cookie. Unexpected infrastructure failures use the sanitized global
500 response and do not write a cookie.

## Current-session logout flow

`POST /api/v1/auth/logout` follows this order:

```text
browser-Origin validation and safe cookie parsing
  -> opaque-token shape validation
  -> presented-token hashing
  -> atomic conditional revocation by unique token hash
  -> auth-scoped cookie clearing
  -> empty 204 response
```

The application use case has no HTTP, cookie, NestJS, Express, or Prisma
dependency. It treats a missing or malformed token as a completed logout. For a
shape-valid token, the repository receives only its branded hash and atomically
sets `revokedAt` only when that unique session is active and unexpired. An
unknown, expired, already-revoked, deleted-user, or rotated-predecessor token
therefore produces the same empty `204 No Content` response without a
read-then-update query.

Logout never invokes family replay revocation, creates no replacement, and does
not affect another session or login family. Replay detection remains exclusive
to refresh. A browser Origin rejected before the use case receives
`403 ORIGIN_NOT_ALLOWED` and neither persistence nor cookie state is changed.
An accepted request clears the cookie with the centralized policy, including
when an unexpected hashing or database failure is returned through the
sanitized global 500 boundary.

Logout revokes no access token and adds no blacklist. Any access token issued
before logout remains valid until its short expiration.

## Current-user flow

`GET /api/v1/auth/me` follows this order:

```text
focused Authorization Bearer parsing
  -> access-token verification
  -> verified subject UUID validation
  -> public user lookup by ID
  -> strict current-user response mapping
```

The presentation layer parses the header and translates all expected
authentication failures to `401 AUTHENTICATION_REQUIRED`. The application use
case depends only on `AccessTokenService` and `UserRepository`; JOSE remains in
the token adapter and Prisma remains in the user repository. The repository
selects only ID, first name, nullable last name, and email.

The endpoint is stateless with respect to refresh sessions. It never reads or
mutates the refresh cookie or session table. Logout and refresh-family
revocation do not blacklist an already-issued access token, which remains
usable until its short expiration. Deleting the referenced user causes the
public lookup to fail and produces the same generic 401 as every other expected
authentication failure.

The Bearer authentication adapter is scoped only to `/auth/me`. Later protected
endpoints may reuse the narrow reader and application boundary, but Version
1.2.5 introduces no global guard and protects no unrelated route.

## Frontend login flow

The `/login` route uses these frontend boundaries:

```text
login form
  -> shared login-request validation
  -> TanStack login mutation
  -> central API client login with credentials included
  -> memory-only access-token staging
  -> central API client /auth/me with explicit Bearer token
  -> current-user contract validation
  -> authenticated memory state and confirmation UI
```

The root authentication provider stores only the access token, its expiration
timestamp, the current public user, and the authentication status. The mutation
has no variables or result data, so neither the password nor access token enters
the TanStack Query cache. The password remains local to the form and is cleared
after an API failure or successful authentication.

Before the login request starts, the frontend acquires the shared exclusive auth
cookie-mutation Web Lock. The request uses `credentials: "include"` so the
browser accepts the backend-managed HttpOnly refresh cookie. `/auth/me` uses
`credentials: "omit"` and an explicit Authorization header, so that verification
depends only on the staged access token. The login response user is not treated
as final; only the contract-validated `/auth/me` user completes authentication.
The token remains staged in the explicit operation until the provider atomically
commits it with its expiration and verified user. After that React commit, the
tab broadcasts one non-sensitive `session-changed` lifecycle event. Failed,
stale, or unverified login work is never broadcast. If verification fails, the
token, expiration, and user are cleared and no refresh attempt occurs.

Access tokens are never persisted to Web Storage, IndexedDB, cookies, URLs,
React Query data, or rendered markup. See
[ADR 0010](../decisions/0010-memory-only-browser-access-tokens.md).
The authenticated confirmation UI can clear only this tab's memory and return
to the login form for an explicit sign-in with another account. It does not
mutate the shared cookie or emit a lifecycle event until the new login has
succeeded and been verified.

## Frontend restoration and refresh

On the first client mount, the provider begins in `initializing` and renders a
neutral status instead of the login form. It asks one non-React coordinator to
rotate the HttpOnly cookie through `POST /auth/refresh`, keeps the validated
access token staged in that operation, and verifies the current PostgreSQL user
through credential-omitting `GET /auth/me`. Only both successes atomically
commit token, expiration, and user and transition to `authenticated`.

The coordinator retains only the active Promise and gives concurrent callers
that same Promise. It clears the reference after settlement. The refresh
transport executes inside the shared exclusive auth cookie-mutation Web Lock.
This prevents
Strict Mode effect replay, a timer, a visibility event, and multiple consumers
within one JavaScript realm from issuing parallel rotations, while the Web Lock
queues rotations from other same-origin documents. Effect
subscriptions and operation generations prevent unmounted or stale restoration
results from overwriting a newer explicit login.

The provider schedules one timeout from the server-provided
`accessTokenExpiresAt`, normally 60 seconds before expiration. It never decodes
the JWT. Every successful startup, proactive, visibility, and remote-event
refresh calls `/auth/me` with the new token before state changes. Routine
refresh keeps the previous matched token/user pair while the new token is
staged, then atomically replaces token, expiration, and user and schedules the
next timeout. When a hidden document becomes visible, it refreshes only if the
token is within that safety window and no prior outcome is indeterminate.

`401 INVALID_REFRESH_SESSION` clears memory and becomes `unauthenticated`.
Startup Origin, network, server, JSON, or contract failures become a
user-recoverable `error` without retry. After an indeterminate
refresh-transport failure, the still-valid matched token and user remain usable
until that token expires; the provider suppresses further automatic rotation
attempts for that token and then clears memory into `error`. If refresh succeeds
but `/auth/me` fails, the new token is discarded and local state fails closed
rather than committing an unverified identity. No automatic retry follows
either failure.

The lock stores no auth state and carries no token or user metadata. It wraps
only login, refresh, and logout; `/me` remains an explicit Bearer request outside
the lock. Access tokens are not shared across tabs and no global request
interceptor or route protection is added.

## Frontend logout

The authenticated confirmation UI exposes one native sign-out button. The
provider owns logout coordination:

```text
logout intent and operation-generation invalidation
  -> immediate access-token, expiration, and user removal
  -> proactive timer cancellation and visibility-refresh suppression
  -> await any same-document refresh Promise
  -> acquire the shared cross-tab auth cookie-mutation Web Lock
  -> bodyless credentialed POST /auth/logout inside the lock
  -> unauthenticated state after 204
```

Waiting for the existing refresh lets the browser apply its replacement cookie
before logout sends the current cookie. The provider ignores the refresh result,
and generation checks prevent stale restoration, login, or proactive-refresh
work from rebuilding authenticated state. Logout never calls `/auth/me` or
starts another refresh.

The statuses are `initializing`, `synchronizing`, `unauthenticated`,
`authenticating`, `authenticated`, `logging-out`, `logout-error`,
`coordination-error`, `lifecycle-error`, and `error`. `logout-error`
means browser memory is already clear but server revocation could not be
confirmed. Origin, network, server, and invalid-response failures are not
retried automatically. The user can retry the idempotent logout directly, or
continue to a clean login form with an explicit warning that reloading before a
successful retry may restore the still-cookie-backed session.

After backend logout returns 204 and local unauthenticated state is committed,
the sender broadcasts one non-sensitive `logout` event. Receiving tabs
immediately invalidate operation generations, clear memory and timers, and
become unauthenticated without calling logout, refresh, or `/auth/me`. A failed
or indeterminate backend logout is not broadcast as confirmed.

## Cross-tab cookie-mutation coordination

All frontend operations that can set, rotate, or clear `washqueue_refresh` use
one stable exclusive Web Lock,
`washqueue-auth-cookie-mutation-v1`. The HTTP request begins only in the lock
callback; the callback settles only after transport and required response
parsing. Waiting is not treated as an auth failure. Lock-capability or
acquisition failure sends no request and surfaces the sanitized
`AUTH_COORDINATION_UNAVAILABLE` state.

Sequential two-tab restoration can rotate the same family multiple times, but
every request observes the browser's current replacement cookie. One active
replacement remains. Login and logout use the same lock so a newer login cookie
cannot race an old refresh, and logout waits for both local refresh idle and
cross-tab lock ownership before revoking the current cookie.

One browser cookie jar cannot preserve different long-lived refresh identities
per tab. The newest successful explicit login owns the shared refresh cookie.
After its `/auth/me` verification and local commit, the sender publishes:

```json
{ "type": "session-changed", "sourceId": "ephemeral-per-document-id" }
```

Receiving tabs clear their old token, expiration, user, and timers immediately,
enter `synchronizing`, and reuse the same `RefreshCoordinator`. Its refresh
still takes the Web Lock, so every receiving document rotates sequentially and
obtains its own memory-only token. `/auth/me` establishes the authoritative
user before token, expiration, and user are committed together. Remote work
never rebroadcasts, and same-user login follows the same path because event
metadata carries no identity.

A confirmed local logout publishes:

```json
{ "type": "logout", "sourceId": "ephemeral-per-document-id" }
```

Remote logout clears local state without another server request. Events never
contain credentials, cookies, user data, session or family identifiers, API
responses, or timestamps. The ephemeral source ID exists only to ignore the
sender's event and is not persisted. Operation generations ensure stale remote
work cannot overwrite a newer explicit login, logout, or lifecycle event.

`BroadcastChannel` is feature-detected and is not a mutex or state store.
Unsupported browsers fail closed with generic lifecycle-coordination UI; there
is no localStorage, polling, credential-sharing, or custom-bus fallback. See
[ADR 0011](../decisions/0011-web-lock-for-auth-cookie-mutations.md),
[ADR 0012](../decisions/0012-non-sensitive-cross-tab-auth-lifecycle-events.md),
the [frontend lifecycle](frontend-authentication-lifecycle.md), and the
[supported-browser policy](supported-browsers.md).

## Browser lifecycle reliability

Version 1.3.2 verifies the existing browser primitives rather than adding a
second coordination mechanism. Real Chromium and WebKit documents prove that a
queued auth mutation disappears when its waiting page closes, a held Web Lock
is released when its document closes or navigates, and a new document can then
restore normally. Closing during remote synchronization or `/auth/me` cannot
commit stale provider state, while reload during synchronization falls back to
startup refresh plus authoritative `/auth/me`.

Runtime BroadcastChannel construction and publication failures retain the
existing fail-closed lifecycle state. There is still no storage event,
polling, credential-sharing, or unlocked mutation fallback. These tests cover
document close and navigation only; they do not establish guarantees for an
operating-system process crash or suspension.

## Configuration

The API validates these server-only environment variables at startup:

| Variable                         | Rule                                                                       |
| -------------------------------- | -------------------------------------------------------------------------- |
| `ACCESS_TOKEN_SIGNING_SECRET`    | required, at least 32 characters                                           |
| `ACCESS_TOKEN_LIFETIME_SECONDS`  | integer from 60 through 3,600                                              |
| `REFRESH_TOKEN_LIFETIME_SECONDS` | integer from 3,600 through 31,536,000 and greater than the access lifetime |

Production rejects obvious development, test, placeholder, and `change-me`
secret values. Validation errors identify invalid field names without including
secret values. Issuer and audience are not configured because Version 1.2.1 has
one API issuer and no concrete multi-audience requirement.
