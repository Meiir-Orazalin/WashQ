# Branches and weekly opening hours (Version 2.2)

Branches owns branch and weekly schedule persistence. Authentication supplies only
the verified current user ID through the existing endpoint-scoped guard. The
organizations public framework-independent `OrganizationOwnerAccess` exports a
void owner assertion and generic OrganizationNotFoundError. Its implementation
uses the organization's membership-filtered repository internally. Branch code
imports only this public boundary (plus OrganizationsModule for composition),
never organization repositories, membership models or controllers.

Create/list/detail/replace application use cases validate shared contracts and
assert owner access before branch persistence. The branch repository always
includes organization scope; detail/replacement include both organization and
branch IDs. Missing/non-owned organizations are ORGANIZATION_NOT_FOUND. An owned
organization with a missing/wrong-organization branch is BRANCH_NOT_FOUND.
Neither discloses foreign existence. Public mappers exclude ownership and database
minute fields. Prisma and transaction APIs stay in infrastructure.

## Time and atomicity

See [ADR 0014](../decisions/0014-branch-local-weekly-opening-hours.md). Branch zones
are IANA identifiers validated with Intl. Weekly schedules are local wall-clock
minutes; HH:mm is never converted through a browser zone. Each saved week has
seven unique weekdays; a fresh branch creates no schedule rows. OPEN is 1–1439
minutes, with an explicit overnight flag. CLOSED/OPEN_24_HOURS have no times.

Replacement locks the scoped branch row, deletes the previous week and inserts
all seven rows in one transaction. Any failure rolls back. Concurrent writers
serialize and commit one complete request, not mixed days. No optimistic version
field or distributed lock. Branch updatedAt advances with a saved schedule;
createdAt is retained. Per-row PostgreSQL checks and branch/day uniqueness remain
authoritative; seven-row completeness is the production repository invariant.

## Frontend boundaries

`/business/organizations/[organizationId]/branches` reuses organization context
and offers creation/listing. Its detail route adds `[branchId]` and displays the
zone, local hours and complete seven-day editor. The editor explicitly labels
unconfigured all-Closed defaults as unsaved, prefills saved hours, disables
irrelevant controls and uses shared validation. Text renders through React, not
HTML. Labels, field errors, weekday legends and status/alert feedback are native.

Transport is stateless, explicit Bearer, credentials omit, no-store, UUID-validated
and encoded paths, shared parsing, abort support and no retries. Queries use
`['branches', userId, organizationId]` and
`['branch', userId, organizationId, branchId]`. Only authenticated user-keyed
subtrees render forms/data. Feature cleanup cancels and removes both key families,
aborts mutations and resets forms on any auth transition. Provider generation
checks reject stale successes; unmounted/aborted writes cannot invalidate another
user's cache or show old feedback/errors. No feature state enters authentication.
Tokens enter neither keys, cache, mutation data nor markup. No optimistic writes.

## Limits

No branch editing/deletion, exceptions, multiple intervals, open-now, wash boxes,
employees, services, prices, bookings or public listing. A committed server write
cannot be undone by browser abort; it remains scoped to the original organization
and its old UI result is discarded. Lost create responses have no idempotency key
and are not retried. Future slice: Version 2.3 wash boxes.
