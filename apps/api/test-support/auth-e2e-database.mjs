import pg from 'pg';

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
  } else if (action === 'cleanup-prefix') {
    const runId = requireRunId();
    const prefix = `${testEmailPrefix}${runId}-`;
    const cleanup = await cleanupPrefix(prefix);
    writeResult(cleanup);
    if (cleanup.deletedUsers > 0 || cleanup.deletedSessions > 0) {
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
    const deleted = await client.query(
      'DELETE FROM users WHERE email = ANY($1::text[]) RETURNING email',
      [emails],
    );
    const after = await countRows('WHERE u.email = ANY($1::text[])', [emails]);
    await client.query('COMMIT');
    return {
      deletedSessions: before.sessions,
      deletedUsers: deleted.rowCount ?? 0,
      remainingSessions: after.sessions,
      remainingUsers: after.users,
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
    const deleted = await client.query('DELETE FROM users WHERE email LIKE $1 RETURNING email', [
      `${prefix}%${testEmailSuffix}`,
    ]);
    const after = await countRows('WHERE u.email LIKE $1', [`${prefix}%${testEmailSuffix}`]);
    await client.query('COMMIT');
    return {
      deletedSessions: before.sessions,
      deletedUsers: deleted.rowCount ?? 0,
      remainingSessions: after.sessions,
      remainingUsers: after.users,
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
        COUNT(rs.id)::integer AS sessions
      FROM users u
      LEFT JOIN refresh_sessions rs ON rs.user_id = u.id
      ${whereClause}
    `,
    parameters,
  );
  const row = result.rows[0];
  return {
    sessions: Number(row?.sessions ?? 0),
    users: Number(row?.users ?? 0),
  };
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
