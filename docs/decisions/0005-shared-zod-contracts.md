# ADR 0005: Shared Zod contracts

## Status

Accepted

## Context

TypeScript types disappear at runtime. Both API and web need one deliberate
definition of public transport payloads without coupling to database entities.

## Decision

Define framework-independent Zod schemas in `@washqueue/contracts`, infer their
TypeScript types, and export only through the package entry point. API and web
parse public boundary data using these schemas.

## Alternatives considered

- Compile-time interfaces only: rejected because they cannot validate network
  data.
- Generated types from Prisma: rejected because persistence models are not API
  contracts and would expose internal schema choices.
- Multiple validators: rejected because competing validation semantics create
  drift and unnecessary dependencies.

## Consequences

Public contract changes are atomic and runtime-safe. The package must stay free
of NestJS, Next.js, React, and Prisma imports, and contract tests are required.
