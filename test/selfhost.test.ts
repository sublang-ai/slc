// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createInterpretedExecutor,
  type AgentClient,
} from '../src/interpreter.js';
import { resolvesToPlaybook } from '../src/phase-runner.js';
import { loadPipeline } from '../src/pipeline.js';
import {
  createPipelineResolver,
  reservedSlcPipelineDir,
  withReservedPipelines,
} from '../src/resolver.js';
import { runSlc, type SlcDeps } from '../src/runner.js';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** A compiled artifact that resolves to the `playbook` format (DR-005). */
const PLAYBOOK_MODULE =
  'export default function createPlaybookRuntime() {\n  return { init: async () => {}, handleBossInput: async () => {}, dispose: async () => {} };\n}\n';

const formats = (sf: string, se: string, tf: string, te: string): string =>
  `## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | ${sf} | ${se} |\n| target | ${tf} | ${te} |\n`;

// The reserved slc link phase: fsm .ts -> playbook .ts (DR-005).
const playbookLink = `## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | fsm | .ts |\n| target | playbook | .ts |\n\n## Link Targets\n\n| Target form | Meaning |\n| --- | --- |\n| <path>.ts | A runtime module. |\n`;

// A conformant gears+fsm artifact pair in the meta-pipeline output shapes, so
// a faked full run exercises every verification emission (VERIFY-8): the fsm
// carries the FLOW-1 binding verbatim plus the gears2fsm Boss surfaces.
const GEARS_ARTIFACT = `# Flow

## Behaviors

### FLOW-1

When Boss starts the flow, Captain shall prompt Writer:
> Do the work.
`;

const FSM_ARTIFACT = `import { assign, fromPromise, setup } from 'xstate';

export const machine = setup({
  actors: {
    captain: fromPromise(async () => {
      throw new Error('captain actor must be provided by the runner');
    }),
  },
}).createMachine({
  id: 'flow',
  initial: 'ready',
  context: {},
  on: {
    BOSS_INTERRUPT: [
      {
        target: '#work',
        reenter: true,
        guard: ({ event }) => event.targetId === 'work',
      },
    ],
  },
  states: {
    ready: { id: 'ready', on: { GO: { target: 'work' } } },
    work: {
      id: 'work',
      invoke: {
        src: 'captain',
        input: ({ context }) => ({
          player: 'Writer',
          sourceItem: 'FLOW-1',
          prompt: 'Do the work.',
          result: {
            ok: 'The work is done.',
            needsBossReply:
              'The player asks Boss. Output shall include \`question: <text>\`.',
          },
          pendingBossQuestion: context.pendingBossQuestion,
          bossReply: context.bossReply,
        }),
        onDone: [
          { target: '#done', guard: ({ event }) => event.output.guard === 'ok' },
          {
            target: '#awaitBossReply',
            guard: ({ event }) =>
              event.output.guard === 'needsBossReply' &&
              typeof event.output.question === 'string',
            actions: assign({
              pendingBossQuestion: ({ event }) => ({
                resumeStateId: 'work',
                sourceItem: 'FLOW-1',
                player: 'Writer',
                question: event.output.question,
              }),
            }),
          },
        ],
        onError: { target: '#failed' },
      },
    },
    awaitBossReply: {
      id: 'awaitBossReply',
      on: {
        BOSS_REPLY: [
          {
            target: '#work',
            reenter: true,
            guard: ({ context, event }) =>
              context.pendingBossQuestion?.resumeStateId === 'work' &&
              typeof event.answer === 'string' &&
              event.answer.trim() !== '',
            actions: assign({ bossReply: ({ event }) => event.answer }),
          },
          { target: '#failed' },
        ],
      },
    },
    failed: { id: 'failed', on: { GO: { target: 'work' } } },
    done: { id: 'done', type: 'final' },
  },
});
`;

