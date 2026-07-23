# Dependency rules

## Backend

Allowed direction:

```text
presentation ──► application ──► domain
infrastructure ──► application and/or domain interfaces
```

NestJS composition may wire these pieces at a module boundary. Domain code
cannot import framework composition code. Prisma Client is allowed only in the
database layer and future infrastructure adapters.

## Frontend and contracts

- Web code may import `@washqueue/contracts`.
- Contracts cannot import NestJS, Next.js, React, Prisma, or application code.
- Web code cannot import `apps/api`, generated Prisma files, or database models.
- API response types are inferred from public Zod schemas rather than database
  entities.

## Shared code threshold

Code becomes shared only when it has one narrow responsibility, stable semantics,
and at least two real consumers. Generic folders such as `helpers`,
`common-utils`, `shared-services`, `misc`, and `global-types` are prohibited.

These rules are enforced by repository structure, package public entry points,
review, and tests. Import-boundary automation can be added when multiple
business modules exist and there are concrete paths to enforce.
