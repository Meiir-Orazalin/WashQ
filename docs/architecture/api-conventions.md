# API conventions

## Organizations (Version 2.1)

All three routes use the existing endpoint-scoped Bearer/current-user check, omit
cookie transport and reject unknown query parameters. Identity is never supplied
by the client. OpenAPI documents strict schemas, generic authentication and errors.

| Method and route                            | Successful response                                     |
| ------------------------------------------- | ------------------------------------------------------- |
| `POST /api/v1/organizations`                | 201 `{ organization }`; atomic initial OWNER membership |
| `GET /api/v1/organizations`                 | 200 `{ organizations: [...] }`; owned only              |
| `GET /api/v1/organizations/:organizationId` | 200 `{ organization }`; owned UUID only                 |

Creation accepts only required `name` and optional nullable `description`. Name
uses NFKC, trim and whitespace collapse, preserves casing, has normalized length
2–120 and rejects Unicode control characters (including tabs/newlines). Description
is trimmed to at most 500 characters; omitted/null/blank becomes null. Internal
punctuation and CR/LF line breaks remain; other controls are rejected. Text lengths
use the existing Zod string-length convention. Names have no uniqueness rule.

The strict public organization contains only UUID id, name, nullable description,
createdAt and updatedAt (ISO timestamps). Lists order by createdAt DESC, id DESC;
there is no pagination. Membership/owner IDs and role data are not response fields.
Invalid input/UUID/query is 400 VALIDATION_ERROR; authentication failures use the
existing generic 401 AUTHENTICATION_REQUIRED. Missing and foreign detail both
return 404 ORGANIZATION_NOT_FOUND, `The organization was not found`. Only ordinary
path/request ID/timestamp error metadata differs. Unexpected failures remain
sanitized 500 INTERNAL_SERVER_ERROR. No duplicate-name conflict is exposed.

The centralized error filter records and returns pathname only, excluding query
values. This prevents rejected ownership or credential query values from entering
error metadata or unexpected-failure logs; status and stable error contracts remain
unchanged for existing endpoints.

## Current-customer profile (Version 1.5)

`PATCH /api/v1/users/me` reuses endpoint-scoped Bearer authentication and accepts
only a strict, nonempty partial `{ firstName?, lastName? }`. No query parameters
are accepted. ID, email, ownership, credentials, session and all unknown fields
are rejected. Registration's exact name schemas are reused: trim surrounding
whitespace, preserve casing and internal whitespace, and require 2–60 characters
for nonempty names. First name cannot be null; last name null or blank clears it.
An omitted field is retained.

Success is 200 with the existing strict current-user response:
`{ user: { id, firstName, lastName, email } }`. There is no new public-user schema.
Invalid/empty input returns `400 VALIDATION_ERROR`; missing, invalid, expired,
deleted or race-time deleted identity returns `401 AUTHENTICATION_REQUIRED` with
the existing generic message. Unexpected failures are sanitized
`500 INTERNAL_SERVER_ERROR`. There is no 404 identity-lifecycle distinction.
OpenAPI documents these four statuses, strict partial names and Bearer security.

`updateCurrentUserProfile(accessToken, input)` uses explicit Bearer, PATCH,
`credentials: "omit"`, `cache: "no-store"`, abort support and strict request/response
parsing. It neither reads cookies nor retries automatically. Successful updates
do not set, rotate or clear a cookie and do not modify access tokens or sessions.

## Transport

- REST over JSON.
- Public routes begin with `/api/v1`.
- Resource names use lowercase plural nouns when business resources are added.
- HTTP methods and status codes carry their standard semantics.
- Public request and response shapes are Zod schemas in
  `@washqueue/contracts`.
- OpenAPI is available at `/docs` when `API_DOCS_ENABLED=true`.

## Current endpoints

```text
GET /api/v1/health
GET /api/v1/health/ready
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET /api/v1/auth/me
POST /api/v1/vehicles
GET /api/v1/vehicles
PATCH /api/v1/vehicles/:vehicleId
DELETE /api/v1/vehicles/:vehicleId
```

Liveness returns:

```json
{
  "status": "ok",
  "service": "washqueue-api",
  "timestamp": "2026-07-23T12:00:00.000Z"
}
```

Readiness adds `"checks": { "database": "up" }`. A database failure returns 503
without server, database, connection string, or exception details.

Customer registration accepts:

```json
{
  "firstName": "Meiir",
  "lastName": "Orazalin",
  "email": "meiir@example.com",
  "password": "example-password"
}
```

`lastName` is optional. The API trims names, converts an empty last name to
`null`, lowercases the trimmed email, and leaves the password unchanged before
hashing it. Success returns `201 Created`:

```json
{
  "user": {
    "id": "df4e7850-e329-4679-91f1-77b409d93f4f",
    "firstName": "Meiir",
    "lastName": "Orazalin",
    "email": "meiir@example.com",
    "createdAt": "2026-07-27T12:00:00.000Z"
  }
}
```

