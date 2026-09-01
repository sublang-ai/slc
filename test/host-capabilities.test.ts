// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Integration tests for the worktree host capabilities: every scenario drives
// real throwaway Git repositories and validates the resulting receipts and
// ledgers with the real engine validators from `@sublang/playbook`, so a
// divergence from the engine contract fails here instead of green-lighting a
// broken demo artifact.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertPlaybookEffectLedger,
  reconcilePlaybookSemanticEvidence,
} from '@sublang/playbook/xstate-runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classifyGitChange,
  failClosedHostCapabilities,
  observeGitWorktree,
  observeWorktree,
  worktreeHostCapabilities,
  NULL_GIT_OID,
  type GitRunner,
  type RepositoryObservation,
  type RepositoryReceiptClassification,
} from '../src/host-capabilities.js';

interface BoundaryResult {
  readonly operation: {
    readonly status: string;
    readonly [k: string]: unknown;
  };
  readonly receipt: {
    readonly classification: RepositoryReceiptClassification;
    readonly baseline: RepositoryObservation;
    readonly after?: RepositoryObservation;
    readonly commitOid?: string;
  };
  readonly effectLedger: unknown;
  readonly deferredStatus?: 'bound' | 'unresolved';
}

interface RepositoryPort {
  runExclusive(options: {
    readonly signal?: AbortSignal;
    readonly effectBoundary: Record<string, unknown>;
    readonly operation: (context: unknown) => Promise<unknown>;
    readonly completeEffectBoundary: (
      completion: unknown,
    ) => unknown | Promise<unknown>;
  }): Promise<BoundaryResult>;
  runDeferred(options: {
    readonly mode: 'continue' | 'park' | 'restore';
    readonly operationId: string;
  }): Promise<{ readonly status: string; readonly effectLedger: unknown }>;
}

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'slc-host-capabilities-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function gitRunner(dir: string): GitRunner {
  return (args) =>
    execFileSync('git', [...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
}

async function makeRepo(
  name: string,
): Promise<{ dir: string; git: (...args: string[]) => string }> {
  const dir = join(scratch, name);
  await mkdir(dir);
  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git('init', '-q');
  git('config', 'user.email', 'test@sublang.ai');
  git('config', 'user.name', 'Host Capabilities Test');
  await writeFile(join(dir, 'base.txt'), 'base\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  return { dir, git };
}

function capabilitiesFor(dir: string): {
  repository: RepositoryPort;
  effectLedger: { snapshot(): unknown; writeAhead(commands: unknown): unknown };
} {
  const run = gitRunner(dir);
  return worktreeHostCapabilities({
    playbookId: 'host-capabilities-test',
    classify: (baseline, after, context) =>
      classifyGitChange({
        baseline,
        after,
        dispositions: context.dispositions,
        run,
      }),
    observe: () =>
      observeGitWorktree({ worktree: dir, gitDir: join(dir, '.git'), run }),
  }) as unknown as {
    repository: RepositoryPort;
    effectLedger: {
      snapshot(): unknown;
      writeAhead(commands: unknown): unknown;
    };
  };
}

function seed(dispositions: readonly string[]): Record<string, unknown> {
  return {
    boundaryId: randomUUID(),
    runtimeSessionId: randomUUID(),
    turnId: 1,
    callId: 'player-1',
    roleId: 'Coder',
    sourceStateId: 'work',
    sourceOutcomeSchema: {},
    dispositions,
    correctionBudget: { limit: 1, spent: false },
  };
}

async function runBoundary(
  repository: RepositoryPort,
  dispositions: readonly string[],
  operation: () => Promise<unknown>,
  completeEffectBoundary: (
    completion: unknown,
  ) => unknown | Promise<unknown> = () => ({
    finalText: 'done',
  }),
): Promise<BoundaryResult> {
  return repository.runExclusive({
    effectBoundary: seed(dispositions),
    operation,
    completeEffectBoundary,
  });
}

function reconcileFor(
  receipt: unknown,
  disposition: 'unchanged' | 'one-descendant-commit',
): { status: string; reason?: string } {
  return reconcilePlaybookSemanticEvidence({
    outcomes: { done: { fields: {}, repositoryDisposition: disposition } },
    semanticCandidate: { guard: 'done' },
    finalText: 'done',
    receipt,
  }) as { status: string; reason?: string };
}

describe('worktreeHostCapabilities against real repositories', () => {
  it('classifies one clean commit as one-descendant-commit with its commitOid and reconciles resolved', async () => {
    const { dir, git } = await makeRepo('happy');
    const { repository } = capabilitiesFor(dir);
    const result = await runBoundary(
      repository,
      ['one-descendant-commit'],
      async () => {
        await writeFile(join(dir, 'work.txt'), 'work\n');
        git('add', '-A');
        git('commit', '-qm', 'work');
        return { status: 'ok', finalText: 'done' };
      },
    );
    expect(result.receipt.classification).toBe('one-descendant-commit');
    expect(result.receipt.commitOid).toBe(result.receipt.after?.head);
    expect(() => assertPlaybookEffectLedger(result.effectLedger)).not.toThrow();
    expect(reconcileFor(result.receipt, 'one-descendant-commit').status).toBe(
      'resolved',
    );
  });

  it('classifies two commits as multiple-commits without a commitOid and keeps the ledger engine-valid', async () => {
    const { dir, git } = await makeRepo('two-commits');
    const { repository } = capabilitiesFor(dir);
    const result = await runBoundary(
      repository,
      ['one-descendant-commit'],
      async () => {
        await writeFile(join(dir, 'one.txt'), '1\n');
        git('add', '-A');
        git('commit', '-qm', 'one');
        await writeFile(join(dir, 'two.txt'), '2\n');
        git('add', '-A');
        git('commit', '-qm', 'two');
        return { status: 'ok', finalText: 'done' };
      },
    );
    expect(result.receipt.classification).toBe('multiple-commits');
    expect(result.receipt).not.toHaveProperty('commitOid');
    expect(() => assertPlaybookEffectLedger(result.effectLedger)).not.toThrow();
    const reconciled = reconcileFor(result.receipt, 'one-descendant-commit');
    expect(reconciled.status).toBe('unresolved');
    expect(reconciled.reason).toBe('repository-disposition-mismatch');
  });

  it('classifies an amended HEAD as rewritten-or-non-descendant without a commitOid', async () => {
    const { dir, git } = await makeRepo('amend');
    const { repository } = capabilitiesFor(dir);
    const result = await runBoundary(
      repository,
      ['one-descendant-commit'],
      async () => {
        await writeFile(join(dir, 'base.txt'), 'amended\n');
        git('add', '-A');
        git('commit', '-q', '--amend', '-m', 'base amended');
        return { status: 'ok', finalText: 'done' };
      },
    );
    expect(result.receipt.classification).toBe('rewritten-or-non-descendant');
    expect(result.receipt).not.toHaveProperty('commitOid');
    expect(() => assertPlaybookEffectLedger(result.effectLedger)).not.toThrow();
  });

  it('classifies a commit that leaves the worktree dirty as observation-ambiguous', async () => {
    const { dir, git } = await makeRepo('dirty-after-commit');
    const { repository } = capabilitiesFor(dir);
    const result = await runBoundary(
      repository,
      ['one-descendant-commit'],
      async () => {
        await writeFile(join(dir, 'work.txt'), 'work\n');
        git('add', 'work.txt');
        git('commit', '-qm', 'work');
        await writeFile(join(dir, 'stray.txt'), 'leftover\n');
        return { status: 'ok', finalText: 'done' };
      },
    );
    expect(result.receipt.classification).toBe('observation-ambiguous');
    expect(result.receipt).not.toHaveProperty('commitOid');
    expect(() => assertPlaybookEffectLedger(result.effectLedger)).not.toThrow();
  });

  it('classifies any change under unchanged-only dispositions as concurrent-or-foreign-change', async () => {
    const { dir } = await makeRepo('foreign');
    const { repository } = capabilitiesFor(dir);
    const result = await runBoundary(repository, ['unchanged'], async () => {
      await writeFile(join(dir, 'stray.txt'), 'oops\n');
      return { status: 'ok', finalText: 'done' };
    });
    expect(result.receipt.classification).toBe('concurrent-or-foreign-change');
    expect(() => assertPlaybookEffectLedger(result.effectLedger)).not.toThrow();
    const reconciled = reconcileFor(result.receipt, 'unchanged');
    expect(reconciled.status).toBe('unresolved');
    expect(reconciled.reason).toBe('repository-disposition-mismatch');
  });

  it('never accepts an uncommitted rewrite of a tracked file as unchanged', async () => {
    const { dir } = await makeRepo('masked-rewrite');
    const { repository } = capabilitiesFor(dir);
    const result = await runBoundary(repository, ['unchanged'], async () => {
      await writeFile(join(dir, 'base.txt'), 'silently rewritten\n');
      return { status: 'ok', finalText: 'done' };
    });
    expect(result.receipt.classification).toBe('concurrent-or-foreign-change');
    expect(() => assertPlaybookEffectLedger(result.effectLedger)).not.toThrow();
    expect(reconcileFor(result.receipt, 'unchanged').status).toBe('unresolved');
  });

  it('sees a re-modified already-dirty file through its content identity', async () => {
    const { dir } = await makeRepo('redirtied');
    await writeFile(join(dir, 'base.txt'), 'dirty before\n');
    const { repository } = capabilitiesFor(dir);
    const result = await runBoundary(repository, ['unchanged'], async () => {
      // Same porcelain status code before and after; only the content moves.
      await writeFile(join(dir, 'base.txt'), 'dirty after\n');
      return { status: 'ok', finalText: 'done' };
    });
    expect(result.receipt.classification).toBe('concurrent-or-foreign-change');
  });

  it('classifies a same-HEAD superset change as worktree-only-change when a commit arm is declared', async () => {
    const { dir } = await makeRepo('worktree-only');
    const { repository } = capabilitiesFor(dir);
    const result = await runBoundary(
      repository,
      ['unchanged', 'one-descendant-commit'],
      async () => {
        await writeFile(join(dir, 'draft.txt'), 'draft\n');
        return { status: 'ok', finalText: 'done' };
      },
    );
    expect(result.receipt.classification).toBe('worktree-only-change');
    expect(() => assertPlaybookEffectLedger(result.effectLedger)).not.toThrow();
  });

  it('classifies a reverted baseline-dirty entry as observation-ambiguous', async () => {
    const { dir, git } = await makeRepo('reverted-baseline');
    await writeFile(join(dir, 'base.txt'), 'dirty at baseline\n');
    const { repository } = capabilitiesFor(dir);
    const result = await runBoundary(
      repository,
      ['unchanged', 'one-descendant-commit'],
      async () => {
        git('checkout', '--', 'base.txt');
        await writeFile(join(dir, 'other.txt'), 'other\n');
        return { status: 'ok', finalText: 'done' };
      },
    );
    expect(result.receipt.classification).toBe('observation-ambiguous');
    expect(() => assertPlaybookEffectLedger(result.effectLedger)).not.toThrow();
  });

  it('serializes overlapping runExclusive calls and keeps boundary sequences contiguous', async () => {
    const { dir } = await makeRepo('overlap');
    const { repository } = capabilitiesFor(dir);
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runBoundary(repository, ['unchanged'], async () => {
      order.push('first:start');
      await gate;
      order.push('first:end');
      return { status: 'ok', finalText: 'first' };
    });
    const second = runBoundary(repository, ['unchanged'], async () => {
      order.push('second:start');
      order.push('second:end');
      return { status: 'ok', finalText: 'second' };
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    const [, resultB] = await Promise.all([first, second]);
    expect(order).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
    const ledger = resultB.effectLedger as {
      boundaries: readonly { sequence: number }[];
    };
    expect(ledger.boundaries.map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(() =>
      assertPlaybookEffectLedger(resultB.effectLedger),
    ).not.toThrow();
  });

  it('rejects an already-aborted governed call before observing or operating', async () => {
    const { dir } = await makeRepo('pre-aborted');
    const { repository } = capabilitiesFor(dir);
    const controller = new AbortController();
    const reason = new Error('pre-aborted boundary');
    controller.abort(reason);
    await expect(
      repository.runExclusive({
        signal: controller.signal,
        effectBoundary: seed(['unchanged']),
        operation: async () => {
          throw new Error('operation must not run');
        },
        completeEffectBoundary: () => ({}),
      }),
    ).rejects.toBe(reason);
  });
});

describe('classifyGitChange ancestry error handling', () => {
  const baseOid = 'a'.repeat(40);
  const nextOid = 'b'.repeat(40);
  const observationFor = (head: string): RepositoryObservation =>
    observeWorktree({
      worktree: '/repo',
      gitDir: '/repo/.git',
      head,
      projection: {},
    });

  function classifyWithAncestryError(thrown: unknown): string {
    return classifyGitChange({
      baseline: observationFor(baseOid),
      after: observationFor(nextOid),
      dispositions: ['unchanged', 'one-descendant-commit'],
      run: (args) => {
        if (args[0] === 'merge-base') throw thrown;
        throw new Error(`unexpected git call: ${args.join(' ')}`);
      },
    });
  }

  it('reads exit code 1 as a definitive non-ancestor', () => {
    expect(
      classifyWithAncestryError(
        Object.assign(new Error('not an ancestor'), { status: 1 }),
      ),
    ).toBe('rewritten-or-non-descendant');
  });

  it('reads any other ancestry failure as observation-ambiguous', () => {
    expect(
      classifyWithAncestryError(
        Object.assign(new Error('object store corrupt'), { status: 128 }),
      ),
    ).toBe('observation-ambiguous');
    expect(
      classifyWithAncestryError(
        Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }),
      ),
    ).toBe('observation-ambiguous');
  });

  it('classifies the first commit from an empty repository as one-descendant-commit', () => {
    const calls: string[][] = [];
    const classification = classifyGitChange({
      baseline: observationFor(NULL_GIT_OID),
      after: observationFor(nextOid),
      dispositions: ['one-descendant-commit'],
      run: (args) => {
        calls.push([...args]);
        if (args[0] === 'rev-list') return '1\n';
        throw new Error(`unexpected git call: ${args.join(' ')}`);
      },
    });
    expect(classification).toBe('one-descendant-commit');
    expect(calls).toEqual([['rev-list', '--count', nextOid]]);
  });
});

describe('deferred Boss-question binding (DR-005, DR-040)', () => {
  it('binds, parks, and restores a deferred operation with an engine-valid ledger at every step', async () => {
    const { dir } = await makeRepo('deferred');
    const { repository } = capabilitiesFor(dir);
    const operationId = randomUUID();
    const result = await runBoundary(
      repository,
      ['one-descendant-commit', 'deferred'],
      async () => ({ status: 'ok', finalText: 'What color?' }),
      () => ({
        finalText: 'What color?',
        semanticCandidate: { guard: 'needsBossReply', question: 'What color?' },
        deferred: {
          operationId,
          pendingQuestion: {
            questionId: 'work',
            asker: { kind: 'role', roleId: 'Coder' },
            question: 'What color?',
            sourceItem: 'The Coder shall ask when the task is ambiguous.',
          },
          playerContinuation: { roleId: 'Coder' },
        },
      }),
    );
    expect(result.deferredStatus).toBe('bound');
    expect(() => assertPlaybookEffectLedger(result.effectLedger)).not.toThrow();
    const ledger = result.effectLedger as {
      boundaries: readonly { logicalOperationId?: string }[];
      logicalOperations: readonly {
        operationId: string;
        checkpointRestorationEligible: boolean;
      }[];
    };
    expect(ledger.boundaries[0]?.logicalOperationId).toBe(operationId);
    expect(ledger.logicalOperations[0]?.operationId).toBe(operationId);
    expect(ledger.logicalOperations[0]?.checkpointRestorationEligible).toBe(
      false,
    );

    const parked = await repository.runDeferred({ mode: 'park', operationId });
    expect(parked.status).toBe('parked');
    expect(() => assertPlaybookEffectLedger(parked.effectLedger)).not.toThrow();
    const parkedLedger = parked.effectLedger as {
      logicalOperations: readonly { checkpointRestorationEligible: boolean }[];
    };
    expect(
      parkedLedger.logicalOperations[0]?.checkpointRestorationEligible,
    ).toBe(true);

    const restored = await repository.runDeferred({
      mode: 'restore',
      operationId,
    });
    expect(restored.status).toBe('restored');
    expect(() =>
      assertPlaybookEffectLedger(restored.effectLedger),
    ).not.toThrow();

    await expect(
      repository.runDeferred({ mode: 'continue', operationId }),
    ).rejects.toThrow(/do not continue a deferred operation/);
  });

  it('reports checkpoint-mismatch when the worktree moved after parking', async () => {
    const { dir } = await makeRepo('deferred-mismatch');
    const { repository } = capabilitiesFor(dir);
    const operationId = randomUUID();
    await runBoundary(
      repository,
      ['one-descendant-commit', 'deferred'],
      async () => ({ status: 'ok', finalText: 'Which file?' }),
      () => ({
        finalText: 'Which file?',
        semanticCandidate: { guard: 'needsBossReply', question: 'Which file?' },
        deferred: {
          operationId,
          pendingQuestion: {
            questionId: 'work',
            asker: { kind: 'role', roleId: 'Coder' },
            question: 'Which file?',
            sourceItem: 'The Coder shall ask when the task is ambiguous.',
          },
          playerContinuation: { roleId: 'Coder' },
        },
      }),
    );
    await repository.runDeferred({ mode: 'park', operationId });
    await writeFile(join(dir, 'meddled.txt'), 'foreign change\n');
    const restored = await repository.runDeferred({
      mode: 'restore',
      operationId,
    });
    expect(restored.status).toBe('checkpoint-mismatch');
  });
});

describe('fail-closed capabilities', () => {
  it('rejects repository operations and reports an engine-valid empty ledger', async () => {
    const capabilities = failClosedHostCapabilities() as unknown as {
      repository: RepositoryPort;
      effectLedger: { snapshot(): unknown };
    };
    await expect(
      capabilities.repository.runExclusive({
        effectBoundary: seed(['unchanged']),
        operation: async () => undefined,
        completeEffectBoundary: () => ({}),
      }),
    ).rejects.toThrow(/does not support repository operations/);
    expect(() =>
      assertPlaybookEffectLedger(capabilities.effectLedger.snapshot()),
    ).not.toThrow();
  });
});

describe('semantic correction budget through the real engine (DR-025, DR-028)', () => {
  it('gives a malformed governed judge reply its one corrective re-ask and still reaches terminal', async () => {
    const entry = join(
      fileURLToPath(new URL('..', import.meta.url)),
      'demo/reference/workflow.ts',
    );
    const smokeRoot = join(scratch, 'correction-smoke');
    await mkdir(smokeRoot);
    execFileSync('git', ['init', '-q'], { cwd: smokeRoot });
    const workdir = join(smokeRoot, 'nested');
    await mkdir(workdir);
    const loaded = (await import(pathToFileURL(entry).href)) as {
      default: {
        createRuntime(
          options: unknown,
          capabilities: unknown,
        ): {
          init(session: unknown): Promise<void>;
          handleBossInput(input: unknown): Promise<{ outcome: string }>;
          dispose(): Promise<void>;
        };
      };
    };
    const run = gitRunner(workdir);
    const judgePrompts: string[] = [];
    const judgeReplies = [
      'this reply is not a semantic candidate', // malformed first adjudication
      '{"guard":"done"}', // corrective re-ask reply
      '{"guard":"clean"}',
    ];
    const runtime = loaded.default.createRuntime(
      { captainOptions: { cwd: workdir } },
      worktreeHostCapabilities({
        playbookId: 'workflow',
        classify: (baseline, after, context) =>
          classifyGitChange({
            baseline,
            after,
            dispositions: context.dispositions,
            run,
          }),
        observe: () =>
          observeGitWorktree({
            worktree: workdir,
            gitDir: join(workdir, '.git'),
            run,
          }),
      }),
    );
    const sessionId = randomUUID();
    let playerCalls = 0;
    await runtime.init({
      sessionId,
      playbookId: 'workflow',
      rootSessionId: sessionId,
      depth: 0,
      ports: {
        callPlayer: async () => {
          playerCalls += 1;
          if (playerCalls === 1) {
            await writeFile(join(workdir, 'change.txt'), 'demo change\n');
            const git = (...args: string[]): void => {
              execFileSync('git', args, { cwd: workdir, stdio: 'ignore' });
            };
            git('add', '-A');
            git(
              '-c',
              'user.name=Correction Test',
              '-c',
              'user.email=test@sublang.ai',
              'commit',
              '-m',
              'test: governed change',
            );
          }
          return { status: 'ok', finalText: 'done' };
        },
        callCaptain: async () => {
          throw new Error('unexpected captain call');
        },
        callJudge: async (prompt: string) => {
          judgePrompts.push(prompt);
          const reply = judgeReplies.shift();
          if (reply === undefined) throw new Error('unexpected judge call');
          return reply;
        },
        callPlaybook: async () => {
          throw new Error('unexpected playbook call');
        },
        emitStatus: async () => {},
        emitTelemetry: async () => {},
      },
    });
    const result = await runtime.handleBossInput({
      text: 'correction task',
      signal: new AbortController().signal,
    });
    await runtime.dispose();
    expect(result.outcome).toBe('terminal');
    // The corrective re-ask happened: three judge calls, the second citing
    // the structurally invalid first reply.
    expect(judgePrompts).toHaveLength(3);
    expect(judgePrompts[1]).toContain('structurally invalid');
    expect(judgePrompts[1]).toContain('this reply is not a semantic candidate');
    expect(judgeReplies).toHaveLength(0);
  });
});
