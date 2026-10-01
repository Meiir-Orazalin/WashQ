# Branch services and fixed KZT pricing (Version 2.4)

A branch owns an independent catalogue. Services have a nonunique name, nullable
plain-text description, integer duration, one positive fixed KZT price and
explicit activity. A branch may configure services without boxes or opening
hours. Activity is configuration, not availability or a booking guarantee.

## Public boundaries

Endpoint-scoped Bearer authentication supplies only the verified user ID.
Four focused application use cases invoke branches' public BranchOwnerAccess
before service persistence. Organizations retains OWNER membership authorization;
branches validates the organization-and-branch scope and returns only branchId.
Services imports no private parent repository or membership persistence.

BranchServiceRepository owns only service rows. Every operation includes the
validated branch; detail/update include service ID too. The infrastructure adapter
selects/returns only nine public application fields. Presentation maps dates to
strict shared public contracts. Missing/foreign resources match at each level:
ORGANIZATION_NOT_FOUND, BRANCH_NOT_FOUND, SERVICE_NOT_FOUND. No name conflict exists.
Only the recognized branch FK creation race becomes branch-not-found; other
failures remain sanitized 500. The FK prevents orphans.

## Text, duration and money

Contracts reuse compatible organization text schemas: prohibited controls are
rejected before NFKC/name trim/whitespace collapse, casing retained (2–120).
Descriptions trim, allow CR/LF, have at most 500 characters and normalize blank
to null; omitted PATCH retains the value. Rendering is ordinary text.

Duration is an actual JSON integer 1–1440 minutes, not a clock time or slot.
Price is a safe JSON integer 1–100000000 hundredths of KZT. Currency is stored
explicitly as KZT, required on creation, immutable on PATCH and always returned.
These bounds are product guardrails, not legal/banking/market limits. Prices are
never floating-point database values. Existing monetary conventions establish
integer minor units and ISO currency, so no new ADR or dependency is needed.

Web kzt-price is the single conversion boundary. Bounded digits plus an optional
dot/comma with one or two fractional digits use string/BigInt arithmetic.
Signs, exponents, mixed separators, trailing junk and excess precision fail
without rounding. 5000 → 500000; 5000.50/5000,50 → 500050; 0.01 → 1.
Editing uses integer quotient/remainder to preserve every accepted minor unit.
Display uses the existing English locale with visible KZT and two decimals.

## Persistence and concurrency

One forward migration adds branch_services: UUID, branch CASCADE FK, bounded text,
integer duration/price with checks, KZT varchar(3) check, default-true boolean,
timestamptz(3) dates and branch/createdAt DESC/id DESC index. No name uniqueness,
redundant organization ID, price table or service-to-box relation exists.

PATCH uses one allowlisted, parameterized branch-and-ID UPDATE RETURNING. It
writes only supplied columns, so independent concurrent patches cannot overwrite
omitted values through stale whole-row saves. A combined price/duration patch is
atomic. Actual changes advance updatedAt by at least a millisecond; a no-op
preserves it. createdAt, currency and parent remain unchanged. Concurrent same-field
edits use committed ordering/last-write-wins, without optimistic locking/history.
Parent cascades include services; membership user RESTRICT is unchanged.

## Frontend

Branch detail links to services list and service detail under the owned branch.
Shared validation and exact money conversion sit outside components. Accessible
native create/edit forms expose KZT/minute labels, pending latches and safe feedback.
Edit sends only changed mutable fields; blank description clears. Deactivation
requires confirmation; cancel sends no request. There are no optimistic writes.

Query keys are ['branch-services', userId, organizationId, branchId] and
['branch-service', userId, organizationId, branchId, serviceId]. Keyed subtrees
hide on all non-authenticated states and reset on account/resource changes.
Feature cleanup cancels/removes service caches and aborts writes. Provider
generations, mounted and post-response abort checks discard late success/401/404/500
without affecting a newer account/branch. Only captured keys are invalidated.
Tokens stay in runWithAccessToken/transport, outside keys, cached data, mutation
results, markup, URLs and storage. Authentication lifecycle code is unchanged.

## Limits and future historical data

No DELETE, multiple currencies, vehicle categories, ranges/from prices, unknown
or zero-price placeholders, discounts, bundles, add-ons, taxes, fiscal/payment
integrations, history/scheduled prices, box/employee assignment, booking slots,
public marketplace or queues. Browser cancellation does not undo a committed
write; it stays scoped to the original authorized resource. Ambiguous creation
is not retried automatically.

Future booking/order work must snapshot the accepted service label, duration,
price and currency rather than derive historical values from this mutable
catalogue. This requirement adds no booking/order/history table now.