Invalid input returns `400 VALIDATION_ERROR`. A duplicate normalized email
returns `409 EMAIL_ALREADY_REGISTERED`. Registration does not return or create
tokens or sessions, and responses never include a password or password hash.

Customer login accepts:

```json
{
  "email": "meiir@example.com",
  "password": "example-password"
}
```

The email is trimmed and lowercased. The password is passed unchanged to the
password-verification boundary. Success returns `200 OK`:

```json
{
  "user": {
    "id": "df4e7850-e329-4679-91f1-77b409d93f4f",
    "firstName": "Meiir",
    "lastName": "Orazalin",
    "email": "meiir@example.com"
  },
  "accessToken": "signed-access-token",
  "accessTokenExpiresAt": "2026-07-27T12:15:00.000Z"
}
```

Login also sets the opaque refresh token in the `washqueue_refresh` HttpOnly
cookie. The refresh token, its hash, and refresh-session metadata are absent
from JSON. Unknown email and incorrect password both return
`401 INVALID_CREDENTIALS` with the message `Invalid email or password`.

Refresh has no JSON request body. It reads the opaque token from the
`washqueue_refresh` HttpOnly cookie. Success returns `200 OK`:

```json
{
  "accessToken": "signed-access-token",
  "accessTokenExpiresAt": "2026-07-27T12:15:00.000Z"
}
```

The response never contains a refresh token or session identifier. The old
session is atomically replaced and the cookie is overwritten only after
persistence succeeds. Missing, malformed, unknown, expired, revoked,
deleted-user, and replayed sessions all return
`401 INVALID_REFRESH_SESSION` and clear the cookie.

Browser requests to refresh must include an `Origin` exactly matching one of
the configured frontend origins. An unapproved Origin returns
`403 ORIGIN_NOT_ALLOWED`; requests without Origin are accepted for trusted
non-browser clients and internal tests. Credentialed CORS never echoes an
arbitrary origin.

Logout has no JSON request body. It reads the current session token from the
same `washqueue_refresh` HttpOnly cookie and returns an empty
`204 No Content`. Valid active, already-revoked, expired, unknown, malformed,
missing, deleted-user, and rotated-predecessor states are externally
indistinguishable. Accepted requests clear the cookie. Logout revokes only the
matching active, unexpired refresh session; other sessions and families are
untouched, and existing access tokens remain valid until expiration.

Logout applies the same Origin policy as refresh. A disallowed browser Origin
returns the sanitized `403 ORIGIN_NOT_ALLOWED` response before revocation and
does not clear the cookie. An absent Origin is accepted for trusted non-browser
clients and internal tests. Unexpected infrastructure failures return the
sanitized 500 response and still clear the cookie because Origin validation
accepted the request.

No success transport contract is defined for logout because a 204 response has
no body.

Current-user lookup has no request body and authenticates only through:

```http
Authorization: Bearer <access-token>
```

Success returns current database values with `200 OK`:

```json
{
  "user": {
    "id": "df4e7850-e329-4679-91f1-77b409d93f4f",
    "firstName": "Meiir",
    "lastName": "Orazalin",
    "email": "meiir@example.com"
  }
}
```

Missing, malformed, expired, invalid-signature, wrong-type, invalid-subject,
and deleted-user credentials all return `401 AUTHENTICATION_REQUIRED` with the
message `Authentication is required`. The response contains no token, claim,
credential, role, session, or Prisma data. `/auth/me` does not read or mutate a
refresh cookie or refresh session.

## Current-customer vehicles (Versions 1.4.1–1.4.2)

All vehicle endpoints require an explicitly supplied Bearer access token and
verify that its user still exists. They never use the refresh cookie. Ownership
comes only from that verified identity; `ownerUserId`, `userId` and all unknown
input fields are rejected. No ownership ID is returned.

`POST /api/v1/vehicles` accepts required `make`, `model`, `plateNumber`, and
optional `productionYear` and `color`. Omitted or explicitly null optionals become
null. Make/model/color are trimmed with repeated whitespace collapsed and valid
casing preserved. Make is 2–60 characters, model 1–60, and nonempty color 1–40;
empty color becomes null. Year must be an integer from 1900 through the current
UTC year plus one; strings and decimals are rejected. Plates use NFKC, uppercase,
space/hyphen removal and only Unicode letters/decimal digits, 2–20 code points.
`123 ABC 01`, `123-ABC-01`, and `123abc01` all persist as `123ABC01`.
There is no country-layout restriction.

Success is `201 { "vehicle": ... }`. The strict public vehicle includes only
`id` (UUID), `make`, `model`, canonical `plateNumber`, nullable `productionYear`,
nullable `color`, and ISO-8601 `createdAt`/`updatedAt` timestamps.
`GET /api/v1/vehicles` returns `200 { "vehicles": [...] }`, only for the current
owner, ordered by `createdAt DESC, id DESC`. An empty list is successful. There
is no pagination or separate single-vehicle read endpoint.

