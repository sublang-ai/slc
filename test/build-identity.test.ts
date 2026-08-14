// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import {
  RUNTIME_ABI,
  SUPPORTED_ARTIFACT_SCHEMAS,
} from '@sublang/playbook/xstate-runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBuildIdentityProvider } from '../src/build-identity.js';
import type {
  CompiledSelection,
  FullBuildTopology,
} from '../src/build-plan.js';

describe('production build identity (INCR-7)', () => {
  let root: string;
  let runtimeRoot: string;
  let slcPackagePath: string;
  let cligentPackagePath: string;
  let cligentDependency: string;
  let cligentPeer: string;
  let typescriptPackagePath: string;
  let typescriptRuntime: string;
  let agentPackagePath: string;
  let nodeExecutablePath: string;
  let pipelineDir: string;
  let linkTarget: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-build-identity-'));
    runtimeRoot = join(root, 'runtime');
    const packages = join(root, 'packages');
    const slcRoot = join(packages, 'slc');
    const cligentRoot = join(packages, 'cligent');
    const typescriptRoot = join(packages, 'typescript');
    const agentRoot = join(packages, 'agent-runtime');
    pipelineDir = join(root, 'project', 'fixture');
    linkTarget = join(root, 'project', 'runtime.ts');
    slcPackagePath = join(slcRoot, 'package.json');
    cligentPackagePath = join(cligentRoot, 'package.json');
    typescriptPackagePath = join(typescriptRoot, 'package.json');
    agentPackagePath = join(agentRoot, 'package.json');
    nodeExecutablePath = join(root, 'bin', 'node-fixture');
    cligentDependency = join(
      cligentRoot,
      'node_modules',
      'fixture-dependency',
      'index.js',
    );
    cligentPeer = join(packages, 'node_modules', 'fixture-peer', 'index.js');
    typescriptRuntime = join(typescriptRoot, 'index.js');

    await Promise.all([
      mkdir(runtimeRoot, { recursive: true }),
      mkdir(slcRoot, { recursive: true }),
      mkdir(join(cligentRoot, 'node_modules', 'fixture-dependency'), {
        recursive: true,
      }),
      mkdir(join(packages, 'node_modules', 'fixture-peer'), {
        recursive: true,
      }),
      mkdir(typescriptRoot, { recursive: true }),
      mkdir(agentRoot, { recursive: true }),
      mkdir(join(root, 'bin'), { recursive: true }),
      mkdir(pipelineDir, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(runtimeRoot, 'runner.js'), 'export const host = 1;\n'),
      writeManifest(slcPackagePath, '@sublang/slc', '0.3.0'),
      writeManifest(
        cligentPackagePath,
        '@sublang/cligent',
        '0.18.0',
        {
          'fixture-dependency': '1.0.0',
        },
        {
          peerDependencies: { 'fixture-peer': '1.0.0' },
        },
      ),
      writeManifest(
        join(cligentRoot, 'node_modules', 'fixture-dependency', 'package.json'),
        'fixture-dependency',
        '1.0.0',
      ),
      writeFile(cligentDependency, 'export const dependency = 1;\n'),
      writeManifest(
        join(packages, 'node_modules', 'fixture-peer', 'package.json'),
        'fixture-peer',
        '1.0.0',
      ),
      writeFile(cligentPeer, 'export const peer = 1;\n'),
      writeManifest(typescriptPackagePath, 'typescript', '6.0.3'),
      writeFile(typescriptRuntime, 'export const compiler = 1;\n'),
      writeManifest(agentPackagePath, '@fixture/agent-runtime', '1.0.0'),
      writeFile(join(agentRoot, 'index.js'), 'export const transport = 1;\n'),
      writeFile(nodeExecutablePath, 'fixture node runtime 1\n'),
      writeFile(linkTarget, 'export const runtime = 1;\n'),
    ]);
    await chmod(nodeExecutablePath, 0o755);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const provider = (model = 'fixture-model') =>
    createBuildIdentityProvider({
      selection: { agent: 'codex', model, effort: 'high' },
      stallTimeoutMs: 60_000,
      layout: {
        runtimeRoot,
        slcPackagePath,
        cligentPackagePath,
        typescriptPackagePath,
        agentRuntimePackagePath: agentPackagePath,
        nodeExecutablePath,
      },
    });

  it('binds exact implementation/config bytes and the execution profile once', async () => {
    const first = await provider()(topology('full'));
    expect(first).not.toHaveProperty('deterministic');
    expect(first.interpretedExecutor.kind).toBe('value');
    expect(first.compiledExecutor.kind).toBe('value');
    if (
      first.interpretedExecutor.kind !== 'value' ||
      first.compiledExecutor.kind !== 'value'
    ) {
      throw new Error('fixture identities are not value-backed');
    }
    expect(JSON.parse(first.interpretedExecutor.value)).toMatchObject({
      schema: 'sublang.slc.host-executor.v1',
      kind: 'interpreted',
      configuration: {
        agent: 'codex',
        model: 'fixture-model',
        effort: 'high',
        permissions: { mode: 'auto' },
        maxTurns: null,
        stallTimeoutMs: 60_000,
      },
    });
    expect(JSON.parse(first.compiledExecutor.value)).toMatchObject({
      kind: 'compiled',
      implementation: {
        node: {
          identity: expect.stringMatching(/^sha256:/),
          platform: process.platform,
          arch: process.arch,
        },
        agentCli: null,
        typescript: expect.stringMatching(/^sha256:/),
      },
    });
    expect(
      first.compiledProfile({
        record: { linkTarget: { provenance: '@sublang/playbook@4.0.0' } },
      } as CompiledSelection),
    ).toBe('composed-v2');

    const otherModel = await provider('other-model')(topology('full'));
    expect(otherModel.interpretedExecutor).not.toEqual(
      first.interpretedExecutor,
    );

    await writeFile(join(runtimeRoot, 'runner.js'), 'export const host = 2;\n');
    const changedHost = await provider()(topology('full'));
    expect(changedHost.interpretedExecutor).not.toEqual(
      first.interpretedExecutor,
    );
    expect(changedHost.compiledExecutor).not.toEqual(first.compiledExecutor);

    await writeFile(nodeExecutablePath, 'fixture node runtime 2\n');
    const changedNode = await provider()(topology('full'));
    expect(changedNode.interpretedExecutor).not.toEqual(
      changedHost.interpretedExecutor,
    );
    expect(changedNode.compiledExecutor).not.toEqual(
      changedHost.compiledExecutor,
    );

    await writeFile(typescriptRuntime, 'export const compiler = 2;\n');
    const changedCompiler = await provider()(topology('full'));
    expect(changedCompiler.interpretedExecutor).toEqual(
      changedNode.interpretedExecutor,
    );
    expect(changedCompiler.compiledExecutor).not.toEqual(
      changedNode.compiledExecutor,
    );

    await writeFile(cligentDependency, 'export const dependency = 2;\n');
    const changedTransport = await provider()(topology('full'));
    expect(changedTransport.interpretedExecutor).not.toEqual(
      changedCompiler.interpretedExecutor,
    );
    expect(changedTransport.compiledExecutor).not.toEqual(
      changedCompiler.compiledExecutor,
    );

    await writeFile(cligentPeer, 'export const peer = 2;\n');
    const changedPeer = await provider()(topology('full'));
    expect(changedPeer.interpretedExecutor).not.toEqual(
      changedTransport.interpretedExecutor,
    );
    expect(changedPeer.compiledExecutor).not.toEqual(
      changedTransport.compiledExecutor,
    );
  });

  it('requires peers unless valid metadata marks them optional', async () => {
    await writeManifest(
      agentPackagePath,
      '@fixture/agent-runtime',
      '1.0.0',
      undefined,
      {
        peerDependencies: { 'missing-optional-peer': '1.0.0' },
        peerDependenciesMeta: {
          'missing-optional-peer': { optional: true },
        },
      },
    );
    await expect(provider()(topology('full'))).resolves.toBeDefined();

    await writeManifest(
      agentPackagePath,
      '@fixture/agent-runtime',
      '1.0.0',
      undefined,
      { peerDependencies: { 'missing-required-peer': '1.0.0' } },
    );
    await expect(provider()(topology('full'))).rejects.toThrow(
      /host runtime dependency is missing: .*missing-required-peer/,
    );

    await writeManifest(
      agentPackagePath,
      '@fixture/agent-runtime',
      '1.0.0',
      undefined,
      {
        peerDependencies: { 'missing-optional-peer': '1.0.0' },
        peerDependenciesMeta: {
          'missing-optional-peer': { optional: 'yes' },
        },
      },
    );
    await expect(provider()(topology('full'))).rejects.toThrow(
      /peerDependenciesMeta\.missing-optional-peer is malformed/,
    );
  });

  it.each([
    ['gemini', 'gemini', '@google/gemini-cli'],
    ['opencode', 'opencode', 'opencode-ai'],
  ] as const)(
    'binds the exact %s CLI package selected for execution',
    async (agent, command, packageName) => {
      const cliRoot = join(root, 'cli', agent);
      const executable = join(cliRoot, 'bin', `${command}-fixture`);
      await mkdir(join(cliRoot, 'bin'), { recursive: true });
      await Promise.all([
        writeManifest(join(cliRoot, 'package.json'), packageName, '1.0.0'),
        writeFile(executable, 'fixture CLI runtime 1\n'),
      ]);
      await chmod(executable, 0o755);
      const cliProvider = createBuildIdentityProvider({
        selection: { agent, model: 'fixture-model', effort: 'high' },
        stallTimeoutMs: 60_000,
        layout: {
          runtimeRoot,
          slcPackagePath,
          cligentPackagePath,
          typescriptPackagePath,
          agentRuntimePackagePath: agent === 'gemini' ? null : agentPackagePath,
          agentCliPath: executable,
          nodeExecutablePath,
        },
      });

      const first = await cliProvider(topology('full'));
      if (first.interpretedExecutor.kind !== 'value') {
        throw new Error('fixture identity is not value-backed');
      }
      expect(JSON.parse(first.interpretedExecutor.value)).toMatchObject({
        implementation: {
          agentCli: {
            command,
            package: packageName,
            kind: 'package-tree',
            identity: expect.stringMatching(/^sha256:/),
          },
        },
      });

      await writeFile(executable, 'fixture CLI runtime 2\n');
      const changed = await cliProvider(topology('full'));
      expect(changed.interpretedExecutor).not.toEqual(
        first.interpretedExecutor,
      );
      expect(changed.compiledExecutor).not.toEqual(first.compiledExecutor);
    },
  );

  it('records defined local package fallbacks and Playbook compatibility gates', async () => {
    const local = await provider()(topology('full-link'));
    expect(local.packages).toEqual([
      { role: 'slc', name: '@sublang/slc', version: '0.3.0' },
      { role: 'pipeline', name: 'fixture', version: null },
      { role: 'link-runtime', name: 'fixture', version: null },
    ]);
    expect(local.compatibility).toEqual([]);

    const playbookRoot = join(root, 'packages', 'playbook');
    const playbookPipeline = join(playbookRoot, 'slc');
    const playbookRuntime = join(playbookRoot, 'src', 'runtime.ts');
    await Promise.all([
      mkdir(playbookPipeline, { recursive: true }),
      mkdir(join(playbookRoot, 'src'), { recursive: true }),
    ]);
    await Promise.all([
      writeManifest(
        join(playbookRoot, 'package.json'),
        '@sublang/playbook',
        '4.0.0',
      ),
      writeFile(playbookRuntime, 'export const runtime = 1;\n'),
    ]);
    const playbook = await provider()(
      topology('full-link', 'playbook', playbookPipeline, playbookRuntime),
    );
    expect(playbook.packages).toEqual([
      { role: 'slc', name: '@sublang/slc', version: '0.3.0' },
      {
        role: 'pipeline',
        name: '@sublang/playbook',
        version: '4.0.0',
      },
      {
        role: 'link-runtime',
        name: '@sublang/playbook',
        version: '4.0.0',
      },
    ]);
    expect(playbook.compatibility).toEqual([
      {
        name: 'playbook-artifact-schema',
        value: String(Math.max(...SUPPORTED_ARTIFACT_SCHEMAS)),
        currentness: 'gate',
      },
      {
        name: 'playbook-runtime-abi',
        value: String(RUNTIME_ABI),
        currentness: 'gate',
      },
    ]);
  });

  it('discovers import-only production packages without package.json exports', async () => {
    const production = createBuildIdentityProvider({
      selection: { agent: 'codex' },
      stallTimeoutMs: 600_000,
    });
    const identified = await production(topology('full'));
    expect(identified.interpretedExecutor).toMatchObject({
      kind: 'value',
      value: expect.stringContaining('sublang.slc.host-executor.v1'),
    });
    expect(identified.packages[0]).toMatchObject({
      role: 'slc',
      name: '@sublang/slc',
    });
  }, 20_000);

  function topology(
    kind: 'full' | 'full-link',
    pipelineName = 'fixture',
    resolvedPipelineDir = pipelineDir,
    runtime = linkTarget,
  ): FullBuildTopology {
    const artifactDir = join(root, 'work', `workflow.${pipelineName}`);
    return {
      pipeline: {
        dir: resolvedPipelineDir,
        phases: [],
        passes: [],
        linkFile:
          kind === 'full-link' ? join(resolvedPipelineDir, 'link.md') : null,
      },
      pipelineName,
      artifactDir,
      basename: 'workflow',
      sourcePath: join(root, 'work', 'workflow.txt'),
      invocation: {
        kind,
        normalize: false,
        optimize: true,
        link:
          kind === 'full-link'
            ? {
                target: relative(artifactDir, runtime).split(sep).join('/'),
                options: [],
              }
            : null,
      },
      artifacts: [],
      steps:
        kind === 'full-link'
          ? [
              {
                id: 'link:000000',
                kind: 'link',
                name: 'link',
                source: { format: 'fsm', ext: '.ts' },
                target: { format: 'playbook', ext: '.ts' },
                product: 'semantic:link.link',
                pinKey: 'link',
                request: {
                  kind: 'link',
                  definitionPath: join(resolvedPipelineDir, 'link.md'),
                  objects: [],
                  linkTarget: runtime,
                  options: [],
                  linked: join(root, 'work', 'workflow.playbook.ts'),
                },
                targetExt: '.ts',
              },
            ]
          : [],
    };
  }
});

async function writeManifest(
  path: string,
  name: string,
  version: string,
  dependencies?: Record<string, string>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify({ name, version, ...(dependencies === undefined ? {} : { dependencies }), ...extra })}\n`,
  );
}
