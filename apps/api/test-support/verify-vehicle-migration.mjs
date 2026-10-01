import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
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
  const migrationDirectory = new URL('../prisma/migrations/', import.meta.url);
  const expectedMigrations = readdirSync(migrationDirectory)
    .filter((name) => existsSync(new URL(`${name}/migration.sql`, migrationDirectory)))
    .sort();
  const migrations = await target.query(
    'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
  );
  if (
    JSON.stringify(migrations.rows.map((row) => row.migration_name)) !==
    JSON.stringify(expectedMigrations)
  )
    throw new Error('Unexpected migration history');
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
  const branchColumns = await target.query(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('branches','branch_opening_hours')",
  );
  if (
    branchColumns.rows.filter((row) => row.table_name === 'branches').length !== 8 ||
    branchColumns.rows.filter((row) => row.table_name === 'branch_opening_hours').length !== 9
  )
    throw new Error('Unexpected branch schema');
  if (
    !branchColumns.rows
      .filter((row) => ['created_at', 'updated_at'].includes(row.column_name))
      .every((row) => row.data_type === 'timestamp with time zone')
  )
    throw new Error('Unexpected branch timestamp type');
  if (
    !branchColumns.rows
      .filter((row) => ['opens_at_minute', 'closes_at_minute'].includes(row.column_name))
      .every((row) => row.data_type === 'integer')
  )
    throw new Error('Weekly times must be minutes');
  const branchIndexes = await target.query(
    "SELECT indexdef FROM pg_indexes WHERE tablename IN ('branches','branch_opening_hours')",
  );
  if (
    !branchIndexes.rows.some((row) =>
      row.indexdef.includes('(organization_id, created_at DESC, id DESC)'),
    ) ||
    !branchIndexes.rows.some(
      (row) => row.indexdef.includes('UNIQUE') && row.indexdef.includes('(branch_id, day_of_week)'),
    )
  )
    throw new Error('Missing branch index');
  const branchConstraints = await target.query(
    "SELECT contype, conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('branches'::regclass,'branch_opening_hours'::regclass)",
  );
  if (
    branchConstraints.rows.filter(
      (row) => row.contype === 'f' && row.definition.includes('ON DELETE CASCADE'),
    ).length !== 2 ||
    !['opening_minutes_range', 'opening_status_interval'].every((name) =>
      branchConstraints.rows.some((row) => row.conname === name && row.contype === 'c'),
    )
  )
    throw new Error('Missing branch integrity constraint');
  const boxColumns = await target.query(
    "SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'wash_boxes'",
  );
  if (
    boxColumns.rows.length !== 6 ||
    !boxColumns.rows
      .filter((row) => row.column_name.endsWith('_at'))
      .every((row) => row.data_type === 'timestamp with time zone') ||
    !boxColumns.rows.every((row) => row.is_nullable === 'NO') ||
    !boxColumns.rows.some((row) => row.column_name === 'is_active' && row.column_default === 'true')
  )
    throw new Error('Unexpected wash box columns');
  const boxIndexes = await target.query(
    "SELECT indexdef FROM pg_indexes WHERE tablename = 'wash_boxes'",
  );
  if (
    boxIndexes.rows.length !== 2 ||
    !boxIndexes.rows.some(
      (row) => row.indexdef.includes('UNIQUE') && row.indexdef.includes('(branch_id, number)'),
    )
  )
    throw new Error('Unexpected wash box indexes');
  const boxConstraints = await target.query(
    "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'wash_boxes'::regclass",
  );
  if (
    !boxConstraints.rows.some(
      (row) =>
        row.definition.includes('REFERENCES branches(id)') &&
        row.definition.includes('ON DELETE CASCADE'),
    ) ||
    !boxConstraints.rows.some(
      (row) =>
        row.conname === 'wash_boxes_number_range' &&
        row.definition.includes('999') &&
        row.definition.includes('1'),
    )
  )
    throw new Error('Missing wash box integrity constraints');
  const services = await target.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='branch_services'",
  );
  if (
    services.rows.length !== 10 ||
    !services.rows
      .filter((row) => row.column_name.endsWith('_at'))
      .every((row) => row.data_type === 'timestamp with time zone') ||
    !services.rows
      .filter((row) => ['duration_minutes', 'price_minor'].includes(row.column_name))
      .every((row) => row.data_type === 'integer') ||
    !services.rows.some(
      (row) => row.column_name === 'is_active' && row.column_default === 'true',
    ) ||
    !services.rows.every(
      (row) => row.is_nullable === (row.column_name === 'description' ? 'YES' : 'NO'),
    )
  )
    throw new Error('Unexpected service schema');
  const serviceIndexes = await target.query(
    "SELECT indexdef FROM pg_indexes WHERE tablename='branch_services'",
  );
  if (
    serviceIndexes.rows.length !== 2 ||
    !serviceIndexes.rows.some((row) =>
      row.indexdef.includes('(branch_id, created_at DESC, id DESC)'),
    )
  )
    throw new Error('Unexpected service indexes');
  const serviceConstraints = await target.query(
    "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='branch_services'::regclass",
  );
  if (
    ![
      'branch_services_duration_range',
      'branch_services_price_range',
      'branch_services_currency_kzt',
    ].every((name) => serviceConstraints.rows.some((row) => row.conname === name)) ||
    !serviceConstraints.rows.some(
      (row) =>
        row.definition.includes('REFERENCES branches(id)') &&
        row.definition.includes('ON DELETE CASCADE'),
    )
  )
    throw new Error('Missing service constraints');
  process.stdout.write(
    `Clean database: all ${expectedMigrations.length} migrations applied; vehicle, organization, branch, wash-box and service schemas, indexes/FKs/checks/timestamps verified; Prisma drift check passed.\n`,
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
