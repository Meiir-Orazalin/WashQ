import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from './auth-test';
import { sanitizeTraceArchives } from './sanitize-auth-traces';

const execFileAsync = promisify(execFile);

test('@auth-matrix sanitizes retained authentication traces before artifact upload', async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'washqueue-trace-policy-'));
  const archiveDirectory = join(temporaryDirectory, 'result');
  const traceContents = join(temporaryDirectory, 'contents');
  const resources = join(traceContents, 'resources');
  const sensitiveInputSentinel = 'must-be-redacted-input';
  const sensitiveHeaderSentinel = 'must-be-redacted-header';

  try {
    await mkdir(archiveDirectory, { recursive: true });
    await mkdir(resources, { recursive: true });
    await writeFile(
      join(traceContents, 'trace.trace'),
      `${JSON.stringify({
        type: 'before',
        params: {
          selector: '#login-password',
          value: sensitiveInputSentinel,
        },
      })}\n${JSON.stringify({
        type: 'screencast-frame',
        sha1: 'safe-screenshot.jpeg',
      })}\n`,
    );
    await writeFile(
      join(traceContents, 'trace.network'),
      JSON.stringify({
        headers: [{ name: 'Authorization', value: sensitiveHeaderSentinel }],
      }),
    );
    await writeFile(join(resources, 'safe-screenshot.jpeg'), 'safe-image-placeholder');
    await writeFile(join(resources, 'network-response-body'), sensitiveHeaderSentinel);
    await execFileAsync('zip', ['-q', '-r', join(archiveDirectory, 'trace.zip'), '.'], {
      cwd: traceContents,
    });

    const summary = await sanitizeTraceArchives(temporaryDirectory);
    const { stdout: listing } = await execFileAsync('unzip', [
      '-Z1',
      join(archiveDirectory, 'trace.zip'),
    ]);
    const { stdout: trace } = await execFileAsync('unzip', [
      '-p',
      join(archiveDirectory, 'trace.zip'),
      'trace.trace',
    ]);

    expect(summary).toEqual({
      keptScreenshotResources: 1,
      redactedFields: 1,
      removedNetworkFiles: 1,
      sanitizedTraces: 1,
    });
    expect(listing).toContain('resources/safe-screenshot.jpeg');
    expect(listing).not.toContain('trace.network');
    expect(listing).not.toContain('network-response-body');
    expect(trace).toContain('"value":"[REDACTED]"');
    expect(trace).not.toContain(sensitiveInputSentinel);
    expect(trace).not.toContain(sensitiveHeaderSentinel);
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});
