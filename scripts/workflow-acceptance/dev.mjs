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
  quoted,
  session,
  supported,
} from './common.mjs';
import { CALLER, RUN_RESULTS } from './code.mjs';

const questions = [
  'Which compatibility scope should be used?\nKeep <request> and $& literal.',
  'Should the narrow path follow the existing decision?\nNo files have changed.',
];
const answers = [
  'Use the narrow Ω scope.\nKeep "quotes" and $& exactly.',
  'Yes, implement the existing decision.\nPreserve 中文 and <request>.',
];
const paths = {
  code: ['code'],
  'decide-code': ['decide', 'code'],
  'code-pr': ['branch', 'code', 'pr'],
  'decide-code-pr': ['branch', 'decide', 'code', 'pr'],
  complete: [],
};
export const devCases = [
  ...Object.keys(paths)
    .filter((x) => x !== 'complete')
    .map((route) => ({ id: `dev-${route}`, steps: [route] })),
  {
    id: 'dev-discussion-resumed-code',
    steps: ['question', 'question', 'code'],
    questionMode: 'resume',
  },
  {
    id: 'dev-discussion-fresh-complete',
    steps: ['question', 'complete'],
    questionMode: 'fresh',
  },
  {
    id: 'dev-premature-discussion-complete',
    steps: ['complete'],
    expected: 'planning-rejected',
  },
  {
    id: 'dev-planning-worktree-mutation',
    steps: ['code'],
    effect: 'worktree',
    expected: 'planning-rejected',
  },
  {
    id: 'dev-planning-commit',
    steps: ['code'],
    effect: 'commit',
    expected: 'planning-rejected',
  },
  ...['branch', 'decide', 'code', 'pr'].flatMap((child) =>
    ['failure', 'aborted', 'control-error'].map((mode) => ({
      id: `dev-${child}-${mode}`,
      steps: ['decide-code-pr'],
      failureAt: child,
      childMode: mode,
      expected:
        mode === 'control-error' ? 'control-failure' : 'authored-failure',
    })),
  ),
  ...['branch', 'decide', 'code'].map((child) => ({
    id: `dev-${child}-insufficient`,
    steps: ['decide-code-pr'],
    failureAt: child,
    childMode: 'insufficient',
    expected: 'authored-failure',
  })),
];

function assertDiscussion(text, exchanges) {
  let cursor = 0;
  for (const { question, answer } of exchanges) {
    for (const value of [question, answer]) {
      const index = text.indexOf(quoted(value), cursor);
      assert(index >= 0, 'ordered exact quoted discussion relay');
      cursor = index + quoted(value).length;
    }
  }
}

