# ADR 0013: Organization-scoped ownership and deletion integrity

## Status

Accepted

## Context

One account can own vehicles and multiple organizations, and may later work for
another business. A global customer/owner role cannot represent these independent
relationships. Creating an organization without an owner, or silently removing
its owner through user deletion, would lose the business authorization boundary.

## Decision

- Organizations own organization memberships. Membership role has only `OWNER`
  in Version 2.1; no global user role or speculative employee role is added.
- Enforce one membership per organization/user pair. Multiple owners are possible
  in the schema, but this slice creates exactly one and exposes no owner management.
- Create the organization and initial verified user's OWNER membership in one
  infrastructure repository transaction. Application code has no Prisma dependency.
- List and detail queries filter by authenticated user and OWNER membership in
  PostgreSQL. Missing and foreign detail have the same controlled 404.
- Membership's user FK uses `ON DELETE RESTRICT`. Until ownership transfer and
  account deletion are designed, a member user cannot be directly deleted.
- Membership's organization FK uses `ON DELETE CASCADE`. Organization deletion
  exists only for database fixtures, not as a production endpoint.
- Existing vehicle and refresh-session user cascades are unchanged. Fixture
  cleanup deletes only its organizations before users, refusing organizations
  that also have a non-fixture member.

## Alternatives considered

Global user roles were rejected because customer and business relationships
coexist. A single owner column was rejected because membership is the explicit
organization authorization boundary and must permit future multiple owners.
Cascading memberships on user deletion was rejected because it can orphan an
organization; silently deleting the organization would destroy business data.
Two independent creation writes were rejected because partial failure loses the
initial-owner invariant.

## Consequences

Normal creation cannot commit a partial organization/member pair. This is an
application repository transaction invariant, not a deferred database trigger
requiring every manually inserted organization to have a member. Direct database
administration remains privileged; production exposes no membership deletion.
Account deletion and ownership transfer must explicitly resolve memberships in
a later slice. Names are descriptive, not legal identifiers, and are not unique.
No branch, employee, verification, public marketplace or global role is implied.
