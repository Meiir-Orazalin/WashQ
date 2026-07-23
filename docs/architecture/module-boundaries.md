# Module boundaries

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
