# Module boundaries

## Organizations (Version 2.1)

`OrganizationsModule` owns organizations and organization memberships, imports the
existing endpoint-scoped auth boundary, and never accesses user/auth persistence.
Three focused create/list/detail use cases depend only on `OrganizationRepository`.
Atomic initial OWNER creation belongs to its Prisma adapter; list/detail filter
OWNER membership server-side and return only application organization fields.
Presentation maps strict public contracts and generic errors. The feature-local
web cache boundary removes both list and detail data on identity transitions;
authentication owns no organization state. See [organizations](organizations.md)
and [ADR 0013](../decisions/0013-organization-membership-ownership-and-deletion-integrity.md).

## Current-customer profile (Version 1.5)

`UsersHttpModule` composes the existing `AuthModule` public scoped guard with
`UsersModule`'s exported `UpdateCurrentUserProfileUseCase`. This small HTTP-only
composition avoids a Nest module cycle: authentication already consumes the users
port, while users persistence must not import authentication. No second profile
store or authentication system is introduced. `UsersController` lives in users
presentation, not in AuthController, and reuses the existing current-user mapper
and response DTO.

The use case validates the shared partial-name contract and passes the verified
principal ID separately to `UserRepository.updateCurrentUserProfile`. The Prisma
adapter performs one ID-filtered `updateManyAndReturn`, explicitly writes only
supplied names and selects only id, firstName, lastName and email. A missing row
becomes a controlled application outcome mapped to the existing generic 401.
Unexpected failures reach the existing sanitized HTTP filter. No vehicle or
session port is involved.

Frontend transport uses the existing central API client. `profile-edit-form`
translates changed controls; `useProfileUpdate` owns temporary pending/failure
state and cancellation. The provider's generation-safe public-user commit
capability owns authoritative state and notification, not feature-specific forms.
There is no profile query cache, mutation-result cache, token copy or dependency.

Future backend business modules are created only when their first use case is
implemented. Each module uses these internal areas:

```text
module/
├── presentation/    HTTP controllers and transport mapping
├── application/     use cases, ports, and transaction orchestration
├── domain/          entities, value objects, policies, and domain events
└── infrastructure/  Prisma repositories and external adapters
```

## Responsibilities

- Presentation validates transport input, invokes an application use case, and
  maps output. It contains no business decisions.
- Application coordinates use cases and depends on domain abstractions.
- Domain expresses business rules and has no NestJS, Prisma, HTTP, PostgreSQL,
  or frontend dependency.
- Infrastructure implements application or domain ports and may use Prisma.

## Cross-module work

A module cannot update another module's records or import its repository.
Interaction occurs through an explicit public application interface or a domain
event. Cross-module data needed for a decision is requested through a narrow
port. A transaction spanning module-owned data requires an explicit documented
design rather than repository sharing.

Planned capabilities are documented in the roadmap; Version 0 intentionally
does not contain empty identity, vehicle, business, marketplace, booking, queue,
review, notification, payment, or analytics modules.

## Vehicles (Versions 1.4.1–1.4.2)

`VehiclesModule` imports `AuthModule`'s public current-customer guard and
current-user application boundary, not users/auth persistence. The guard reuses
Bearer parsing, access-token verification and the current public user lookup;
only `{ userId }` is attached to the request. It is applied to `VehiclesController`
only, never through `APP_GUARD`.

The controller maps transport errors and responses. `CreateVehicleUseCase`
normalizes the strict shared input and accepts the verified owner separately;
`ListCurrentUserVehiclesUseCase` requests only that owner's ordered list.
Both depend on `VehicleRepository` and framework-independent vehicle values.
`PrismaVehicleRepository` alone writes/queries vehicles, projects only public
fields, and maps the exact composite duplicate constraint. No cross-module
repository access, CQRS framework, role system or global authorization is added.

`UpdateCurrentUserVehicleUseCase` validates a UUID and strict partial input using
the same shared field schemas as creation. It passes the verified owner, vehicle
ID and only supplied mutable fields to `updateOwnedVehicle`. The Prisma adapter
uses one owner-and-ID-filtered `updateManyAndReturn` with a public projection.
`DeleteCurrentUserVehicleUseCase` calls one owner-and-ID-filtered `deleteMany`.
Neither performs a preliminary ownership lookup or a mutation by vehicle ID alone.
Null/false repository results become `VehicleNotFoundError`; presentation maps
both missing and foreign vehicles to the same `404 VEHICLE_NOT_FOUND`.

Frontend transport remains in `vehicle-api-client`; `vehicle-edit-form` translates
changed controls and delegates normalization to contracts. `useVehicleMutations`
owns asynchronous lifecycle and owner-scoped invalidation. Native inline forms
and explicit delete confirmation remain presentation concerns, inside the existing
authenticated, user-keyed subtree. AuthenticationProvider has no vehicle logic.
