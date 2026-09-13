// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { test, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import * as runtime from '../src/index.js';
import * as history from '../src/build-history.js';
import { generatePinRecord, writePinFile } from '../src/pin-generate.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  recordPhase,
  selectCase,
  parsePhaseArguments,
} from '../scripts/phase-probe.mjs';
const compilerRoot = fileURLToPath(new URL('..', import.meta.url));
const root = fs.mkdtempSync(path.join(tmpdir(), 'slc-phase-probe-test-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const source = path.join(root, 'opaque-source.md'),
  config = path.join(root, 'empty.yaml'),
  pipelineRoot = path.join(root, 'pipelines'),
  pipeline = path.join(pipelineRoot, 'fixture');
fs.mkdirSync(pipeline, { recursive: true });
fs.writeFileSync(config, '{}\n');
fs.writeFileSync(
  source,
  'Coder carries out the work.\n\nAt the start of the phase, Captain shall relay the following instruction:\n\n```markdown\nDo the work exactly as authored.\n```\n',
);
const definition = (name, from, to, ext = '.md') =>
  `# Phase ${name}\n\n## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | ${from} | .md |\n| target | ${to} | ${ext} |\n`;
fs.writeFileSync(
  path.join(pipeline, 'text2gears.md'),
  definition('text2gears', 'text', 'gears'),
);
fs.writeFileSync(
  path.join(pipeline, 'gears2fsm.md'),
  definition('gears2fsm', 'gears', 'fsm', '.ts'),
);
const questions = [
  {
    id: 'q1',
    question: 'PRIVATE QUESTION?',
    reason: 'PRIVATE REASON',
    evidence: 'PRIVATE EVIDENCE',
  },
];
const marker = `CLARIFICATION: ${JSON.stringify({ questions })}`;
const faithful =
  '# Case\n\n## Roles\n\n- Coder\n\n### CASE-1\n\nWhen the phase starts, Captain shall prompt Coder:\n\n> Do the work exactly as authored.\n';
function adapter(mode, seen) {
  return {
    agent: 'claude-code',
    isAvailable: async () => true,
    async *run(prompt, options) {
      seen.push({ prompt, options });
      const target = prompt.match(/^- artifact to write: (.+)$/m)?.[1],
        input = prompt.match(/^- source to read: (.+)$/m)?.[1];
      if (mode === 'wait') {
        if (!options.abortSignal.aborted)
          await new Promise((done) =>
            options.abortSignal.addEventListener('abort', done, { once: true }),
          );
      } else if (mode === 'clarify' || mode === 'mutate') {
        if (target) fs.writeFileSync(target, 'UNACCEPTED DRAFT');
        if (mode === 'mutate') fs.appendFileSync(input, 'MUTATION');
      } else
        fs.writeFileSync(
          target,
          mode === 'bad-fsm'
            ? 'export const value: string = 1;\n'
            : mode === 'drift'
              ? faithful + '> INVENTED EXTRA PRIVATE INSTRUCTION\n'
              : faithful,
        );
      yield {
        type: 'done',
        agent: 'claude-code',
        sessionId: 'private-token',
        timestamp: 1,
        payload: {
          status: mode === 'wait' ? 'interrupted' : 'success',
          result:
            mode === 'clarify' || mode === 'mutate'
              ? marker
              : (mode === 'drift' || mode === 'bad-fsm') && seen.length > 1
                ? JSON.stringify({
                    dispositions: [
                      {
                        finding: 1,
                        decision: 'accept',
                        reason: 'Attempted correction',
                      },
                    ],
                    result: 'PRIVATE RESPONSE',
                  })
                : 'PRIVATE RESPONSE',
          resumeToken: 'private-token',
          durationMs: 1,
        },
      };
    },
  };
}
const options = {
  compilerRoot,
  source,
  config,
  phase: 'fixture.text2gears',
  model: 'fixture-model',
  agent: 'claude-code',
  effort: 'low',
  pipelinePaths: [pipelineRoot],
  output: path.join(root, 'runs'),
  timeoutSeconds: 10,
};
for (const mode of ['success', 'clarify', 'mutate', 'drift', 'wait'])
  test(`ordinary phase ${mode}`, async () => {
    const seen = [];
    const run = await recordPhase(
      { ...options, ...(mode === 'wait' ? { timeoutSeconds: 1 } : {}) },
      { runtime, history, env: {}, adapterFactory: () => adapter(mode, seen) },
    );
    const s = run.summary;
    assert.equal(s.scope, 'phase');
    assert.equal(s.actualCliExit, null);
    assert.equal(s.cliExecution, 'not-invoked');
    assert.equal(s.source.path.endsWith('/workflow.md'), true);
    assert.equal(s.invocation[0], 'fixture.text2gears');
    assert.equal(
      s.compiler.metadata.path,
      path.join(compilerRoot, 'package.json'),
    );
    assert.ok(
      s.dependencies.packages.some((p) => p.name === '@sublang/cligent'),
    );
    assert.equal(s.executions.length, 1);
    assert.equal(s.executions[0].kind, 'interpreted');
    assert.equal(s.phases.length, 1);
    assert.equal(s.phases[0].name, 'text2gears');
    assert.equal(s.history.published, false);
    assert.ok(
      seen.every(
        (v) =>
          !v.prompt.includes('expected') && !v.prompt.includes('opaque-source'),
      ),
    );
    const raw =
      fs.readFileSync(run.summaryPath, 'utf8') +
      fs.readFileSync(s.logs.metrics, 'utf8');
    assert.ok(!raw.includes('PRIVATE QUESTION'));
    assert.ok(!raw.includes('PRIVATE RESPONSE'));
    assert.ok(!raw.includes('private-token'));
    if (mode === 'success') {
      assert.equal(s.status, 'success');
      assert.equal(s.phaseAcceptance.ok, true);
      assert.equal(s.phaseAcceptance.fullArtifactValidation, false);
      assert.equal(s.calls.length, 1);
    }
    if (mode === 'clarify') {
      assert.equal(s.status, 'clarification-required');
      assert.equal(s.api.outcome, 'clarification-required');
      assert.equal(s.api.clarification.questionCount, 1);
      assert.equal(s.artifacts.length, 0);
      assert.equal(s.preservation.sourceUnchanged, true);
      assert.deepEqual(
        JSON.parse(fs.readFileSync(s.logs.clarification)).questions,
        questions,
      );
    }
    if (mode === 'mutate') {
      assert.equal(s.status, 'failure');
      assert.equal(s.api.outcome, 'failure');
      assert.equal(s.preservation.sourceUnchanged, false);
      assert.equal(s.api.clarification, undefined);
    }
    if (mode === 'drift') {
      assert.equal(s.status, 'failure');
      assert.equal(s.calls.length, 3);
      assert.match(
        fs.readFileSync(s.logs.diagnostics, 'utf8'),
        /not an authored fragment/,
      );
    }
    if (mode === 'wait') {
      assert.equal(s.status, 'interrupted');
      assert.equal(s.deadlineExceeded, true);
      assert.equal(s.calls[0].status, 'interrupted');
    }
  });
test('ordinary pinned fixture selection is captured without inferred fallback', async () => {
  const name = 'compiled',
    dir = path.join(pipelineRoot, name),
    bundle = path.join(dir, 'text2gears.slc');
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'text2gears.md'),
    definition('text2gears', 'text', 'gears'),
  );
  fs.writeFileSync(path.join(dir, 'runtime.ts'), 'export {};\n');
  fs.writeFileSync(
    path.join(bundle, 'text2gears.playbook.ts'),
    `export default function createPlaybookRuntime(){let ports;return{async init(value){ports=value},async handleBossInput({text,signal}){await ports.callPlayer('coder',text,signal)},async dispose(){}}}\n`,
  );
  for (const ext of [
    'fsm.ts',
    'gears.md',
    'gears-fsm.test.ts',
    'fsm.introspect.test.ts',
    'prompt-contract.test.ts',
    'fsm.coverage.test.ts',
  ])
    fs.writeFileSync(
      path.join(bundle, 'text2gears.' + ext),
      ext.endsWith('.ts') ? 'export {};\n' : '# Fixture\n',
    );
  const pin = await generatePinRecord(dir, {
    definition: 'text2gears.md',
    artifact: 'text2gears.slc/text2gears.playbook.ts',
    artifactBundle: 'text2gears.slc',
    linkTarget: { kind: 'file', locator: 'runtime.ts' },
  });
  await writePinFile(dir, { text2gears: pin });
  const seen = [];
  const run = await recordPhase(
    { ...options, phase: 'compiled.text2gears' },
    {
      runtime,
      history,
      env: {},
      adapterFactory: () => adapter('clarify', seen),
    },
  );
  assert.equal(
    run.summary.status,
    'clarification-required',
    fs.readFileSync(run.summary.logs.diagnostics, 'utf8'),
  );
  assert.equal(run.summary.executions.length, 1);
  assert.equal(run.summary.executions[0].kind, 'compiled');
  assert.ok(run.summary.executions[0].pin.artifact.hash);
  assert.equal(run.summary.calls.length, 1);
});
test('actual CLI orchestration maps clarification to child exit2 separately', () => {
  const child = path.join(root, 'cli-probe.mjs');
  fs.writeFileSync(
    child,
    `import*as r from '${compilerRoot}/dist/index.js';\nconst source=${JSON.stringify(source)};\nconst report=${JSON.stringify(marker)};\nconst code=await r.run(['fixture.text2gears',source],{cwd:${JSON.stringify(root)},env:{},buildDeps:()=>({cwd:${JSON.stringify(root)},resolver:()=>[${JSON.stringify(pipeline)}],executor:r.createInterpretedExecutor({agent:{async run(){return{status:'success',text:report}}}})})});\nprocess.exitCode=code;\n`,
  );
  const result = spawnSync(process.execPath, [child], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /SLC_CLARIFICATION: /);
  fs.writeFileSync(
    path.join(root, 'cli-evidence.json'),
    JSON.stringify(
      {
        scope: 'CLI-process-with-fixture-transport',
        status: 'passed',
        actualExitCode: result.status,
        stdoutBytes: Buffer.byteLength(result.stdout),
        stderrHasStructuredReport: true,
      },
      null,
      2,
    ) + '\n',
  );
});
test('rejects irrelevant scope and oracle inputs before creating provider work', async () => {
  await assert.rejects(
    recordPhase({ ...options, phase: 'fixture.link' }),
    /non-link/,
  );
  await assert.rejects(
    recordPhase({ ...options, oracle: { outcome: 'success' } }),
    /oracle/,
  );
  await assert.rejects(
    recordPhase({ ...options, sourceSha256: 'bad' }),
    /identity/,
  );
});

