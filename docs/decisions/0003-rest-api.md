# ADR 0003: REST API

## Status

Accepted

## Context

Web clients need a stable HTTP interface for resource-oriented marketplace,
booking, and queue workflows. Versioning and operational observability are
required.

## Decision

Expose JSON REST endpoints under `/api/v1` from NestJS. Describe them through
OpenAPI and validate public payloads with shared Zod contracts. Use consistent,
sanitized error envelopes and request IDs.

## Alternatives considered

- GraphQL: rejected because the current clients do not need arbitrary query
  composition and it would add schema, caching, authorization, and operational
  complexity.
- RPC-only APIs: rejected because resource semantics and standard HTTP tooling
  fit the planned public surface.

## Consequences

HTTP behavior is easy to inspect, cache, document, and test. Endpoint evolution
requires deliberate compatibility and versioning decisions.
