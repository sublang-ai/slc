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

import { loadBuildHistory } from '../src/build-history.js';
import type {
  ExecuteRequest,
  ExecutorResult,
  PhaseExecutor,
} from '../src/execution.js';
import { runSlc, type SlcDeps } from '../src/runner.js';

const phase = (
  source: string,
  sourceExt: string,
  target: string,
  targetExt: string,
): string => `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | ${source} | ${sourceExt} |
| target | ${target} | ${targetExt} |
`;

describe('success-only incremental runner (INCR-18..24)', () => {
  let root: string;
  let pipelineDir: string;
  let workDir: string;
  let source: string;
  let artDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-incremental-'));
    pipelineDir = join(root, 'pipeline');
    workDir = join(root, 'work');
    await mkdir(pipelineDir);
    await mkdir(workDir);
    await writeFile(
      join(pipelineDir, 'text2middle.md'),
      phase('text', '.md', 'middle', '.md'),
    );
    await writeFile(
      join(pipelineDir, 'middle2final.md'),
      phase('middle', '.md', 'final', '.md'),
    );
    source = join(workDir, 'case.md');
    artDir = join(workDir, 'case.flow');
    await writeFile(source, 'source one\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const deps = (executor: PhaseExecutor): SlcDeps => ({
    resolver: (reference) => (reference === 'flow' ? [pipelineDir] : []),
    executor,
    cwd: workDir,
  });

  const fake = (
    calls: ExecuteRequest[],
    run: (request: ExecuteRequest) => Promise<ExecutorResult> = async (
      request,
    ) => {
      const target =
        request.kind === 'compile' ? request.target : request.linked;
      await writeFile(
        target,
        target.endsWith('.middle.md') ? 'middle\n' : 'final\n',
      );
      return { status: 'ok', diagnostics: [] };
    },
  ): PhaseExecutor => ({
    async run(request) {
      calls.push(request);
      return run(request);
    },
  });

  const exists = async (path: string): Promise<boolean> =>
    access(path).then(
      () => true,
      () => false,
    );

  it('publishes one complete build after the first successful run', async () => {
    const calls: ExecuteRequest[] = [];
    const result = await runSlc(['flow', source], deps(fake(calls)));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const history = await loadBuildHistory(artDir);
    expect(history?.build).toBe(1);
    expect(history?.manifest.steps.map((step) => step.name)).toEqual([
      'text2middle',
      'middle2final',
    ]);
    expect(await readFile(join(history!.dir, 'outputs', '0'), 'utf8')).toBe(
      'middle\n',
    );
    expect(await readFile(join(history!.dir, 'outputs', '1'), 'utf8')).toBe(
      'final\n',
    );
  });

  it('reuses every phase and preserves a manual final refinement', async () => {
    await runSlc(['flow', source], deps(fake([])));
    const final = join(artDir, 'case.final.md');
    await writeFile(final, 'reviewed final\n');
    const calls: ExecuteRequest[] = [];

    const result = await runSlc(['flow', source], deps(fake(calls)));

    expect(result).toMatchObject({ ok: true, outcome: 'up-to-date' });
    expect(result.outputs).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await readFile(final, 'utf8')).toBe('reviewed final\n');
    expect((await loadBuildHistory(artDir))?.build).toBe(1);
  });

  it('updates a changed phase and stops when its output converges', async () => {
    await runSlc(['flow', source], deps(fake([])));
    await writeFile(source, 'source two\n');
    const calls: ExecuteRequest[] = [];

    const result = await runSlc(['flow', source], deps(fake(calls)));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const request = calls[0];
    expect(request.kind).toBe('compile');
    if (request.kind === 'compile') {
      expect(request.update?.priorInput).toContain('/.slc/builds/1/source');
      expect(request.update?.diff).toContain('-source one');
      expect(request.update?.diff).toContain('+source two');
    }
    expect(result.outputs).toEqual([join(artDir, 'case.middle.md')]);
    expect((await loadBuildHistory(artDir))?.build).toBe(2);
  });

  it('leaves no marker after failure and retries every phase ordinarily', async () => {
    await runSlc(['flow', source], deps(fake([])));
    await writeFile(source, 'source two\n');
    const failedCalls: ExecuteRequest[] = [];
    const failed = await runSlc(
      ['flow', source],
      deps(
        fake(failedCalls, async (request) => {
          const target =
            request.kind === 'compile' ? request.target : request.linked;
          await writeFile(target, 'rejected\n');
          return { status: 'error', diagnostics: ['fixture failure'] };
        }),
      ),
    );

    expect(failed.ok).toBe(false);
    expect(failedCalls).toHaveLength(1);
    expect(await exists(join(artDir, '.slc', 'latest'))).toBe(false);
    expect(await exists(join(artDir, '.slc', 'builds', '1'))).toBe(true);

    const retryCalls: ExecuteRequest[] = [];
    const retry = await runSlc(['flow', source], deps(fake(retryCalls)));
    expect(retry.ok).toBe(true);
    expect(retryCalls).toHaveLength(2);
    expect(
      retryCalls.every(
        (request) => request.kind !== 'compile' || request.update === undefined,
      ),
    ).toBe(true);
    expect((await loadBuildHistory(artDir))?.build).toBe(2);
  });

  it('makes --rebuild ordinary and publishes a new complete build', async () => {
    await runSlc(['flow', source], deps(fake([])));
    const calls: ExecuteRequest[] = [];

    const result = await runSlc(
      ['flow', source, '--rebuild'],
      deps(fake(calls)),
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(
      calls.every(
        (request) => request.kind !== 'compile' || request.update === undefined,
      ),
    ).toBe(true);
    expect((await loadBuildHistory(artDir))?.build).toBe(2);
  });

  it('invalidates a snapshot before an excluded run writes one of its targets', async () => {
    await runSlc(['flow', source], deps(fake([])));
    const calls: ExecuteRequest[] = [];

    const result = await runSlc(
      ['flow.text2middle', source],
      deps(
        fake(calls, async (request) => {
          const target =
            request.kind === 'compile' ? request.target : request.linked;
          await writeFile(target, 'rejected partial output\n');
          return { status: 'error', diagnostics: ['fixture failure'] };
        }),
      ),
    );

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(await exists(join(artDir, '.slc', 'latest'))).toBe(false);

    const retryCalls: ExecuteRequest[] = [];
    const retry = await runSlc(['flow', source], deps(fake(retryCalls)));
    expect(retry.ok).toBe(true);
    expect(retryCalls).toHaveLength(2);
    expect(
      retryCalls.every(
        (request) => request.kind !== 'compile' || request.update === undefined,
      ),
    ).toBe(true);
  });
});
