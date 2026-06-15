// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type ExecuteRequest,
  type ExecutorResult,
  formatFailureReport,
  type PhaseExecutor,
  runPhase,
} from '../src/execution.js';

const executor = (
  impl: (request: ExecuteRequest) => Promise<ExecutorResult> | ExecutorResult,
): PhaseExecutor => ({ run: (request) => Promise.resolve(impl(request)) });

/** An executor that writes `content` to the request target and returns ok. */
const writingExecutor = (
  content = 'output',
  diagnostics: string[] = [],
): PhaseExecutor =>
  executor(async (request) => {
    const target = request.kind === 'compile' ? request.target : request.linked;
    await writeFile(target, content);
    return { status: 'ok', diagnostics };
  });

describe('runPhase generic checks (PHEXEC-4, PHEXEC-5)', () => {
  let dir: string;
  let request: Extract<ExecuteRequest, { kind: 'compile' }>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-exec-'));
    await writeFile(join(dir, 'text2gears.md'), '# def');
    await writeFile(join(dir, 'onboarding.md'), 'source');
    request = {
      kind: 'compile',
      definitionPath: join(dir, 'text2gears.md'),
      source: join(dir, 'onboarding.md'),
      target: join(dir, 'onboarding.gears.md'),
    };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const run = (executorImpl: PhaseExecutor) =>
    runPhase({
      request,
      phase: 'text2gears',
      targetExt: '.md',
      executor: executorImpl,
    });

  it('passes when the target is written and inputs are unchanged', async () => {
    const result = await run(
      writingExecutor('gears', ['resolved a benign ambiguity']),
    );
    expect(result).toEqual({
      ok: true,
      target: request.target,
      diagnostics: ['resolved a benign ambiguity'],
    });
  });

  it('fails when the target is not written (PHEXEC-4)', async () => {
    const result = await run(
      executor(() => ({ status: 'ok', diagnostics: [] })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.report.reasons[0]).toContain('was not written');
  });

  it('fails when the target extension does not match the declared one (PHEXEC-4)', async () => {
    const result = await runPhase({
      request: { ...request, target: join(dir, 'onboarding.gears.txt') },
      phase: 'text2gears',
      targetExt: '.md',
      executor: writingExecutor(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.report.reasons[0]).toContain('extension');
  });

  it('fails when the executor mutates a protected input (PHEXEC-5, PHEXEC-6)', async () => {
    const result = await run(
      executor(async (req) => {
        if (req.kind === 'compile') {
          await writeFile(req.target, 'out');
          await writeFile(req.source, 'tampered');
        }
        return { status: 'ok', diagnostics: [] };
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(
        result.report.reasons.some((r) => r.includes('changed during the run')),
      ).toBe(true);
  });

  it('fails when the executor mutates the phase definition (chain validity, PHEXEC-5)', async () => {
    const result = await run(
      executor(async (req) => {
        await writeFile(req.target, 'out');
        await writeFile(req.definitionPath, 'tampered def');
        return { status: 'ok', diagnostics: [] };
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.report.reasons.some((r) => r.includes('text2gears.md')),
      ).toBe(true);
    }
  });

  it('does not alter the source when the run succeeds', async () => {
    await run(writingExecutor());
    expect(await readFile(request.source, 'utf8')).toBe('source');
  });

  it('fails when a sibling chain definition is mutated (PHEXEC-5)', async () => {
    const sibling = join(dir, 'gears2fsm.md');
    await writeFile(sibling, 'sibling def');
    const result = await runPhase({
      request,
      phase: 'text2gears',
      targetExt: '.md',
      definitions: [request.definitionPath, sibling],
      executor: executor(async (req) => {
        await writeFile(req.target, 'out');
        await writeFile(sibling, 'tampered sibling');
        return { status: 'ok', diagnostics: [] };
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.report.reasons.some((r) => r.includes('gears2fsm.md')),
      ).toBe(true);
    }
  });

  it('always protects the active definition even when definitions omits it', async () => {
    const result = await runPhase({
      request,
      phase: 'text2gears',
      targetExt: '.md',
      definitions: [],
      executor: executor(async (req) => {
        await writeFile(req.target, 'out');
        await writeFile(req.definitionPath, 'tampered def');
        return { status: 'ok', diagnostics: [] };
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.report.reasons.some((r) => r.includes('text2gears.md')),
      ).toBe(true);
    }
  });

  it('fails when the revalidate hook reports an invalid chain (PHEXEC-5)', async () => {
    const result = await runPhase({
      request,
      phase: 'text2gears',
      targetExt: '.md',
      revalidate: () => {
        throw new Error('multiple entry phases');
      },
      executor: writingExecutor(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.report.reasons.some((r) => r.includes('no longer valid')),
      ).toBe(true);
    }
  });

  it('passes when the revalidate hook accepts the chain', async () => {
    let called = false;
    const result = await runPhase({
      request,
      phase: 'text2gears',
      targetExt: '.md',
      revalidate: () => {
        called = true;
      },
      executor: writingExecutor(),
    });
    expect(called).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('detects an input mutation even when the executor blocks (PHEXEC-6)', async () => {
    const result = await run(
      executor(async (req) => {
        if (req.kind === 'compile') await writeFile(req.source, 'tampered');
        return { status: 'blocked', diagnostics: ['source is malformed'] };
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.report.reasons).toContain('source is malformed');
      expect(
        result.report.reasons.some((r) => r.includes('changed during the run')),
      ).toBe(true);
    }
  });
});

describe('runPhase blocked protocol (PHEXEC-7, PHEXEC-9)', () => {
  const request: ExecuteRequest = {
    kind: 'compile',
    definitionPath: '/defs/text2gears.md',
    source: '/src/onboarding.md',
    target: '/out/onboarding.gears.md',
  };
  const run = (executorImpl: PhaseExecutor) =>
    runPhase({
      request,
      phase: 'text2gears',
      targetExt: '.md',
      executor: executorImpl,
    });

  it('reports BLOCKED diagnostics as failure reasons', async () => {
    const result = await run(
      executor(() => ({
        status: 'blocked',
        diagnostics: ['source is malformed'],
      })),
    );
    expect(result).toMatchObject({
      ok: false,
      report: {
        phase: 'text2gears',
        target: request.target,
        reasons: ['source is malformed'],
      },
    });
  });

  it('reports an error status as a failure', async () => {
    const result = await run(
      executor(() => ({ status: 'error', diagnostics: ['agent crashed'] })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.report.reasons).toEqual(['agent crashed']);
  });

  it('reports a thrown executor as a failure', async () => {
    const result = await run(
      executor(() => {
        throw new Error('boom');
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.report.reasons[0]).toContain('executor threw: boom');
  });

  it('supplies a default reason when diagnostics are empty', async () => {
    const result = await run(
      executor(() => ({ status: 'blocked', diagnostics: [] })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.report.reasons[0]).toContain('without diagnostics');
  });
});

describe('runPhase link execution', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-exec-link-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('checks the linked artifact and leaves objects unchanged', async () => {
    await writeFile(join(dir, 'link.md'), '# link');
    await writeFile(join(dir, 'onboarding.fsm.ts'), 'fsm');
    await writeFile(join(dir, 'runner.ts'), 'runner');
    const request: ExecuteRequest = {
      kind: 'link',
      definitionPath: join(dir, 'link.md'),
      objects: [join(dir, 'onboarding.fsm.ts')],
      linkTarget: join(dir, 'runner.ts'),
      options: [{ name: 'seed', value: '1' }],
      linked: join(dir, 'onboarding.playbook.ts'),
    };

    const result = await runPhase({
      request,
      phase: 'link',
      targetExt: '.ts',
      executor: writingExecutor(),
    });
    expect(result.ok).toBe(true);
    expect(await readFile(join(dir, 'onboarding.fsm.ts'), 'utf8')).toBe('fsm');
  });
});

describe('formatFailureReport', () => {
  it('names the phase, target, and reasons', () => {
    expect(
      formatFailureReport({
        phase: 'gears2fsm',
        target: 'out/onboarding.fsm.ts',
        reasons: ['a', 'b'],
      }),
    ).toBe(
      'slc: phase "gears2fsm" failed at "out/onboarding.fsm.ts"\n  - a\n  - b',
    );
  });
});
