# Local containers

`compose.yaml` at the repository root is the canonical local infrastructure
definition. Version 0 runs only PostgreSQL. Application containers are
intentionally deferred so local watch mode remains fast.

PostgreSQL 18 stores its versioned data directory beneath
`/var/lib/postgresql`, so the named volume is mounted at that parent path.