test('gears2fsm uses the real strict producer gate before phase acceptance', async () => {
  const gears = path.join(root, 'opaque-gears.gears.md');
  fs.writeFileSync(gears, faithful);
  const seen = [];
  const run = await recordPhase(
    { ...options, source: gears, phase: 'fixture.gears2fsm' },
    {
      runtime,
      history,
      env: {},
      adapterFactory: () => adapter('bad-fsm', seen),
    },
  );
  assert.equal(run.summary.status, 'failure');
  assert.equal(run.summary.source.path.endsWith('/workflow.gears.md'), true);
  assert.equal(run.summary.phases.length, 1);
  assert.equal(run.summary.phases[0].name, 'gears2fsm');
  assert.equal(run.summary.calls.length, 3);
  assert.match(fs.readFileSync(run.summary.logs.diagnostics, 'utf8'), /TS2322/);
  assert.equal(run.summary.api.clarification, undefined);
});

test('selected-case projection cannot expose oracle or family metadata', async () => {
  const manifestPath = path.join(root, 'authoring.json'),
    bytes = fs.readFileSync(source);
  const { createHash } = await import('node:crypto');
  const manifest = {
    cases: [
      {
        id: 'case-001',
        sourcePath: source,
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        sourceBytes: bytes.length,
        phase: 'fixture.text2gears',
        family: 'PRIVATE FAMILY',
        member: 'mutant',
        expected: { oracle: 'NEVER EXPOSE ORACLE' },
        unexpectedPrompt: 'OVERRIDE INSTRUCTION',
      },
    ],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const chosen = selectCase(manifestPath, 'case-001');
  assert.deepEqual(
    Object.keys(chosen).sort(),
    ['caseId', 'phase', 'source', 'sourceBytes', 'sourceSha256'].sort(),
  );
  const seen = [];
  const result = await recordPhase(
    { ...options, ...chosen },
    {
      runtime,
      history,
      env: {},
      adapterFactory: () => adapter('success', seen),
    },
  );
  assert.equal(result.summary.status, 'success');
  assert.ok(
    seen.every(
      (call) =>
        !call.prompt.includes('NEVER EXPOSE ORACLE') &&
        !call.prompt.includes('PRIVATE FAMILY') &&
        !call.prompt.includes('OVERRIDE INSTRUCTION') &&
        !call.prompt.includes('case-001'),
    ),
  );
  assert.ok(!JSON.stringify(result.summary).includes('NEVER EXPOSE ORACLE'));
  assert.ok(
    !fs.existsSync(path.join(result.evidence, 'work', 'authoring.json')),
  );
  await assert.rejects(
    recordPhase({ ...options, ...chosen, sourceBytes: bytes.length + 1 }),
    /byte count/,
  );
  assert.throws(() => selectCase(manifestPath, 'absent'), /exactly once/);
});

test('clears inherited cohort settings and explicitly disables fast mode and review', async () => {
  const configured = path.join(root, 'selection.yaml');
  fs.writeFileSync(
    configured,
    'agent: claude-code\neffort: low\nfastMode: true\nreviewerAgent: codex\nreviewerModel: reviewer-fixture\n',
  );
  const seen = [];
  const run = await recordPhase(
    { ...options, config: configured },
    {
      runtime,
      history,
      env: {
        SLC_AGENT: 'unsupported-inherited',
        SLC_EFFORT: 'unsupported-inherited',
        SLC_FAST_MODE: 'true',
        SLC_REVIEWER_AGENT: 'unsupported-inherited',
        SLC_PIPELINE_PATH: '/missing-inherited',
      },
      adapterFactory: () => adapter('success', seen),
    },
  );
  assert.equal(run.summary.status, 'success');
  assert.equal(run.summary.selection.agent, 'claude-code');
  assert.equal(run.summary.selection.effort, 'low');
  assert.equal(run.summary.selection.fastMode, false);
  assert.equal(run.summary.selection.reviewer, undefined);
  assert.equal(run.summary.reviewerDisabled, true);
  assert.equal(run.summary.fastModeRequested, false);
  assert.equal(seen.length, 1);
  assert.equal(run.summary.fixtureInjection, true);
});

test('records preservation and history after configuration throws', async () => {
  const badConfig = path.join(root, 'bad.yaml');
  fs.writeFileSync(badConfig, 'agent: unsupported-fixture\n');
  const withoutAgent = { ...options };
  delete withoutAgent.agent;
  const run = await recordPhase(
    { ...withoutAgent, config: badConfig },
    { runtime, history, env: {} },
  );
  assert.equal(run.summary.status, 'failure');
  assert.equal(run.summary.preservation.sourceUnchanged, true);
  assert.equal(run.summary.preservation.cohortUnchanged, true);
  assert.equal(run.summary.history.published, false);
  assert.equal(run.summary.calls.length, 0);
  assert.equal(run.summary.comparison.eligible, false);
  assert.ok(
    run.summary.comparison.reasons.includes(
      'pipeline-input-closure-incomplete',
    ),
  );
});

test('portable manifest arguments select relative source bytes and CLI help keeps stdout empty', () => {
  const bytes = fs.readFileSync(source);
  const manifestPath = path.join(root, 'portable.json');
  const manifest = {
    cases: [
      {
        id: 'case-001',
        sourcePath: path.basename(source),
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        sourceBytes: bytes.length,
        phase: options.phase,
        expected: { answer: 'PRIVATE ORACLE' },
      },
    ],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const parsed = parsePhaseArguments([
    '--manifest',
    manifestPath,
    '--case',
    'case-001',
    '--config',
    config,
    '--model',
    'fixture-model',
  ]);
  assert.equal(parsed.source, source);
  assert.equal(parsed.phase, options.phase);
  assert.equal(parsed.expected, undefined);
  assert.equal(parsed.manifest, undefined);
  assert.throws(
    () =>
      parsePhaseArguments([
        '--manifest',
        manifestPath,
        '--case',
        'case-001',
        '--phase',
        options.phase,
      ]),
    /cannot override/,
  );
  assert.throws(() => parsePhaseArguments(['--phase']), /needs a value/);
  assert.throws(
    () => parsePhaseArguments(['--runtime-check', 'minimal']),
    /unknown argument/,
  );
  const help = spawnSync(
    process.execPath,
    [path.join(compilerRoot, 'scripts/phase-probe.mjs'), '--help'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(help.status, 0, help.stderr);
  assert.equal(help.stdout, '');
  assert.match(help.stderr, /Usage: node scripts\/phase-probe/);
});

test('successful phase with unavailable closure discovery is explicitly ineligible', async () => {
  const unavailable = path.join(root, 'unavailable-compiler');
  fs.mkdirSync(unavailable);
  fs.writeFileSync(
    path.join(unavailable, 'package.json'),
    '{"name":"fixture-slc","version":"0.0.0"}\n',
  );
  fs.mkdirSync(path.join(unavailable, 'node_modules'));
  const seen = [];
  const run = await recordPhase(
    { ...options, compilerRoot: unavailable },
    {
      runtime,
      history,
      env: {},
      adapterFactory: () => adapter('success', seen),
    },
  );
  assert.equal(run.summary.status, 'success');
  assert.equal(run.summary.api.ok, true);
  assert.equal(run.summary.phaseAcceptance.ok, false);
  assert.equal(run.summary.comparison.eligible, false);
  assert.ok(
    run.summary.comparison.reasons.includes(
      'pipeline-input-closure-incomplete',
    ),
  );
  assert.ok(
    run.summary.comparison.reasons.includes(
      'compiled-runtime-identity-unavailable',
    ),
  );
  assert.equal(run.summary.preservation.sourceUnchanged, true);
  assert.ok(
    run.summary.comparison.reasons.includes(
      'required-dependency-entry-unavailable',
    ),
  );
  assert.ok(
    run.summary.dependencies.required.missing.includes(
      '@anthropic-ai/claude-agent-sdk',
    ),
  );
  assert.ok(
    !run.summary.dependencies.required.missing.includes('@openai/codex-sdk'),
  );
});
