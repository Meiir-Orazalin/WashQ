import pg from 'pg';
import { randomUUID } from 'node:crypto';

const { Client } = pg;
const testEmailSuffix = '@auth-e2e.invalid';
const testEmailPrefix = 'wq-auth-';

const action = process.argv[2];
const argumentsAfterAction = process.argv.slice(3);
let client;

try {
  client = new Client({ connectionString: getSafeDatabaseUrl() });
  await client.connect();

  if (action === 'cleanup-exact') {
    const emails = requireTestEmails(argumentsAfterAction);
    writeResult(await cleanupExactEmails(emails));
  } else if (action === 'inspect-latest-family') {
    const [email, ...unexpected] = argumentsAfterAction;
    if (!email || unexpected.length > 0) {
      throw new Error('inspect-latest-family requires one email');
    }
    requireTestEmails([email]);
    writeResult(await inspectLatestFamily(email));
  } else if (action === 'inspect-vehicles') {
    const emails = requireTestEmails(argumentsAfterAction);
    const counts = await countRows('WHERE u.email = ANY($1::text[])', [emails]);
    writeResult({ vehicles: counts.vehicles });
  } else if (action === 'inspect-organizations') {
    const emails = requireTestEmails(argumentsAfterAction);
    const counts = await countRows('WHERE u.email = ANY($1::text[])', [emails]);
    const result = await client.query(
      `SELECT
      COUNT(DISTINCT om.organization_id)::integer AS organizations,
      COUNT(om.id)::integer AS memberships,
      COUNT(om.id) FILTER (WHERE om.role = 'OWNER')::integer AS owners
      FROM organization_memberships om WHERE om.user_id = ANY($1::uuid[])`,
      [counts.ownerIds],
    );
    writeResult(result.rows[0]);
  } else if (action === 'verify-organization-rollback') {
    requireTestEmails(argumentsAfterAction);
    // Exercise the built production repository, not a replacement transaction implementation.
    await import('reflect-metadata');
    const { ConfigService } = await import('@nestjs/config');
    const { PrismaService } = await import('../dist/database/prisma.service.js');
    const { PrismaOrganizationRepository } =
      await import('../dist/organizations/infrastructure/prisma-organization.repository.js');
    const prisma = new PrismaService(
      new ConfigService({ database: { url: getSafeDatabaseUrl() } }),
    );
    const name = `Rollback fixture ${randomUUID()}`;
    try {
      await prisma.onModuleInit();
      const before = await prisma.organizationMembership.count();
      const failed = await new PrismaOrganizationRepository(prisma)
        .createWithOwnerMembership(randomUUID(), { name, description: null })
        .then(
          () => false,
          () => true,
        );
      writeResult({
        failed,
        remainingOrganizations: await prisma.organization.count({ where: { name } }),
        membershipsUnchanged: before === (await prisma.organizationMembership.count()),
      });
    } finally {
      // Preserve the failing assertion while still removing this exact fixture if rollback regresses.
      await prisma.organization.deleteMany({ where: { name } });
      await prisma.onModuleDestroy();
    }
  } else if (action === 'cleanup-prefix') {
    const runId = requireRunId();
    const prefix = `${testEmailPrefix}${runId}-`;
    const cleanup = await cleanupPrefix(prefix);
    writeResult(cleanup);
    if (
      cleanup.deletedUsers > 0 ||
      cleanup.deletedSessions > 0 ||
      cleanup.deletedOrganizations > 0 ||
      cleanup.deletedMemberships > 0
    ) {
      process.exitCode = 2;
    }
  } else {
    throw new Error('Unsupported authentication E2E database action');
  }
} catch {
  process.stderr.write('Authentication E2E database operation failed\n');
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => undefined);
}

function getSafeDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error('TEST_DATABASE_URL is required');
  }

  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !allowedHosts.has(url.hostname) ||
    !/(?:_test|_ci)$/.test(databaseName)
  ) {
    throw new Error('Unsafe test database');
  }

  return value;
}

function requireRunId() {
  const value = process.env.AUTH_E2E_RUN_ID;
  if (!value || !/^[a-z0-9-]{1,32}$/.test(value)) {
    throw new Error('AUTH_E2E_RUN_ID is invalid');
  }

  return value;
}

function requireTestEmails(values) {
  if (values.length === 0) {
    throw new Error('At least one test email is required');
  }

  const emails = [...new Set(values)];
  if (
    emails.some(
      (email) =>
        typeof email !== 'string' ||
        !email.startsWith(testEmailPrefix) ||
        !email.endsWith(testEmailSuffix) ||
        email.length > 254,
    )
  ) {
    throw new Error('Authentication E2E cleanup accepts only namespaced test emails');
  }

  return emails;
}

