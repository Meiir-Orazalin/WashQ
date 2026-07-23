# ADR 0006: Testing strategy

## Status

Accepted

## Context

The platform will contain business invariants, database concurrency, HTTP
contracts, and browser workflows. One test style cannot cover all risks
efficiently.

## Decision

Use Vitest for contracts, units, API HTTP tests, PostgreSQL integrations, and
web components. Use Testing Library for visible component behavior and
Playwright for critical browser workflows. Run real PostgreSQL integration tests
in CI; do not depend on production services.

## Alternatives considered

- End-to-end tests only: rejected because they are slow and poor at isolating
  domain failures.
- Unit tests only: rejected because database and framework integration failures
  would remain invisible.
- Jest plus Vitest: rejected because two competing test runners add configuration
  and mental overhead without a current need.

## Consequences

Tests can be placed at the cheapest boundary that detects a risk. CI requires a
PostgreSQL service, and concurrency features must include integration tests
rather than mocked repositories alone.
