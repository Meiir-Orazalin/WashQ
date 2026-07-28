# ADR 0009: Refresh-token rotation and family replay revocation

## Status

Accepted

## Context

ADR 0007 selects opaque refresh tokens with hashed server-side sessions, and
ADR 0008 transports the raw token in an HttpOnly cookie. A refresh token must be
single-use, two concurrent requests must not both rotate it, and reuse of a
token that was already replaced must be treated as possible credential theft.
At the same time, a replay response must not revoke independent logins for the
same user.

## Decision

- Give every login-created refresh session a new UUID `family_id`.
- Keep every rotated replacement in the same family.
- Record the successor in nullable, unique `replaced_by_session_id` linkage.
- Rotate in one PostgreSQL transaction. Lock the presented session row, verify
  its hash, state, expiration, user, and previously observed update timestamp,
  create one replacement, then revoke and link the old session.
- When an already-linked token is presented after rotation, revoke every active
  session in that family and return the generic invalid-refresh result.
- Do not revoke other families owned by the same user.
- Treat a transaction result that became stale during a simultaneous rotation
  as an invalid request without revoking the winner. A later request that
  observes the persisted replacement linkage is the replay signal that revokes
  the family.

## Alternatives considered

- Update after an unlocked lookup: rejected because two requests could both
  create valid replacements.
- Revoke every user session on replay: rejected because one compromised client
  should not sign out independent clients.
- Reuse one session row and overwrite its hash: rejected because it removes the
  durable replay signal.
- Revoke the family for every stale concurrent attempt: rejected because a
  legitimate simultaneous request could invalidate the one successful
  replacement, violating the requirement to retain exactly one valid result.

## Consequences

Rotation requires PostgreSQL availability and creates one session row per
successful refresh. Old tokens are immediately unusable. A detected later
replay invalidates only its family. Expired and normally revoked sessions remain
generic invalid-refresh failures without causing unrelated revocation.
