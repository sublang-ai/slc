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
import { resolvesToPlaybook } from '../src/phase-runner.js';
import { loadPipeline } from '../src/pipeline.js';
import {
  reservedSlcPipelineDir,
  withReservedPipelines,
} from '../src/resolver.js';
import { runSlc, type SlcDeps } from '../src/runner.js';

/** A compiled artifact that resolves to the `playbook` format (DR-005). */
const PLAYBOOK_MODULE =
  'export default function createPlaybookRuntime() {\n  return { init: async () => {}, handleBossInput: async () => {}, dispose: async () => {} };\n}\n';

const formats = (sf: string, se: string, tf: string, te: string): string =>
  `## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | ${sf} | ${se} |\n| target | ${tf} | ${te} |\n`;

// The reserved slc link phase: fsm .ts -> playbook .ts (DR-005).
const playbookLink = `## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | fsm | .ts |\n| target | playbook | .ts |\n\n## Link Targets\n\n| Target form | Meaning |\n| --- | --- |\n| <path>.ts | A runtime module. |\n`;

// An agent that writes the prompt's declared target, emitting a real
// createPlaybookRuntime module for the `playbook` artifact (SELFHOST-3).
const writingAgent = (): AgentClient => ({
  run: async ({ prompt }) => {
    const match = /artifact to write: (.+)/.exec(prompt);
    if (match) {
      const target = match[1].trim();
      await writeFile(
        target,
        target.endsWith('.playbook.ts')
          ? PLAYBOOK_MODULE
          : 'export default 1;\n',
      );
    }
    return { status: 'success', text: 'wrote the artifact' };
  },
});

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

