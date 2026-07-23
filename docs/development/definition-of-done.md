# Definition of done

A change is complete when all applicable statements are true:

- The requested behavior is implemented within the correct module boundary.
- No unrelated refactoring or speculative module scaffolding is included.
- Public input and output contracts are explicit and runtime-validated.
- New dependencies have a concrete need and compatible pinned resolution.
- New business rules have focused tests.
- Persistence changes have PostgreSQL integration coverage and a reviewed,
  forward-only migration.
- Error responses and logs expose no secrets or internal exception objects.
- Accessibility, responsive behavior, and loading/error states are considered
  for user-visible work.
- Product or architecture documentation reflects changed behavior.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, relevant tests, and affected
  builds pass.
- The completion report lists changed files, commands, results, assumptions,
  and remaining risks.
