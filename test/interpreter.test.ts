// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canonicalJson } from '../src/build-record.js';
import { runPhase, type ExecuteRequest } from '../src/execution.js';
import {
  type AgentClient,
  type AgentRunRequest,
  type AgentRunResult,
  buildPhasePrompt,
  createInterpretedExecutor,
} from '../src/interpreter.js';
import {
  createWorkspaceRecord,
  encodeWorkspaceContract,
  type WorkspaceReadBinding,
  type WorkspaceRecord,
} from '../src/workspace.js';

const compileRequest = (
  overrides: Partial<Extract<ExecuteRequest, { kind: 'compile' }>> = {},
) =>
  ({
    kind: 'compile',
    definitionPath: '/defs/text2gears.md',
    source: '/src/onboarding.md',
    target: '/out/onboarding.gears.md',
    ...overrides,
  }) satisfies ExecuteRequest;

const IDENTITY = `sha256:${'0'.repeat(64)}` as WorkspaceReadBinding['identity'];

const promptWorkspace = (
  request: ExecuteRequest,
  semanticInputs: readonly string[] = [],
): WorkspaceRecord => {
  const read = (role: string, logicalPath: string): WorkspaceReadBinding => ({
    role,
    logicalPath,
    physicalPath: logicalPath,
    kind: 'file',
    identity: IDENTITY,
  });
  const reads = [read('definition', request.definitionPath)];
  if (request.kind === 'compile') {
    reads.push(read('source', request.source));
    for (const [index, path] of (request.references ?? []).entries()) {
      reads.push(read(`reference:${index}`, path));
    }
  } else {
    for (const [index, path] of request.objects.entries()) {
      reads.push(read(`object:${index}`, path));
    }
    reads.push(read('link-target', request.linkTarget));
  }
  for (const [index, path] of semanticInputs.entries()) {
    reads.push(read(`semantic-input:${index}`, path));
  }
  const logicalWrite =
    request.kind === 'compile' ? request.target : request.linked;
  return {
    schema: 'sublang.slc.workspace.v1',
    reads,
    write: {
      role: request.kind === 'compile' ? 'target' : 'linked',
      logicalPath: logicalWrite,
      physicalPath: logicalWrite,
      kind: 'file',
    },
  };
};

describe('buildPhasePrompt (PHEXEC-11, PHEXEC-14, PHEXEC-15)', () => {
  it('embeds the definition, the target, and the agent contract for a compile phase', () => {
    const request = compileRequest({
      references: ['/defs/entry.md'],
    });
    const workspace = promptWorkspace(request, ['/defs/grammar.md']);
    const prompt = buildPhasePrompt({
      request,
      definition: '## Formats\n\nTransform text to gears.',
      workspace,
    });
    expect(prompt).toContain('Transform text to gears.');
    expect(prompt).toContain('authoritative');
    expect(prompt).toContain('logical path above as a semantic identifier');
    expect(prompt).toContain('sole filesystem authority');
    expect(prompt).toContain('host-bound physical sink');
    expect(prompt).toContain('not commit');
    expect(prompt).toContain('source to read: /src/onboarding.md');
    expect(prompt).toContain(
      'reference to consult (read-only): /defs/entry.md',
    );
    expect(prompt).toContain(
      'declared semantic input to read: /defs/grammar.md',
    );
    expect(prompt).toContain('drop nothing');
    expect(prompt).toContain('preserve verbatim');
    expect(prompt).toContain('verify the complete produced artifact');
    expect(prompt).toContain('any diagnostics');
    expect(prompt).toContain('BLOCKED:');
    expect(prompt.endsWith(encodeWorkspaceContract(workspace))).toBe(true);
  });

  it('lists ordered objects, the link target, and options for a link phase', () => {
    const request: ExecuteRequest = {
      kind: 'link',
      definitionPath: '/defs/link.md',
      objects: ['/o/main.fsm.ts', '/o/helper.fsm.ts'],
      linkTarget: '/o/runner.ts',
      options: [{ name: 'seed', value: '42' }],
      linked: '/o/app.run.ts',
    };
    const workspace = promptWorkspace(request, ['/defs/runtime-contract.md']);
    const prompt = buildPhasePrompt({
      request,
      definition: '## Link Targets',
      workspace,
    });
    expect(prompt).toContain('/o/main.fsm.ts, /o/helper.fsm.ts');
    expect(prompt).toContain('link target module: /o/runner.ts');
    expect(prompt).toContain('options: seed=42');
    expect(prompt).toContain('artifact to produce: /o/app.run.ts');
    expect(prompt).toContain(
      'declared semantic input to read: /defs/runtime-contract.md',
    );
    expect(prompt.endsWith(encodeWorkspaceContract(workspace))).toBe(true);
  });
});

