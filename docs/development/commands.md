# Commands

Run commands from the repository root.

| Command                 | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `pnpm dev`              | Build dependency packages and run web/API watch mode |
| `pnpm build`            | Build contracts, API, and web in dependency order    |
| `pnpm lint`             | Run shared ESLint rules in every code package        |
| `pnpm typecheck`        | Run strict TypeScript checks                         |
| `pnpm test`             | Run unit, contract, API HTTP, and component tests    |
| `pnpm test:integration` | Run PostgreSQL integration tests                     |
| `pnpm test:e2e`         | Run the Playwright browser foundation                |
| `pnpm format`           | Write Prettier formatting                            |
| `pnpm format:check`     | Verify formatting without writing                    |
| `pnpm db:generate`      | Generate Prisma Client                               |
| `pnpm db:migrate`       | Create/apply a local Prisma development migration    |
| `pnpm db:seed`          | Run the versioned seed entry point                   |
| `pnpm run doctor`       | Verify the Node, pnpm, and Git baseline              |

`pnpm test:integration` requires PostgreSQL and the dedicated
`TEST_DATABASE_URL`. The test runner rejects non-test database names and remote
hosts. Start the Compose service first. Playwright uses the locally installed
stable Google Chrome on desktop and emulated mobile viewports.

Local development uses `prisma migrate dev`. The first change that introduces a
schema migration adds `prisma migrate deploy` to CI before its persistence
integration tests. To deploy migrations to the disposable local test database,
run `NODE_ENV=test pnpm --filter @washqueue/api db:migrate:deploy`; Prisma then
uses `TEST_DATABASE_URL`. To verify a full history, point `TEST_DATABASE_URL` at
a newly created local database ending in `_test` or `_ci`, run the same deploy
command, inspect the resulting schema, and delete only that disposable database.
