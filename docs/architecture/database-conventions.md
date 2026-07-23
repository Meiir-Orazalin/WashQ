# Database conventions

PostgreSQL is the system of record. Prisma is the database access tool and is
used only by database or module-infrastructure code.

## Naming and data rules

- SQL tables and columns use `snake_case`; Prisma model and field mappings must
  make this explicit.
- IDs use PostgreSQL UUIDs unless an ADR documents an exception.
- Timestamps are stored in UTC and named with `_at` in SQL.
- Branch time zones use IANA identifiers such as `Asia/Almaty`.
- Monetary values are never floating-point numbers.
- Money stores an integer amount in minor units and an ISO 4217 currency code.
- Foreign keys, uniqueness, and check constraints enforce durable invariants
  where PostgreSQL can express them.
- Indexes are added for measured access patterns, ownership lookups, and
  constraints, not speculatively.

## Migrations

Develop locally with:

```bash
pnpm db:generate
pnpm db:migrate
```

Production-like environments use `prisma migrate deploy`, never `migrate dev`.
An applied migration is immutable. Migrations must not be edited after they
reach a shared environment. Destructive changes require an explicit expand,
migrate, contract plan with rollback and data-verification steps.

Version 0 defines no business tables and therefore may produce no migration.
Connectivity is verified with `SELECT 1`.
