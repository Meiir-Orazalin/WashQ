# WashQueue KZ

WashQueue KZ is a planned car wash marketplace and queue-management platform
for customers, car wash operators, and platform administrators in Kazakhstan.
This repository currently contains **Version 0 only**: the production-oriented
technical foundation, not product functionality.

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
pnpm doctor
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

No database tables are required in Version 0, so the first `db:migrate` may
report that the schema is already synchronized.

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
