# Version roadmap

## Version 0 — Foundation

Monorepo, applications, database connection, shared contracts, testing, CI, and
documentation.

## Version 1 — Customer identity and vehicles

Status: implementation complete and locally verified. Version 1.5 delivery awaits
reviewed, passing GitHub-hosted checks and merge; no release tag is created here.

- [x] Version 1.1 — Customer registration.
- [x] Version 1.2 — Customer login and the minimum token lifecycle.
  - [x] Version 1.2.1 — Authentication configuration and session-token
        foundation.
  - [x] Version 1.2.2 — Backend customer login and initial session issuance.
  - [x] Version 1.2.3 — Refresh-token rotation and replay detection.
  - [x] Version 1.2.4 — Backend logout of the current refresh session.
  - [x] Version 1.2.5 — Access-token authentication and current-user endpoint.
  - [x] Version 1.2.6 — Frontend login and in-memory authentication state.
  - [x] Version 1.2.7 — Controlled frontend session restoration and
        same-document refresh coordination.
  - [x] Version 1.2.8 — Frontend logout and final authentication hardening
        review.
  - [x] Version 1.2.9 — Cross-tab login/refresh/logout cookie-operation coordination
        and supported-browser verification.
- [x] Version 1.3 — Frontend authentication identity consistency before protected
      business actions.
  - [x] Version 1.3.1 — Non-sensitive cross-tab account synchronization,
        confirmed logout notification, and refresh-plus-`/auth/me` identity
        verification.
  - [x] Version 1.3.2 — Authentication browser-lifecycle reliability,
        repeatable Chromium/WebKit CI coverage, and isolated test cleanup.
- [x] Version 1.4 — Customer vehicle management (create/list/edit/delete).
  - [x] Version 1.4.1 — Current-customer vehicle creation and listing.
  - [x] Version 1.4.2 — Owner-scoped vehicle editing and deletion.
- [x] Version 1.5 — Current-customer profile viewing and name editing.

Version 1.2.9 closes the Version 1.2.8 cross-tab release blocker by serializing
all browser login, refresh, and logout cookie mutations with one fail-closed
same-origin Web Lock.

Version 1.3.1 resolves the remaining Version 1.2 medium-severity identity gap:
the newest explicit login controls the shared cookie, while every tab keeps its
own memory-only token and converges through a non-sensitive lifecycle event,
coordinated refresh, and authoritative `/auth/me`. Confirmed logout removes
memory in other tabs without repeating the server request.

Version 1.3.2 changes no authentication product contract. It enforces the
critical shared-cookie, Web Lock, lifecycle-channel, page-close/navigation, and
identity-consistency scenarios through built applications, real browsers, and
isolated PostgreSQL fixtures in CI.

Version 1.4.1 delivers only current-customer vehicle creation and listing:
strict canonical contracts, endpoint-scoped Bearer authentication, owner-filtered
persistence, atomic duplicate handling, and a memory-only-token frontend with
identity-scoped cache removal. Built Chromium/WebKit scenarios verify account
switching and stale-response isolation.

Version 1.4.2 completes the Version 1.4 create/list/edit/delete milestone with
strict partial updates, owner-filtered atomic mutations, indistinguishable
missing/foreign 404s, deterministic duplicate handling, accessible inline editing
and delete confirmation, and identity-scoped mutation cleanup. Chrome and WebKit
verify delayed PATCH/DELETE results across account switches; PostgreSQL races,
existing migration history, authentication smoke and the full release gates pass.
No dependency or migration is added; organizations and booking features remain
unimplemented.

Do not create `v0.4.0` until the Version 1.4.2 PR has been reviewed, passes
GitHub-hosted checks and is merged into `main`.

Version 1.5 completes the planned Customer Version 1 registration, authentication,
vehicle management and profile scope. `/profile` displays the authoritative public
user and edits only names through guarded `PATCH /users/me`. Registration name
normalization is reused, immutable/identity fields are rejected, and persistence
updates only supplied names. Generation-safe local commits and non-sensitive
`profile-changed` notifications synchronize other tabs through `/auth/me`, without
cookie rotation or a second current-user cache. Stale account-A results cannot
affect account B. Concurrent writes remain last-write-wins.

All required local unit, integration, general/browser-profile, authentication,
vehicle, migration and build gates pass. No dependency or migration is added.
The Version 1.5 PR must still be reviewed, pass hosted checks and merge before
Customer Version 1 is released or tagged. Email/password changes, organizations
and bookings remain outside this milestone.

## Version 2 — Business onboarding

Organizations, ownership, branches, opening hours, wash boxes, employees,
services, and prices.

## Version 3 — Marketplace

Public car wash listing, branch details, service and price display, filters,
sorting, favorites, and location data.

## Version 4 — Booking engine

Availability, time slots, creation, confirmation, cancellation, conflict
prevention, history, and status history.

## Version 5 — Live queue

Walk-ins, booked-customer arrival, check-in, wash-box assignment, position,
service status updates, queue history, and race-condition protection.

## Version 6 — Reviews and moderation

Verified customer reviews, one review per completed order, business replies,
complaints, and moderation.

## Version 7 — Notifications and analytics

In-app and email notifications, business operational dashboard, and booking and
queue analytics.

## Version 8 — Production readiness

Rate limiting, audit logging, monitoring, backups, production configuration,
security review, performance testing, and deployment documentation.
