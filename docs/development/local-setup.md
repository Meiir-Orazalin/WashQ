# Local setup

## Prerequisites

Install Node.js 24 LTS, Git, and Docker Desktop. Enable the repository-pinned
pnpm version through Corepack:

```bash
corepack enable
pnpm run doctor
```

If `/usr/local/bin` is not writable on macOS, enable Corepack in a user-owned
directory already on `PATH`:

```bash
mkdir -p ~/.npm-global/bin
corepack enable pnpm --install-directory ~/.npm-global/bin
```

## Start the project

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Before starting the API, replace the development-only
`ACCESS_TOKEN_SIGNING_SECRET` example with a private value. Authentication
configuration has no production defaults: production startup requires a
non-placeholder secret of at least 32 characters plus valid access- and
refresh-token lifetimes. Tests receive isolated values from the test
environment.

Default development credentials are local-only:

```text
application database: washqueue
integration-test database: washqueue_test
user: washqueue
password: washqueue_dev
port: 5432
```

The Compose initialization script creates `washqueue_test` only when the
PostgreSQL volume is initialized. If the volume predates that script, recreate
the disposable local volume with `docker compose down -v` followed by
`docker compose up -d`, after confirming it contains no data you need.

Open:

- web: `http://localhost:3000`
- API health: `http://localhost:4000/api/v1/health`
- API readiness: `http://localhost:4000/api/v1/health/ready`
- Swagger: `http://localhost:4000/docs`

Stop applications with `Ctrl+C`. Stop PostgreSQL with `docker compose down`.
Use `docker compose down -v` only when intentionally deleting local database
data.

Version 1.1 creates the `users` table through
`20260727094726_add_users_for_customer_registration`. A fresh environment must
run `pnpm db:migrate` before registration or integration testing.

Version 1.2.1 adds `refresh_sessions` through
`20260727104041_add_refresh_sessions`. Run `pnpm db:generate` after schema
changes and apply the complete migration history to both development and
dedicated test databases.

Version 1.2.3 adds refresh-session family and replacement linkage through
`20260727111913_add_refresh_session_families`. Apply it before testing refresh
rotation.

## Manual refresh-rotation check

Start PostgreSQL and the built API, then use a disposable cookie directory so
raw tokens are not printed:

```bash
pnpm build
pnpm --filter @washqueue/api start

washqueue_cookie_dir="$(mktemp -d)"
curl -sS -X POST http://localhost:4000/api/v1/auth/register \
  -H 'content-type: application/json' \
  --data '{"firstName":"Refresh","email":"refresh-check@example.com","password":"example-password"}'
curl -sS -X POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  --data '{"email":"REFRESH-CHECK@EXAMPLE.COM","password":"example-password"}' \
  -c "$washqueue_cookie_dir/current.cookies"
cp "$washqueue_cookie_dir/current.cookies" "$washqueue_cookie_dir/replay.cookies"
curl -sS -X POST http://localhost:4000/api/v1/auth/refresh \
  -H 'Origin: http://localhost:3000' \
  -b "$washqueue_cookie_dir/current.cookies" \
  -c "$washqueue_cookie_dir/current.cookies"
curl -sS -X POST http://localhost:4000/api/v1/auth/refresh \
  -H 'Origin: http://localhost:3000' \
  -b "$washqueue_cookie_dir/replay.cookies"
```

The first refresh returns 200 and rotates the cookie. Reusing
`replay.cookies` returns `401 INVALID_REFRESH_SESSION` and revokes only that
family. A request with `Origin: https://attacker.example` returns
`403 ORIGIN_NOT_ALLOWED`. Remove the temporary cookie directory and database
fixture when finished.

## Manual current-session logout check

Start PostgreSQL, generate Prisma Client, deploy the existing migration history,
and start the built API. Use disposable cookie jars and response files so raw
refresh and access tokens are not printed:

```bash
docker compose up -d
pnpm db:generate
pnpm --filter @washqueue/api db:migrate:deploy
pnpm build
pnpm --filter @washqueue/api start

washqueue_logout_dir="$(mktemp -d)"
curl -sS -o "$washqueue_logout_dir/register.json" \
  -X POST http://localhost:4000/api/v1/auth/register \
  -H 'content-type: application/json' \
  --data '{"firstName":"Logout","email":"logout-check@example.com","password":"example-password"}'
curl -sS -o "$washqueue_logout_dir/first-login.json" \
  -X POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  --data '{"email":"logout-check@example.com","password":"example-password"}' \
  -c "$washqueue_logout_dir/first.cookies"
cp "$washqueue_logout_dir/first.cookies" "$washqueue_logout_dir/first-original.cookies"
curl -sS -o "$washqueue_logout_dir/second-login.json" \
  -X POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  --data '{"email":"logout-check@example.com","password":"example-password"}' \
  -c "$washqueue_logout_dir/second.cookies"

curl -sS -o /dev/null -D "$washqueue_logout_dir/logout.headers" \
  -w '%{http_code}\n' -X POST http://localhost:4000/api/v1/auth/logout \
  -H 'Origin: http://localhost:3000' \
  -b "$washqueue_logout_dir/first.cookies" \
  -c "$washqueue_logout_dir/first.cookies"
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:4000/api/v1/auth/refresh \
  -H 'Origin: http://localhost:3000' \
  -b "$washqueue_logout_dir/first-original.cookies"
curl -sS -o "$washqueue_logout_dir/second-refresh.json" -w '%{http_code}\n' \
  -X POST http://localhost:4000/api/v1/auth/refresh \
  -H 'Origin: http://localhost:3000' \
  -b "$washqueue_logout_dir/second.cookies" \
  -c "$washqueue_logout_dir/second.cookies"
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:4000/api/v1/auth/logout \
  -H 'Origin: http://localhost:3000' \
  -b "$washqueue_logout_dir/first-original.cookies"
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:4000/api/v1/auth/logout \
  -H 'Origin: http://localhost:3000'
```

