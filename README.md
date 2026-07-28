# WashQueue KZ

WashQueue KZ is a planned car wash marketplace and queue-management platform
for customers, car wash operators, and platform administrators in Kazakhstan.
This repository contains the stable Version 0 foundation, **Version 1.1
customer registration**, and the **Version 1.2.1 backend authentication
foundation**. Version 1.2.2 adds backend customer login and initial
cookie-backed refresh-session issuance. Version 1.2.3 adds one-time
refresh-token rotation and family-scoped replay detection. Logout, current-user,
frontend login, vehicles, organizations, and later product functionality are
not implemented.

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

## Quality

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

See [local setup](docs/development/local-setup.md), [commands](docs/development/commands.md),
and the [architecture overview](docs/architecture/system-overview.md).
