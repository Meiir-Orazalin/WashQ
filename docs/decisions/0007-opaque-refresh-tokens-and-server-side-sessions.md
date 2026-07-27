# ADR 0007: Opaque refresh tokens with server-side sessions

## Status

Accepted

## Context

Upcoming login, rotation, and logout flows need short-lived access credentials
and independently revocable long-lived sessions. Users must be able to sign in
from multiple clients. A leaked database must not reveal usable refresh tokens,
and mutable user or authorization data must not be copied into access-token
claims.

## Decision

- Issue short-lived signed access tokens containing only subject, token type,
  issued-at, and expiration claims.
- Generate refresh tokens as opaque values from 32 bytes of a cryptographically
  secure random source. Refresh tokens are not JWTs.
- Persist only a versioned SHA-256 digest of each refresh token. SHA-256 is used
  because refresh tokens have 256 bits of uniform entropy; Argon2id remains for
  low-entropy user passwords.
- Represent each refresh token with its own database session so users can have
  multiple concurrent sessions and each session can expire or be revoked
  independently.
- Enforce unique token hashes and cascade session deletion when a user is
  deleted.
- Keep signing, verification, token generation, hashing, and persistence behind
  application ports.

Rotation will create a new session and revoke or replace the prior session in a
later slice. Replacement linkage will be added only if that use case requires
it.

## Alternatives considered

- Refresh-token JWTs: rejected because self-contained refresh credentials make
  revocation and rotation-reuse controls harder without server-side state.
- Raw refresh-token persistence: rejected because a database disclosure would
  immediately expose usable bearer credentials.
- Argon2id for refresh tokens: rejected because uniformly random 256-bit tokens
  are not vulnerable to practical offline guessing, while password-grade work
  factors would add avoidable cost to every refresh lookup.
- One token on the users table: rejected because it prevents independent,
  concurrent, session-level revocation.

## Consequences

Refresh requests will hash the presented token before lookup and will require
PostgreSQL availability. Session revocation is explicit and supports concurrent
clients. The future rotation use case must return a raw token only at issuance
or rotation and must never log or persist it.
