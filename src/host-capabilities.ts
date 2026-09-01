// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Host capabilities for driving a schema-3 compiled `playbook` artifact
 * (DR-024).
 *
 * A schema-3 linked factory takes configured options plus live host
 * capabilities, and Playbook publishes the `XStateRepositoryCapability` and
 * effect-ledger *interfaces* without shipping an implementation — its own lives
 * inside `playbook run`. Any other host embedding a compiled artifact therefore
 * has to supply one, so SLC owns a real implementation here rather than leaving
 * each caller to hand-roll the engine contract.
 *
 * {@link failClosedHostCapabilities} is what the compiled phase host uses: the
 * meta phases declare no governed player state, so a repository or effect write
 * is a contract violation rather than work to perform.
 * {@link worktreeHostCapabilities} runs governed operations against a real
 * worktree, which is what an artifact carrying a `script` state needs.
 */

import { createHash, randomUUID } from 'node:crypto';

/** Minimal structural view of the engine-owned boundary seed. */
export interface EffectBoundarySeed {
  readonly sourceStateId: string;
  readonly sourceOutcomeSchema: unknown;
  readonly [key: string]: unknown;
}

export type RepositoryReceiptClassification =
  | 'unchanged'
  | 'one-descendant-commit'
  | 'multiple-commits'
  | 'rewritten-or-non-descendant'
  | 'worktree-only-change'
  | 'concurrent-or-foreign-change'
  | 'observation-ambiguous';

export interface RepositoryObservation {
  readonly worktree: string;
  readonly gitDir: string;
  readonly head: string;
  readonly projection: Readonly<Record<string, unknown>>;
  readonly projectionDigest: string;
}

/** The engine's ordered effect ledger; revision is zero exactly when empty. */
export interface EffectLedgerSnapshot {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly boundaries: readonly unknown[];
  readonly logicalOperations: readonly unknown[];
}

export interface HostCapabilities {
  readonly repository: unknown;
  readonly effectLedger: unknown;
}

const REPOSITORY_UNSUPPORTED =
  'compiled composed-v3 phase host does not support repository operations';
const EFFECT_UNSUPPORTED =
  'compiled composed-v3 phase host does not support effect-ledger writes';

/**
 * Builds a repository observation whose digest matches the engine's rule
 * exactly: `sha256:` over `JSON.stringify(projection)`. Callers supply the
 * worktree paths and HEAD; a repository with no commit yet reports the null
 * OID, which is what the engine's canonical-OID check expects.
 */
export function observeWorktree(opts: {
  readonly worktree: string;
  readonly gitDir: string;
  readonly head: string;
  readonly projection?: Readonly<Record<string, unknown>>;
}): RepositoryObservation {
  const projection = opts.projection ?? {};
  return {
    worktree: opts.worktree,
    gitDir: opts.gitDir,
    head: opts.head,
    projection,
    projectionDigest: `sha256:${createHash('sha256')
      .update(JSON.stringify(projection))
      .digest('hex')}`,
  };
}

/**
 * Classifies what one governed operation did to a repository, which is the
 * judgement the engine matches against the state's declared
 * `repositoryDisposition`. Ancestry decides the commit cases: a HEAD that moved
 * to a descendant is one commit or many, and a HEAD that moved elsewhere was
 * rewritten.
 */
export function classifyGitChange(opts: {
  readonly baseline: RepositoryObservation;
  readonly after: RepositoryObservation;
  readonly run: (args: readonly string[]) => string;
}): RepositoryReceiptClassification {
  const { baseline, after } = opts;
  if (baseline.head === after.head) {
    return baseline.projectionDigest === after.projectionDigest
      ? 'unchanged'
      : 'worktree-only-change';
  }
  if (after.head === NULL_GIT_OID) return 'rewritten-or-non-descendant';
  const range =
    baseline.head === NULL_GIT_OID
      ? after.head
      : `${baseline.head}..${after.head}`;
  if (baseline.head !== NULL_GIT_OID) {
    try {
      opts.run(['merge-base', '--is-ancestor', baseline.head, after.head]);
    } catch {
      return 'rewritten-or-non-descendant';
    }
  }
  let count: number;
  try {
    count = Number.parseInt(
      opts.run(['rev-list', '--count', range]).trim(),
      10,
    );
  } catch {
    return 'observation-ambiguous';
  }
  if (!Number.isFinite(count) || count < 1) return 'observation-ambiguous';
  return count === 1 ? 'one-descendant-commit' : 'multiple-commits';
}

/** The null Git OID, reported before a repository has its first commit. */
export const NULL_GIT_OID = '0'.repeat(40);

