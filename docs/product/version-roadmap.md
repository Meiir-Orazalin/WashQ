# Version roadmap

## Version 0 — Foundation

Monorepo, applications, database connection, shared contracts, testing, CI, and
documentation.

## Version 1 — Customer identity and vehicles

Status: in progress.

- [x] Version 1.1 — Customer registration.
- [ ] Version 1.2 — Customer login and the minimum token lifecycle.
  - [x] Version 1.2.1 — Authentication configuration and session-token
        foundation.
  - [x] Version 1.2.2 — Backend customer login and initial session issuance.
  - [x] Version 1.2.3 — Refresh-token rotation and replay detection.
  - [x] Version 1.2.4 — Backend logout of the current refresh session.
  - [x] Version 1.2.5 — Access-token authentication and current-user endpoint.
  - [x] Version 1.2.6 — Frontend login and in-memory authentication state.
  - [ ] Version 1.2.7 — Frontend session restoration and automatic refresh.
- [ ] Later Version 1 slices — customer profile and vehicle create, edit,
      delete, and list operations.

Completing Version 1.2.6 does not complete Version 1.2 or Version 1.

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