// The reserved `slc` meta-pipeline run through the generic pipeline/link
// machinery, emitting the `playbook` linked format (SELFHOST-4).
describe('reserved slc pipeline and playbook format (SELFHOST-4)', () => {
  let root: string;
  let slcDir: string;
  let source: string;
  let artDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-selfhost-'));
    // The reserved `slc` pipeline: text -> gears -> fsm, plus a `playbook` link.
    slcDir = join(root, 'slc');
    await mkdir(slcDir);
    await writeFile(
      join(slcDir, 'text2gears.md'),
      formats('text', '.md', 'gears', '.md'),
    );
    await writeFile(
      join(slcDir, 'gears2fsm.md'),
      formats('gears', '.md', 'fsm', '.ts'),
    );
    await writeFile(join(slcDir, 'link.md'), playbookLink);

    const work = join(root, 'work');
    await mkdir(work);
    // A domain phase definition is the meta-pipeline's source.
    source = join(work, 'text2gears.md');
    await writeFile(source, '# A phase definition\n');
    await writeFile(join(work, 'runtime.ts'), 'export const rt = 1;\n');
    artDir = join(work, 'text2gears.slc');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const deps = (): SlcDeps => ({
    resolver: (reference) => (reference === 'slc' ? [slcDir] : []),
    executor: createInterpretedExecutor({ agent: writingAgent() }),
  });

  it('compiles a definition to the fsm object at its DR-001 location', async () => {
    const result = await runSlc(['slc', source], deps());
    expect(result.ok).toBe(true);
    // text -> gears -> fsm; the full run stops at the fsm object (no --link).
    expect(await exists(join(artDir, 'text2gears.gears.md'))).toBe(true);
    expect(await exists(join(artDir, 'text2gears.fsm.ts'))).toBe(true);
    expect(await exists(join(artDir, 'text2gears.playbook.ts'))).toBe(false);
  });

  it('links the fsm object to a playbook artifact that resolves to a createPlaybookRuntime factory', async () => {
    const result = await runSlc(
      ['slc', source, '--link', join(root, 'work', 'runtime.ts')],
      deps(),
    );
    expect(result.ok).toBe(true);
    const playbookArtifact = join(artDir, 'text2gears.playbook.ts');
    expect(result.outputs).toContain(playbookArtifact);
    expect(resolvesToPlaybook(await readFile(playbookArtifact, 'utf8'))).toBe(
      true,
    );
  });

  it('reserves `slc` with no built-in default: an unresolved `slc` fails', async () => {
    const result = await runSlc(['slc', source], {
      resolver: () => [],
      executor: createInterpretedExecutor({ agent: writingAgent() }),
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(/did not resolve/);
  });
});

// The reserved `slc` pipeline consumes the meta-pipeline definitions
// `@sublang/playbook` ships, rather than a duplicate authored here (SELFHOST-2).
describe('reserved slc pipeline consumes Playbook definitions (SELFHOST-2)', () => {
  it('locates Playbook-provided text2gears, gears2fsm, and link definitions', async () => {
    const dir = reservedSlcPipelineDir();
    for (const file of ['text2gears.md', 'gears2fsm.md', 'link.md']) {
      expect(await exists(join(dir, file))).toBe(true);
    }
  });

  it('chains and infers the Playbook meta-pipeline through slc', async () => {
    const pipeline = await loadPipeline(reservedSlcPipelineDir());
    expect(pipeline.phases.map((phase) => phase.name)).toEqual([
      'text2gears',
      'gears2fsm',
    ]);
    expect(pipeline.linkFile).not.toBeNull();
  });

  // Playbook ships its reserved `link` as a phase definition with no
  // `## Link Targets`; the reserved `slc` link relaxes that requirement
  // (PIPE-11), so `slc slc <src> --link <tgt>` links end to end to a
  // `.playbook.ts` runtime. The agent is faked, so this exercises the SLC link
  // path, not Playbook's link-compiler behavior (PROVISIONAL: the interpreted
  // link follows Playbook's `link.md` prose, validated by a real artifact).
  it('links the reserved slc pipeline through Playbook definitions to a .playbook.ts artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-reserved-link-'));
    try {
      const work = join(root, 'work');
      await mkdir(work, { recursive: true });
      const source = join(work, 'text2gears.md');
      await writeFile(source, '# A phase definition\n');
      await writeFile(join(work, 'runtime.ts'), 'export const rt = 1;\n');

      const result = await runSlc(
        ['slc', source, '--link', join(work, 'runtime.ts')],
        {
          resolver: (reference) =>
            reference === 'slc' ? [reservedSlcPipelineDir()] : [],
          executor: createInterpretedExecutor({ agent: writingAgent() }),
        },
      );

      expect(result.ok).toBe(true);
      const playbookArtifact = join(
        work,
        'text2gears.slc',
        'text2gears.playbook.ts',
      );
      expect(result.outputs).toContain(playbookArtifact);
      expect(resolvesToPlaybook(await readFile(playbookArtifact, 'utf8'))).toBe(
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('routes the reserved `slc` and `playbook` references to the shared definitions, delegating others', async () => {
    const wrapped = withReservedPipelines(() => ['/configured/domain']);
    expect(await wrapped('slc')).toEqual([reservedSlcPipelineDir()]);
    expect(await wrapped('playbook')).toEqual([reservedSlcPipelineDir()]);
    expect(await wrapped('domain')).toEqual(['/configured/domain']);
  });
});

// The `playbook` domain pipeline resolves to the same Playbook-provided
// definitions as the reserved `slc`, and its target-less `link.md` loads under
// the same relaxation, so `slc playbook <src> --link <tgt>` links to a
// `.playbook.ts` runtime under `<basename>.playbook/` (SELFHOST-6, SELFHOST-7,
// PIPE-11). The agent is faked, so this exercises SLC's resolution and link
// loading, not Playbook's link-compiler behavior.
describe('playbook pipeline shares Playbook definitions (SELFHOST-6, SELFHOST-7)', () => {
  it('resolves `playbook` to the shared definitions and loads its target-less link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-playbook-link-'));
    try {
      const work = join(root, 'work');
      await mkdir(work, { recursive: true });
      const source = join(work, 'flow.md');
      await writeFile(source, '# A workflow\n');
      await writeFile(join(work, 'runtime.ts'), 'export const rt = 1;\n');

      const result = await runSlc(
        ['playbook', source, '--link', join(work, 'runtime.ts')],
        {
          resolver: withReservedPipelines(() => []),
          executor: createInterpretedExecutor({ agent: writingAgent() }),
        },
      );

      expect(result.ok).toBe(true);
      const playbookArtifact = join(work, 'flow.playbook', 'flow.playbook.ts');
      expect(result.outputs).toContain(playbookArtifact);
      expect(resolvesToPlaybook(await readFile(playbookArtifact, 'utf8'))).toBe(
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // The ## Link Targets relaxation keys on the `playbook` linked format, not the
  // reference name, so an injected resolver mapping `playbook` to a directory
  // whose link emits a different format and omits ## Link Targets is refused
  // (PIPE-11, DR-009).
  it('refuses a `playbook` reference whose link is not the Playbook `playbook` format and omits ## Link Targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-playbook-badlink-'));
    try {
      const dir = join(root, 'custom');
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'text2gears.md'),
        formats('text', '.md', 'gears', '.md'),
      );
      await writeFile(
        join(dir, 'gears2fsm.md'),
        formats('gears', '.md', 'fsm', '.ts'),
      );
      // A non-`playbook` linked format (run) with no ## Link Targets section.
      await writeFile(
        join(dir, 'link.md'),
        formats('fsm', '.ts', 'run', '.ts'),
      );

      const work = join(root, 'work');
      await mkdir(work, { recursive: true });
      const source = join(work, 'flow.md');
      await writeFile(source, '# A workflow\n');
      await writeFile(join(work, 'runtime.ts'), 'export const rt = 1;\n');

      const result = await runSlc(
        ['playbook', source, '--link', join(work, 'runtime.ts')],
        {
          resolver: (reference) => (reference === 'playbook' ? [dir] : []),
          executor: createInterpretedExecutor({ agent: writingAgent() }),
        },
      );

      expect(result.ok).toBe(false);
      expect(result.diagnostics.join('\n')).toMatch(/Link Targets/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

// `slc playbook code.md` compiles a domain workflow through the playbook pipeline
// (text2gears -> gears2fsm) to the fsm object, and `--link` adds the playbook
// runtime, each at its DR-001 location under `code.playbook/` (COMPILE-1,
// COMPILE-2, SELFHOST-8). The agent is faked, so this exercises the pipeline
// mechanics, not compilation quality.
describe('playbook pipeline interpreted end to end (SELFHOST-8)', () => {
  let root: string;
  let source: string;
  let runtime: string;
  let artDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-playbook-e2e-'));
    const work = join(root, 'work');
    await mkdir(work, { recursive: true });
    source = join(work, 'code.md');
    await writeFile(
      source,
      '# Code\n\nPlayers:\n\n- Coder\n- Reviewer\n\n## Coder\n\nWhen Boss gives a coding intent, Captain shall relay it to Coder.\n',
    );
    runtime = join(work, 'runtime.ts');
    await writeFile(runtime, 'export const rt = 1;\n');
    artDir = join(work, 'code.playbook');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const deps = (): SlcDeps => ({
    resolver: withReservedPipelines(() => []),
    executor: createInterpretedExecutor({ agent: writingAgent() }),
  });

  it('compiles code.md to the gears intermediate and fsm object, stopping at the fsm', async () => {
    const result = await runSlc(['playbook', source], deps());
    expect(result.ok).toBe(true);
    expect(await exists(join(artDir, 'code.gears.md'))).toBe(true);
    expect(await exists(join(artDir, 'code.fsm.ts'))).toBe(true);
    expect(await exists(join(artDir, 'code.playbook.ts'))).toBe(false);
    // The GEARS<->FSM verification test is emitted beside the artifacts
    // (VERIFY-2): the reserved `playbook` run produced a gears+fsm pair.
    expect(await exists(join(artDir, 'code.gears-fsm.test.ts'))).toBe(true);
    expect(result.outputs).toContain(join(artDir, 'code.gears-fsm.test.ts'));
  });

  it('emits no verification when -o relocates the fsm out of the artifact dir (VERIFY-2, PIPE-8)', async () => {
    const out = join(root, 'work', 'custom.fsm.ts');
    const result = await runSlc(['playbook', source, '-o', out], deps());
    expect(result.ok).toBe(true);
    expect(await exists(out)).toBe(true);
    // The fsm left `<basename>.playbook/`, so no test is emitted there (it would
    // otherwise import a `./code.fsm.js` that was not written beside it).
    expect(await exists(join(artDir, 'code.gears-fsm.test.ts'))).toBe(false);
    expect(result.outputs).not.toContain(
      join(artDir, 'code.gears-fsm.test.ts'),
    );
  });

  it('links code.md to the playbook runtime at its DR-001 location', async () => {
    const result = await runSlc(
      ['playbook', source, '--link', runtime],
      deps(),
    );
    expect(result.ok).toBe(true);
    const playbookArtifact = join(artDir, 'code.playbook.ts');
    expect(result.outputs).toContain(playbookArtifact);
    expect(resolvesToPlaybook(await readFile(playbookArtifact, 'utf8'))).toBe(
      true,
    );
  });
});
