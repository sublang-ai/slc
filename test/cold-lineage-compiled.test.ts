// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BUILD_RECORD_FILE,
  SOURCE_SNAPSHOT_FILE,
  decodeBuildRecord,
} from '../src/build-record.js';
import type {
  BuildIdentityContext,
  CompiledSelection,
  FullBuildTopology,
} from '../src/build-plan.js';
import { createCompiledExecutor } from '../src/compiled-executor.js';
import { runtimeContractForPin } from '../src/config.js';
import type { PhaseExecutor } from '../src/execution.js';
import type { AgentClient } from '../src/interpreter.js';
import { generatePinRecord, writePinFile } from '../src/pin-generate.js';
import type {
  CompatiblePlaybookPorts,
  CompatiblePlaybookRuntimeFactory,
} from '../src/playbook-contract.js';
import { runSlc, type SlcDeps } from '../src/runner.js';
import {
  WORKSPACE_BEGIN,
  WORKSPACE_END,
  type WorkspaceRecord,
} from '../src/workspace.js';

const phaseDoc = (
  source: string,
  sourceExt: string,
  target: string,
  targetExt: string,
  pinInput?: string,
): string =>
  [
    '# Fixture phase',
    '',
    '## Formats',
    '',
    '| Role | Format | Extension |',
    '| --- | --- | --- |',
    `| source | ${source} | ${sourceExt} |`,
    `| target | ${target} | ${targetExt} |`,
    '',
    '## Pin Inputs',
    '',
    ...(pinInput === undefined ? [] : [`- \`${pinInput}\``, '']),
  ].join('\n');

const artifactSource =
  'export default function createPlaybookRuntime() { return {}; }\n';

const structuredState = {
  value: 'done',
  activeStateIds: ['done'],
  tags: [],
  status: 'done' as const,
  quiescent: true,
  stateId: 'done',
};

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

function workspaceFromPrompt(prompt: string): {
  body: string;
  workspace: WorkspaceRecord;
} {
  const marker = `\n${WORKSPACE_BEGIN}\n`;
  const start = prompt.lastIndexOf(marker);
  if (start === -1 || prompt.indexOf(marker) !== start) {
    throw new Error('performing prompt must contain one workspace envelope');
  }
  const lines = prompt.slice(start + 1).split('\n');
  if (
    lines.length !== 3 ||
    lines[0] !== WORKSPACE_BEGIN ||
    lines[2] !== WORKSPACE_END
  ) {
    throw new Error('workspace envelope must be the exact final three lines');
  }
  return {
    body: prompt.slice(0, start),
    workspace: JSON.parse(lines[1]) as WorkspaceRecord,
  };
}

