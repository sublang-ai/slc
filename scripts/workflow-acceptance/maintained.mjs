// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { codeCases, runCodeScenario } from './code.mjs';
import { identities } from './common.mjs';

// Review fixture only. These names are read from the maintained artifact;
// they are deliberately not defaults for a freshly generated artifact.
export const maintainedCodeProfile = {
  role: 'coder',
  select(semantic, { ir, task }) {
    if (semantic === 'question') return { guard: 'needsBossReply' };
    if (semantic === 'direct') return { guard: 'directCommit' };
    if (semantic === 'new-ir') return { guard: 'irCommit', irNumber: ir };
    return {
      guard: semantic === 'more' ? 'moreTasks' : 'finalTask',
      irNumber: ir,
      irTask: task,
    };
  },
  resultText(semantic, { ir, task }) {
    const meaning = {
      direct:
        'Implemented and tested the complete direct request, updated its specs, and made one new commit.',
      'new-ir': `Created IR-${ir}, split it into two one-commit tasks, and committed only the IR. No implementation task was performed.`,
      more: `Implemented exactly ${task} of IR-${ir}, tested it, updated progress, and committed it. One task remains.`,
      final: `Implemented exactly ${task}, the final unfinished task of IR-${ir}; checked all acceptance criteria, updated progress, tested and committed it.`,
    };
    return `${meaning[semantic]}\nLiteral report: "quoted" <latest-commit> $& 中文.\nAll existing commits were preserved.`;
  },
  reviewResult(mode, { head, ownCommit, childSessionId }) {
    const result = {
      status: 'ok',
      playbookId: 'review',
      childSessionId,
      terminal: { stateId: 'fixture-review-terminal', kind: 'success' },
      output: { evaluatedRevision: head, noUnsettledFindings: true },
    };
    if (mode === 'missing-revision') delete result.output.evaluatedRevision;
    if (mode === 'ill-typed-revision') result.output.evaluatedRevision = 7;
    if (mode === 'unsettled') result.output.noUnsettledFindings = false;
    if (mode === 'foreign-shape')
      result.output = { approvedCommit: ownCommit, noUnsettledFindings: true };
    if (mode === 'failure') result.terminal.kind = 'failure';
    if (mode === 'aborted')
      return {
        status: 'aborted',
        playbookId: 'review',
        childSessionId,
        error: { name: 'FixtureAbort', message: 'Review authored abort.' },
      };
    return result;
  },
  decodeSuccess(result) {
    return {
      lastOwnedCommit: result.output.lastCodeCommit,
      evaluatedRevision: result.output.finalEvaluatedRevision,
      allReviewsPassed: result.output.allReviewsPassed,
    };
  },
  assertFailure(result, ownCommit) {
    assert.equal(result.output.lastCodeCommit, ownCommit);
  },
};

export async function maintainedConfig(root, workflow, output) {
  const registryPath = join(
    root,
    'reference/sdlc',
    `${workflow}.playbook`,
    `${workflow}.registry.js`,
  );
  const sourcePath = join(root, 'reference/sdlc', `${workflow}.md`);
  const hostPath = join(
    root,
    'reference/sdlc/code.playbook/host-capabilities.js',
  );
  const enginePath = join(root, 'src/xstate-runtime.js');
  const registry = (await import(pathToFileURL(registryPath))).default;
  const { createWorktreeHostCapabilities: createHost } = await import(
    pathToFileURL(hostPath)
  );
  const { assertPlaybookRuntimeSnapshot: assertSnapshot } = await import(
    pathToFileURL(enginePath)
  );
  return {
    registry,
    createHost,
    assertSnapshot,
    profile: maintainedCodeProfile,
    construct: (entry, host, { runResults }) =>
      entry.createRuntime({ runResults }, host),
    source: await readFile(sourcePath, 'utf8'),
    output,
    protectedPaths: [
      sourcePath,
      registryPath,
      ...['fsm', 'playbook'].flatMap((name) =>
        ['js', 'ts'].map((ext) =>
          join(
            root,
            'reference/sdlc',
            `${workflow}.playbook`,
            `${workflow}.${name}.${ext}`,
          ),
        ),
      ),
      hostPath,
      enginePath,
      join(root, 'src/xstate-playbook-runtime.js'),
      join(root, 'reference/sdlc/code.playbook/bin/repository-effects.js'),
      join(root, 'package.json'),
    ],
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === new URL(import.meta.url).pathname
) {
  const root = resolve(process.argv[2]);
  const output = resolve(process.argv[3]);
  const only = process.argv[4];
  await mkdir(output, { recursive: true });
  const config = await maintainedConfig(root, 'code', output);
  const expectedSource =
    '42987d1a13ee38e0f555c32dec6bb0d32c31153c5d855e56f8fc7ea97333ade5';
  assert.equal(
    (await identities([config.protectedPaths[0]]))[0].sha256,
    expectedSource,
    'fixture source stays exact task-start CODE',
  );
  const results = [];
  for (const scenario of codeCases.filter(
    (row) => only === undefined || row.id.includes(only),
  )) {
    const result = await runCodeScenario(config, scenario);
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
