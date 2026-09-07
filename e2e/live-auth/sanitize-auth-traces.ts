import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const authOutputDirectory = new URL('../../test-results/auth', import.meta.url).pathname;
const authReportDirectory = new URL('../../playwright-report/auth', import.meta.url).pathname;

interface SanitizationSummary {
  keptScreenshotResources: number;
  redactedFields: number;
  removedNetworkFiles: number;
  sanitizedTraces: number;
}

export async function sanitizeAuthTraceArtifacts() {
  const outputSummary = await sanitizeTraceArchives(authOutputDirectory);
  const reportSummary = await sanitizeTraceArchives(authReportDirectory);
  const summary = combineSummaries(outputSummary, reportSummary);
  if (summary.sanitizedTraces > 0) {
    await writeFile(
      join(authOutputDirectory, 'trace-sanitization.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
      'utf8',
    );
  }
}

export async function sanitizeTraceArchives(directory: string) {
  const traceArchives = await findTraceArchives(directory);
  const summary: SanitizationSummary = {
    keptScreenshotResources: 0,
    redactedFields: 0,
    removedNetworkFiles: 0,
    sanitizedTraces: 0,
  };

  for (const traceArchive of traceArchives) {
    const traceSummary = await sanitizeTraceArchive(traceArchive);
    summary.keptScreenshotResources += traceSummary.keptScreenshotResources;
    summary.redactedFields += traceSummary.redactedFields;
    summary.removedNetworkFiles += traceSummary.removedNetworkFiles;
    summary.sanitizedTraces += 1;
  }
  return summary;
}

async function sanitizeTraceArchive(traceArchive: string) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'washqueue-auth-trace-'));
  const extractedDirectory = join(temporaryDirectory, 'extracted');
  const sanitizedArchive = join(temporaryDirectory, 'trace.zip');
  let redactedFields = 0;
  let removedNetworkFiles = 0;
  const screenshotResources = new Set<string>();

  try {
    await execFileAsync('unzip', ['-q', traceArchive, '-d', extractedDirectory]);
    const extractedFiles = await listFiles(extractedDirectory);

    for (const file of extractedFiles) {
      if (file.endsWith('.network')) {
        await unlink(file);
        removedNetworkFiles += 1;
        continue;
      }

      if (!file.endsWith('.trace')) {
        continue;
      }

      const records = (await readFile(file, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown);
      const sanitizedRecords = records.map((record) =>
        sanitizeTraceValue(record, [], screenshotResources, () => {
          redactedFields += 1;
        }),
      );
      await writeFile(
        file,
        `${sanitizedRecords.map((record) => JSON.stringify(record)).join('\n')}\n`,
      );
    }

    const resourceDirectory = join(extractedDirectory, 'resources');
    const resources = await listFiles(resourceDirectory).catch(() => []);
    for (const resource of resources) {
      const resourceName = resource.split('/').at(-1);
      if (!resourceName || !screenshotResources.has(resourceName)) {
        await unlink(resource);
      }
    }

    await execFileAsync('zip', ['-q', '-r', sanitizedArchive, '.'], {
      cwd: extractedDirectory,
    });
    await rename(sanitizedArchive, traceArchive);
    return {
      keptScreenshotResources: screenshotResources.size,
      redactedFields,
      removedNetworkFiles,
    };
  } catch (error) {
    await unlink(traceArchive).catch(() => undefined);
    throw error;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

function sanitizeTraceValue(
  value: unknown,
  path: readonly string[],
  screenshotResources: Set<string>,
  recordRedaction: () => void,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeTraceValue(item, path, screenshotResources, recordRedaction),
    );
  }
  if (!isRecord(value)) {
    return sanitizeString(value);
  }

  if (value.type === 'screencast-frame' && typeof value.sha1 === 'string') {
    screenshotResources.add(value.sha1);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (isSensitiveTraceField(key, path)) {
      sanitized[key] = '[REDACTED]';
      recordRedaction();
    } else {
      sanitized[key] = sanitizeTraceValue(child, nextPath, screenshotResources, recordRedaction);
    }
  }
  return sanitized;
}

function isSensitiveTraceField(key: string, parentPath: readonly string[]) {
  const normalizedKey = key.toLowerCase().replaceAll('-', '');
  if (
    [
      'authorization',
      'cookie',
      'cookies',
      'headers',
      'postdata',
      'requestbody',
      'responsebody',
      'setcookie',
    ].includes(normalizedKey)
  ) {
    return true;
  }

  return parentPath.at(-1) === 'params' && ['text', 'value', 'values'].includes(normalizedKey);
}

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/g, 'Bearer [REDACTED]')
    .replace(/"accessToken"\s*:\s*"[^"]+"/g, '"accessToken":"[REDACTED]"')
    .replace(/"password"\s*:\s*"[^"]+"/g, '"password":"[REDACTED]"');
}

async function findTraceArchives(directory: string): Promise<string[]> {
  const files = await listFiles(directory).catch(() => []);
  return files.filter((file) => file.endsWith('.zip'));
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return files.flat();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function combineSummaries(
  first: SanitizationSummary,
  second: SanitizationSummary,
): SanitizationSummary {
  return {
    keptScreenshotResources: first.keptScreenshotResources + second.keptScreenshotResources,
    redactedFields: first.redactedFields + second.redactedFields,
    removedNetworkFiles: first.removedNetworkFiles + second.removedNetworkFiles,
    sanitizedTraces: first.sanitizedTraces + second.sanitizedTraces,
  };
}

if (process.argv[1]?.endsWith('sanitize-auth-traces.ts')) {
  await sanitizeAuthTraceArtifacts();
}
