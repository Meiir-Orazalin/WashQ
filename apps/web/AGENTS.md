# Web guidance

- Keep server and client component boundaries explicit; add `'use client'` only when required.
- Put transport access in `lib`, query lifecycle in TanStack Query, and rendering in components.
- Validate API responses through `@washqueue/contracts`; never import Prisma or backend internals.
- Keep business rules out of React components and cover user-visible state changes with component tests.
- Maintain semantic HTML, keyboard access, responsive layouts, and explicit loading/error states.
