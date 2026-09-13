// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertInstructions,
  assertRelay,
  assertRepositoryIsolation,
  bossReply,
  commit,
  git,
  governedReply,
  nestedGit,
  preserveRun,
  session,
  supported,
} from './common.mjs';

export const CALLER =
  'Implement the requested compatibility change.\nKeep "quotes", `ticks`, <ir-number>, $& and 中文 literally.\nDo not erase this last line.';
export const RUN_RESULTS =
  'Earlier tests: passed\nKeep <caller-input> and $& as data.';
export const QUESTION =
  'Which existing IR should continue?\nPlease supply its identity; no files have changed.';
export const ANSWER =
  'Continue IR-Ω42.\nPreserve <caller-input>, "quotes" and $& exactly.';
const IDENTITY = 'Fixture coder Ω';

export const codeCases = [
  { id: 'code-direct', steps: ['direct'] },
  { id: 'code-new-ir-two-tasks', steps: ['new-ir', 'more', 'final'] },
  { id: 'code-existing-ir-two-tasks', steps: ['more', 'final'], ir: 'Ω42' },
  {
    id: 'code-existing-ir-other-identity',
    steps: ['more', 'final'],
    ir: 'ZH-917',
  },
  { id: 'code-review-fix', steps: ['direct'], review: 'fix' },
  {
    id: 'code-review-missing-revision',
    steps: ['new-ir'],
    review: 'missing-revision',
    expected: 'authored-failure',
  },
  {
    id: 'code-review-ill-typed-revision',
    steps: ['new-ir'],
    review: 'ill-typed-revision',
    expected: 'authored-failure',
  },
  {
    id: 'code-review-unsettled',
    steps: ['new-ir'],
    review: 'unsettled',
    expected: 'authored-failure',
  },
  {
    id: 'code-review-foreign-shape',
    steps: ['new-ir'],
    review: 'foreign-shape',
    expected: 'authored-failure',
  },
  {
    id: 'code-review-authored-failure',
    steps: ['new-ir'],
    review: 'failure',
    expected: 'authored-failure',
  },
  {
    id: 'code-review-authored-abort',
    steps: ['new-ir'],
    review: 'aborted',
    expected: 'authored-failure',
  },
  {
    id: 'code-child-control-error',
    steps: ['new-ir'],
    review: 'control-error',
    expected: 'control-failure',
  },
  {
    id: 'code-ambiguous-ir-restored-session',
    steps: ['question', 'final'],
    questionMode: 'resume',
    ir: 'Ω42',
  },
  {
    id: 'code-ambiguous-ir-restored-fresh',
    steps: ['question', 'final'],
    questionMode: 'fresh',
    ir: 'Ω42',
  },
  ...['unchanged', 'multiple', 'residual', 'rewritten'].map((effect) => ({
    id: `code-effect-${effect}`,
    steps: ['direct'],
    effect,
    expected: 'effect-rejected',
  })),
];

