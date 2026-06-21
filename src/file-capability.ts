// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Host-supplied file capability for compiled phase artifacts (FCAP-1..6; DR-008).
 *
 * A {@link FileCapability} gives a compiled artifact deterministic, confined
 * whole-file access through three operations — `read`, `list`, and `write` — over
 * virtual POSIX paths inside a per-run root. A leading `/` names the run root, not
 * an operating-system absolute path; paths are normalized (repeated separators
 * collapsed, `.` removed, `..` resolved) and confined to the root after resolving
 * symlinks, so a path that escapes the root or uses platform-absolute syntax (for
 * example a Windows drive path) is rejected as `invalid_path` (FCAP-2). Reads and
 * writes return the exact-byte `sha256:` hash with no content transformation
 * (FCAP-3, FCAP-5); writes are atomic whole-file replacements and honor an
 * `ifMatch` compare-and-swap that returns `stale` on a hash mismatch (FCAP-6);
 * listing returns only immediate children, directories before files then
 * lexicographic (FCAP-4).
 *
 * This module is the artifact-facing surface. The host-side per-run grant model
 * that authorizes each operation (default-deny, writable target/linked only) is a
 * later FCAP concern; this capability authorizes by run-root containment alone.
 * See specs/dev/file-capability.md.
 */

import { randomUUID } from 'node:crypto';
import {
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { type Hash, hashBytes } from './hash.js';

/** A virtual POSIX path inside the run root (DR-008). */
export type SlcPath = string;

/** Machine-readable reason a capability operation failed (DR-008). */
export type FileErrorCode =
  | 'invalid_path'
  | 'not_found'
  | 'not_file'
  | 'not_directory'
  | 'unauthorized'
  | 'stale'
  | 'io_error';

/** The result of a capability operation: a value, or a coded failure (DR-008). */
export type FileResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: FileErrorCode; diagnostic: string };

/** One immediate child returned by {@link FileCapability.list} (DR-008). */
export interface DirectoryEntry {
  name: string;
  kind: 'file' | 'directory';
}

/** The artifact-facing file capability (FCAP-1; DR-008). */
export interface FileCapability {
  read(path: SlcPath): Promise<FileResult<{ bytes: Uint8Array; hash: Hash }>>;
  list(path: SlcPath): Promise<FileResult<{ entries: DirectoryEntry[] }>>;
  write(
    path: SlcPath,
    bytes: Uint8Array,
    opts?: { ifMatch?: Hash },
  ): Promise<FileResult<{ hash: Hash }>>;
}

/**
 * Creates a {@link FileCapability} rooted at `runRoot`, confining every operation
 * to that directory after symlink resolution (FCAP-1..6).
 */
