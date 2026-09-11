import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { getSafeTestDatabaseUrl } from '../test/safe-test-database-url.ts';

// This exact disposable database is created by this process or never dropped.
const databaseName = 'washqueue_vehicle_migration_ci';
const apiDirectory = new URL('..', import.meta.url);
const sourceUrl = getSafeTestDatabaseUrl({ ...process.env, NODE_ENV: 'test' });
const targetUrl = new URL(sourceUrl);
targetUrl.pathname = `/${databaseName}`;
const admin = new pg.Client({ connectionString: sourceUrl });
let target;
let created = false;
try {
  await admin.connect();
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    databaseName,
  ]);
  if (existing.rowCount !== 0) throw new Error('Disposable database already exists; preserve it');
  await admin.query('CREATE DATABASE washqueue_vehicle_migration_ci');
  created = true;
  const environment = { ...process.env, NODE_ENV: 'test', TEST_DATABASE_URL: targetUrl.toString() };
  execFileSync('pnpm', ['db:migrate:deploy'], {
    cwd: apiDirectory,
    env: environment,
    stdio: 'pipe',
  });
  execFileSync(
    'pnpm',
    [
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ],
    { cwd: apiDirectory, env: environment, stdio: 'pipe' },
  );
  target = new pg.Client({ connectionString: targetUrl.toString() });
  await target.connect();
  const migrations = await target.query(
    'SELECT count(*)::integer AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  if (migrations.rows[0]?.count !== 5) throw new Error('Unexpected migration count');
  const table = await target.query(
    "SELECT count(*)::integer AS count FROM information_schema.columns WHERE table_name = 'vehicles' AND table_schema = 'public'",
  );
  if (table.rows[0]?.count !== 9) throw new Error('Unexpected vehicle schema');
  const organizationColumns = await target.query(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('organizations', 'organization_memberships')",
  );
  for (const name of ['organizations', 'organization_memberships']) {
    if (organizationColumns.rows.filter((row) => row.table_name === name).length !== 5)
      throw new Error('Unexpected organization schema');
  }
  if (
    !organizationColumns.rows
      .filter((row) => row.column_name.endsWith('_at'))
      .every((row) => row.data_type === 'timestamp with time zone')
  )
    throw new Error('Unexpected timestamp type');
  const indexes = await target.query(
    "SELECT indexdef FROM pg_indexes WHERE tablename = 'organization_memberships'",
  );
  if (
    !indexes.rows.some((row) => row.indexdef.includes('(user_id, role)')) ||
    !indexes.rows.some(
      (row) =>
        row.indexdef.includes('UNIQUE') && row.indexdef.includes('(organization_id, user_id)'),
    )
  )
    throw new Error('Missing membership index');
  const fks = await target.query(
    "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'organization_memberships'::regclass AND contype = 'f'",
  );
  if (
    !fks.rows.some(
      (row) =>
        row.definition.includes('REFERENCES users(id)') &&
        row.definition.includes('ON DELETE RESTRICT'),
    ) ||
    !fks.rows.some(
      (row) =>
        row.definition.includes('REFERENCES organizations(id)') &&
        row.definition.includes('ON DELETE CASCADE'),
    )
  )
    throw new Error('Unexpected membership foreign keys');
  process.stdout.write(
    'Clean database: all 5 migrations applied; vehicle and organization schemas, membership indexes/FKs/timestamps verified; Prisma drift check passed.\n',
  );
} catch {
  process.stderr.write(
    'Disposable vehicle migration verification failed; no existing database was reset.\n',
  );
  process.exitCode = 1;
} finally {
  await target?.end();
  if (created) {
    await admin.query('DROP DATABASE washqueue_vehicle_migration_ci');
    process.stdout.write('Removed only the disposable database created by this verification.\n');
  }
  await admin.end();
}
