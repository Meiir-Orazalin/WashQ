# Coding-agent instructions

## Before changing code

- Read the relevant product, architecture, decision, and development documents.
- Identify affected modules and their public boundaries before implementation.
- Make the smallest change that satisfies the task.
- Do not perform unrelated refactoring.
- Do not introduce dependencies without a concrete written justification.

## Architecture and code quality

- Do not weaken TypeScript, linting, formatting, or testing rules.
- Do not use `any` without explicit written justification.
- Do not expose Prisma models through the API or import them into frontend code.
- Do not put business logic in controllers or React components.
- Do not access another module's persistence implementation directly.
- Use explicit public interfaces, application services, or domain events across modules.
- Do not create generic utility dumping grounds such as `helpers`, `common-utils`,
  `shared-services`, `misc`, or `global-types`.
- Update documentation when behavior, contracts, commands, or architecture change.

## Tests and completion

- Add tests for every new business rule.
- Do not delete, weaken, or skip failing tests.
- Run formatting, linting, type checking, and relevant tests before completion.
- Report changed files, commands executed, results, assumptions, and remaining risks.

Nested `AGENTS.md` files add directory-specific rules and do not replace these
repository-wide instructions.
