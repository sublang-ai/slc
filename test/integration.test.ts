// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createInterpretedExecutor,
  type AgentClient,
} from '../src/interpreter.js';
import { runSlc, type SlcDeps } from '../src/runner.js';

const formats = (sf: string, se: string, tf: string, te: string): string =>
  `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | ${sf} | ${se} |
| target | ${tf} | ${te} |
`;

const linkDoc = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | fsm | .ts |
| target | run | .ts |

## Link Targets

| Target form | Meaning |
| --- | --- |
| <path>.ts | A runner module. |
`;

/** An agent that writes the prompt's declared target, with optional faults. */
const makeAgent = (
  opts: { block?: boolean; skip?: boolean; mutate?: string; add?: string } = {},
): { agent: AgentClient; calls: string[]; models: (string | undefined)[] } => {
  const calls: string[] = [];
  const models: (string | undefined)[] = [];
  const agent: AgentClient = {
    run: async ({ prompt, model }) => {
      calls.push(prompt);
      models.push(model);
      if (opts.block)
        return { status: 'success', text: 'BLOCKED: the source is malformed' };
      const match = /artifact to write: (.+)/.exec(prompt);
      if (match && !opts.skip) await writeFile(match[1].trim(), 'output\n');
      if (opts.mutate) await writeFile(opts.mutate, 'tampered');
      if (opts.add)
        await writeFile(opts.add, formats('text', '.md', 'foo', '.md'));
      return { status: 'success', text: 'wrote the artifact' };
    },
  };
  return { agent, calls, models };
};

let root: string;
let pipelineDir: string;
let srcDir: string;
let source: string;
let artDir: string;

const deps = (agent: AgentClient, model?: string): SlcDeps => ({
  resolver: (reference) => {
    if (reference === 'flow') return [pipelineDir];
    if (reference === 'broken') return [join(root, 'broken')];
    return [];
  },
  executor: createInterpretedExecutor({
    agent,
    config: model ? { model } : undefined,
  }),
});

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slc-it-'));
  pipelineDir = join(root, 'pipe');
  srcDir = join(root, 'work');
  await mkdir(pipelineDir);
  await mkdir(srcDir);
  await writeFile(
    join(pipelineDir, 'text2gears.md'),
    formats('text', '.md', 'gears', '.md'),
  );
  await writeFile(
    join(pipelineDir, 'gears2fsm.md'),
    formats('gears', '.md', 'fsm', '.ts'),
  );
  await writeFile(join(pipelineDir, 'link.md'), linkDoc);
  source = join(srcDir, 'onboarding.md');
  await writeFile(source, 'prose');
  artDir = join(srcDir, 'onboarding.flow');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('full pipeline run (PIPE-20, PHEXEC-16)', () => {
  it('writes the canonical intermediate and output with one agent call per phase', async () => {
    const { agent, calls } = makeAgent();
    const result = await runSlc(['flow', source], deps(agent));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(await exists(join(artDir, 'onboarding.gears.md'))).toBe(true);
    expect(await exists(join(artDir, 'onboarding.fsm.ts'))).toBe(true);
    expect(result.outputs).toEqual([
      join(artDir, 'onboarding.gears.md'),
      join(artDir, 'onboarding.fsm.ts'),
    ]);
  });

  it('lets -o override the output while keeping intermediates canonical (PIPE-28)', async () => {
    const { agent } = makeAgent();
    const out = join(srcDir, 'custom.fsm.ts');
    const result = await runSlc(['flow', source, '-o', out], deps(agent));

    expect(result.ok).toBe(true);
    expect(await exists(out)).toBe(true);
    expect(await exists(join(artDir, 'onboarding.gears.md'))).toBe(true);
    expect(await exists(join(artDir, 'onboarding.fsm.ts'))).toBe(false);
  });

  it('passes the configured model to every interpreted phase (PHEXEC-21)', async () => {
    const { agent, models } = makeAgent();
    await runSlc(['flow', source], deps(agent, 'a-model'));
    expect(models).toEqual(['a-model', 'a-model']);
    // The source is unchanged: the agent wrote only targets.
    expect(await readFile(source, 'utf8')).toBe('prose');
  });

  it('builds an agent prompt with the definition verbatim and the full contract (PHEXEC-20)', async () => {
    const { agent, calls } = makeAgent();
    await runSlc(['flow', source], deps(agent));
    const prompt = calls[0];
    // The definition is embedded verbatim, not just a fragment.
    expect(prompt).toContain(formats('text', '.md', 'gears', '.md'));
    // Every PHEXEC-14 contract clause (plus PHEXEC-15) appears.
    expect(prompt).toContain('authoritative');
    expect(prompt).toContain('write only');
    expect(prompt).toContain('not edit the sources');
    expect(prompt).toContain('not commit');
    expect(prompt).toContain('complete artifact');
    expect(prompt).toContain('add no domain semantics');
    expect(prompt).toContain('drop nothing');
    expect(prompt).toContain('preserve verbatim');
    expect(prompt).toContain('run only the deterministic tools');
    expect(prompt).toContain('read only the content it cites');
    expect(prompt).toContain('verify the produced artifact');
    expect(prompt).toContain('summary');
    expect(prompt).toContain('BLOCKED:');
  });
});

describe('single-phase run (PIPE-24)', () => {
  it('writes only the named phase target', async () => {
    const { agent, calls } = makeAgent();
    const result = await runSlc(['flow.text2gears', source], deps(agent));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(result.outputs).toEqual([join(artDir, 'onboarding.gears.md')]);
    expect(await exists(join(artDir, 'onboarding.fsm.ts'))).toBe(false);
  });

  it('ignores -o for a non-terminal phase, keeping the canonical intermediate (DR-001)', async () => {
    const { agent } = makeAgent();
    const out = join(srcDir, 'custom.gears.md');
    const result = await runSlc(
      ['flow.text2gears', source, '-o', out],
      deps(agent),
    );

    expect(result.ok).toBe(true);
    expect(result.outputs).toEqual([join(artDir, 'onboarding.gears.md')]);
    expect(await exists(out)).toBe(false);
  });

  it('reuses the artifact directory without nesting on a rerun (PIPE-24)', async () => {
    await mkdir(artDir, { recursive: true });
    const intermediate = join(artDir, 'onboarding.gears.md');
    await writeFile(intermediate, 'gears');
    const { agent } = makeAgent();

    const result = await runSlc(['flow.gears2fsm', intermediate], deps(agent));

    expect(result.ok).toBe(true);
    expect(result.outputs).toEqual([join(artDir, 'onboarding.fsm.ts')]);
  });

  it('honors -o for the terminal phase', async () => {
    await mkdir(artDir, { recursive: true });
    const intermediate = join(artDir, 'onboarding.gears.md');
    await writeFile(intermediate, 'gears');
    const out = join(srcDir, 'custom.fsm.ts');
    const { agent } = makeAgent();

    const result = await runSlc(
      ['flow.gears2fsm', intermediate, '-o', out],
      deps(agent),
    );

    expect(result.ok).toBe(true);
    expect(result.outputs).toEqual([out]);
    expect(await exists(out)).toBe(true);
  });
});

describe('link runs (PIPE-25, PIPE-26)', () => {
  it('runs a single-object .link, placing the artifact source-adjacent', async () => {
    await mkdir(artDir, { recursive: true });
    const object = join(artDir, 'onboarding.fsm.ts');
    await writeFile(object, 'fsm');
    await writeFile(join(srcDir, 'runner.ts'), 'runner');
    const { agent } = makeAgent();

    const result = await runSlc(
      ['flow.link', object, join(srcDir, 'runner.ts')],
      deps(agent),
    );

    expect(result.ok).toBe(true);
    expect(await exists(join(artDir, 'onboarding.run.ts'))).toBe(true);
  });

  it('refuses a multi-object .link without -o (PIPE-25)', async () => {
    const { agent } = makeAgent();
    const result = await runSlc(
      ['flow.link', 'a.fsm.ts', 'b.fsm.ts', join(srcDir, 'runner.ts')],
      deps(agent),
    );
    expect(result.ok).toBe(false);
  });

  it('runs a full pipeline then links the exit artifact (PIPE-26)', async () => {
    await writeFile(join(srcDir, 'runner.ts'), 'runner');
    const { agent } = makeAgent();

    const result = await runSlc(
      ['flow', source, '--link', join(srcDir, 'runner.ts')],
      deps(agent),
    );

    expect(result.ok).toBe(true);
    expect(await exists(join(artDir, 'onboarding.fsm.ts'))).toBe(true); // object artifact
    expect(await exists(join(artDir, 'onboarding.run.ts'))).toBe(true); // linked artifact
  });

  it('lets -o override the linked artifact for a .link run (PIPE-28)', async () => {
    await mkdir(artDir, { recursive: true });
    const object = join(artDir, 'onboarding.fsm.ts');
    await writeFile(object, 'fsm');
    await writeFile(join(srcDir, 'runner.ts'), 'runner');
    const out = join(srcDir, 'app.run.ts');
    const { agent } = makeAgent();

    const result = await runSlc(
      ['flow.link', object, join(srcDir, 'runner.ts'), '-o', out],
      deps(agent),
    );

    expect(result.ok).toBe(true);
    expect(result.outputs).toEqual([out]);
    expect(await exists(out)).toBe(true);
  });

  it('conveys --link-option to the link phase (PIPE-29)', async () => {
    await mkdir(artDir, { recursive: true });
    const object = join(artDir, 'onboarding.fsm.ts');
    await writeFile(object, 'fsm');
    await writeFile(join(srcDir, 'runner.ts'), 'runner');
    const { agent, calls } = makeAgent();

    await runSlc(
      [
        'flow.link',
        object,
        join(srcDir, 'runner.ts'),
        '--link-option',
        'seed=42',
      ],
      deps(agent),
    );

    expect(calls[0]).toContain('options: seed=42');
  });
});

describe('pass phases and normalization (DR-013; PIPE-35, PIPE-36)', () => {
  const addOptimizePass = async (): Promise<void> => {
    await writeFile(
      join(pipelineDir, 'optimize.md'),
      formats('gears', '.md', 'gears', '.md'),
    );
  };

  it('schedules a pass between phases with -O: raw intermediate, canonical pass output (PIPE-32)', async () => {
    await addOptimizePass();
    const { agent, calls } = makeAgent();
    const result = await runSlc(['flow', source, '-O'], deps(agent));
    expect(result.ok).toBe(true);
    expect(await exists(join(artDir, 'onboarding.gears.raw.md'))).toBe(true);
    expect(await exists(join(artDir, 'onboarding.gears.md'))).toBe(true);
    expect(await exists(join(artDir, 'onboarding.fsm.ts'))).toBe(true);
    expect(calls).toHaveLength(3);
    // The pass reads the raw intermediate and writes the canonical path.
    expect(calls[1]).toContain(
      `source to read: ${join(artDir, 'onboarding.gears.raw.md')}`,
    );
    expect(calls[1]).toContain(
      `artifact to write: ${join(artDir, 'onboarding.gears.md')}`,
    );
    // The downstream phase consumes the canonical (optimized) intermediate.
    expect(calls[2]).toContain(
      `source to read: ${join(artDir, 'onboarding.gears.md')}`,
    );
  });

  it('ignores discovered passes without -O', async () => {
    await addOptimizePass();
    const { agent, calls } = makeAgent();
    const result = await runSlc(['flow', source], deps(agent));
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(await exists(join(artDir, 'onboarding.gears.raw.md'))).toBe(false);
  });

  it('runs a pass standalone, writing the .opt sibling (PIPE-33)', async () => {
    await addOptimizePass();
    await mkdir(artDir, { recursive: true });
    const intermediate = join(artDir, 'onboarding.gears.md');
    await writeFile(intermediate, 'gears');
    const { agent } = makeAgent();
    const result = await runSlc(['flow.optimize', intermediate], deps(agent));
    expect(result.ok).toBe(true);
    expect(result.outputs).toEqual([join(artDir, 'onboarding.gears.opt.md')]);
    expect(await exists(join(artDir, 'onboarding.gears.opt.md'))).toBe(true);
  });

  it('schedules the generic normalize step ahead of the entry phase (PIPE-34, PHEXEC-33)', async () => {
    const { agent, calls } = makeAgent();
    const result = await runSlc(['flow', source, '--normalize'], deps(agent));
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(3);
    // The built-in pipeline-agnostic definition drives the step, with the
    // entry-phase definition as a protected read-only reference.
    expect(calls[0]).toContain('# Input Normalization');
    expect(calls[0]).toContain(
      `reference to consult (read-only): ${join(pipelineDir, 'text2gears.md')}`,
    );
    expect(calls[0]).toContain(
      `artifact to write: ${join(artDir, 'onboarding.text.md')}`,
    );
    // The entry phase consumes the normalized source.
    expect(calls[1]).toContain(
      `source to read: ${join(artDir, 'onboarding.text.md')}`,
    );
  });
});

describe('failure paths (PHEXEC-17, PHEXEC-19, PHEXEC-22, PIPE-21, PIPE-27)', () => {
  it('fails when the agent does not write the target (PHEXEC-17)', async () => {
    const { agent } = makeAgent({ skip: true });
    const result = await runSlc(['flow', source], deps(agent));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('was not written');
  });

  it('fails when -o gives the output a wrong extension (PHEXEC-17)', async () => {
    const { agent } = makeAgent();
    const out = join(srcDir, 'onboarding.fsm.txt'); // terminal phase declares .ts
    const result = await runSlc(['flow', source, '-o', out], deps(agent));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('extension');
  });

  it('fails and reports when the agent blocks (PHEXEC-19)', async () => {
    const { agent } = makeAgent({ block: true });
    const result = await runSlc(['flow', source], deps(agent));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('BLOCKED');
  });

  it('fails when the agent mutates the source (PHEXEC-18)', async () => {
    const { agent } = makeAgent({ mutate: source });
    const result = await runSlc(['flow', source], deps(agent));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('changed during the run');
  });

  it('fails when the agent mutates a phase definition (PHEXEC-18)', async () => {
    const { agent } = makeAgent({ mutate: join(pipelineDir, 'text2gears.md') });
    const result = await runSlc(['flow', source], deps(agent));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('text2gears.md');
  });

  it('fails when the agent mutates a link object (PHEXEC-18)', async () => {
    await mkdir(artDir, { recursive: true });
    const object = join(artDir, 'onboarding.fsm.ts');
    await writeFile(object, 'fsm');
    await writeFile(join(srcDir, 'runner.ts'), 'runner');
    const { agent } = makeAgent({ mutate: object });
    const result = await runSlc(
      ['flow.link', object, join(srcDir, 'runner.ts')],
      deps(agent),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('changed during the run');
  });

  it('fails when a phase filename disagrees with its ## Formats (PIPE-23)', async () => {
    const badDir = join(root, 'badname');
    await mkdir(badDir);
    // Named text2gears.md but declares target fsm, so the expected name is text2fsm.md.
    await writeFile(
      join(badDir, 'text2gears.md'),
      formats('text', '.md', 'fsm', '.ts'),
    );
    const { agent } = makeAgent();
    const result = await runSlc(['x', source], {
      ...deps(agent),
      resolver: () => [badDir],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('text2gears.md');
    expect(result.outputs).toEqual([]);
  });

  it('fails when the agent breaks the chain mid-run (PHEXEC-22)', async () => {
    const { agent } = makeAgent({ add: join(pipelineDir, 'text2foo.md') });
    const result = await runSlc(['flow', source], deps(agent));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('no longer valid');
  });

  it('fails on an invalid pipeline chain (PIPE-21)', async () => {
    const broken = join(root, 'broken');
    await mkdir(broken);
    await writeFile(join(broken, 'a2b.md'), formats('a', '.md', 'b', '.md'));
    await writeFile(join(broken, 'c2d.md'), formats('c', '.md', 'd', '.md'));
    const { agent } = makeAgent();
    const result = await runSlc(['broken', source], deps(agent));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.outputs).toEqual([]);
  });

  it('fails on an unresolved pipeline reference (PIPE-27)', async () => {
    const { agent } = makeAgent();
    const result = await runSlc(['missing', source], deps(agent));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('missing'); // names the reference
    expect(result.outputs).toEqual([]);
  });

  it('fails on an ambiguous pipeline reference (PIPE-27)', async () => {
    const { agent } = makeAgent();
    const ambiguous: SlcDeps = {
      ...deps(agent),
      resolver: () => [pipelineDir, join(root, 'pipe-2')],
    };
    const result = await runSlc(['flow', source], ambiguous);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('flow'); // names the reference
    expect(result.outputs).toEqual([]);
  });

  it('fails on a source whose name matches no form (PIPE-22)', async () => {
    const badSource = join(srcDir, 'onboarding.txt');
    await writeFile(badSource, 'prose');
    const { agent } = makeAgent();
    const result = await runSlc(['flow', badSource], deps(agent));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.outputs).toEqual([]);
  });

  it('fails on a malformed invocation', async () => {
    const { agent } = makeAgent();
    const result = await runSlc([], deps(agent));
    expect(result.ok).toBe(false);
  });
});