The status sequence is `204`, `401`, `200`, `204`, `204`. The logout headers
contain an empty, expired `washqueue_refresh` cookie with `HttpOnly`,
`SameSite=Lax`, and `Path=/api/v1/auth`.

Create a third login cookie, call logout with an unapproved Origin, and then
refresh it with the approved Origin:

```bash
curl -sS -o "$washqueue_logout_dir/third-login.json" \
  -X POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  --data '{"email":"logout-check@example.com","password":"example-password"}' \
  -c "$washqueue_logout_dir/third.cookies"
curl -sS -o "$washqueue_logout_dir/disallowed.json" \
  -D "$washqueue_logout_dir/disallowed.headers" -w '%{http_code}\n' \
  -X POST http://localhost:4000/api/v1/auth/logout \
  -H 'Origin: https://attacker.example' \
  -b "$washqueue_logout_dir/third.cookies"
curl -sS -o "$washqueue_logout_dir/third-refresh.json" -w '%{http_code}\n' \
  -X POST http://localhost:4000/api/v1/auth/refresh \
  -H 'Origin: http://localhost:3000' \
  -b "$washqueue_logout_dir/third.cookies"
```

The last two statuses are `403` and `200`; the 403 headers contain no
`Set-Cookie`. Inspect `users` and `refresh_sessions` without selecting
`password_hash` or `token_hash`, confirm only the first session was revoked,
and review API logs for accidental token, password, or signing-secret output.
Delete the temporary account, remove the disposable directory, and stop the
built API when finished.

## Manual current-user check

Register and log in a temporary account, saving the login response without
printing its access token:

```bash
washqueue_me_dir="$(mktemp -d)"
curl -sS -o "$washqueue_me_dir/register.json" \
  -X POST http://localhost:4000/api/v1/auth/register \
  -H 'content-type: application/json' \
  --data '{"firstName":"Current","email":"current-check@example.com","password":"example-password"}'
curl -sS -o "$washqueue_me_dir/login.json" \
  -X POST http://localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  --data '{"email":"current-check@example.com","password":"example-password"}'
washqueue_access_token="$(jq -r '.accessToken' "$washqueue_me_dir/login.json")"
```

Call the endpoint with the access token, without Authorization, and with a
modified token:

```bash
curl -sS -o "$washqueue_me_dir/current.json" -D "$washqueue_me_dir/current.headers" \
  -w '%{http_code}\n' http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer $washqueue_access_token"
curl -sS -o "$washqueue_me_dir/missing.json" -w '%{http_code}\n' \
  http://localhost:4000/api/v1/auth/me
curl -sS -o "$washqueue_me_dir/modified.json" -w '%{http_code}\n' \
  http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer ${washqueue_access_token}modified"
```

The status sequence is `200`, `401`, `401`. The 200 response contains only the
four public user fields, and its headers contain no `Set-Cookie`. The two 401
responses use the same `AUTHENTICATION_REQUIRED` code and message. Update the
temporary user's name or email directly in the local database and repeat the
valid request to confirm the endpoint returns current values rather than token
claims. Delete the user and repeat once more to confirm the old token receives
the same 401. Expired-token behavior is covered deterministically by the API
test suite.

Inspect API logs for accidental Authorization, token, password, or signing
secret output. Delete the temporary fixture and directory when finished.

## Manual frontend login and restoration check

Start PostgreSQL, the API, and the web application:

```bash
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Register a temporary account at `http://localhost:3000/register`, then open
`http://localhost:3000/login`. Sign in with surrounding whitespace and uppercase
letters in the email to confirm shared-contract normalization. In browser
developer tools:

1. Confirm `POST /api/v1/auth/login` returns 200 and the response cookie is
   `washqueue_refresh` with `HttpOnly`, `SameSite=Lax`, and the auth-scoped path.
2. Confirm the next request is `GET /api/v1/auth/me` with an Authorization
   header and that its public user is displayed. Do not copy or print the token.
3. Confirm localStorage, application-owned sessionStorage, IndexedDB, cookies
   accessible through JavaScript, page markup, and the URL contain no access
   token or password.
