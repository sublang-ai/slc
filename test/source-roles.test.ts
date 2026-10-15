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
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ExecuteRequest, PhaseExecutor } from '../src/execution.js';
import { runSlc, type SlcDeps } from '../src/runner.js';
import { checkSourceRoles } from '../src/verify-source.js';

const FIXTURE = fileURLToPath(
  new URL('./fixtures/sources/two-word-role.md', import.meta.url),
);
const RULE = 'roles are single capitalized words of letters and digits';
const TWO_WORD_FINDING = `Roles entry "Business Analyst" at line 8 is not one capitalized word: ${RULE}; write \`BusinessAnalyst\``;

const formats = (source: string, target: string): string => `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | ${source} | .md |
| target | ${target} | .md |
`;

/** One Source with `lines` under its `Roles:` label, the label at line 3. */
const roles = (...lines: string[]): string =>
  ['# Flow', '', 'Roles:', '', ...lines, '', 'Prose follows.', ''].join('\n');

describe('Source role names (verification-55)', () => {
  it('reports the two-word-role fixture with its line, the rule, and the word to write', async () => {
    expect(checkSourceRoles(await readFile(FIXTURE, 'utf8'))).toEqual([
      TWO_WORD_FINDING,
    ]);
  });

  it('accepts single capitalized words in English and in a script without case', () => {
    expect(
      checkSourceRoles(
        roles('- Coder', '- SRE', '- Reviewer2', '- `编码者`', '- 审查者'),
      ),
    ).toEqual([]);
    expect(checkSourceRoles('# Flow\n\nCoder writes the change.\n')).toEqual(
      [],
    );
  });

  it.each([
    ['a lowercase', '- coder', '"coder" at line 5', '`Coder`'],
    [
      'a hyphenated',
      '- Risk-Officer',
      '"Risk-Officer" at line 5',
      '`RiskOfficer`',
    ],
    [
      'a backticked two-word',
      '- `Client Advocate`',
      '"`Client Advocate`" at line 5',
      '`ClientAdvocate`',
    ],
    [
      'a Chinese two-word',
      '- 业务 分析师',
      '"业务 分析师" at line 5',
      '`业务分析师`',
    ],
  ])('reports %s entry with its joined word', (_label, line, entry, word) => {
    expect(checkSourceRoles(roles(line))).toEqual([
      `Roles entry ${entry} is not one capitalized word: ${RULE}; write ${word}`,
    ]);
  });

  it('reads a role list under a full-width-colon label', () => {
    expect(checkSourceRoles('# 流程\n\nRoles：\n\n- risk officer\n')).toEqual([
      `Roles entry "risk officer" at line 5 is not one capitalized word: ${RULE}; write \`RiskOfficer\``,
    ]);
  });

  it('reports a punctuated entry with the rule and no proposed word', () => {
    expect(checkSourceRoles(roles('- Coder: writes the change'))).toEqual([
      `Roles entry "Coder: writes the change" at line 5 is not one capitalized word: ${RULE}; write the role as one such word, e.g. \`RiskOfficer\``,
    ]);
  });

  it('closes a fence only on a run of its own character at least as long as its opening', () => {
    // A four-backtick fence holding a three-backtick line and a Roles
    // list: nothing inside is read, and the list after it is.
    const longer = [
      '# Flow', '', '````', 'Roles:', '', '- Business Analyst', '```', 'still fenced', '````', '',
      'Roles:', '', '- Coder', '',
    ].join('\n');
    expect(checkSourceRoles(longer)).toEqual([]);
    const tildes = [
      '# Flow', '', '~~~~', 'Roles:', '', '- Business Analyst', '~~~', '~~~~', '', 'Roles:', '', '- Coder', '',
    ].join('\n');
    expect(checkSourceRoles(tildes)).toEqual([]);
    // A run followed by text closes nothing; the other character's run closes nothing.
    const info = [
      '# Flow', '', '```', 'Roles:', '', '- Business Analyst', '```text', '- Product Owner', '```', '',
      'Roles:', '', '- Coder', '',
    ].join('\n');
    expect(checkSourceRoles(info)).toEqual([]);
    const mixed = [
      '# Flow', '', '```', 'Roles:', '', '- Business Analyst', '~~~', '```', '', 'Roles:', '', '- Product Owner', '',
    ].join('\n');
    expect(checkSourceRoles(mixed)).toEqual([
      `Roles entry "Product Owner" at line 12 is not one capitalized word: ${RULE}; write \`ProductOwner\``,
    ]);
  });

  it('stops at the first prose line and reads no fenced code', () => {
    const source = [
      roles('- Coder'),
      '- Not A Role',
      '',
      '```markdown',
      'Roles:',
      '- Not A Role',
      '```',
      '',
    ].join('\n');
    expect(checkSourceRoles(source)).toEqual([]);
  });
});

describe('Source role-name boundary (phase-execution-70)', () => {
  let root: string;
  let pipelineDir: string;
  let workDir: string;
  let artDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-source-roles-'));
    pipelineDir = join(root, 'pipeline');
    workDir = join(root, 'work');
    artDir = join(workDir, 'intake.flow');
    await mkdir(pipelineDir);
    await mkdir(workDir);
    await writeFile(
      join(pipelineDir, 'text2gears.md'),
      formats('text', 'gears'),
    );
    await writeFile(
      join(pipelineDir, 'gears2note.md'),
      formats('gears', 'note'),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Records every request; writes nothing. */
  const recording = (): {
    executor: PhaseExecutor;
    calls: ExecuteRequest[];
  } => {
    const calls: ExecuteRequest[] = [];
    return {
      calls,
      executor: {
        async run(request) {
          calls.push(request);
          return { status: 'ok', diagnostics: [] };
        },
      },
    };
  };

  const deps = (executor: PhaseExecutor): SlcDeps => ({
    resolver: (name) => (name === 'flow' ? [pipelineDir] : []),
    executor,
    cwd: workDir,
  });

  const exists = async (path: string): Promise<boolean> =>
    access(path).then(
      () => true,
      () => false,
    );

  it.each([
    ['an entry-form', 'intake.md', 'text2gears', 'intake.gears.md'],
    ['a raw', 'intake.txt', 'normalize', 'intake.text.md'],
  ])(
    'refuses %s Source before any executor runs',
    async (_label, name, phase, targetName) => {
      const source = join(workDir, name);
      await writeFile(source, await readFile(FIXTURE, 'utf8'));
      const { executor, calls } = recording();

      const result = await runSlc(['flow', source], deps(executor));

      expect(result.ok).toBe(false);
      const report = result.diagnostics.join('\n');
      expect(report).toContain(
        `slc: phase "${phase}" failed at "${join(artDir, targetName)}"`,
      );
      expect(report).toContain(`invalid Source: ${source}`);
      expect(report).toContain(TWO_WORD_FINDING);
      expect(calls).toEqual([]);
      expect(await exists(join(artDir, targetName))).toBe(false);
    },
  );

  it('reaches the executor once the role is one word', async () => {
    const source = join(workDir, 'intake.md');
    await writeFile(
      source,
      (await readFile(FIXTURE, 'utf8')).replaceAll(
        'Business Analyst',
        'BusinessAnalyst',
      ),
    );
    const { executor, calls } = recording();

    await runSlc(['flow', source], deps(executor));

    expect(calls[0]).toMatchObject({ kind: 'compile', source });
  });
});