export async function runCodeScenario(config, scenario) {
  const {
    registry,
    createHost,
    assertSnapshot,
    construct,
    profile,
    source,
    output,
    protectedPaths,
  } = config;
  const runResults = config.runResults ?? RUN_RESULTS;
  return preserveRun(
    { id: scenario.id, paths: protectedPaths, output },
    async (diagnostics) => {
      supported(
        registry.id === 'code',
        'CODE source requires canonical code identity',
      );
      supported(
        registry.requiredRoleIds.length === 1 &&
          registry.requiredRoleIds[0] === profile.role,
        'requires one declared source Coder role',
      );
      const blocks = [...source.matchAll(/```markdown\n([\s\S]*?)\n```/g)].map(
        (match) => match[1],
      );
      supported(blocks.length === 3, 'source instruction profile changed');
      const questionRepositoryDisposition = scenario.questionMode
        ? profile.questionRepositoryDisposition
        : undefined;
      if (scenario.questionMode)
        supported(
          questionRepositoryDisposition === 'deferred' ||
            questionRepositoryDisposition === 'unchanged',
          'CODE question cases require profile.questionRepositoryDisposition',
        );
      const repo = await nestedGit(output);
      const steps = [...scenario.steps];
      const ownCommits = [],
        evaluated = [],
        pendingChildren = [],
        phaseTexts = [];
      let host,
        runtime,
        pendingQuestion,
        currentStep,
        currentTask,
        taskOrdinal = 0,
        playerCount = 0,
        reviewCount = 0,
        promptFault,
        questionDone = false;
      const recordFault =
        (fn) =>
        async (...args) => {
          try {
            return await fn(...args);
          } catch (error) {
            if (error.name !== 'FixtureChildControlError')
              promptFault ??= error;
            throw error;
          }
        };
      const ir = scenario.ir ?? 'NEW-Ω42';
      const caller =
        scenario.steps[0] === 'more'
          ? `${CALLER}\nContinue IR-${ir} with two remaining tasks.`
          : CALLER;
      const effect = async (kind) => {
        if (kind === 'unchanged') return;
        if (kind === 'rewritten') {
          const tree = await git(repo.cwd, 'rev-parse', 'HEAD^{tree}');
          const oid = await git(
            repo.cwd,
            '-c',
            'user.name=Acceptance Fixture',
            '-c',
            'user.email=fixture@example.invalid',
            'commit-tree',
            tree,
            '-m',
            'foreign root',
          );
          await git(repo.cwd, 'reset', '--hard', '--quiet', oid);
          return;
        }
        for (let n = 0; n < (kind === 'multiple' ? 2 : 1); n++) {
          const filename = `phase-${playerCount}-${n}.txt`;
          await writeFile(
            join(repo.cwd, filename),
            `${currentStep}\n${caller}\n`,
          );
          await git(repo.cwd, 'add', filename);
          ownCommits.push(
            await commit(
              repo.cwd,
              `fixture ${currentStep} ${playerCount}.${n}`,
            ),
          );
        }
        if (kind === 'residual')
          await writeFile(join(repo.cwd, 'residual.txt'), 'uncommitted\n');
      };
      const ports = {
        callPlayer: recordFault(async (role, prompt, _signal, options) => {
          (diagnostics.transportedPlayers ??= []).push({
            role,
            prompt,
            options,
          });
          supported(
            steps.length > 0,
            'unexpected extra Coder phase / unsupported source splitting',
          );
          currentStep = steps.shift();
          if (currentStep === 'more' || currentStep === 'final')
            currentTask = `Task ${++taskOrdinal}`;
          playerCount++;
          assert.equal(role, profile.role);
          assert.equal(
            pendingChildren.length,
            0,
            'Coder cannot start before review callback',
          );
          assert.equal(
            reviewCount,
            ownCommits.length,
            'each preceding own commit has a review barrier',
          );
          assertRelay(prompt, 'Original request', caller);
          if (runResults !== '') assertRelay(prompt, 'Run results', runResults);
          const later = ownCommits.length > 0;
          if (later) assertRelay(prompt, 'IR number', ir);
          assertInstructions(prompt, [
            blocks[later ? 1 : 0],
            blocks[2].replace('<coder-llm>', IDENTITY),
          ]);
          await assertRepositoryIsolation(repo);
          if (questionDone) {
            assert.equal(
              options.resume,
              scenario.questionMode === 'resume'
                ? 'fixture-coder-question'
                : false,
            );
            assert(prompt.includes(ANSWER), 'exact Boss answer');
            if (scenario.questionMode === 'resume')
              assert(
                !prompt.includes(QUESTION),
                'resumed framework does not repeat pending question',
              );
            else
              assert(
                prompt.includes(QUESTION),
                'fresh fallback includes exact pending question',
              );
            if (options.freshPrompt !== undefined) {
              assert(options.freshPrompt.includes(QUESTION));
              assert(options.freshPrompt.includes(ANSWER));
              assertRelay(options.freshPrompt, 'Original request', caller);
            }
          }
          const finalText =
            currentStep === 'question'
              ? QUESTION
              : profile.resultText(currentStep, {
                  ir,
                  task: currentTask,
                  caller,
                });
          diagnostics.callbacks.push({
            kind: 'player',
            role,
            prompt,
            options,
            semantic: currentStep,
            finalText,
          });
          phaseTexts.push(finalText);
          if (currentStep !== 'question')
            await effect(scenario.effect ?? 'commit');
          return {
            status: 'ok',
            finalText,
            ...(currentStep === 'question' && scenario.questionMode === 'fresh'
              ? {}
              : {
                  resumeToken:
                    currentStep === 'question'
                      ? 'fixture-coder-question'
                      : `fixture-phase-${playerCount}`,
                }),
          };
        }),
        callCaptain: recordFault(async () => {
          supported(
            false,
            'source-specific direct Captain adapter not configured',
          );
        }),
        callJudge: recordFault(async (prompt) => {
          let reply;
          if (prompt.startsWith('Classify the following Boss message')) {
            assert(prompt.includes(ANSWER));
            reply = bossReply(prompt, pendingQuestion);
          } else {
            const selected = profile.select(currentStep, {
              ir,
              task: currentTask,
            });
            reply = governedReply(prompt, selected).json;
          }
          diagnostics.judges.push({ prompt, reply: JSON.parse(reply) });
          return reply;
        }),
        callPlaybook: recordFault(async (request) => {
          assert.equal(request.playbookId, 'review');
          assert.equal(
            ownCommits.length,
            reviewCount + 1,
            'one new own commit per review',
          );
          assertRelay(request.text, 'Original intent', caller);
          assertRelay(
            request.text,
            'Review scope',
            `the commit ${ownCommits.at(-1)} from this coding phase and its resulting repository state.`,
          );
          assertRelay(request.text, 'Coder output', phaseTexts.at(-1));
          if (currentStep === 'more' || currentStep === 'final')
            assertRelay(request.text, 'Current IR task', currentTask);
          reviewCount++;
          assert(
            !diagnostics.callbacks.some(
              (call) =>
                call.kind === 'child' && call.request.callId === request.callId,
            ),
            'fresh nested invocation identity',
          );
          const childSessionId = `fixture-review-${reviewCount}`;
          diagnostics.callbacks.push({
            kind: 'child',
            request,
            childSessionId,
          });
          if (scenario.review === 'control-error') {
            const error = new Error('fixture nested REVIEW transport failed');
            error.name = 'FixtureChildControlError';
            throw error;
          }
          pendingChildren.push({ request, childSessionId });
          return { state: 'suspended', childSessionId };
        }),
        emitStatus: async (message, data) => {
          (diagnostics.statuses ??= []).push({ message, data });
        },
        emitTelemetry: async (event) => {
          (diagnostics.telemetry ??= []).push(event);
        },
      };
      const runtimeSession = session(registry, ports, IDENTITY);
      const makeRuntime = async (effectLedger) => {
        host = await createHost({
          cwd: repo.cwd,
          playbookId: registry.id,
          requiredRoleIds: registry.requiredRoleIds,
          concurrentRoleSets: registry.concurrentRoleSets,
          ...(effectLedger ? { effectLedger } : {}),
        });
        runtime = construct(registry, host, { cwd: repo.cwd, runResults });
      };
      try {
        await makeRuntime();
        await runtime.init(runtimeSession);
        let result;
        try {
          result = await runtime.handleBossInput({
            text: caller,
            signal: AbortSignal.timeout(15000),
          });
        } catch (error) {
          if (
            scenario.expected !== 'control-failure' ||
            error.name !== 'FixtureChildControlError'
          )
            throw error;
          diagnostics.controlError = {
            name: error.name,
            message: error.message,
          };
          result = { outcome: 'caught-control-error' };
        }
        if (promptFault) throw promptFault;
        diagnostics.results.push(result);
        if (scenario.questionMode) {
          assert.equal(result.outcome, 'quiescent');
          assert.equal(ownCommits.length, 0);
          assert.equal(reviewCount, 0);
          assert.equal(await git(repo.cwd, 'rev-parse', 'HEAD'), repo.base);
          assert.equal(await git(repo.cwd, 'status', '--porcelain'), '');
          supported(
            typeof runtime.exportSnapshot === 'function' &&
              typeof runtime.restore === 'function',
            'requires public durable snapshot/restore',
          );
          const checkpoint = join(output, `${scenario.id}.checkpoint.json`);
          await writeFile(checkpoint, JSON.stringify(runtime.exportSnapshot()));
          const snapshot = assertSnapshot(
            JSON.parse(await readFile(checkpoint, 'utf8')),
            registry.id,
          );
          assert.equal(snapshot.pendingBossQuestions.length, 1);
          pendingQuestion = snapshot.pendingBossQuestions[0];
          assert.equal(pendingQuestion.question, QUESTION);
          assert.deepEqual(pendingQuestion.asker, {
            kind: 'role',
            roleId: profile.role,
          });
          if (questionRepositoryDisposition === 'deferred') {
            const operation = snapshot.effectLedger.logicalOperations.at(-1);
            assert(operation, 'CODE ambiguous IR uses deferred chain');
            assert.equal(operation.pendingQuestion.question, QUESTION);
          } else {
            assert.equal(
              snapshot.effectLedger.logicalOperations.length,
              0,
              'unchanged CODE question does not create a deferred chain',
            );
          }
          if (scenario.questionMode === 'resume')
            assert.equal(
              snapshot.roleResumeTokens[profile.role],
              'fixture-coder-question',
            );
          await runtime.dispose();
          questionDone = true;
          await makeRuntime(snapshot.effectLedger);
          await runtime.restore(runtimeSession, snapshot);
          result = await runtime.handleBossInput({
            text: ANSWER,
            signal: AbortSignal.timeout(15000),
          });
          if (promptFault) throw promptFault;
          diagnostics.results.push(result);
        }
        while (result.outcome === 'suspended') {
          assert.equal(pendingChildren.length, 1);
          const pending = pendingChildren.shift();
          assert.equal(result.pendingCall.callId, pending.request.callId);
          assert.equal(
            result.pendingCall.childSessionId,
            pending.childSessionId,
          );
          assert.equal(result.pendingCall.playbookId, 'review');
          if (scenario.review === 'fix') {
            await writeFile(
              join(repo.cwd, 'review-fix.txt'),
              'review owned fix\n',
            );
            await git(repo.cwd, 'add', 'review-fix.txt');
            await commit(repo.cwd, 'fixture review-owned fix');
          }
          const head = await git(repo.cwd, 'rev-parse', 'HEAD');
          evaluated.push(head);
          const child = profile.reviewResult(scenario.review ?? 'pass', {
            head,
            ownCommit: ownCommits.at(-1),
            childSessionId: pending.childSessionId,
          });
          diagnostics.callbacks.push({
            kind: 'child-result',
            callId: pending.request.callId,
            result: child,
          });
          try {
            result = await runtime.resumePlaybookCall({
              callId: pending.request.callId,
              result: child,
              signal: AbortSignal.timeout(15000),
            });
          } catch (error) {
            if (scenario.expected !== 'control-failure') throw error;
            diagnostics.controlError = {
              name: error.name,
              message: error.message,
            };
            result = { outcome: 'caught-control-error' };
          }
          if (promptFault) throw promptFault;
          diagnostics.results.push(result);
        }
        const expected = scenario.expected ?? 'success';
        if (expected === 'success') {
          assert.equal(steps.length, 0);
          assert.equal(result.outcome, 'terminal');
          assert.equal(result.terminal?.kind, 'success');
          const decoded = profile.decodeSuccess(result);
          assert.equal(decoded.lastOwnedCommit, ownCommits.at(-1));
          assert.equal(decoded.evaluatedRevision, evaluated.at(-1));
          assert.equal(decoded.allReviewsPassed, true);
          assert.equal(reviewCount, ownCommits.length);
          assert.equal(await git(repo.cwd, 'status', '--porcelain'), '');
          assert.equal(
            Number(
              await git(repo.cwd, 'rev-list', '--count', `${repo.base}..HEAD`),
            ),
            ownCommits.length + (scenario.review === 'fix' ? 1 : 0),
          );
          if (scenario.review === 'fix')
            assert.notEqual(decoded.lastOwnedCommit, decoded.evaluatedRevision);
          if (scenario.questionMode) {
            supported(
              typeof runtime.describe === 'function',
              'requires public pending-question inspection',
            );
            assert.equal(runtime.describe().pendingQuestions.length, 0);
            if (questionRepositoryDisposition === 'deferred') {
              assert.equal(
                host.effectLedger.snapshot().logicalOperations.at(-1)
                  .logicalReceipt.classification,
                'one-descendant-commit',
              );
            } else {
              assert.equal(
                host.effectLedger.snapshot().logicalOperations.length,
                0,
                'unchanged CODE question does not invent a deferred chain after answer',
              );
            }
          }
        } else if (expected === 'authored-failure') {
          assert.equal(result.outcome, 'terminal');
          assert.equal(result.terminal?.kind, 'failure');
          profile.assertFailure(result, ownCommits.at(-1));
          assert.equal(playerCount, 1);
          assert.equal(reviewCount, 1);
        } else if (expected === 'effect-rejected') {
          assert.notEqual(result.terminal?.kind, 'success');
          assert.equal(reviewCount, 0);
          assert.equal(playerCount, 1);
          assert(
            ['unresolved-effect', 'failed', 'quiescent'].includes(
              result.outcome,
            ),
            'rejected effect must remain nonterminal',
          );
        } else {
          assert.notEqual(result.terminal?.kind, 'success');
          assert.equal(playerCount, 1);
          assert.equal(reviewCount, 1);
          assert(
            diagnostics.controlError || result.outcome === 'failed',
            'control failure retained',
          );
          assert.equal(
            runtime.describe().lastError?.message,
            'fixture nested REVIEW transport failed',
          );
        }
        await assertRepositoryIsolation(repo);
        return {
          scope: 'CODE parent runtime with scripted REVIEW children',
          expected,
          ownNestedGit: true,
          exactPromptRelays: true,
          nonemptyRunResultsChecked: runResults !== '',
          actualReceipts: true,
          coderCalls: playerCount,
          reviewCalls: reviewCount,
          ownCommitCount: ownCommits.length,
          reviewFixCommit: scenario.review === 'fix',
          durableRestore: Boolean(scenario.questionMode),
          sourceInstructionBlocksChecked: true,
          outcome: result.outcome,
          terminalKind: result.terminal?.kind,
          childInternalsTested: false,
        };
      } finally {
        await runtime?.dispose();
      }
    },
  );
}