/** An empty ledger: revision zero exactly when both ordered ledgers are empty. */
export function emptyEffectLedger(): EffectLedgerSnapshot {
  return {
    schemaVersion: 1,
    revision: 0,
    boundaries: [],
    logicalOperations: [],
  };
}

/**
 * Capabilities whose repository and effect-mutation seams reject. Correct
 * wherever the artifact declares no governed player state (DR-024).
 */
export function failClosedHostCapabilities(): HostCapabilities {
  const rejectRepository = (): Promise<never> =>
    Promise.reject(new Error(REPOSITORY_UNSUPPORTED));
  const rejectEffectWrite = (): Promise<never> =>
    Promise.reject(new Error(EFFECT_UNSUPPORTED));
  return {
    repository: {
      runExclusive: rejectRepository,
      runDeferred: rejectRepository,
    },
    effectLedger: {
      snapshot: emptyEffectLedger,
      writeAhead: rejectEffectWrite,
    },
  };
}

/**
 * Capabilities that run governed operations against a real worktree, observing
 * it before and after so the engine receives a classified receipt. The engine
 * owns each boundary's identity — it re-checks the source state and outcome
 * schema on completion — so the seed it supplies is completed, never replaced.
 */
export function worktreeHostCapabilities(opts: {
  readonly playbookId: string;
  readonly observe: () => RepositoryObservation;
  readonly classify?: (
    baseline: RepositoryObservation,
    after: RepositoryObservation,
  ) => RepositoryReceiptClassification;
}): HostCapabilities {
  const boundaries: unknown[] = [];
  // The engine holds one active governed attempt id per runtime boundary and
  // rejects a second, so the host mints one identity and reuses it; a distinct
  // attempt would come from a retry this capability does not perform.
  const attemptId = randomUUID();
  const snapshot = (): EffectLedgerSnapshot => ({
    schemaVersion: 1,
    revision: boundaries.length,
    boundaries: [...boundaries],
    logicalOperations: [],
  });
  return {
    repository: {
      async runExclusive(options: {
        readonly effectBoundary: EffectBoundarySeed;
        readonly operation: (context: {
          readonly baseline: RepositoryObservation;
          readonly identity: unknown;
        }) => Promise<unknown>;
        readonly completeEffectBoundary: (
          completion: unknown,
        ) => unknown | Promise<unknown>;
      }) {
        const baseline = opts.observe();
        let operation: {
          status: 'fulfilled' | 'rejected';
          [k: string]: unknown;
        };
        try {
          operation = {
            status: 'fulfilled',
            value: await options.operation({ baseline, identity: {} }),
          };
        } catch (reason) {
          operation = { status: 'rejected', reason };
        }
        const after = opts.observe();
        const receipt = {
          classification: opts.classify
            ? opts.classify(baseline, after)
            : baseline.projectionDigest === after.projectionDigest &&
                baseline.head === after.head
              ? 'unchanged'
              : 'observation-ambiguous',
          baseline,
          after,
          ...(after.head !== baseline.head ? { commitOid: after.head } : {}),
        };
        // `PlaybookEffectBoundaryStart` omits every host-owned member, so the
        // host supplies ordering and attempt identity while everything
        // identifying the work comes from the engine's seed.
        const sequence = boundaries.length + 1;
        const boundary = {
          ...options.effectBoundary,
          sequence,
          attemptId,
          attemptNumber: 1,
          playbookId: opts.playbookId,
          canonicalWorktree: {
            worktree: baseline.worktree,
            gitDir: baseline.gitDir,
          },
          baseline,
        };
        // The engine re-checks that the settled boundary carries exactly the
        // evidence its completion callback returned, so that evidence is
        // acknowledged verbatim - present keys copied, absent keys left absent.
        const evidence = ((await options.completeEffectBoundary({
          boundary,
          operation,
          receipt,
          outcomeReceipt: receipt,
        })) ?? {}) as {
          readonly finalText?: string;
          readonly semanticCandidate?: unknown;
        };
        boundaries.push({
          ...boundary,
          after,
          physicalReceipt: receipt,
          ...(Object.prototype.hasOwnProperty.call(evidence, 'finalText')
            ? { finalText: evidence.finalText }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(
            evidence,
            'semanticCandidate',
          )
            ? { semanticCandidate: evidence.semanticCandidate }
            : {}),
        });
        return { operation, receipt, effectLedger: snapshot() };
      },
      runDeferred(): Promise<never> {
        return Promise.reject(
          new Error('worktree host capabilities run no deferred operation'),
        );
      },
    },
    effectLedger: {
      snapshot,
      writeAhead: async (): Promise<void> => {},
    },
  };
}
