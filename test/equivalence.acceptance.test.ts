// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadFsmModule } from '../src/verify.js';
import {
  checkReferenceEquivalence,
  checkSourceFaithfulness,
  playerLineSets,
  type CompiledPlaybook,
} from './equivalence.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const referenceDir = join(
  repoRoot,
  'node_modules/@sublang/playbook/reference/sdlc/code.playbook',
);
// The sibling checkout carries the workflow source the reference was compiled
// from; the installed package ships only the compiled artifacts.
const siblingSource = join(repoRoot, '../playbook/reference/sdlc/code.md');

/** Loads the manual reference package as a {@link CompiledPlaybook}. */
async function loadReference(): Promise<CompiledPlaybook> {
  return {
    gears: readFileSync(join(referenceDir, 'code.gears.md'), 'utf8'),
    fsm: await import(join(referenceDir, 'code.fsm.js')),
    playbook: await import(join(referenceDir, 'code.playbook.js')),
    fsmSource: readFileSync(join(referenceDir, 'code.fsm.ts'), 'utf8'),
  };
}

/** Loads an `slc playbook` output directory as a {@link CompiledPlaybook}. */
async function loadProduced(dir: string): Promise<CompiledPlaybook> {
  return {
    gears: readFileSync(join(dir, 'code.gears.md'), 'utf8'),
    fsm: await loadFsmModule(join(dir, 'code.fsm.ts')),
    playbook: await loadFsmModule(join(dir, 'code.playbook.ts')),
    fsmSource: readFileSync(join(dir, 'code.fsm.ts'), 'utf8'),
  };
}

describe('reference equivalence harness (VERIFY-9)', () => {
  it('accepts the reference compared to itself', async () => {
    const reference = await loadReference();
    expect(
      await checkReferenceEquivalence({ produced: reference, reference }),
    ).toEqual([]);
  });

  it('rejects a compilation that drops or rewrites a prompt line', async () => {
    const reference = await loadReference();
    const drifted: CompiledPlaybook = {
      ...reference,
      gears: reference.gears.replaceAll(
        "> Think thoroughly — don't just approve or reject.",
        '> Think about it.',
      ),
    };
    const findings = await checkReferenceEquivalence({
      produced: drifted,
      reference,
    });
    expect(findings.join('\n')).toMatch(/lacks the line/);
    expect(findings.join('\n')).toMatch(/adds the line "Think about it\."/);
  });

  it('rejects a compilation that loses a player', async () => {
    const reference = await loadReference();
    const drifted: CompiledPlaybook = {
      ...reference,
      gears: reference.gears.replaceAll('Committer', 'Reviewer'),
    };
    const findings = await checkReferenceEquivalence({
      produced: drifted,
      reference,
    });
    expect(findings.join('\n')).toMatch(/player sets differ/);
  });

  it('holds source faithfulness for the reference gears against code.md', () => {
    if (!existsSync(siblingSource)) return; // sibling checkout absent
    const gears = readFileSync(join(referenceDir, 'code.gears.md'), 'utf8');
    const source = readFileSync(siblingSource, 'utf8');
    expect(checkSourceFaithfulness(source, gears)).toEqual([]);
  });

  it('binds the reference prompt lines to Coder, Reviewer, and Committer', async () => {
    const reference = await loadReference();
    const players = [...playerLineSets(reference.gears).keys()].sort();
    expect(players).toEqual(['Coder', 'Committer', 'Reviewer']);
  });

  // The real acceptance: `slc playbook <source>` output compared to the manual
  // reference (IR-007 Task 9). Gated on a produced directory — a real agent
  // compile — so a clean checkout skips rather than fails.
  it('accepts real slc playbook output when produced (gated)', async () => {
    const producedDir =
      process.env.SLC_EQUIVALENCE_DIR ??
      join(repoRoot, '.scratch/sdlc/code.playbook');
    if (!existsSync(join(producedDir, 'code.playbook.ts'))) {
      console.warn(
        `equivalence: no produced output at ${producedDir}; run \`slc playbook <code.md> --link @sublang/playbook\` there first`,
      );
      return;
    }
    const produced = await loadProduced(producedDir);
    const reference = await loadReference();
    expect(await checkReferenceEquivalence({ produced, reference })).toEqual(
      [],
    );
    if (existsSync(siblingSource)) {
      expect(
        checkSourceFaithfulness(
          readFileSync(siblingSource, 'utf8'),
          produced.gears,
        ),
      ).toEqual([]);
    }
  });
});