4. Reload `/login` and confirm the neutral `Restoring your session…` state
   appears without flashing the form. Confirm the request order is one
   `POST /auth/refresh`, then one credential-omitting `GET /auth/me`.
5. Confirm the authenticated user returns, the HttpOnly cookie value rotated,
   and access-token data remains absent from Web Storage, IndexedDB, the URL,
   cookies visible to JavaScript, React Query, and page markup.
6. Rapidly hide/show the tab near expiration and confirm no parallel refresh
   requests are created. Simulate a refresh network/server failure and confirm
   there is no automatic retry loop.
7. Invalidate the refresh session, reload, and confirm initialization settles
   to the login form after one 401 without calling `/auth/me`.
8. Submit a wrong password and confirm the page shows only
   `Email or password is incorrect.`
9. Sign in again, select `Sign out`, and confirm the access token, expiration,
   and user disappear immediately. Confirm one bodyless credentialed
   `POST /auth/logout` follows any already-active refresh, returns 204, and
   clears the HttpOnly cookie.
10. Reload and confirm one startup refresh settles to the login form without
    `/auth/me` or a loop. Simulate a logout 500 or network failure, confirm the
    unconfirmed-sign-out warning appears with local state still clear, and
    confirm only a manual retry calls logout again.

Inspect the browser console, API output, and web output for token or password
leakage. Delete the temporary user so its refresh session is removed by the
existing database cascade.

## Two-tab authentication release review

Use one browser context so two tabs share `washqueue_refresh`. After both tabs
are authenticated, use one `BrowserContext` and begin restoration in both pages
as close together as possible. In developer tools, verify the second
`POST /auth/refresh` starts only after the first settles and uses the replacement
cookie. Repeat at least five cycles and record only response statuses, cookie
presence/attributes, UI state, maximum request concurrency, and hash-free family
counts. Never print token, cookie, or hash values.

Confirm both pages call `/auth/me`, every rotation returns 200, one final cookie
remains usable, and PostgreSQL contains exactly one active replacement in the
family. Repeat near access-token expiration. Then delay refresh in one tab and
sign out in the other; logout must wait, use the newest cookie, and leave no
active current session. Also verify explicit login waits behind refresh/logout
and that the latest login becomes the shared cookie-backed identity.

Run the matrix in desktop Chromium and the pinned desktop WebKit engine. Keep
mobile Chrome login/restoration/logout regression coverage. Temporarily remove
`navigator.locks` in a test page and confirm the generic coordination warning
appears and no login, refresh, or logout transport starts.

The Version 1.2.8 `[401, 200]`, cleared-cookie, and zero-active-family sequence
is the failing baseline. It must not recur. Other tabs retain already-issued
memory-only access tokens until expiration; access tokens are never shared.

## Version 1.3.1 multi-tab identity review

Use the built API and web applications with PostgreSQL, not only intercepted
browser tests:

```bash
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm build
pnpm --filter @washqueue/api start
pnpm --filter @washqueue/web start
```

Run one desktop Chromium context and one pinned desktop WebKit context. Each
context must use at least two pages so the pages share the browser cookie jar.
Create two disposable customers without printing passwords, tokens, cookies, or
hashes.

1. Sign in customer A in one page. Confirm the other page receives exactly one
   `session-changed` event, performs refresh followed by `/auth/me`, and displays
   customer A. The receiver must not emit another event.
2. Select `Sign in with another account` in the sender and sign in customer B.
   Delay the receiver's refresh for observation. Confirm customer A disappears
   immediately, `Updating your session…` is announced, and no old access token
   remains available. Release the request and confirm both pages display the
   `/auth/me` projection for customer B.
3. Sign out in one page. Confirm logout returns 204 and sends exactly one
   `logout` event. The receiver must clear immediately without logout, refresh,
   or `/auth/me`. Reload both pages and confirm one invalid startup refresh per
   page settles without a loop.
4. Repeat account A/B switching and logout/login cycles with three pages.
   Record only mutation start/settle ordering, response statuses, displayed
   public identity, cookie presence/attributes, active-session counts, and
   lifecycle event shapes.

Inspect `washqueue-auth-events-v1` messages. The only allowed shapes are:

```json
{ "type": "session-changed", "sourceId": "ephemeral-per-document-id" }
```

```json
{ "type": "logout", "sourceId": "ephemeral-per-document-id" }
```

Confirm no message, browser storage, URL, markup, console output, API log, or
web log contains an access token, refresh token, cookie value, password, user
data, session ID, family ID, or API response. Confirm `document.cookie` cannot
read `washqueue_refresh`.

Inspect PostgreSQL without selecting `token_hash` or `password_hash`. After all
receivers settle, the current family must have exactly one active unexpired
session; rotated predecessors may remain revoked for audit/replay semantics.
No family may be replay-revoked during serialized normal use. After confirmed
logout, the current cookie-backed session must have no active replacement.

Temporarily remove `window.BroadcastChannel` in a fresh page. Confirm accessible
unsupported-browser UI appears and no login, refresh, or logout request starts.
Do not add a localStorage event, polling, or credential-sharing fallback.
