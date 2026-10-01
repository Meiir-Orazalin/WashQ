# Branch wash boxes (Version 2.3)

A wash box is a physical bay belonging to one branch. Its immutable number is
1–999 and unique within that branch, including inactive rows. Activity is an owner
configuration setting, not real-time occupancy, availability or booking capacity.
A branch may have no boxes and need not have configured opening hours.

## Public module boundaries

`WashBoxesModule` uses the unchanged endpoint-scoped Bearer/current-user guard.
Its focused create/list/detail/state use cases consume only branches' public
`BranchOwnerAccess.assertCurrentOwner(userId, organizationId, branchId)` interface.
The branches facade reuses `GetOwnedBranchUseCase`: organizations' public owner
assertion runs first, followed by the organization-and-branch-filtered lookup.
Only a frozen `{ branchId }` scope leaves that facade; no membership, schedule,
repository or Prisma model crosses the boundary.

Wash-box persistence accesses only its own table. Every operation includes the
validated branch ID; detail and state updates additionally match the box ID.
No global lookup followed by application-only authorization is used. Presentation
maps five public fields and sanitized errors; application/domain code contains no
NestJS, HTTP or Prisma dependency. Parent authorization runs before box lookup.

Missing/foreign organization, branch and box are indistinguishable at their own
level, respectively `ORGANIZATION_NOT_FOUND`, `BRANCH_NOT_FOUND` and
`WASH_BOX_NOT_FOUND`. Recognized branch/number uniqueness maps to
`WASH_BOX_ALREADY_EXISTS`; only the known branch FK failure maps to branch missing
if a parent disappears after authorization. Other infrastructure failures remain
sanitized 500. The FK prevents orphan boxes.

## Persistence and concurrent writes

One forward migration adds only `wash_boxes`, with a branch CASCADE FK, integer
number check, non-null default-true activity, UUID and timezone-aware timestamps.
The branch/number unique index also supports branch-filtered number ordering;
there is no redundant listing index. List ordering is number ASC, id ASC.
Concurrent duplicate creates yield one success, one controlled conflict and one
row. The same number in another branch is allowed.

Activity changes use one parameterized branch-and-box-scoped `UPDATE RETURNING`,
not read-then-toggle. Same-value assignments succeed and preserve `updatedAt`.
Actual changes advance it by at least the timestamp's millisecond precision;
`createdAt`, number and parent are retained. Concurrent explicit assignments follow
PostgreSQL committed ordering/last-write-wins. No locking/version framework is added.
Organization fixture deletion cascades memberships, branches, hours and boxes;
membership user deletion remains RESTRICT. Existing customer relations are untouched.

## Frontend boundaries

The branch detail links to `/business/organizations/[organizationId]/branches/
[branchId]/wash-boxes` and its `[washBoxId]` detail. Native forms use shared strict
validation. Deactivation requires a labelled confirmation; cancellation sends no
request. Activity updates have pending feedback, no optimistic change, and
invalidate/refetch captured list/detail keys after a validated server success.

Keys are `['wash-boxes', userId, organizationId, branchId]` and
`['wash-box', userId, organizationId, branchId, washBoxId]`. Only the authenticated
user/resource-keyed subtree shows protected data. Cleanup aborts writes, cancels
requests and removes both wash-box cache families for the departing user. Account
and parent navigation reset forms/confirmations. Provider identity generations,
mounted checks and abort checks discard late success/errors. Transport checks abort
before classifying a response so a cancelled prior-branch 401 cannot invalidate
the current session. Tokens stay solely in the existing callback/transport, never
keys, cached values, mutation results, markup, URLs or storage. Authentication and
its lifecycle channel are unchanged.

## Limits

No deletion, renumbering, box schedule, occupancy, equipment, employee assignment,
service compatibility, booking or queue behavior. Browser abort does not undo a
committed server write: it remains scoped to the original authorized resource,
while its UI result is discarded. Create has no general idempotency key; do not
automatically retry an indeterminate write. Next slice: Version 2.4 services/pricing.
