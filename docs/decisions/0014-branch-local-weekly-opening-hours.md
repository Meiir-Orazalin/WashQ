# ADR 0014: Branch IANA zones and local weekly opening hours

## Status

Accepted

## Context

Recurring business hours describe local weekday wall-clock values, not dated
booking instants. UTC conversion would invent a date and offset and distort
recurrence when offsets change. Complete concurrent schedule writes must not mix
days from separate requests.

## Decision

- Store a required validated IANA time-zone identifier on each branch; city does
  not determine it. Use the runtime Intl API, not a new time library.
- Store weekly weekdays and integer local minutes, never dates or UTC instants.
  CLOSED and OPEN_24_HOURS have null minutes and false next-day. OPEN has one
  interval of 1–1439 minutes with an explicit next-day flag.
- A configured schedule contains every weekday exactly once. An empty schedule
  means unconfigured, not seven closed days. Public times use exact HH:mm and
  responses order Monday–Sunday.
- Replace all seven rows in one infrastructure transaction after an
  organization-and-ID-filtered branch FOR UPDATE lock. Every schedule writer
  takes that lock before deleting/inserting children. Failures roll back the old
  week; concurrent complete replacements serialize, with the last committed
  writer winning. PostgreSQL range/status/duration checks and branch/day
  uniqueness protect per-row invariants.
- Branch applications consume organizations' public OrganizationOwnerAccess;
  membership lookup stays in organizations. No global role/authorization engine.

## Alternatives

UTC timestamps and arbitrary reference dates were rejected because they do not
represent local recurrence. Offset strings were rejected because they do not
carry IANA zone rules. Independent per-day writes and unlocked replacement were
rejected because concurrent calls could commit mixed weeks. A date/time library,
optimistic-locking column or distributed lock is unnecessary for this slice.

## Consequences

Seven-day completeness is a repository transaction invariant, not a deferred
database trigger preventing privileged manual single-row inserts. All production
schedule writes use the validated complete application flow; direct database
administration remains privileged. Ownership membership is immutable through
the currently exposed API; future membership removal must revisit authorization
check/write races. Rows cascade with their branch and organization. Membership
user deletion remains RESTRICT.

This does not calculate open-now, bookings, DST booking instants, availability,
special-date exceptions or multiple daily intervals. Future dated booking logic
must explicitly resolve local times and ambiguous/nonexistent instants. General
optimistic locking and conflict history remain absent.
