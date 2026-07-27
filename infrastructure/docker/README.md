# Local containers

`compose.yaml` at the repository root is the canonical local infrastructure
definition. Version 0 runs only PostgreSQL. Application containers are
intentionally deferred so local watch mode remains fast.

PostgreSQL 18 stores its versioned data directory beneath
`/var/lib/postgresql`, so the named volume is mounted at that parent path.

On first volume initialization, `create-test-database.sh` creates the separate
database named by `POSTGRES_TEST_DB` (default `washqueue_test`). Application
migrations target `DATABASE_URL`; integration tests target `TEST_DATABASE_URL`
and reject remote hosts or database names without a `_test` or `_ci` suffix.