export function createFileCapability(runRoot: string): FileCapability {
  const root = resolve(runRoot);
  let realRoot: Promise<string> | null = null;
  const canonicalRoot = (): Promise<string> => (realRoot ??= realpath(root));

  async function resolveHost(path: SlcPath): Promise<FileResult<string>> {
    if (isPlatformAbsolute(path)) {
      return fail(
        'invalid_path',
        `path "${path}" uses platform-absolute syntax`,
      );
    }
    const segments = normalizeVirtual(path);
    if (segments === null) {
      return fail('invalid_path', `path "${path}" escapes the run root`);
    }
    const host = segments.length === 0 ? root : join(root, ...segments);
    const real = await realpathAllowingMissing(host);
    if (!isInside(await canonicalRoot(), real)) {
      return fail(
        'invalid_path',
        `path "${path}" escapes the run root after resolving symlinks`,
      );
    }
    return { ok: true, value: host };
  }

  // Serialize writes per resolved host path so an ifMatch read-check-rename runs
  // without another write to the same path interleaving at an await — making the
  // compare-and-swap atomic across operations through this capability (FCAP-6).
  const writeLocks = new Map<string, Promise<unknown>>();
  function serializeWrite<T>(host: string, op: () => Promise<T>): Promise<T> {
    const prior = writeLocks.get(host) ?? Promise.resolve();
    const run = prior.then(op, op);
    writeLocks.set(
      host,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  return {
    async read(path) {
      const resolved = await resolveHost(path);
      if (!resolved.ok) {
        return resolved;
      }
      try {
        const info = await stat(resolved.value);
        if (info.isDirectory()) {
          return fail('not_file', `path "${path}" is a directory`);
        }
        const bytes = await readFile(resolved.value);
        return { ok: true, value: { bytes, hash: hashBytes(bytes) } };
      } catch (error) {
        return fromFsError(error, path);
      }
    },

    async list(path) {
      const resolved = await resolveHost(path);
      if (!resolved.ok) {
        return resolved;
      }
      try {
        const info = await stat(resolved.value);
        if (!info.isDirectory()) {
          return fail('not_directory', `path "${path}" is not a directory`);
        }
        const dirents = await readdir(resolved.value, { withFileTypes: true });
        const entries = dirents
          .map(
            (entry): DirectoryEntry => ({
              name: entry.name,
              kind: entry.isDirectory() ? 'directory' : 'file',
            }),
          )
          .sort(compareEntries);
        return { ok: true, value: { entries } };
      } catch (error) {
        return fromFsError(error, path);
      }
    },

    async write(path, bytes, opts) {
      const resolved = await resolveHost(path);
      if (!resolved.ok) {
        return resolved;
      }
      const host = resolved.value;
      return serializeWrite(
        host,
        async (): Promise<FileResult<{ hash: Hash }>> => {
          try {
            const current = await currentHash(host);
            if (current.kind === 'directory') {
              return fail('not_file', `path "${path}" is a directory`);
            }
            if (opts?.ifMatch !== undefined && opts.ifMatch !== current.hash) {
              return fail(
                'stale',
                `path "${path}" did not match ifMatch ${opts.ifMatch}`,
              );
            }
            await atomicWrite(host, bytes);
            return { ok: true, value: { hash: hashBytes(bytes) } };
          } catch (error) {
            return fromFsError(error, path);
          }
        },
      );
    },
  };
}

/** The current exact-byte hash of `host`, or `null` when it does not exist. */
async function currentHash(
  host: string,
): Promise<
  { kind: 'file' | 'absent'; hash: Hash | null } | { kind: 'directory' }
> {
  try {
    const info = await stat(host);
    if (info.isDirectory()) {
      return { kind: 'directory' };
    }
    return { kind: 'file', hash: hashBytes(await readFile(host)) };
  } catch (error) {
    if (isNotFound(error)) {
      return { kind: 'absent', hash: null };
    }
    throw error;
  }
}

/** Atomically replaces or creates `host` by writing a sibling temp file and renaming. */
async function atomicWrite(host: string, bytes: Uint8Array): Promise<void> {
  const temp = join(dirname(host), `.${basename(host)}.${randomUUID()}.tmp`);
  await writeFile(temp, bytes);
  await rename(temp, host);
}

/**
 * Normalizes a virtual POSIX path to in-root segments, treating a leading `/` as
 * the root and resolving `.`/`..`; returns `null` when `..` escapes the root.
 */
function normalizeVirtual(path: SlcPath): string[] | null {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      if (out.length === 0) {
        return null;
      }
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out;
}

/** Rejects Windows drive paths and UNC syntax (DR-008 platform-absolute paths). */
function isPlatformAbsolute(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\');
}

/**
 * Canonicalizes a virtual POSIX path to its normalized `/`-prefixed form — the key
 * the host-side grant model matches on — or `null` when the path is
 * platform-absolute or escapes the run root (FCAP-2).
 */
export function canonicalize(path: SlcPath): string | null {
  if (isPlatformAbsolute(path)) {
    return null;
  }
  const segments = normalizeVirtual(path);
  if (segments === null) {
    return null;
  }
  return `/${segments.join('/')}`;
}

/** Resolves `host` through symlinks, falling back to the deepest existing ancestor. */
async function realpathAllowingMissing(host: string): Promise<string> {
  try {
    return await realpath(host);
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
    const parent = dirname(host);
    if (parent === host) {
      return host;
    }
    return join(await realpathAllowingMissing(parent), basename(host));
  }
}

function isInside(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`);
}

/** Orders entries with directories before files, then lexicographically by name. */
function compareEntries(a: DirectoryEntry, b: DirectoryEntry): number {
  if (a.kind !== b.kind) {
    return a.kind === 'directory' ? -1 : 1;
  }
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function fromFsError<T>(error: unknown, path: SlcPath): FileResult<T> {
  if (isNotFound(error)) {
    return fail('not_found', `path "${path}" was not found`);
  }
  return fail('io_error', `path "${path}": ${messageOf(error)}`);
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'ENOENT';
}

function fail<T>(code: FileErrorCode, diagnostic: string): FileResult<T> {
  return { ok: false, code, diagnostic };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
