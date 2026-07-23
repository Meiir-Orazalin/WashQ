# ADR 0004: PostgreSQL and Prisma

## Status

Accepted

## Context

Bookings, queues, prices, ownership, and reviews need relational constraints,
transactions, indexes, and concurrency control. Type-safe application access
and repeatable migrations are required.

## Decision

Use PostgreSQL as the system of record and Prisma for schema, migrations, and
infrastructure-layer access. Prisma Client is generated inside `apps/api` and
never becomes a public API type.

## Alternatives considered

- MongoDB: rejected because relational integrity and transactional workflows
  dominate the data model.
- Handwritten SQL only: retained as an escape hatch for measured queries, but
  rejected as the default because it increases mapping and migration work.
- Another TypeScript ORM: viable, but Prisma provides the selected migration
  and generated-client workflow.

## Consequences

Development requires PostgreSQL and Prisma generation. Advanced concurrency
flows may require transactions or carefully reviewed raw SQL in infrastructure.
Applied migrations are immutable.
