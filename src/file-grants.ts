// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Host-side per-run grant model for the file capability (FCAP-11..14; DR-008).
 *
 * A compiled phase artifact reaches files only through a {@link FileCapability}
 * the host builds for that run. The capability is default-deny: an operation
 * succeeds only when its path is inside the run root (enforced by the artifact-
 * facing layer in `file-capability.ts`) and is covered by a {@link Grant} of the
 * matching access. {@link buildRunGrants} encodes the policy — the only writable
 * path is the run's `target` (compile) or `linked` (link), and read grants are
 * the run's source/object inputs, its link target when applicable, and the
 * recorded semantic-input closure, each enumerated as a file grant.
 * {@link createGuardedCapability} wraps a run-root capability with that grant set,
 * reporting `unauthorized` for any ungranted access.
 *
 * Directory listing and recursive directory reads are withheld: until a pinning
 * extension defines directory listing and subtree identities, this model grants
 * neither (DR-008), so a pinned phase cannot widen its closure at run time.
 * Scope failures (`invalid_path`, `unauthorized`) are distinguished by
 * {@link isScopeFailure} so the executor can fail them like a generic check rather
 * than a phase `BLOCKED`. See specs/dev/file-capability.md.
 */

import {
  type FileCapability,
  type FileErrorCode,
  type FileResult,
  type SlcPath,
  canonicalize,
  createFileCapability,
} from './file-capability.js';
import { type Hash } from './hash.js';

/** Whether a grant authorizes reading or writing (DR-008). */
export type GrantAccess = 'read' | 'write';

/** Whether a grant covers a file or a directory (DR-008). */
export type GrantKind = 'file' | 'directory';

/** Why a path is granted, for audit and diagnostics (DR-008). */
export type GrantReason =
  | 'source'
  | 'object'
  | 'linkTarget'
  | 'semanticInput'
  | 'target'
  | 'linked';

/** One host-side authorization over a normalized virtual path (DR-008). */
export interface Grant {
  /** Normalized virtual path (see {@link canonicalize}). */
  path: string;
  access: GrantAccess;
  kind: GrantKind;
  /** Directory grants only: whether `list` is allowed. */
  listing?: boolean;
  /** Directory read grants only: whether descendant reads are covered. */
  recursive?: boolean;
  /** Expected identity for audit: file hash, listing identity, or subtree identity. */
  identity?: Hash;
  reason: GrantReason;
}

/** The run inputs a grant set is closed over (DR-008; the closure to authorize). */
export interface RunGrantSpec {
  kind: 'compile' | 'link';
  /** Compile source input. */
  source?: SlcPath;
  /** Link object artifacts. */
  objects?: readonly SlcPath[];
  /** Runtime link target, when the run consumes one. */
  linkTarget?: SlcPath;
  /** Compile writable target. */
  target?: SlcPath;
  /** Link writable artifact. */
  linked?: SlcPath;
  /** Recorded semantic-input closure files, each enumerated (DR-007). */
  semanticInputs?: readonly { path: SlcPath; identity?: Hash }[];
}

/**
 * Builds the default-deny grant set for a run (FCAP-12, FCAP-13).
 *
 * The only writable grant is the run's `target` (compile) or `linked` (link); read
 * grants enumerate the source/object inputs, the link target when present, and the
 * semantic-input closure. Directory listing and recursive reads are not granted.
 */
export function buildRunGrants(spec: RunGrantSpec): Grant[] {
  const grants: Grant[] = [];
  if (spec.kind === 'compile' && spec.target !== undefined) {
    grants.push(fileGrant(spec.target, 'write', 'target'));
  }
  if (spec.kind === 'link' && spec.linked !== undefined) {
    grants.push(fileGrant(spec.linked, 'write', 'linked'));
  }
  if (spec.source !== undefined) {
    grants.push(fileGrant(spec.source, 'read', 'source'));
  }
  for (const object of spec.objects ?? []) {
    grants.push(fileGrant(object, 'read', 'object'));
  }
  if (spec.linkTarget !== undefined) {
    grants.push(fileGrant(spec.linkTarget, 'read', 'linkTarget'));
  }
  for (const input of spec.semanticInputs ?? []) {
    grants.push(fileGrant(input.path, 'read', 'semanticInput', input.identity));
  }
  return grants;
}

/**
 * Wraps a run-root capability with a grant set, denying every ungranted access
 * (FCAP-11). Path validity and run-root containment are left to the wrapped
 * capability, so an invalid or escaping path still reports `invalid_path`.
 */
export function createGuardedCapability(
  runRoot: string,
  grants: readonly Grant[],
): FileCapability {
  const inner = createFileCapability(runRoot);
  return {
    async read(path) {
      return authorize(grants, path, 'read') ?? inner.read(path);
    },
    async list(path) {
      return authorizeList(grants, path) ?? inner.list(path);
    },
    async write(path, bytes, opts) {
      return authorize(grants, path, 'write') ?? inner.write(path, bytes, opts);
    },
  };
}

/** Reports whether a capability error is a host-enforced scope failure (FCAP-14). */
export function isScopeFailure(code: FileErrorCode): boolean {
  return code === 'invalid_path' || code === 'unauthorized';
}

/**
 * Returns an `unauthorized` denial when no grant covers `path` for `access`, or
 * `null` to defer to the wrapped capability (which validates the path itself).
 */
function authorize(
  grants: readonly Grant[],
  path: SlcPath,
  access: GrantAccess,
): FileResult<never> | null {
  const canonical = canonicalize(path);
  if (canonical === null) {
    return null;
  }
  if (!covers(grants, canonical, access)) {
    return deny(`no ${access} grant covers "${path}"`);
  }
  return null;
}

function authorizeList(
  grants: readonly Grant[],
  path: SlcPath,
): FileResult<never> | null {
  const canonical = canonicalize(path);
  if (canonical === null) {
    return null;
  }
  const granted = grants.some(
    (grant) =>
      grant.access === 'read' &&
      grant.path === canonical &&
      grant.kind === 'directory' &&
      grant.listing === true,
  );
  return granted ? null : deny(`no listing grant covers "${path}"`);
}

function covers(
  grants: readonly Grant[],
  canonical: string,
  access: GrantAccess,
): boolean {
  return grants.some((grant) => {
    if (grant.access !== access) {
      return false;
    }
    if (grant.path === canonical) {
      return true;
    }
    return (
      access === 'read' &&
      grant.kind === 'directory' &&
      grant.recursive === true &&
      isUnder(grant.path, canonical)
    );
  });
}

function isUnder(ancestor: string, candidate: string): boolean {
  const prefix = ancestor === '/' ? '/' : `${ancestor}/`;
  return candidate.startsWith(prefix);
}

function fileGrant(
  path: SlcPath,
  access: GrantAccess,
  reason: GrantReason,
  identity?: Hash,
): Grant {
  const canonical = canonicalize(path);
  if (canonical === null) {
    throw new Error(`grant path "${path}" is not a valid run-root path`);
  }
  return identity === undefined
    ? { path: canonical, access, kind: 'file', reason }
    : { path: canonical, access, kind: 'file', identity, reason };
}

function deny(diagnostic: string): FileResult<never> {
  return { ok: false, code: 'unauthorized', diagnostic };
}