describe('createInterpretedExecutor (PHEXEC-12, PHEXEC-13)', () => {
  let dir: string;
  let request: ExecuteRequest;

  const recordingAgent = (
    response: AgentRunResult,
  ): AgentClient & { calls: AgentRunRequest[] } => {
    const calls: AgentRunRequest[] = [];
    return {
      calls,
      run: (req) => {
        calls.push(req);
        return Promise.resolve(response);
      },
    };
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(await realpath(tmpdir()), 'slc-interp-'));
    await writeFile(join(dir, 'text2gears.md'), '## Formats\n\ndo the thing');
    await writeFile(join(dir, 'source.md'), 'source');
    request = compileRequest({
      definitionPath: join(dir, 'text2gears.md'),
      source: join(dir, 'source.md'),
      target: join(dir, 'target.md'),
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('invokes the agent exactly once with the definition in the prompt', async () => {
    const agent = recordingAgent({
      status: 'success',
      text: 'wrote the gears',
    });
    const executor = createInterpretedExecutor({ agent });
    const workspace = await createWorkspaceRecord(request);

    const result = await executor.run(
      request,
      workspace,
      new AbortController().signal,
    );

    expect(agent.calls).toHaveLength(1);
    expect(agent.calls[0].prompt).toContain('do the thing');
    expect(result).toEqual({ status: 'ok', diagnostics: ['wrote the gears'] });
  });

  it('passes the configured model and cwd to the agent (PHEXEC-13)', async () => {
    const agent = recordingAgent({ status: 'success', text: 'ok' });
    const executor = createInterpretedExecutor({
      agent,
      config: { model: 'some-model', cwd: '/work' },
    });
    const workspace = await createWorkspaceRecord(request);

    await executor.run(request, workspace, new AbortController().signal);

    expect(agent.calls[0]).toMatchObject({ model: 'some-model', cwd: '/work' });
  });

  // Adjacent scopes must cover the whole byte length, and each input scope
  // needs exactly one ordered dependency entry.
  const trace = {
    schema: 'sublang.slc.update.v1',
    input: {
      hash: `sha256:${'a'.repeat(64)}`,
      byteLength: 8,
      scopes: [
        { scope: 'in', start: 0, end: 8, classification: 'local' as const },
      ],
    },
    target: {
      hash: `sha256:${'b'.repeat(64)}`,
      byteLength: 9,
      scopes: [
        { scope: 'out', start: 0, end: 9, classification: 'local' as const },
      ],
    },
    dependencies: [{ input: 'in', targets: ['out'] }],
  };
  const envelope = (payload: string): string =>
    ['SLC_RESULT_BEGIN', payload, 'SLC_RESULT_END'].join('\n');
  const validPayload = canonicalJson({
    schema: 'sublang.slc.interpreted-result.v1',
    metadata: { 'sublang.slc.update.v1': trace },
  });

  const decode = async (text: string) => {
    const agent = recordingAgent({ status: 'success', text });
    return createInterpretedExecutor({ agent }).run(
      request,
      await createWorkspaceRecord(request),
      new AbortController().signal,
    );
  };

  it('extracts a valid reserved suffix and strips it from diagnostics (PHEXEC-39)', async () => {
    const result = await decode(`wrote the gears\n${envelope(validPayload)}`);

    expect(result.status).toBe('ok');
    expect(result.metadata).toEqual({ 'sublang.slc.update.v1': trace });
    // Neither the markers nor the payload reach diagnostics.
    expect(result.diagnostics).toEqual(['wrote the gears']);
    expect(result.diagnostics.join('\n')).not.toContain('SLC_RESULT');
  });

  it('accepts a CRLF-delimited reserved suffix', async () => {
    const result = await decode(
      `wrote the gears\r\n${envelope(validPayload).replace(/\n/g, '\r\n')}`,
    );
    expect(result.metadata).toEqual({ 'sublang.slc.update.v1': trace });
  });

  it.each([
    { name: 'unterminated', text: `done\nSLC_RESULT_BEGIN\n${validPayload}` },
    {
      name: 'duplicated',
      text: `done\n${envelope(validPayload)}\n${envelope(validPayload)}`,
    },
    {
      name: 'misplaced',
      text: `${envelope(validPayload)}\ntrailing prose`,
    },
    {
      name: 'malformed JSON',
      text: `done\n${envelope('{not json')}`,
    },
    {
      name: 'noncanonical line',
      text: `done\n${envelope(`{"metadata":{},"schema":"sublang.slc.interpreted-result.v1"}`)}`,
    },
    {
      name: 'unknown envelope field',
      text: `done\n${envelope(`${validPayload.slice(0, -1)},"extra":1}`)}`,
    },
  ])(
    'preserves ordinary success with no metadata for a $name envelope (PHEXEC-40)',
    async ({ text }) => {
      const result = await decode(text);

      expect(result.status).toBe('ok');
      expect(result.metadata).toBeUndefined();
      // Exactly one host diagnostic, and no reserved text anywhere.
      expect(
        result.diagnostics.filter((line) => line.includes('reserved result')),
      ).toHaveLength(1);
      expect(result.diagnostics.join('\n')).not.toContain('SLC_RESULT');
      expect(result.diagnostics.join('\n')).not.toContain('sublang.slc.update');
    },
  );

  it('keeps a blocked reply blocked when it carries a reserved suffix', async () => {
    const result = await decode(
      `BLOCKED: the source has no headings\n${envelope(validPayload)}`,
    );

    // A blocked candidate is discarded whole, so it carries no metadata.
    expect(result.status).toBe('blocked');
    expect(result.metadata).toBeUndefined();
    expect(result.diagnostics).toEqual(['BLOCKED: the source has no headings']);
  });

  it('maps a BLOCKED reply to a blocked result (PHEXEC-7)', async () => {
    const agent = recordingAgent({
      status: 'success',
      text: 'BLOCKED: the source has no headings',
    });
    const workspace = await createWorkspaceRecord(request);
    const result = await createInterpretedExecutor({ agent }).run(
      request,
      workspace,
      new AbortController().signal,
    );
    expect(result).toEqual({
      status: 'blocked',
      diagnostics: ['BLOCKED: the source has no headings'],
    });
  });

  it('maps an error agent status to an error result', async () => {
    const agent = recordingAgent({ status: 'error', text: '' });
    const workspace = await createWorkspaceRecord(request);
    const result = await createInterpretedExecutor({ agent }).run(
      request,
      workspace,
      new AbortController().signal,
    );
    expect(result.status).toBe('error');
  });

  it('refuses an update-bearing request without calling the agent (INCR-39)', async () => {
    // The factory is exported, so a caller can drive this executor without
    // the phase boundary. Rendering the update prompt is the withheld
    // behavior, so the refusal must precede the agent call entirely.
    let called = false;
    const agent = {
      run: async () => {
        called = true;
        return { status: 'success' as const, text: 'done' };
      },
    };
    const workspace = await createWorkspaceRecord(request);
    const result = await createInterpretedExecutor({ agent }).run(
      { ...request, update: {} } as unknown as ExecuteRequest,
      workspace,
      new AbortController().signal,
    );

    expect(result.status).toBe('error');
    expect(result.diagnostics.join('\n')).toMatch(/withheld from this release/);
    expect(called).toBe(false);
  });

  it('keeps the reserved envelope out of a failed run’s diagnostics (PHEXEC-39)', async () => {
    // An aborted or errored turn can already carry the reserved suffix. The
    // status branch used to report the raw text, publishing the markers and
    // the whole trace payload as user-facing diagnostics.
    const agent = recordingAgent({
      status: 'incomplete',
      text: [
        'partial work',
        'SLC_RESULT_BEGIN',
        '{"schema":"sublang.slc.interpreted-result.v1","metadata":{"sublang.slc.update.v1":{"secret":"payload"}}}',
        'SLC_RESULT_END',
      ].join('\n'),
    });
    const workspace = await createWorkspaceRecord(request);
    const result = await createInterpretedExecutor({ agent }).run(
      request,
      workspace,
      new AbortController().signal,
    );

    expect(result.status).toBe('error');
    const joined = result.diagnostics.join('\n');
    expect(joined).toContain('partial work');
    expect(joined).not.toContain('SLC_RESULT_BEGIN');
    expect(joined).not.toContain('SLC_RESULT_END');
    expect(joined).not.toContain('secret');
  });

  it('maps an unfinished agent run to an error result', async () => {
    const agent = recordingAgent({ status: 'incomplete', text: '' });
    const workspace = await createWorkspaceRecord(request);
    const result = await createInterpretedExecutor({ agent }).run(
      request,
      workspace,
      new AbortController().signal,
    );
    expect(result).toEqual({
      status: 'error',
      diagnostics: ['agent did not finish'],
    });
  });

  it('reads the physical definition and appends one exact final binding while retaining logical locators', async () => {
    const logicalDefinition = join(dir, 'logical-definition.md');
    const physicalDefinition = join(dir, 'staged-definition.md');
    const logicalSource = join(dir, 'logical-source.md');
    const physicalSource = join(dir, 'staged-source.md');
    const logicalTarget = join(dir, 'logical-target.md');
    const physicalTarget = join(dir, 'staged-target.md');
    await writeFile(physicalDefinition, 'PHYSICAL DEFINITION');
    await writeFile(physicalSource, 'staged source');
    const stagedRequest: ExecuteRequest = {
      kind: 'compile',
      definitionPath: logicalDefinition,
      source: logicalSource,
      target: logicalTarget,
    };
    const workspace = await createWorkspaceRecord(stagedRequest, {
      physicalReads: {
        definition: physicalDefinition,
        source: physicalSource,
      },
      physicalWrite: physicalTarget,
    });
    const agent: AgentClient & { calls: AgentRunRequest[] } = {
      calls: [],
      async run(call) {
        this.calls.push(call);
        await writeFile(workspace.write.physicalPath, 'candidate');
        return { status: 'success', text: 'done' };
      },
    };

    const result = await createInterpretedExecutor({ agent }).run(
      stagedRequest,
      workspace,
      new AbortController().signal,
    );

    expect(result.status).toBe('ok');
    expect(await readFile(physicalTarget, 'utf8')).toBe('candidate');
    const prompt = agent.calls[0].prompt;
    expect(prompt).toContain('PHYSICAL DEFINITION');
    const [body] = prompt.split('\n\nSLC_WORKSPACE_BEGIN\n');
    expect(body).toContain(logicalDefinition);
    expect(body).toContain(logicalSource);
    expect(body).toContain(logicalTarget);
    expect(body).not.toContain(physicalDefinition);
    expect(body).not.toContain(physicalSource);
    expect(body).not.toContain(physicalTarget);
    expect(prompt.endsWith(encodeWorkspaceContract(workspace))).toBe(true);
    expect(prompt.match(/SLC_WORKSPACE_BEGIN/g)).toHaveLength(1);
    expect(prompt.match(/SLC_WORKSPACE_END/g)).toHaveLength(1);
  });

  it('carries alternate link reads and sink only in the exact final binding', async () => {
    const logicalDefinition = join(dir, 'logical-link.md');
    const logicalObject = join(dir, 'logical-object.ts');
    const logicalRuntime = join(dir, 'logical-runtime.ts');
    const logicalLinked = join(dir, 'logical-linked.ts');
    const physicalDefinition = join(dir, 'staged-link.md');
    const physicalObject = join(dir, 'staged-object.ts');
    const physicalRuntime = join(dir, 'staged-runtime.ts');
    const physicalLinked = join(dir, 'staged-linked.ts');
    await writeFile(physicalDefinition, 'PHYSICAL LINK DEFINITION');
    await writeFile(physicalObject, 'export const machine = {};');
    await writeFile(physicalRuntime, 'export const runtime = {};');
    const linkRequest: ExecuteRequest = {
      kind: 'link',
      definitionPath: logicalDefinition,
      objects: [logicalObject],
      linkTarget: logicalRuntime,
      options: [],
      linked: logicalLinked,
    };
    const workspace = await createWorkspaceRecord(linkRequest, {
      physicalReads: {
        definition: physicalDefinition,
        'object:0': physicalObject,
        'link-target': physicalRuntime,
      },
      physicalWrite: physicalLinked,
    });
    const agent: AgentClient & { calls: AgentRunRequest[] } = {
      calls: [],
      async run(call) {
        this.calls.push(call);
        await writeFile(workspace.write.physicalPath, 'linked candidate');
        return { status: 'success', text: 'done' };
      },
    };

    const result = await createInterpretedExecutor({ agent }).run(
      linkRequest,
      workspace,
      new AbortController().signal,
    );

    expect(result.status).toBe('ok');
    expect(await readFile(physicalLinked, 'utf8')).toBe('linked candidate');
    const prompt = agent.calls[0].prompt;
    const [body] = prompt.split('\n\nSLC_WORKSPACE_BEGIN\n');
    expect(body).toContain(logicalDefinition);
    expect(body).toContain(logicalObject);
    expect(body).toContain(logicalRuntime);
    expect(body).toContain(logicalLinked);
    for (const physical of [
      physicalDefinition,
      physicalObject,
      physicalRuntime,
      physicalLinked,
    ]) {
      expect(body).not.toContain(physical);
    }
    expect(prompt.endsWith(encodeWorkspaceContract(workspace))).toBe(true);
  });
});

describe('interpreted executor through the boundary (DR-003 + DR-004)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(await realpath(tmpdir()), 'slc-interp-run-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('passes generic checks when the agent writes the target', async () => {
    await writeFile(join(dir, 'text2gears.md'), '## Formats');
    await writeFile(join(dir, 'onboarding.md'), 'prose');
    const request: ExecuteRequest = {
      kind: 'compile',
      definitionPath: join(dir, 'text2gears.md'),
      source: join(dir, 'onboarding.md'),
      target: join(dir, 'onboarding.gears.md'),
    };

    // Fake agent that "performs the transformation" by writing the target.
    const agent: AgentClient = {
      run: async () => {
        await writeFile(request.target, 'gears output');
        return { status: 'success', text: 'done' };
      },
    };

    const result = await runPhase({
      request,
      phase: 'text2gears',
      targetExt: '.md',
      executor: createInterpretedExecutor({ agent }),
    });

    expect(result.ok).toBe(true);
  });

  it('rejects an interpreted agent that writes both the bound sink and differing logical target', async () => {
    const definition = join(dir, 'text2gears.md');
    const source = join(dir, 'onboarding.md');
    const logicalTarget = join(dir, 'canonical.gears.md');
    const physicalTarget = join(dir, 'candidate.gears.md');
    await writeFile(definition, '## Formats');
    await writeFile(source, 'prose');
    const request: ExecuteRequest = {
      kind: 'compile',
      definitionPath: definition,
      source,
      target: logicalTarget,
    };
    const workspace = await createWorkspaceRecord(request, {
      physicalWrite: physicalTarget,
    });
    const agent: AgentClient = {
      async run() {
        await writeFile(physicalTarget, 'candidate gears');
        await writeFile(logicalTarget, 'out-of-binding gears');
        return { status: 'success', text: 'done' };
      },
    };

    const result = await runPhase({
      request,
      phase: 'text2gears',
      targetExt: '.md',
      executor: createInterpretedExecutor({ agent }),
      workspace,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.report.reasons).toContain(
        `protected path "${logicalTarget}" changed during the run`,
      );
    }
  });
});
