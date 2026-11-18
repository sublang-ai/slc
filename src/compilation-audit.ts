// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  appendFile,
  lstat,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
export const compilationAudit = new AsyncLocalStorage<{
  path: string;
  tail?: Promise<void>;
  target?: { path: string; parent: string };
}>();

/** Credentials are never part of compilation evidence. */
export async function auditEvent(kind: string, data: unknown): Promise<void> {
  const context = compilationAudit.getStore();
  if (!context) return;
  let text = JSON.stringify(
    { at: new Date().toISOString(), kind, data },
    (key, value: unknown) =>
      /^(?:api[-_]?key|access[-_]?token|auth[-_]?token|authorization|password|refresh[-_]?token)$/i.test(
        key,
      )
        ? '[REDACTED]'
        : value,
  );
  for (const [key, value] of Object.entries(process.env)) {
    if (
      /(?:TOKEN|KEY|PASSWORD|SECRET)/i.test(key) &&
      value &&
      value.length >= 8
    )
      text = text.split(value).join('[REDACTED]');
  }
  context.tail = (context.tail ?? Promise.resolve()).then(() =>
    appendFile(context.path, text + '\n', { mode: 0o600 }),
  );
  await context.tail;
}

/** Retain each performing-call revision before a mechanical correction can overwrite it. */
export async function auditAgentRevision(label: string): Promise<void> {
  const context = compilationAudit.getStore();
  const target = context?.target;
  if (!context || !target) return;
  try {
    const info = await lstat(target.path);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      (await realpath(dirname(target.path))) !== target.parent
    ) {
      await auditEvent('revision-not-captured', {
        path: target.path,
        reason: 'target is no longer an owned regular file',
      });
      return;
    }
    const bytes = await readFile(target.path);
    const snapshot = join(
      dirname(context.path),
      `agent-${randomUUID()}-${basename(target.path)}`,
    );
    await writeFile(snapshot, bytes, { mode: 0o600 });
    await auditEvent('agent-target-revision', {
      label,
      path: target.path,
      snapshot: basename(snapshot),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      await auditEvent('revision-not-captured', {
        path: target.path,
        reason: 'target absent',
      });
      return;
    }
    throw error;
  }
}
