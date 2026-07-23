# ADR 0002: TypeScript monorepo

## Status

Accepted

## Context

The web application, API, public contracts, and quality configuration evolve
together. The team needs atomic changes and consistent compiler rules.

## Decision

Use TypeScript throughout a pnpm workspace managed by Turborepo. Applications
live in `apps`; deliberate shared packages live in `packages`. Node.js 24 LTS
and the exact pnpm version are repository policy.

## Alternatives considered

- Separate repositories: rejected because contract changes would require
  coordinated releases before the product has independent teams.
- npm or Yarn workspaces: viable, but pnpm provides strict, space-efficient
  dependency isolation and explicit workspace protocols.
- Multiple implementation languages: rejected because Version 0 gains no
  capability from the added toolchains.

## Consequences

Contracts and configuration can change atomically and CI has one entry point.
Package boundaries and Turborepo task dependencies must remain accurate.