// An agent that writes the prompt's declared target, emitting realistic
// artifacts per target kind — a gears package, a conformant machine, and a
// real createPlaybookRuntime module — so verification emission runs end to end
// (SELFHOST-3, VERIFY-8).
const writingAgent = (): AgentClient => ({
  run: async ({ prompt }) => {
    const match = /artifact to write: (.+)/.exec(prompt);
    if (match) {
      const target = match[1].trim();
      const content = target.endsWith('.playbook.ts')
        ? PLAYBOOK_MODULE
        : target.endsWith('.fsm.ts')
          ? FSM_ARTIFACT
          : target.endsWith('.md')
            ? GEARS_ARTIFACT
            : 'export default 1;\n';
      await writeFile(target, content);
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

  it('routes the reserved `slc` and `playbook` references to the shared definitions, delegating others (SELFHOST-10)', async () => {
    // No search root provides a `playbook` directory: both reserved references
    // fall back to the installed definitions.
    const fallback = withReservedPipelines((reference) =>
      reference === 'domain' ? ['/configured/domain'] : [],
    );
    expect(await fallback('slc')).toEqual([reservedSlcPipelineDir()]);
    expect(await fallback('playbook')).toEqual([reservedSlcPipelineDir()]);
    expect(await fallback('domain')).toEqual(['/configured/domain']);
  });

  it('prefers a search-root `playbook` vendor of the shared definitions for both references (SELFHOST-10)', async () => {
    const wrapped = withReservedPipelines((reference) =>
      reference === 'playbook' ? ['/roots/playbook'] : [],
    );
    // The vendored directory carries the shared definition set and the pin
    // index, so `slc` and `playbook` stay one definition set (SELFHOST-9).
    expect(await wrapped('slc')).toEqual(['/roots/playbook']);
    expect(await wrapped('playbook')).toEqual(['/roots/playbook']);
  });

  it('resolves the vendored pipelines/playbook directory through real search roots (SELFHOST-10)', async () => {
    const repoRoot = fileURLToPath(new URL('..', import.meta.url));
    const resolver = withReservedPipelines(
      createPipelineResolver([join(repoRoot, 'pipelines')]),
    );
    const vendored = join(repoRoot, 'pipelines', 'playbook');
    expect(await resolver('slc')).toEqual([vendored]);
    expect(await resolver('playbook')).toEqual([vendored]);
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
    // Every verification test is emitted beside the artifacts (VERIFY-8): the
    // faked agents produced a conformant gears+fsm pair, so conformance,
    // introspection, prompt-contract, and coverage all derive and emit.
    for (const test of [
      'code.gears-fsm.test.ts',
      'code.fsm.introspect.test.ts',
      'code.prompt-contract.test.ts',
      'code.fsm.coverage.test.ts',
    ]) {
      expect(await exists(join(artDir, test))).toBe(true);
      expect(result.outputs).toContain(join(artDir, test));
    }
    for (const support of [
      'hash.js',
      'hash.d.ts',
      'verify.js',
      'verify.d.ts',
      'verify-coverage.js',
      'verify-coverage.d.ts',
    ]) {
      const path = join(artDir, '.slc-verify', support);
      expect(await exists(path)).toBe(true);
      expect(result.outputs).toContain(path);
    }
    expect(
      await readFile(join(artDir, 'code.gears-fsm.test.ts'), 'utf8'),
    ).toContain('from "./.slc-verify/verify.js"');
  });

  it('runs generated verification in a project with no SLC installation', async () => {
    const result = await runSlc(['playbook', source], deps());
    expect(result.ok).toBe(true);
    await writeFile(
      join(root, 'package.json'),
      '{"private":true,"type":"module"}\n',
    );
    await symlink(join(repoRoot, 'node_modules'), join(root, 'node_modules'));
    expect(await exists(join(root, 'node_modules', '@sublang', 'slc'))).toBe(
      false,
    );

    const testFiles = [
      'code.gears-fsm.test.ts',
      'code.fsm.introspect.test.ts',
      'code.prompt-contract.test.ts',
      'code.fsm.coverage.test.ts',
    ];
    for (const test of testFiles.map((file) => join(artDir, file))) {
      const sourceText = await readFile(test, 'utf8');
      expect(sourceText).toContain('from "./.slc-verify/verify.js"');
      expect(sourceText).not.toContain('@sublang/slc/verify');
    }

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        join(repoRoot, 'node_modules/vitest/vitest.mjs'),
        'run',
        ...testFiles.map((file) => join('work/code.playbook', file)),
      ],
      { cwd: root, timeout: 15_000 },
    );
    expect(`${stdout}\n${stderr}`).toMatch(/4 passed/);
  });

  it('degrades fsm-derived emissions to diagnostics when the produced fsm cannot be imported (VERIFY-8)', async () => {
    const junkAgent: AgentClient = {
      run: async ({ prompt }) => {
        const match = /artifact to write: (.+)/.exec(prompt);
        if (match) {
          const target = match[1].trim();
          await writeFile(
            target,
            target.endsWith('.gears.md')
              ? GEARS_ARTIFACT
              : 'not a module {{{\n',
          );
        }
        return { status: 'success', text: 'wrote the artifact' };
      },
    };
    const result = await runSlc(['playbook', source], {
      resolver: withReservedPipelines(() => []),
      executor: createInterpretedExecutor({ agent: junkAgent }),
    });
    expect(result.ok).toBe(true);
    // Portable checker support and the conformance test need no FSM import;
    // the other generated tests degrade independently.
    expect(await exists(join(artDir, '.slc-verify', 'verify.js'))).toBe(true);
    expect(result.outputs).toContain(join(artDir, '.slc-verify', 'verify.js'));
    expect(await exists(join(artDir, 'code.gears-fsm.test.ts'))).toBe(true);
    expect(await exists(join(artDir, 'code.fsm.introspect.test.ts'))).toBe(
      false,
    );
    expect(await exists(join(artDir, 'code.prompt-contract.test.ts'))).toBe(
      false,
    );
    expect(await exists(join(artDir, 'code.fsm.coverage.test.ts'))).toBe(false);
    const diagnostics = result.diagnostics.join('\n');
    expect(diagnostics).toMatch(/introspection test not emitted/);
    expect(diagnostics).toMatch(/prompt-contract test not emitted/);
    expect(diagnostics).toMatch(/coverage test not emitted/);
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
