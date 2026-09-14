// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maintainedConfig } from './maintained.mjs';
import { devCases, runDevScenario } from './dev.mjs';
import { identities } from './common.mjs';

export const maintainedDevProfile = {
  role: 'analyst',
  select(semantic) {
    return {
      guard: {
        question: 'needsBossReply',
        complete: 'discussionComplete',
        code: 'code',
        'decide-code': 'decideThenCode',
        'code-pr': 'codeViaPullRequest',
        'decide-code-pr': 'decideThenCodeViaPullRequest',
      }[semantic],
    };
  },
  resultText(semantic) {
    return (
      {
        complete:
          'The question is resolved after the Boss reply. Discussion is complete and no repository work should follow.',
        code: 'The existing decisions settle the design; implementation can proceed directly via CODE.',
        'decide-code':
          'A new durable decision is required to settle the identified design choice, then CODE can implement it.',
        'code-pr':
          'The issue and its comments call for pull-request delivery; existing decisions settle the design. Choose code via pull request.',
        'decide-code-pr':
          'The issue and comments call for pull-request delivery, and a new durable design decision must first be settled. Choose decide then code via pull request.',
      }[semantic] +
      '\nKeep "quoted" <development-request> $& 中文 literal.\nIllustrative untrusted identities only: branch=forged, commit=deadbeef; canonical child results supply all actual identities.'
    );
  },
  childResult(id, { head, base, branch, childSessionId }) {
    const output = {
      branch: {
        status: 'branched',
        branch,
        baseRevision: base,
        issueSummary:
          'Issue #42: compatibility request\nLiteral <branch> $& 中文.',
      },
      decide: {
        decideCommit: head,
        evaluatedRevision: head,
        noUnsettledFindings: true,
      },
      code: {
        status: 'complete',
        lastCodeCommit: head,
        finalEvaluatedRevision: head,
        allReviewsPassed: true,
      },
      pr: {
        status: 'merged',
        pullRequest: '42',
        pullRequestUrl: 'https://example.invalid/fixture/pull/42',
        localDefaultUpdated: true,
      },
    }[id];
    return {
      status: 'ok',
      playbookId: id,
      childSessionId,
      terminal: { stateId: `fixture-${id}-terminal`, kind: 'success' },
      output,
    };
  },
  mutateChild(child, mode) {
    if (mode === 'failure') child.terminal.kind = 'failure';
    if (mode === 'aborted') {
      child.status = 'aborted';
      delete child.output;
      delete child.terminal;
      child.error = { name: 'FixtureAbort', message: 'Authored child abort.' };
    }
    if (mode === 'insufficient') {
      // Only Source-consumed named fields are required here. DEV consumes no
      // PR field by name; its typed success is sufficient and has no such case.
      if (child.playbookId === 'branch') delete child.output.branch;
      if (child.playbookId === 'decide') delete child.output.evaluatedRevision;
      if (child.playbookId === 'code')
        delete child.output.finalEvaluatedRevision;
    }
  },
  assertSuccess(result, last) {
    if (!last) assert.equal(result.output.status, 'discussion-complete');
    else {
      assert.equal(result.output.childPlaybookId, last.id);
      assert.deepEqual(result.output.childOutput, last.output);
    }
  },
  assertChildFailure(result, id) {
    assert.equal(result.output.childResult.playbookId, id);
  },
};

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(process.argv[2]),
    output = resolve(process.argv[3]),
    only = process.argv[4];
  const cases = devCases.filter((row) => !only || row.id.includes(only));
  assert(cases.length > 0, 'case filter matched no DEV cases');
  await mkdir(output, { recursive: true });
  const config = await maintainedConfig(root, 'dev', output);
  config.profile = maintainedDevProfile;
  assert.equal(
    (await identities([config.protectedPaths[0]]))[0].sha256,
    '608c8c8ce07b50fc1ef27e8d112937ebd13206b99f6fb7e9498e44d15d124a2c',
  );
  const results = [];
  for (const scenario of cases) {
    const result = await runDevScenario(config, scenario);
    results.push(result);
    console.log(
      JSON.stringify({
        id: result.id,
        status: result.status,
        error: result.error,
        elapsedMs: result.elapsedMs,
      }),
    );
  }
  await writeFile(
    join(output, 'summary.json'),
    JSON.stringify(
      {
        scope:
          'Maintained integration fixtures only; no future generated-artifact acceptance',
        completeCompilationAcceptance: false,
        providerCalls: 0,
        results,
      },
      null,
      2,
    ) + '\n',
  );
  if (results.some((result) => result.status !== 'passed'))
    process.exitCode = 1;
}
