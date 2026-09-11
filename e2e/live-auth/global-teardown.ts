import { cleanupRunNamespace } from './auth-test';
import { sanitizeAuthTraceArtifacts } from './sanitize-auth-traces';

export default async function globalTeardown() {
  let traceSanitizationError: unknown;
  try {
    await sanitizeAuthTraceArtifacts();
  } catch (error) {
    traceSanitizationError = error;
  }

  const cleanup = await cleanupRunNamespace();
  if (
    cleanup.deletedOrganizations > 0 ||
    cleanup.deletedMemberships > 0 ||
    cleanup.remainingOrganizations > 0 ||
    cleanup.remainingMemberships > 0 ||
    cleanup.deletedUsers > 0 ||
    cleanup.deletedSessions > 0 ||
    cleanup.deletedVehicles > 0 ||
    cleanup.remainingVehicles > 0 ||
    cleanup.remainingUsers > 0 ||
    cleanup.remainingSessions > 0
  ) {
    throw new Error('Authentication E2E cleanup found and removed leaked temporary data');
  }

  if (traceSanitizationError) {
    throw new Error('Authentication E2E trace sanitization failed', {
      cause: traceSanitizationError,
    });
  }
}
