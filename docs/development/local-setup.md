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
