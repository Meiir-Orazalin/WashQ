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
| `pnpm doctor`           | Verify the Node, pnpm, and Git baseline              |

`pnpm test:integration` requires PostgreSQL and `DATABASE_URL`. Start the Compose
service first. Playwright uses the locally installed stable Google Chrome on
desktop and emulated mobile viewports.

CI uses `prisma migrate deploy` when migrations exist; local development alone
uses `prisma migrate dev`.
