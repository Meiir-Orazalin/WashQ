# Local setup

## Prerequisites

Install Node.js 24 LTS, Git, and Docker Desktop. Enable the repository-pinned
pnpm version through Corepack:

```bash
corepack enable
pnpm run doctor
```

If `/usr/local/bin` is not writable on macOS, enable Corepack in a user-owned
directory already on `PATH`:

```bash
mkdir -p ~/.npm-global/bin
corepack enable pnpm --install-directory ~/.npm-global/bin
```

## Start the project

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Default development credentials are local-only:

```text
application database: washqueue
integration-test database: washqueue_test
user: washqueue
password: washqueue_dev
port: 5432
```

The Compose initialization script creates `washqueue_test` only when the
PostgreSQL volume is initialized. If the volume predates that script, recreate
the disposable local volume with `docker compose down -v` followed by
`docker compose up -d`, after confirming it contains no data you need.

Open:

- web: `http://localhost:3000`
- API health: `http://localhost:4000/api/v1/health`
- API readiness: `http://localhost:4000/api/v1/health/ready`
- Swagger: `http://localhost:4000/docs`

Stop applications with `Ctrl+C`. Stop PostgreSQL with `docker compose down`.
Use `docker compose down -v` only when intentionally deleting local database
data.

Version 1.1 creates the `users` table through
`20260727094726_add_users_for_customer_registration`. A fresh environment must
run `pnpm db:migrate` before registration or integration testing.
