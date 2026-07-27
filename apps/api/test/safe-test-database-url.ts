interface TestDatabaseEnvironment {
  NODE_ENV?: string;
  TEST_DATABASE_URL?: string;
}

const allowedHosts = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

export function getSafeTestDatabaseUrl(environment: TestDatabaseEnvironment): string {
  if (environment.NODE_ENV !== 'test') {
    throw new Error('Integration tests require NODE_ENV=test');
  }

  const value = environment.TEST_DATABASE_URL;
  if (!value) {
    throw new Error('TEST_DATABASE_URL is required for integration tests');
  }

  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.slice(1));

  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !allowedHosts.has(url.hostname) ||
    !/(?:_test|_ci)$/.test(databaseName)
  ) {
    throw new Error('TEST_DATABASE_URL must target a local test database ending in _test or _ci');
  }

  return value;
}
