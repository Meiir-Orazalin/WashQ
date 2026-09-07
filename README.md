# WashQueue KZ

WashQueue KZ is a planned car wash marketplace and queue-management platform
for customers, car wash operators, and platform administrators in Kazakhstan.
This repository contains the stable Version 0 foundation, **Version 1.1
customer registration**, and the **Version 1.2.1 backend authentication
foundation**. Version 1.2.2 adds backend customer login and initial
cookie-backed refresh-session issuance. Version 1.2.3 adds one-time
refresh-token rotation and family-scoped replay detection. Version 1.2.4 adds
backend logout of the current refresh session. Version 1.2.5 adds the
Bearer-authenticated backend current-user endpoint. Version 1.2.6 adds frontend
login with memory-only authentication state. Version 1.2.7 adds controlled
startup restoration and same-document proactive refresh without persistent
token storage. Versions 1.2.8 and 1.2.9 add coordinated frontend logout and a
cross-tab Web Lock for every refresh-cookie mutation. Version 1.3.1 adds
non-sensitive cross-tab login/logout lifecycle notification and verifies
`/auth/me` after every successful frontend refresh. Version 1.3.2 makes the
critical built-app Chromium smoke and Chromium/WebKit browser-lifecycle matrix
repeatable in CI with isolated PostgreSQL fixtures and safe failure artifacts.
Vehicles, organizations, and later product functionality are not implemented.

## Repository

- `apps/web` — Next.js App Router frontend.
- `apps/api` — NestJS REST API and Prisma database layer.
- `packages/contracts` — public framework-independent Zod API contracts.
- `packages/typescript-config` — strict shared TypeScript settings.
- `packages/eslint-config` — shared flat ESLint configuration.
- `docs` — product, architecture, decisions, and development guidance.
- `infrastructure` — local infrastructure notes and scripts.

The system is a TypeScript modular monolith. Future backend business modules
will keep presentation, application, domain, and infrastructure boundaries.

## Prerequisites

- Node.js 24 LTS
- Corepack and pnpm 11.16.0
- Docker Desktop with Docker Compose

```bash
corepack enable
pnpm run doctor
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

The web application runs at `http://localhost:3000`, the API at
`http://localhost:4000`, Swagger at `http://localhost:4000/docs`, and health
checks at:

```text
GET http://localhost:4000/api/v1/health
GET http://localhost:4000/api/v1/health/ready
```

Version 1.1 adds the minimal `users` table. Run `pnpm db:migrate` before using
`POST /api/v1/auth/register` or opening `http://localhost:3000/register`.
Version 1.2.1 adds server-side token configuration and the
`refresh_sessions` table without adding a public authentication endpoint.
Version 1.2.2 adds `POST /api/v1/auth/login`; it returns a short-lived access
token and sets the opaque refresh token only in an HttpOnly cookie.
Version 1.2.3 adds `POST /api/v1/auth/refresh`; it atomically rotates that
cookie, returns a new short-lived access token, and revokes only the compromised
session family when an already-replaced token is replayed.
Version 1.2.4 adds `POST /api/v1/auth/logout`; it idempotently revokes only the
presented active refresh session, clears the auth cookie, and leaves existing
access tokens valid until expiration.
Version 1.2.5 adds `GET /api/v1/auth/me`; it validates the short-lived Bearer
access token and returns current public user values without consulting refresh
sessions.
Version 1.2.6 adds `http://localhost:3000/login`; it validates through shared
contracts, accepts the HttpOnly refresh cookie, verifies `/auth/me`, and keeps
the access token only in React memory. Version 1.2.7 restores after reload by
rotating that cookie once, verifying `/auth/me`, and scheduling same-document
refresh from the server-provided expiration. Version 1.2.8 adds frontend logout,
and Version 1.2.9 serializes login, refresh, and logout across tabs with one Web
Lock. Version 1.3.1 sends only ephemeral lifecycle events between tabs; each tab
still obtains its own token through refresh and verifies current identity
through `/auth/me`. Version 1.3.2 changes no authentication product behavior;
it promotes the critical real-browser, real-database coordination and
page-lifecycle checks into repeatable CI suites.

## Quality

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:e2e:auth-smoke
pnpm test:e2e:auth-matrix
pnpm build
```

See [local setup](docs/development/local-setup.md), [commands](docs/development/commands.md),
and the [architecture overview](docs/architecture/system-overview.md).
