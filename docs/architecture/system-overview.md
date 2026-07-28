# System overview

WashQueue KZ is a TypeScript modular monolith in a pnpm/Turborepo monorepo.

```text
Browser
  │ HTTPS / REST JSON
  ▼
apps/web (Next.js App Router)
  │ /api/v1 contracts
  ▼
apps/api (NestJS)
  │ Prisma infrastructure adapter
  ▼
PostgreSQL
```

`packages/contracts` defines public Zod transport contracts shared by web and
API. It contains no framework or persistence types. `apps/api` is one deployable
process; future business capabilities are modules within that process, not
services on a network.

Version 0 contains the technical foundation. Version 1.1 adds customer
registration: shared request/response contracts, an auth registration use case,
users persistence, Argon2id password hashing, and the `/register` web route.
Version 1.2.1 adds server-only authentication configuration, token service
ports, cryptographic adapters, and refresh-session persistence. Versions 1.2.2
through 1.2.4 add backend login, cookie-backed refresh rotation,
family-scoped replay detection, and idempotent current-session logout.
Version 1.2.5 adds the Bearer-authenticated backend current-user endpoint.
Frontend login, global guards, vehicles, and organization capabilities do not
exist.

## Runtime boundaries

- The browser communicates only through the versioned REST API.
- The web application parses API responses before using them.
- The API owns persistence access; Prisma is confined to database and future
  module-infrastructure code.
- PostgreSQL is the only local infrastructure dependency.
- The liveness check does not touch PostgreSQL. Readiness executes `SELECT 1`
  and exposes only `database: up` or a sanitized 503 response.