export async function runDevScenario(config, scenario) {
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
      supported(registry.id === 'dev', 'DEV canonical identity required');
      supported(
        registry.requiredRoleIds.length === 1 &&
          registry.requiredRoleIds[0] === profile.role,
        'one source Analyst role required',
      );
      const blocks = [...source.matchAll(/```markdown\n([\s\S]*?)\n```/g)].map(
        (match) => match[1],
      );
      supported(blocks.length === 1, 'DEV source instruction profile changed');
      const repo = await nestedGit(output);
      const steps = [...scenario.steps],
        childIds = [],
        childValues = {},
        exchanges = [];
      let runtime,
        host,
        semantic,
        planningText,
        pending,
        pendingQuestion,
        answered = 0,
        playerCalls = 0,
        fault;
      const caller = scenario.steps.at(-1).endsWith('-pr')
        ? `${CALLER}\nDeliver via pull request for issue #42.`
        : CALLER;
      const guardPort =
        (fn) =>
        async (...args) => {
          try {
            return await fn(...args);
          } catch (error) {
            if (error.name !== 'FixtureChildControlError') fault ??= error;
            throw error;
          }
        };
      const ports = {
        callPlayer: guardPort(async (role, prompt, _signal, options) => {
          (diagnostics.transportedPlayers ??= []).push({
            role,
            prompt,
            options,
          });
          supported(steps.length > 0, 'unexpected extra Analyst phase');
          semantic = steps.shift();
          playerCalls++;
          assert.equal(role, profile.role);
          assert.equal(
            childIds.length,
            0,
            'all planning precedes child dispatch',
          );
          assert.equal(await git(repo.cwd, 'rev-parse', 'HEAD'), repo.base);
          assert.equal(await git(repo.cwd, 'status', '--porcelain'), '');
          assertRelay(prompt, 'Original request', caller);
          if (runResults !== '') assertRelay(prompt, 'Run results', runResults);
          assertInstructions(prompt, blocks);
          if (answered > 0) {
            const question = questions[answered - 1],
              answer = answers[answered - 1];
            assert.equal(
              options.resume,
              scenario.questionMode === 'resume'
                ? `fixture-analyst-${answered}`
                : false,
            );
            assert(prompt.includes(answer));
            if (scenario.questionMode === 'fresh')
              assert(prompt.includes(question));
            else {
              // Earlier question history remains source-owned; only the current
              // framework repeat is omitted for a resumed conversation.
              const preamble = prompt.split('> Original request:')[0];
              assert(!preamble.includes(question));
            }
            // The current exchange is carried by the continuation envelope;
            // archived earlier exchanges stay in source-owned quoted context.
            assertDiscussion(prompt, exchanges.slice(0, -1));
            if (options.freshPrompt !== undefined) {
              assert(options.freshPrompt.includes(question));
              assert(options.freshPrompt.includes(answer));
            }
          }
          planningText =
            semantic === 'question'
              ? questions[answered]
              : profile.resultText(semantic);
          diagnostics.callbacks.push({
            kind: 'player',
            role,
            prompt,
            options,
            semantic,
            finalText: planningText,
          });
          if (scenario.effect) {
            await writeFile(
              join(repo.cwd, 'invalid-planning-mutation.txt'),
              'should not change while planning\n',
            );
            if (scenario.effect === 'commit') {
              await git(repo.cwd, 'add', 'invalid-planning-mutation.txt');
              await commit(repo.cwd, 'invalid planner commit');
            }
          }
          return {
            status: 'ok',
            finalText: planningText,
            ...(scenario.questionMode === 'fresh'
              ? {}
              : { resumeToken: `fixture-analyst-${playerCalls}` }),
          };
        }),
        callCaptain: guardPort(async () => {
          supported(false, 'DEV direct-Captain adapter not reviewed');
        }),
        callJudge: guardPort(async (prompt) => {
          const reply = prompt.startsWith('Classify the following Boss message')
            ? bossReply(prompt, pendingQuestion)
            : governedReply(prompt, profile.select(semantic)).json;
          diagnostics.judges.push({ prompt, reply: JSON.parse(reply) });
          return reply;
        }),
        callPlaybook: guardPort(async (request) => {
          const route = paths[semantic];
          supported(route, 'unknown actual source semantic route');
          assert.equal(
            request.playbookId,
            route[childIds.length],
            'exact source child ordering / no extra REVIEW',
          );
          assert.equal(pending, undefined, 'must await prior child result');
          assertRelay(request.text, 'Original request', caller);
          if (request.playbookId !== 'pr') {
            assertRelay(request.text, 'Planning result', planningText);
            assertDiscussion(request.text, exchanges);
          }
          if (request.playbookId === 'code' && childValues.decide) {
            assertRelay(
              request.text,
              'DECIDE commit',
              childValues.decide.decideCommit,
            );
            assertRelay(
              request.text,
              'Evaluated revision',
              childValues.decide.evaluatedRevision,
            );
          }
          if (request.playbookId === 'pr') {
            for (const [label, value] of [
              ['Issue summary', childValues.branch.issueSummary],
              ['Branch', childValues.branch.branch],
              ['Base revision', childValues.branch.baseRevision],
              ['CODE commit', childValues.code.lastCodeCommit],
              ['Evaluated revision', childValues.code.finalEvaluatedRevision],
            ])
              assertRelay(request.text, label, value);
          }
          childIds.push(request.playbookId);
          const childSessionId = `fixture-${request.playbookId}-${childIds.length}`;
          diagnostics.callbacks.push({
            kind: 'child',
            request,
            childSessionId,
          });
          if (
            scenario.failureAt === request.playbookId &&
            scenario.childMode === 'control-error'
          ) {
            const error = new Error(
              `fixture nested ${request.playbookId} transport failed`,
            );
            error.name = 'FixtureChildControlError';
            throw error;
          }
          pending = { request, childSessionId };
          return { state: 'suspended', childSessionId };
        }),
        emitStatus: async (message, data) => {
          (diagnostics.statuses ??= []).push({ message, data });
        },
        emitTelemetry: async (event) => {
          (diagnostics.telemetry ??= []).push(event);
        },
      };
      const runtimeSession = session(registry, ports, 'Fixture Analyst Ω');
      const make = async (effectLedger) => {
        host = await createHost({
          cwd: repo.cwd,
          playbookId: registry.id,
          requiredRoleIds: registry.requiredRoleIds,
          concurrentRoleSets: registry.concurrentRoleSets,
          ...(effectLedger ? { effectLedger } : {}),
        });
        runtime = construct(registry, host, { cwd: repo.cwd, runResults });
      };
      const invoke = async (fn) => {
        try {
          return await fn();
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
          return { outcome: 'caught-control-error' };
        }
      };
      try {
        await make();
        await runtime.init(runtimeSession);
        let result = await invoke(() =>
          runtime.handleBossInput({
            text: caller,
            signal: AbortSignal.timeout(15000),
          }),
        );
        diagnostics.results.push(result);
        if (fault) throw fault;
        while (semantic === 'question' && result.outcome === 'quiescent') {
          assert.equal(childIds.length, 0);
          assert.equal(await git(repo.cwd, 'status', '--porcelain'), '');
          assert.equal(await git(repo.cwd, 'rev-parse', 'HEAD'), repo.base);
          supported(
            runtime.exportSnapshot && runtime.restore,
            'durable DEV question profile required',
          );
          const checkpoint = join(
            output,
            `${scenario.id}.${answered}.checkpoint.json`,
          );
          await writeFile(checkpoint, JSON.stringify(runtime.exportSnapshot()));
          const snapshot = assertSnapshot(
            JSON.parse(await readFile(checkpoint, 'utf8')),
            registry.id,
          );
          assert.equal(snapshot.pendingBossQuestions.length, 1);
          pendingQuestion = snapshot.pendingBossQuestions[0];
          assert.equal(pendingQuestion.question, questions[answered]);
          assert.equal(
            snapshot.effectLedger.logicalOperations.length,
            0,
            'unchanged planning question does not create CODE-style deferred chain',
          );
          exchanges.push({
            question: questions[answered],
            answer: answers[answered],
          });
          answered++;
          await runtime.dispose();
          await make(snapshot.effectLedger);
          await runtime.restore(runtimeSession, snapshot);
          result = await invoke(() =>
            runtime.handleBossInput({
              text: answers[answered - 1],
              signal: AbortSignal.timeout(15000),
            }),
          );
          diagnostics.results.push(result);
          if (fault) throw fault;
        }
        while (result.outcome === 'suspended') {
          assert(pending);
          const opened = pending;
          pending = undefined;
          assert.deepEqual(result.pendingCall, {
            callId: opened.request.callId,
            playbookId: opened.request.playbookId,
            childSessionId: opened.childSessionId,
          });
          const id = opened.request.playbookId;
          if (id === 'branch')
            await git(repo.cwd, 'switch', '--quiet', '-c', 'issue-42-fixture');
          if (id === 'decide' || id === 'code') {
            await writeFile(
              join(repo.cwd, `${id}-child.txt`),
              `scripted child ${id}\n`,
            );
            await git(repo.cwd, 'add', `${id}-child.txt`);
            await commit(repo.cwd, `fixture ${id}-owned commit`);
          }
          const head = await git(repo.cwd, 'rev-parse', 'HEAD');
          const child = profile.childResult(id, {
            head,
            base: repo.base,
            branch: await git(repo.cwd, 'branch', '--show-current'),
            childSessionId: opened.childSessionId,
          });
          childValues[id] = child.output;
          if (id === scenario.failureAt)
            profile.mutateChild(child, scenario.childMode);
          diagnostics.callbacks.push({
            kind: 'child-result',
            callId: opened.request.callId,
            result: child,
          });
          result = await invoke(() =>
            runtime.resumePlaybookCall({
              callId: opened.request.callId,
              result: child,
              signal: AbortSignal.timeout(15000),
            }),
          );
          diagnostics.results.push(result);
          if (fault) throw fault;
        }
        const expected = scenario.expected ?? 'success';
        if (expected === 'success') {
          assert.equal(result.outcome, 'terminal');
          assert.equal(result.terminal?.kind, 'success');
          assert.deepEqual(childIds, paths[semantic]);
          profile.assertSuccess(
            result,
            semantic === 'complete'
              ? undefined
              : { id: childIds.at(-1), output: childValues[childIds.at(-1)] },
          );
          assert.equal(await git(repo.cwd, 'status', '--porcelain'), '');
          if (semantic === 'complete')
            assert.equal(await git(repo.cwd, 'rev-parse', 'HEAD'), repo.base);
        } else if (expected === 'planning-rejected') {
          assert.equal(childIds.length, 0);
          assert.notEqual(result.terminal?.kind, 'success');
          assert(
            ['unresolved-effect', 'failed', 'quiescent'].includes(
              result.outcome,
            ),
          );
        } else if (expected === 'authored-failure') {
          assert.equal(result.outcome, 'terminal');
          assert.equal(result.terminal?.kind, 'failure');
          assert.equal(childIds.at(-1), scenario.failureAt);
          profile.assertChildFailure(result, scenario.failureAt);
        } else {
          assert.equal(childIds.at(-1), scenario.failureAt);
          assert.notEqual(result.terminal?.kind, 'success');
          assert.equal(
            runtime.describe().lastError?.message,
            `fixture nested ${scenario.failureAt} transport failed`,
          );
        }
        await assertRepositoryIsolation(repo);
        return {
          scope: 'DEV parent routing with scripted canonical children',
          expected,
          ownNestedGit: true,
          exactPromptRelays: true,
          nonemptyRunResultsChecked: runResults !== '',
          actualPlanningReceipts: true,
          analystCalls: playerCalls,
          childSequence: childIds,
          durableRestores: answered,
          outcome: result.outcome,
          terminalKind: result.terminal?.kind,
          childInternalsTested: false,
          remoteGitHubTested: false,
        };
      } finally {
        await runtime?.dispose();
      }
    },
  );
}
