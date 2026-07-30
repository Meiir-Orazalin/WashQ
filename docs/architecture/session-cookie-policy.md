# Refresh-session cookie policy

Versions 1.2.2 onward transport the opaque refresh token only through a response
cookie. The cookie policy is centralized in the API presentation layer.

| Attribute  | Value                                   |
| ---------- | --------------------------------------- |
| Name       | `washqueue_refresh`                     |
| `HttpOnly` | `true`                                  |
| `SameSite` | `Lax`                                   |
| `Path`     | `/api/v1/auth`                          |
| `Max-Age`  | validated refresh-token lifetime        |
| `Secure`   | `true` in production; otherwise `false` |
| `Domain`   | omitted                                 |

`HttpOnly` prevents browser JavaScript from reading the refresh token.
`SameSite=Lax` and the auth-scoped path reduce ambient cross-site exposure.
Production requires HTTPS through the `Secure` attribute. Development and test
may use local HTTP.

The login JSON response contains only the public user, short-lived access token,
and access-token expiration. A successful refresh overwrites the cookie with
the new opaque token and returns only the new access token and expiration.
Invalid refresh sessions clear the cookie with the same path, same-site, and
security attributes.

Current-session logout always expires the cookie after Origin validation is
accepted, using `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth`, the
environment-specific `Secure` setting, and no `Domain`. This clearing occurs
for valid, missing, malformed, unknown, expired, revoked, deleted-user, and
rotated-predecessor tokens, and also when an unexpected accepted-request
infrastructure failure becomes a sanitized 500. A disallowed Origin is rejected
before cookie clearing.

Refresh and logout are cookie-authenticated and therefore validate a browser
`Origin` header through the same configured `CORS_ORIGINS` allowlist policy.
Arbitrary origins are not echoed. An absent `Origin` is accepted for trusted
non-browser clients and internal tests; callers in that category remain
responsible for protecting their credential context. `SameSite=Lax`, explicit
credentialed CORS, and the Origin check are the current CSRF controls. A
separate CSRF token is not added in Version 1.2.4.

Web login, restoration, refresh, and logout requests use
`credentials: "include"` so the browser can accept or rotate this cookie.
Frontend JavaScript neither reads nor writes it. Post-login and startup
`/auth/me` verification explicitly omit credentials and authenticate with the
new in-memory Bearer token.

A page reload discards the prior access token, enters a neutral initialization
state, and attempts one cookie rotation through the single-flight coordinator.
Ambiguous rotation failures are not retried automatically because the server
may have committed the one-time rotation even when the browser did not receive
the response. Same-document callers share one request. Frontend logout first
clears memory and waits for that request to settle, then sends a bodyless
credentialed logout so the newest cookie is revoked.

Login, refresh, and logout additionally execute under the same exclusive
same-origin Web Lock. The fetch begins only after lock acquisition and response
processing settles before release. This serializes every operation that can set,
rotate, or clear the cookie across tabs. `/auth/me`, registration, health, and
other non-cookie-mutating requests do not take this lock.

The frontend fails closed when Web Locks are unavailable; it sends no unlocked
cookie mutation. Tabs retain independent memory-only access tokens, but the
browser has one shared persistent refresh cookie. Sequential restoration may
therefore rotate the family once per tab. The latest explicit login determines
the cookie-backed identity for future refreshes; open tabs can retain an older
memory-only access token and display until expiration or reload. Protected
business actions must not be added before the account-switch behavior is
revalidated. See
[ADR 0011](../decisions/0011-web-lock-for-auth-cookie-mutations.md).
