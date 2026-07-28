# Refresh-session cookie policy

Versions 1.2.2 and 1.2.3 transport the opaque refresh token only through a
response cookie. The cookie policy is centralized in the API presentation
layer.

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

Refresh is cookie-authenticated and therefore validates a browser `Origin`
header against the configured `CORS_ORIGINS` allowlist. Arbitrary origins are
not echoed. An absent `Origin` is accepted for trusted non-browser clients and
internal tests; callers in that category remain responsible for protecting
their credential context. `SameSite=Lax`, explicit credentialed CORS, and the
Origin check are the current CSRF controls. A separate CSRF token is not added
because refresh has no caller-selected state transition beyond rotating the
presented session. Logout must repeat this review in its own slice.
