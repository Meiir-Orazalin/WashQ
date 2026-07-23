# Contracts package guidance

- Keep schemas framework-independent and expose them only through `src/index.ts`.
- Add parsing tests for valid and invalid payloads whenever a public contract changes.
- API contracts describe transport data, never Prisma models or internal domain entities.
- Prefer narrow schemas owned by a concrete endpoint or capability.