describe('compiled cold lineage (INCR-31, PHEXEC-34)', () => {
  let root: string;
  let workDir: string;
  let pipelineDir: string;
  let sourcePath: string;
  let artifactDir: string;
  let predecessorPath: string;
  let targetPath: string;
  let referencePath: string;
  let artifactPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-cold-compiled-'));
    workDir = join(root, 'work');
    pipelineDir = join(root, 'pipeline');
    sourcePath = join(workDir, 'workflow.md');
    artifactDir = join(workDir, 'workflow.flow');
    predecessorPath = join(artifactDir, 'workflow.mid.md');
    targetPath = join(artifactDir, 'workflow.out.ts');
    referencePath = join(pipelineDir, 'refs', 'reference.md');
    const bundle = join(pipelineDir, 'mid2out.slc');
    artifactPath = join(bundle, 'mid2out.playbook.ts');

    await mkdir(workDir);
    await Promise.all([
      mkdir(bundle, { recursive: true }),
      mkdir(join(pipelineDir, 'refs'), { recursive: true }),
      mkdir(artifactDir),
    ]);
    await Promise.all([
      writeFile(sourcePath, 'source bytes\n'),
      writeFile(referencePath, 'reference bytes\n'),
      writeFile(
        join(pipelineDir, 'text2mid.md'),
        phaseDoc('text', '.md', 'mid', '.md'),
      ),
      writeFile(
        join(pipelineDir, 'mid2out.md'),
        phaseDoc('mid', '.md', 'out', '.ts', 'refs/reference.md'),
      ),
      writeFile(artifactPath, artifactSource),
      writeFile(join(pipelineDir, 'runtime.ts'), 'runtime bytes\n'),
      ...[
        'mid2out.fsm.ts',
        'mid2out.gears.md',
        'mid2out.gears-fsm.test.ts',
        'mid2out.fsm.introspect.test.ts',
        'mid2out.prompt-contract.test.ts',
        'mid2out.fsm.coverage.test.ts',
      ].map((name) => writeFile(join(bundle, name), `${name}\n`)),
    ]);
    const record = await generatePinRecord(pipelineDir, {
      definition: 'mid2out.md',
      artifact: 'mid2out.slc/mid2out.playbook.ts',
      artifactBundle: 'mid2out.slc',
      linkTarget: {
        kind: 'file',
        locator: 'runtime.ts',
        provenance: '@sublang/playbook@4.0.0',
      },
    });
    await writePinFile(pipelineDir, { mid2out: record });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const identity = (topology: FullBuildTopology): BuildIdentityContext => ({
    interpretedExecutor: {
      kind: 'value',
      value: 'sublang.slc.interpreted-executor.v1:compiled-cold-fixture',
    },
    compiledExecutor: {
      kind: 'value',
      value: 'sublang.slc.compiled-host.v1:compiled-cold-fixture',
    },
    compiledProfile: runtimeContractForPin,
    packages: [
      { role: 'slc', name: '@sublang/slc', version: '0.3.0-test' },
      { role: 'pipeline', name: topology.pipelineName, version: null },
    ],
    compatibility: [],
  });

  const interpretedCalls: WorkspaceRecord[] = [];
  const interpreted: PhaseExecutor = {
    async run(request, workspace) {
      interpretedCalls.push(workspace);
      const source = workspace.reads.find((read) => read.role === 'source');
      if (request.kind !== 'compile' || source === undefined) {
        return { status: 'error', diagnostics: ['bad fixture request'] };
      }
      const input = await readFile(source.physicalPath, 'utf8');
      await writeFile(workspace.write.physicalPath, `staged:${input}`);
      return { status: 'ok', diagnostics: [] };
    },
  };

  const successfulDeps = (
    mode: 'player' | 'captain',
    observations: {
      bosses: string[];
      workspaces: WorkspaceRecord[];
      selections: CompiledSelection[];
    },
    violateLogicalTarget = false,
  ): SlcDeps => {
    const performing: AgentClient = {
      async run({ prompt }) {
        const { body, workspace } = workspaceFromPrompt(prompt);
        observations.workspaces.push(workspace);
        expect(body).not.toContain('.workflow.flow.slc-stage-');
        const source = workspace.reads.find((read) => read.role === 'source');
        const semantic = workspace.reads.find(
          (read) => read.role === 'semantic-input:0',
        );
        expect(source?.logicalPath).toBe(predecessorPath);
        expect(source?.physicalPath).not.toBe(predecessorPath);
        expect(source?.physicalPath).toContain('.workflow.flow.slc-stage-');
        expect(await exists(source!.logicalPath)).toBe(false);
        expect(await readFile(source!.physicalPath, 'utf8')).toBe(
          'staged:source bytes\n',
        );
        expect(semantic).toMatchObject({
          logicalPath: referencePath,
          physicalPath: referencePath,
        });
        expect(await readFile(semantic!.physicalPath, 'utf8')).toBe(
          'reference bytes\n',
        );
        expect(workspace.write.logicalPath).toBe(targetPath);
        expect(workspace.write.physicalPath).not.toBe(targetPath);
        expect(workspace.write.physicalPath).toContain(
          '.workflow.flow.slc-stage-',
        );
        await writeFile(
          workspace.write.physicalPath,
          `${mode}:staged:source bytes:reference bytes\n`,
        );
        if (violateLogicalTarget) {
          await writeFile(workspace.write.logicalPath, 'unauthorized\n');
        }
        return { status: 'success', text: 'wrote the bound candidate' };
      },
    };
    const idle: AgentClient = {
      async run() {
        throw new Error('unexpected transport call');
      },
    };
    return {
      resolver: (reference) => (reference === 'flow' ? [pipelineDir] : []),
      executor: interpreted,
      buildIdentity: identity,
      compiled(selection) {
        observations.selections.push(selection);
        let ports: CompatiblePlaybookPorts | undefined;
        const factory = (() => ({
          async init(session: { ports: CompatiblePlaybookPorts }) {
            ports = session.ports;
          },
          async handleBossInput(turn: { text: string; signal: AbortSignal }) {
            observations.bosses.push(turn.text);
            if (mode === 'player') {
              await ports!.callPlayer(
                'writer',
                'Transform the bound source.',
                turn.signal,
                { resume: false },
              );
            } else {
              await ports!.callCaptain(
                'Transform the bound source directly.',
                turn.signal,
                { visibility: 'visible', resume: false },
              );
            }
            return { outcome: 'terminal' as const, state: structuredState };
          },
          async dispose() {},
        })) as CompatiblePlaybookRuntimeFactory;
        return createCompiledExecutor({
          artifactPath: resolve(
            selection.pipelineDir,
            selection.record.artifact.path,
          ),
          runRoot: workDir,
          runtimeContract: runtimeContractForPin(selection),
          player: mode === 'player' ? performing : idle,
          judge: mode === 'captain' ? performing : idle,
          loadFactory: async () => factory,
        });
      },
      cwd: workDir,
    };
  };

  it.each(['player', 'captain'] as const)(
    'promotes a compiled %s candidate while preserving logical authority',
    async (mode) => {
      interpretedCalls.length = 0;
      const observations = {
        bosses: [] as string[],
        workspaces: [] as WorkspaceRecord[],
        selections: [] as CompiledSelection[],
      };

      const result = await runSlc(
        ['flow', sourcePath],
        successfulDeps(mode, observations),
      );

      expect(result.ok, result.diagnostics.join('\n')).toBe(true);
      expect(result.outputs).toEqual([predecessorPath, targetPath]);
      expect(observations.selections).toHaveLength(1);
      expect(observations.selections[0]).toMatchObject({
        phase: 'mid2out',
        pipelineDir,
      });
      expect(observations.bosses).toHaveLength(1);
      expect(observations.bosses[0]).toContain(
        JSON.stringify({
          kind: 'compile',
          source: predecessorPath,
          target: targetPath,
        }),
      );
      expect(observations.bosses[0]).not.toContain('.workflow.flow.slc-stage-');
      expect(observations.bosses[0]).not.toContain(WORKSPACE_BEGIN);
      expect(observations.workspaces).toHaveLength(1);

      expect(interpretedCalls).toHaveLength(1);
      expect(interpretedCalls[0].write.logicalPath).toBe(predecessorPath);
      expect(interpretedCalls[0].write.physicalPath).not.toBe(predecessorPath);
      expect(await readFile(referencePath, 'utf8')).toBe('reference bytes\n');
      expect(await readFile(targetPath, 'utf8')).toBe(
        `${mode}:staged:source bytes:reference bytes\n`,
      );
      expect(await readFile(targetPath, 'utf8')).not.toContain('.slc-stage-');
      expect(await readFile(join(artifactDir, SOURCE_SNAPSHOT_FILE))).toEqual(
        await readFile(sourcePath),
      );
      const record = decodeBuildRecord(
        await readFile(join(artifactDir, BUILD_RECORD_FILE)),
      );
      expect(record.plan.steps.map((step) => step.origin)).toEqual([
        'ordinary',
        'ordinary',
      ]);
      expect(record.products.map((product) => product.path)).toEqual([
        'workflow.mid.md',
        'workflow.out.ts',
      ]);
      expect(
        (await readdir(workDir)).filter((name) =>
          name.startsWith('.workflow.flow.slc-'),
        ),
      ).toEqual([]);
    },
  );

  it('rejects a compiled Player that also writes the canonical logical target', async () => {
    interpretedCalls.length = 0;
    const observations = {
      bosses: [] as string[],
      workspaces: [] as WorkspaceRecord[],
      selections: [] as CompiledSelection[],
    };
    const deps = successfulDeps('player', observations, true);

    const result = await runSlc(['flow', sourcePath], deps);

    expect(result.ok).toBe(false);
    expect(result.outputs).toEqual([]);
    expect(result.diagnostics.join('\n')).toContain(
      `protected path "${targetPath}" changed during the run`,
    );
    expect(await exists(join(artifactDir, BUILD_RECORD_FILE))).toBe(false);
    expect(await exists(join(artifactDir, SOURCE_SNAPSHOT_FILE))).toBe(false);
    expect(await exists(predecessorPath)).toBe(false);
    expect(await readFile(targetPath, 'utf8')).toBe('unauthorized\n');
    expect(
      (await readdir(workDir)).filter((name) =>
        name.startsWith('.workflow.flow.slc-'),
      ),
    ).toEqual([]);
  });
});
