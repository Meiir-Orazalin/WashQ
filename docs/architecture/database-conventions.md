# Database conventions

PostgreSQL is the system of record. Prisma is the database access tool and is
used only by database or module-infrastructure code.

## Naming and data rules

- SQL tables and columns use `snake_case`; Prisma model and field mappings must
  make this explicit.
- IDs use PostgreSQL UUIDs unless an ADR documents an exception.
- Timestamps are stored in UTC and named with `_at` in SQL.
- Branch time zones use IANA identifiers such as `Asia/Almaty`.
- Monetary values are never floating-point numbers.
- Money stores an integer amount in minor units and an ISO 4217 currency code.
- Foreign keys, uniqueness, and check constraints enforce durable invariants
  where PostgreSQL can express them.
- Indexes are added for measured access patterns, ownership lookups, and
  constraints, not speculatively.

## Migrations

Develop locally with:

```bash
pnpm db:generate
pnpm db:migrate
```

Production-like environments use `prisma migrate deploy`, never `migrate dev`.
An applied migration is immutable. Migrations must not be edited after they
reach a shared environment. Destructive changes require an explicit expand,
migrate, contract plan with rollback and data-verification steps.

Version 0 defines no business tables and therefore may produce no migration.
Connectivity is verified with `SELECT 1`.

## Version 1.1 user model

The `users` table contains only:

| SQL column      | Rule                                      |
| --------------- | ----------------------------------------- |
| `id`            | PostgreSQL-generated UUID primary key     |
| `first_name`    | required `varchar(60)`                    |
| `last_name`     | nullable `varchar(60)`                    |
| `email`         | required unique `varchar(254)`, lowercase |
| `password_hash` | required `varchar(255)`, Argon2id hash    |
| `created_at`    | UTC-aware creation timestamp              |
| `updated_at`    | UTC-aware update timestamp                |

Migration `20260727094726_add_users_for_customer_registration` creates the
table and its unique email index. Application normalization and the database
constraint together make concurrent duplicate registrations resolve to one
created user and one controlled conflict.

## Version 1.2.1 refresh-session model

The `refresh_sessions` table contains only:

| SQL column   | Rule                                             |
| ------------ | ------------------------------------------------ |
| `id`         | PostgreSQL-generated UUID primary key            |
| `user_id`    | required user UUID, indexed, cascading delete    |
| `token_hash` | required unique `varchar(64)`, never a raw token |
| `expires_at` | required UTC-aware expiration timestamp          |
| `revoked_at` | nullable UTC-aware revocation timestamp          |
| `created_at` | UTC-aware creation timestamp                     |
| `updated_at` | UTC-aware update timestamp                       |

Migration `20260727104041_add_refresh_sessions` creates the table, unique token
hash index, user lookup index, and cascading foreign key. Multiple rows may
belong to one user.
