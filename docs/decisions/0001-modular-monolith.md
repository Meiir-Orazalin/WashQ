# ADR 0001: Modular monolith

## Status

Accepted

## Context

WashQueue KZ has several related capabilities but no proven need for independent
scaling, deployment, or team ownership. Bookings and live queues will require
strong transactional behavior.

## Decision

Build one deployable NestJS API organized into explicit business modules. Each
module will separate presentation, application, domain, and infrastructure and
interact with other modules through public application interfaces or domain
events.

## Alternatives considered

- Microservices: rejected because they add network failure modes, distributed
  transactions, deployment overhead, and premature ownership boundaries.
- Unstructured monolith: rejected because direct repository and model sharing
  would make future changes unsafe.

## Consequences

Local development and transactions remain simple. Boundary discipline must be
enforced in code review and tests. A later service extraction remains possible
when production evidence justifies it.
