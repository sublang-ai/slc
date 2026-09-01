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
 * each caller to hand-roll the engine contract. The classification and
 * observation rules mirror the engine's reference implementation
 * (`reference/sdlc/code.playbook/bin/repository-effects.js`), reduced to the
 * single-worktree shape this host needs.
 *
 * {@link failClosedHostCapabilities} rejects every repository or effect write:
 * correct wherever the artifact declares no governed player state.
 * {@link worktreeHostCapabilities} runs governed operations against a real
 * worktree, which is what an artifact carrying governed player states needs.
 *
 * Deliberate scope limit: `runDeferred` supports `park` and `restore` for a
 * bound Boss question, but not `continue` — cross-turn continuation of a
 * deferred operation (DR-005) is not implemented by this demo host. A
 * declared-`deferred` arm binds and parks cleanly; answering the parked
 * question in a later turn fails with an explicit unsupported-operation error.
 */

import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

/** Minimal structural view of the engine-owned boundary seed. */
export interface EffectBoundarySeed {
  readonly boundaryId: string;
  readonly runtimeSessionId: string;
  readonly sourceStateId: string;
  readonly sourceOutcomeSchema: unknown;
  /** Repository dispositions declared by the boundary's outcome arms. */
  readonly dispositions?: readonly string[];
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

export interface RepositoryReceipt {
  readonly classification: RepositoryReceiptClassification;
  readonly baseline: RepositoryObservation;
  readonly after?: RepositoryObservation;
  readonly commitOid?: string;
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

/** Runs one Git command and returns its stdout; throws on nonzero exit. */
export type GitRunner = (args: readonly string[]) => string;

const REPOSITORY_UNSUPPORTED =
  'compiled composed-v3 phase host does not support repository operations';
const EFFECT_UNSUPPORTED =
  'compiled composed-v3 phase host does not support effect-ledger writes';

/** The null Git OID, reported before a repository has its first commit. */
export const NULL_GIT_OID = '0'.repeat(40);

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function projectionText(projection: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(projection);
}

function projectionsEqual(
  left: RepositoryObservation,
  right: RepositoryObservation,
): boolean {
  return (
    left.projectionDigest === right.projectionDigest &&
    projectionText(left.projection) === projectionText(right.projection)
  );
}

function projectionPreservesBaseline(
  baseline: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(baseline).every(
    ([path, entry]) =>
      Object.prototype.hasOwnProperty.call(after, path) &&
      JSON.stringify(after[path]) === JSON.stringify(entry),
  );
}

/**
 * Builds a repository observation whose digest matches the engine's rule
 * exactly: `sha256:` over `JSON.stringify(projection)`. Callers supply the
 * worktree paths, HEAD, and the dirty-state projection; a repository with no
 * commit yet reports the null OID, which is what the engine's canonical-OID
 * check expects. The projection is required: an empty projection asserts a
 * clean worktree, so it must come from a real status observation such as
 * {@link observeGitWorktree}, never from a default.
 */
export function observeWorktree(opts: {
  readonly worktree: string;
  readonly gitDir: string;
  readonly head: string;
  readonly projection: Readonly<Record<string, unknown>>;
}): RepositoryObservation {
  return {
    worktree: opts.worktree,
    gitDir: opts.gitDir,
    head: opts.head,
    projection: opts.projection,
    projectionDigest: `sha256:${sha256Hex(projectionText(opts.projection))}`,
  };
}

/**
 * Observes one Git worktree: HEAD plus a path-keyed projection of every
 * dirty or untracked entry, derived from `git status --porcelain` with
 * content identities so a change is visible even when the status code alone
 * would not move. Mirrors the reference host's status-derived projection in
 * reduced form: one sample, index identities from `ls-files -s`, worktree
 * identities from `hash-object`.
 */
export function observeGitWorktree(opts: {
  readonly worktree: string;
  readonly gitDir: string;
  readonly run: GitRunner;
}): RepositoryObservation {
  let head = NULL_GIT_OID;
  try {
    head = opts.run(['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  } catch {
    // No commit yet (or unborn branch): the null OID is the canonical report.
  }
  const status = opts.run([
    'status',
    '--porcelain',
    '-z',
    '--untracked-files=all',
    '--no-renames',
  ]);
  const records: { readonly xy: string; readonly path: string }[] = [];
  for (const record of status.split('\0')) {
    if (record.length === 0) continue;
    if (record.length < 4 || record[2] !== ' ') {
      throw new Error(
        `git status returned an unrecognized record: ${JSON.stringify(record)}`,
      );
    }
    records.push({ xy: record.slice(0, 2), path: record.slice(3) });
  }
  records.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  // Staged content identity for every tracked path in the status set.
  const indexOids = new Map<string, string>();
  if (records.some(({ xy }) => xy !== '??')) {
    for (const record of opts.run(['ls-files', '-s', '-z']).split('\0')) {
      if (record.length === 0) continue;
      const tab = record.indexOf('\t');
      const fields = record.slice(0, tab).split(' ');
      if (tab < 0 || fields.length !== 3) {
        throw new Error(
          `git ls-files returned an unrecognized record: ${JSON.stringify(record)}`,
        );
      }
      indexOids.set(record.slice(tab + 1), `${fields[0]}:${fields[1]}`);
    }
  }
  // Worktree content identity for every entry whose worktree side differs
  // from the index (or is untracked); a worktree-deleted side needs none —
  // its absence is the identity.
  const hashPaths = records
    .filter(({ xy }) => xy[1] !== ' ' && xy[1] !== 'D')
    .map(({ path }) => path);
  const worktreeOids = new Map<string, string>();
  if (hashPaths.length > 0) {
    const hashes = opts
      .run(['hash-object', '--', ...hashPaths])
      .split('\n')
      .filter((line) => line.length > 0);
    if (hashes.length !== hashPaths.length) {
      throw new Error('git hash-object did not identify every dirty path');
    }
    hashPaths.forEach((path, index) => {
      worktreeOids.set(path, hashes[index]!);
    });
  }
  const projection: Record<string, unknown> = {};
  for (const { xy, path } of records) {
    if (path.length === 0) {
      throw new Error('git status returned an empty repository path');
    }
    if (Object.prototype.hasOwnProperty.call(projection, path)) {
      throw new Error(
        `git status returned duplicate entries for ${JSON.stringify(path)}`,
      );
    }
    const index = indexOids.get(path);
    const worktree = worktreeOids.get(path);
    projection[path] = {
      xy,
      ...(index === undefined ? {} : { index }),
      ...(worktree === undefined ? {} : { worktree }),
    };
  }
  return observeWorktree({
    worktree: opts.worktree,
    gitDir: opts.gitDir,
    head,
    projection,
  });
}

function commandExitCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return status;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' ? code : undefined;
}

/**
 * Classifies what one governed operation did to a repository, which is the
 * judgement the engine matches against the state's declared
 * `repositoryDisposition`. Mirrors the engine reference's
 * `classifyRepositoryReceipt` decision order: an identical observation is
 * `unchanged`; any change under all-`unchanged` dispositions is
 * `concurrent-or-foreign-change`; a same-HEAD change is `worktree-only-change`
 * only when it preserves every baseline entry and a commit arm is declared;
 * a moved HEAD is one descendant commit only when ancestry proves exactly one
 * new commit and the dirty projection is preserved; everything the observation
 * cannot prove is `observation-ambiguous`.
 */
export function classifyGitChange(opts: {
  readonly baseline: RepositoryObservation;
  readonly after: RepositoryObservation;
  /** The boundary's declared dispositions; assume every arm when omitted. */
  readonly dispositions?: readonly string[];
  readonly run: GitRunner;
}): RepositoryReceiptClassification {
  const { baseline, after } = opts;
  const sameHead = baseline.head === after.head;
  const sameProjection = projectionsEqual(baseline, after);
  if (sameHead && sameProjection) return 'unchanged';
  const allowed = opts.dispositions ?? ['unchanged', 'one-descendant-commit'];
  if (allowed.length > 0 && allowed.every((value) => value === 'unchanged')) {
    return 'concurrent-or-foreign-change';
  }
  if (sameHead) {
    if (!projectionPreservesBaseline(baseline.projection, after.projection)) {
      return 'observation-ambiguous';
    }
    return allowed.includes('one-descendant-commit')
      ? 'worktree-only-change'
      : 'observation-ambiguous';
  }
  if (after.head === NULL_GIT_OID) return 'rewritten-or-non-descendant';
  if (baseline.head !== NULL_GIT_OID) {
    try {
      opts.run(['merge-base', '--is-ancestor', baseline.head, after.head]);
    } catch (error) {
      // Exit code 1 is Git's definitive "not an ancestor"; any other failure
      // proves nothing about ancestry and stays ambiguous.
      return commandExitCode(error) === 1
        ? 'rewritten-or-non-descendant'
        : 'observation-ambiguous';
    }
  }
  const range =
    baseline.head === NULL_GIT_OID
      ? after.head
      : `${baseline.head}..${after.head}`;
  let count: number;
  try {
    count = Number.parseInt(
      opts.run(['rev-list', '--count', range]).trim(),
      10,
    );
  } catch {
    return 'observation-ambiguous';
  }
  if (!Number.isSafeInteger(count) || count < 0) return 'observation-ambiguous';
  if (count > 1) return 'multiple-commits';
  if (count !== 1) return 'rewritten-or-non-descendant';
  if (!sameProjection) return 'observation-ambiguous';
  return 'one-descendant-commit';
}

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

interface StoredBoundary {
  readonly boundaryId: string;
  readonly runtimeSessionId: string;
  readonly baseline: RepositoryObservation;
  readonly [key: string]: unknown;
}

interface StoredOperation {
  readonly sequence: number;
  readonly operationId: string;
  readonly checkpointRestorationEligible: boolean;
  readonly checkpoint?: RepositoryObservation;
  readonly [key: string]: unknown;
}

interface DeferredBindingEvidence {
  readonly operationId: string;
  readonly pendingQuestion: {
    readonly questionId: string;
    readonly asker: unknown;
    readonly question: string;
    readonly sourceItem?: string;
  };
  readonly playerContinuation: unknown;
}

interface CompletionEvidence {
  readonly finalText?: string;
  readonly semanticCandidate?: unknown;
  readonly deferred?: DeferredBindingEvidence;
  readonly unresolved?: true;
}

/**
 * Capabilities that run governed operations against a real worktree, observing
 * it before and after so the engine receives a classified receipt. The engine
 * owns each boundary's identity — it re-checks the source state and outcome
 * schema on completion — so the seed it supplies is completed, never replaced.
 *
 * The boundary is recorded in the ledger when the operation starts, before the
 * completion callback runs, so the engine's semantic correction budget can
 * find and spend it through `writeAhead` mid-completion (DR-025, DR-028); the
 * settlement then replaces the started record with the receipt and exactly the
 * evidence the completion callback returned. A completion carrying a deferred
 * Boss-question binding appends the reciprocal logical operation and settles
 * `deferredStatus: 'bound'` (DR-005, DR-040).
 */
export function worktreeHostCapabilities(opts: {
  readonly playbookId: string;
  readonly observe: () => RepositoryObservation;
  readonly classify?: (
    baseline: RepositoryObservation,
    after: RepositoryObservation,
    context: { readonly dispositions?: readonly string[] },
  ) => RepositoryReceiptClassification;
}): HostCapabilities {
  const boundaries: StoredBoundary[] = [];
  const logicalOperations: StoredOperation[] = [];
  let revision = 0;
  // The engine holds one active governed attempt id per runtime boundary and
  // rejects a second, so the host mints one identity and reuses it; a distinct
  // attempt would come from a retry this capability does not perform.
  const attemptId = randomUUID();
  // One governed operation owns the worktree at a time: `runExclusive` and
  // `runDeferred` calls are chained, and the boundary sequence is assigned
  // under the same chain so concurrent callers cannot collide.
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const settled = tail.then(task, task);
    tail = settled.then(
      () => undefined,
      () => undefined,
    );
    return settled;
  };
  const snapshot = (): EffectLedgerSnapshot => ({
    schemaVersion: 1,
    revision,
    boundaries: [...boundaries],
    logicalOperations: [...logicalOperations],
  });
  const boundaryIndexById = (boundaryId: string): number => {
    const index = boundaries.findIndex(
      (candidate) => candidate.boundaryId === boundaryId,
    );
    if (index < 0) {
      throw new Error(`effect boundary ${boundaryId} is not in the ledger`);
    }
    return index;
  };
  const operationIndexById = (operationId: string): number => {
    const index = logicalOperations.findIndex(
      (candidate) => candidate.operationId === operationId,
    );
    if (index < 0) {
      throw new Error(
        `deferred logical operation ${operationId} is not in the ledger`,
      );
    }
    return index;
  };
  const classify = (
    baseline: RepositoryObservation,
    after: RepositoryObservation,
    dispositions: readonly string[] | undefined,
  ): RepositoryReceiptClassification =>
    opts.classify
      ? opts.classify(baseline, after, { dispositions })
      : projectionsEqual(baseline, after) && baseline.head === after.head
        ? 'unchanged'
        : 'observation-ambiguous';

  return {
    repository: {
      runExclusive(options: {
        readonly signal?: AbortSignal;
        readonly effectBoundary: EffectBoundarySeed;
        readonly operation: (context: {
          readonly baseline: RepositoryObservation;
          readonly identity: unknown;
        }) => Promise<unknown>;
        readonly completeEffectBoundary: (
          completion: unknown,
        ) => unknown | Promise<unknown>;
      }) {
        return exclusive(async () => {
          options.signal?.throwIfAborted();
          const seed = options.effectBoundary;
          const baseline = opts.observe();
          // `PlaybookEffectBoundaryStart` omits every host-owned member, so
          // the host supplies ordering and attempt identity while everything
          // identifying the work comes from the engine's seed. Recording the
          // started boundary now lets the engine's correction budget find it.
          const started: StoredBoundary = {
            ...seed,
            sequence: boundaries.length + 1,
            attemptId,
            attemptNumber: 1,
            playbookId: opts.playbookId,
            canonicalWorktree: {
              worktree: baseline.worktree,
              gitDir: baseline.gitDir,
            },
            baseline,
          };
          boundaries.push(started);
          revision += 1;
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
          let receipt: RepositoryReceipt;
          try {
            const after = opts.observe();
            const classification = classify(baseline, after, seed.dispositions);
            receipt = {
              classification,
              baseline,
              after,
              ...(classification === 'one-descendant-commit'
                ? { commitOid: after.head }
                : {}),
            };
          } catch {
            // An after-observation that cannot be taken proves nothing; the
            // engine accepts `observation-ambiguous` with no after.
            receipt = { classification: 'observation-ambiguous', baseline };
          }
          const evidence = ((await options.completeEffectBoundary({
            boundary: started,
            operation,
            receipt,
            outcomeReceipt: receipt,
          })) ?? {}) as CompletionEvidence;
          // The engine re-checks that the settled boundary carries exactly the
          // evidence its completion callback returned, so that evidence is
          // acknowledged verbatim — present keys copied, absent keys removed —
          // over whatever the completion (e.g., a spent correction budget)
          // left in the ledger.
          const index = boundaryIndexById(started.boundaryId);
          const retained: Record<string, unknown> = { ...boundaries[index]! };
          delete retained.finalText;
          delete retained.semanticCandidate;
          let settled: StoredBoundary = {
            ...(retained as StoredBoundary),
            ...(receipt.after === undefined ? {} : { after: receipt.after }),
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
          };
          let deferredStatus: 'bound' | 'unresolved' | undefined;
          if (evidence.deferred !== undefined) {
            const binding = evidence.deferred;
            if (receipt.after === undefined) {
              // Without a checkpoint observation the question cannot bind;
              // append the operation without binding evidence so the engine
              // sees it as structurally unresolved.
              logicalOperations.push({
                sequence: logicalOperations.length + 1,
                operationId: binding.operationId,
                playbookId: opts.playbookId,
                runtimeSessionId: started.runtimeSessionId,
                boundaryIds: [started.boundaryId],
                originalBaseline: baseline,
                checkpointRestorationEligible: false,
              });
              deferredStatus = 'unresolved';
            } else {
              const question = binding.pendingQuestion;
              logicalOperations.push({
                sequence: logicalOperations.length + 1,
                operationId: binding.operationId,
                playbookId: opts.playbookId,
                runtimeSessionId: started.runtimeSessionId,
                boundaryIds: [started.boundaryId],
                originalBaseline: baseline,
                checkpoint: receipt.after,
                pendingQuestion: {
                  questionId: question.questionId,
                  asker: question.asker,
                  question: question.question,
                  ...(typeof question.sourceItem === 'string'
                    ? { sourceItem: question.sourceItem }
                    : {}),
                },
                playerContinuation: binding.playerContinuation,
                checkpointRestorationEligible: false,
              });
              deferredStatus = 'bound';
            }
            settled = { ...settled, logicalOperationId: binding.operationId };
          }
          boundaries[index] = settled;
          revision += 1;
          return {
            operation,
            receipt,
            effectLedger: snapshot(),
            ...(deferredStatus === undefined ? {} : { deferredStatus }),
          };
        });
      },
      runDeferred(options: {
        readonly mode: 'continue' | 'park' | 'restore';
        readonly operationId: string;
      }): Promise<unknown> {
        return exclusive(async () => {
          if (options.mode === 'park') {
            const index = operationIndexById(options.operationId);
            logicalOperations[index] = {
              ...logicalOperations[index]!,
              checkpointRestorationEligible: true,
            };
            revision += 1;
            return { status: 'parked', effectLedger: snapshot() };
          }
          if (options.mode === 'restore') {
            const index = operationIndexById(options.operationId);
            const operation = logicalOperations[index]!;
            const checkpoint = operation.checkpoint;
            if (
              checkpoint === undefined ||
              !operation.checkpointRestorationEligible
            ) {
              return { status: 'ineligible', effectLedger: snapshot() };
            }
            const current = opts.observe();
            if (
              current.head !== checkpoint.head ||
              !projectionsEqual(current, checkpoint)
            ) {
              return {
                status: 'checkpoint-mismatch',
                effectLedger: snapshot(),
              };
            }
            logicalOperations[index] = {
              ...operation,
              checkpointRestorationEligible: false,
            };
            revision += 1;
            return { status: 'restored', effectLedger: snapshot() };
          }
          throw new Error(
            'worktree host capabilities do not continue a deferred operation',
          );
        });
      },
    },
    effectLedger: {
      snapshot,
      // The engine's only write-ahead command against a live host capability
      // is the correction-budget boundary replacement (DR-025); it arrives
      // mid-completion, inside the exclusive chain, so it must apply directly.
      writeAhead: async (commands: readonly unknown[]): Promise<unknown> => {
        for (const command of commands) {
          const { kind } = command as { readonly kind?: unknown };
          if (kind !== 'replace-boundaries') {
            throw new Error(
              `worktree host capabilities do not support effect-ledger command ${String(kind)}`,
            );
          }
          const { replacements } = command as {
            readonly replacements: readonly {
              readonly expected: unknown;
              readonly next: unknown;
            }[];
          };
          for (const { expected, next } of replacements) {
            const index = boundaries.findIndex((candidate) =>
              isDeepStrictEqual(candidate, expected),
            );
            if (index < 0) {
              throw new Error(
                'effect-ledger replacement expected a boundary that is not in the ledger',
              );
            }
            boundaries[index] = next as StoredBoundary;
            revision += 1;
          }
        }
        return snapshot();
      },
    },
  };
}