`PATCH /api/v1/vehicles/:vehicleId` validates the UUID and a strict partial object
containing at least one of `make`, `model`, `plateNumber`, `productionYear`, `color`.
It returns `200 { "vehicle": ... }` using the same public vehicle projection.
Omitted fields remain unchanged. Make/model/plate cannot be null and reuse the
creation normalizers and limits. Null year/color clear their values; empty color
also becomes null. No string coercion is performed for year. Ownership, immutable,
credential and all unknown fields are rejected. `createdAt` is preserved and
`updatedAt` changes. A plate already held by this same vehicle is not a conflict;
the canonical plate of a different owned vehicle is `409 VEHICLE_ALREADY_EXISTS`.

`DELETE /api/v1/vehicles/:vehicleId` validates the UUID and returns an empty
`204 No Content` after one owned row is deleted. It has no success JSON contract.
Repeated deletion returns 404, not another 204. Both mutation endpoints match the
verified owner and vehicle ID atomically. Missing and not-owned rows produce the
identical `404 VEHICLE_NOT_FOUND` error and `The vehicle was not found` message,
never an ownership-specific 403. Standard request ID, path and timestamp metadata
remain request-specific and carry no existence information.

PATCH documents 200/400/401/404/409/500; DELETE documents 204/400/401/404/500 in
OpenAPI, with endpoint-scoped Bearer security and UUID parameters. Invalid UUIDs
return `400 VALIDATION_ERROR` before persistence. Deletion changes no owner,
refresh session or unrelated vehicle.

Invalid data returns `400 VALIDATION_ERROR`. All expected authentication failures
return `401 AUTHENTICATION_REQUIRED`. A duplicate canonical plate under the same
owner returns `409 VEHICLE_ALREADY_EXISTS`; another owner may save the same
plate. Concurrent equivalent creates produce one 201 and one 409 through the
database constraint. Unexpected failures use sanitized `500 INTERNAL_SERVER_ERROR`.
No Prisma codes, constraints, ownership values or token details enter errors.

Concurrent equivalent plate updates of two owned vehicles yield one 200 and one 409. Concurrent deletes yield one 204 and one generic 404. An update racing a
delete may return 200 or 404 according to committed database ordering; it never
recreates the vehicle. There is no general optimistic locking or version column.

The focused vehicle client calls `createVehicle(accessToken, input)`,
`listVehicles(accessToken)`, `updateVehicle(accessToken, vehicleId, input)` and
`deleteVehicle(accessToken, vehicleId)` with `credentials: "omit"`, no browser HTTP caching,
strict shared parsing and cancellation signals. It stores no token, reads no
cookie and retries neither 401 nor other failures automatically. DELETE requires
204 and never parses its successful response as JSON.

## Frontend authentication API client

The central web API client:

- sends `POST /auth/login` with `credentials: "include"`;
- sends bodyless `POST /auth/refresh` with `credentials: "include"` and no
  Authorization header;
- sends bodyless `POST /auth/logout` with `credentials: "include"`, no
  Authorization header, and accepts an empty 204 without JSON parsing;
- parses refresh success through the shared refresh-response contract;
- parses login success through the shared login-response contract;
- sends `GET /auth/me` only with an explicitly supplied in-memory Bearer token
  and `credentials: "omit"`;
- parses the current user through the shared current-user contract;
- converts invalid JSON, invalid success responses, network failures, and API
  errors into sanitized frontend errors;
- does not keep a global token, attach Authorization to public endpoints,
  retry requests, or log request credentials.

The non-React refresh coordinator calls this narrow client method and shares
only an active Promise within one JavaScript realm. Login callers, the refresh
coordinator, and logout callers execute their complete client operation inside
the same cross-tab exclusive auth cookie-mutation Web Lock. The client remains
responsible only for HTTP and contract parsing; the lock contains no auth state.
The coordinator also exposes a narrow idle barrier so frontend logout can wait
for an already-committing local rotation without becoming a token store.
Authentication tokens remain owned by the provider, not the client, lock, or
TanStack Query. No global interceptor or arbitrary 401 retry exists.

After every successful coordinator result, the provider makes one explicit
`GET /auth/me` request with the returned token before committing refreshed
authentication. This applies to startup, proactive, visibility, and remote
session-change paths. `/auth/me` stays outside the cookie-mutation lock because
it neither reads nor changes the refresh cookie. Cross-tab lifecycle events
remain outside the API client and contain no HTTP response, token, or user data.

## Errors

All errors use:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Safe human-readable message"
  },
  "timestamp": "2026-07-23T12:00:00.000Z",
  "path": "/api/v1/resource",
  "requestId": "opaque-id"
}
```

`details` is optional and may contain only sanitized validation information.
Stack traces, environment values, tokens, secrets, connection strings, and
internal exception objects are never response data. Clients may send
`x-request-id`; the API otherwise generates one and returns it in the header and
error body.

Logout documents its endpoint-specific idempotency above. Pagination,
filtering, and broader concurrency conventions will be added with the first
business endpoint that needs them rather than guessed in advance.