async function cleanupExactEmails(emails) {
  await client.query('BEGIN');
  try {
    const before = await countRows('WHERE u.email = ANY($1::text[])', [emails]);
    const organizations = await deleteFixtureOrganizations(before.ownerIds);
    const deleted = await client.query(
      'DELETE FROM users WHERE email = ANY($1::text[]) RETURNING email',
      [emails],
    );
    const after = await countRows('WHERE u.email = ANY($1::text[])', [emails]);
    const remainingChildren = await countChildren(before.ownerIds, organizations.ids);
    await client.query('COMMIT');
    return {
      deletedSessions: before.sessions,
      deletedUsers: deleted.rowCount ?? 0,
      deletedVehicles: before.vehicles,
      remainingVehicles: remainingChildren.vehicles,
      remainingSessions: remainingChildren.sessions,
      remainingUsers: after.users,
      deletedOrganizations: organizations.count,
      deletedMemberships: organizations.memberships,
      remainingOrganizations: remainingChildren.organizations,
      remainingMemberships: remainingChildren.memberships,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function cleanupPrefix(prefix) {
  await client.query('BEGIN');
  try {
    const before = await countRows('WHERE u.email LIKE $1', [`${prefix}%${testEmailSuffix}`]);
    const organizations = await deleteFixtureOrganizations(before.ownerIds);
    const deleted = await client.query('DELETE FROM users WHERE email LIKE $1 RETURNING email', [
      `${prefix}%${testEmailSuffix}`,
    ]);
    const after = await countRows('WHERE u.email LIKE $1', [`${prefix}%${testEmailSuffix}`]);
    const remainingChildren = await countChildren(before.ownerIds, organizations.ids);
    await client.query('COMMIT');
    return {
      deletedSessions: before.sessions,
      deletedUsers: deleted.rowCount ?? 0,
      deletedVehicles: before.vehicles,
      remainingVehicles: remainingChildren.vehicles,
      remainingSessions: remainingChildren.sessions,
      remainingUsers: after.users,
      deletedOrganizations: organizations.count,
      deletedMemberships: organizations.memberships,
      remainingOrganizations: remainingChildren.organizations,
      remainingMemberships: remainingChildren.memberships,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function countRows(whereClause, parameters) {
  const result = await client.query(
    `
      SELECT
        COUNT(DISTINCT u.id)::integer AS users,
        COUNT(DISTINCT rs.id)::integer AS sessions,
        COUNT(DISTINCT v.id)::integer AS vehicles,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT u.id), NULL) AS owner_ids
      FROM users u
      LEFT JOIN refresh_sessions rs ON rs.user_id = u.id
      LEFT JOIN vehicles v ON v.owner_user_id = u.id
      ${whereClause}
    `,
    parameters,
  );
  const row = result.rows[0];
  return {
    sessions: Number(row?.sessions ?? 0),
    users: Number(row?.users ?? 0),
    vehicles: Number(row?.vehicles ?? 0),
    ownerIds: row?.owner_ids ?? [],
  };
}

// Refuse to delete any organization shared with a non-fixture user.
async function deleteFixtureOrganizations(ownerIds) {
  const result = await client.query(
    'SELECT DISTINCT organization_id FROM organization_memberships WHERE user_id = ANY($1::uuid[])',
    [ownerIds],
  );
  const ids = result.rows.map((row) => row.organization_id);
  const foreign = await client.query(
    'SELECT 1 FROM organization_memberships WHERE organization_id = ANY($1::uuid[]) AND NOT (user_id = ANY($2::uuid[])) LIMIT 1',
    [ids, ownerIds],
  );
  if (foreign.rowCount !== 0) throw new Error('Preserve organization with unrelated membership');
  const memberships = await client.query(
    'SELECT COUNT(*)::integer AS count FROM organization_memberships WHERE organization_id = ANY($1::uuid[])',
    [ids],
  );
  const deleted = await client.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [ids]);
  return { ids, count: deleted.rowCount ?? 0, memberships: memberships.rows[0].count };
}

async function countChildren(ownerIds, organizationIds) {
  const result = await client.query(
    `SELECT
    (SELECT COUNT(*)::integer FROM vehicles WHERE owner_user_id = ANY($1::uuid[])) AS vehicles,
    (SELECT COUNT(*)::integer FROM refresh_sessions WHERE user_id = ANY($1::uuid[])) AS sessions,
    (SELECT COUNT(*)::integer FROM organizations WHERE id = ANY($2::uuid[])) AS organizations,
    (SELECT COUNT(*)::integer FROM organization_memberships WHERE user_id = ANY($1::uuid[]) OR organization_id = ANY($2::uuid[])) AS memberships`,
    [ownerIds, organizationIds],
  );
  return result.rows[0];
}

async function inspectLatestFamily(email) {
  const result = await client.query(
    `
      WITH target_user AS (
        SELECT id
        FROM users
        WHERE email = $1
      ),
      latest_family AS (
        SELECT rs.family_id
        FROM refresh_sessions rs
        JOIN target_user u ON u.id = rs.user_id
        ORDER BY rs.created_at DESC, rs.id DESC
        LIMIT 1
      )
      SELECT
        (SELECT COUNT(*)::integer FROM target_user) AS users,
        COUNT(rs.id)::integer AS family_rows,
        COUNT(rs.id) FILTER (
          WHERE rs.revoked_at IS NULL AND rs.expires_at > NOW()
        )::integer AS active_sessions,
        COUNT(rs.id) FILTER (
          WHERE rs.revoked_at IS NOT NULL AND rs.replaced_by_session_id IS NULL
        )::integer AS unlinked_revocations
      FROM latest_family family
      LEFT JOIN refresh_sessions rs ON rs.family_id = family.family_id
    `,
    [email],
  );
  const row = result.rows[0];
  return {
    activeSessions: Number(row?.active_sessions ?? 0),
    familyRows: Number(row?.family_rows ?? 0),
    unlinkedRevocations: Number(row?.unlinked_revocations ?? 0),
    users: Number(row?.users ?? 0),
  };
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
