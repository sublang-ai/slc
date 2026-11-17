// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
import { auditEvent, compilationAudit } from './compilation-audit.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm, lstat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { fork } from 'node:child_process';

/** Native permissions and a private complete-report capability isolate every check. */
export async function isolatedCheck(
  job: string,
  args: unknown[],
  signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted();
  if (!process.allowedNodeEnvironmentFlags.has('--allow-net'))
    return [
      'environment: compiler verification requires Node >=25.5.0 with native network permissions; upgrade Node before compiling',
    ];
  const started = performance.now(),
    audit = compilationAudit.getStore();
  const snapshots: { path: string; sha256: string; snapshot: string }[] = [];
  if (audit)
    for (const path of args.filter(
      (arg): arg is string => typeof arg === 'string',
    )) {
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.nlink !== 1) continue;
        const content = await readFile(path),
          snapshot = join(
            dirname(audit.path),
            `check-${randomUUID()}-${basename(path)}`,
          );
        await writeFile(snapshot, content, { mode: 0o600 });
        snapshots.push({
          path,
          sha256: createHash('sha256').update(content).digest('hex'),
          snapshot,
        });
      } catch (error) {
        if (!(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          ['ENOENT', 'EISDIR'].includes(String(error.code))
        ))
          throw error;
      }
    }
  await auditEvent('checker-start', { job, args, snapshots });
  const built = new URL('./verification-worker.js', import.meta.url),
    workerUrl = existsSync(built)
      ? built
      : new URL('../dist/verification-worker.js', import.meta.url);
  const scratch = await mkdtemp(join(tmpdir(), 'slc-check-'));
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const token = randomUUID(),
        lifecycle = job === 'lifecycle';
      const child = fork(workerUrl, [], {
        execArgv: [
          '--permission',
          '--allow-fs-read=*',
          ...(!lifecycle ? ['--allow-fs-write=' + scratch] : []),
        ],
        serialization: 'advanced',
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          TMPDIR: scratch,
          TEMP: scratch,
          TMP: scratch,
        },
      });
      let stdout = '',
        stderr = '',
        settled = false,
        foreignMessages = 0;
      child.stdout?.on('data', (data) => (stdout += String(data)));
      child.stderr?.on('data', (data) => (stderr += String(data)));
      const end = (error?: unknown, findings?: string[]) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        void (async () => {
          if (child.exitCode === null && child.signalCode === null)
            await new Promise<void>((done) => {
              child.once('exit', () => done());
              child.kill('SIGKILL');
            });
          await auditEvent('checker-finish', {
            job,
            args,
            elapsedMs: Math.round(performance.now() - started),
            findings,
            stdout,
            stderr,
            foreignMessages,
            error: error instanceof Error ? error.message : error,
          });
          if (error) reject(error);
          else resolve(findings ?? []);
        })().catch(reject);
      };
      const abort = () => end(signal?.reason ?? new Error('canceled'));
      const coverage = args.find(
        (value): value is { maxDurationMs: number } =>
          !!value &&
          typeof value === 'object' &&
          'maxDurationMs' in value &&
          typeof value.maxDurationMs === 'number',
      );
      const limit = Math.max(300000, (coverage?.maxDurationMs ?? 0) + 30000);
      const timer = setTimeout(
        () =>
          end(
            new Error(
              `checker-failed: isolated verification exceeded ${limit}ms`,
            ),
          ),
        limit,
      );
      child.on('message', (raw: unknown) => {
        const value =
          raw && typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : undefined;
        if (
          !value ||
          value.schema !== 'sublang.slc.check-report.v1' ||
          value.token !== token ||
          value.job !== job ||
          value.status !== 'completed' ||
          !Array.isArray(value.findings) ||
          !value.findings.every((finding) => typeof finding === 'string') ||
          !Array.isArray(value.observations)
        ) {
          if (++foreignMessages > 64)
            end(
              new Error(
                'checker-failed: artifact exhausted the unrelated IPC message limit',
              ),
            );
          return;
        }
        const findings = value.findings as string[];
        if (
          lifecycle &&
          !findings.length &&
          !['initialize', 'dispose'].every((operation) =>
            (value.observations as Record<string, unknown>[]).some(
              (item) =>
                item.operation === operation && item.status === 'passed',
            ),
          )
        ) {
          end(new Error('checker-failed: incomplete lifecycle report'));
          return;
        }
        // An authenticated report owns completion before async evidence drains.
        // Exit/abort cannot replace the actual completed check during that drain.
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        void auditEvent('checker-report', {
          job,
          observations: value.observations,
        })
          .then(() => {
            settled = false;
            end(undefined, findings);
          })
          .catch((error) => {
            settled = false;
            end(error);
          });
      });
      child.once('error', (error) => end(error));
      child.once('exit', (code) => {
        if (!settled)
          end(
            new Error(
              `checker-failed: worker exited ${code} without a complete authenticated report: ${stderr}`,
            ),
          );
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else child.send({ job, args, token });
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
