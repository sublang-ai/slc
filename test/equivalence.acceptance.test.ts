// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadFsmModule } from '../src/verify.js';
import {
  checkPlaybookIntegrity,
  checkReferenceEquivalence,
  hasBossReplySurface,
  playerLineSets,
  runtimeCapabilityProfile,
  type CompiledPlaybook,
  type RuntimeCapabilityProfile,
} from './equivalence.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
// The dependency lock selects the released oracle used in every environment;
// an unrelated mutable sibling checkout must not change acceptance semantics.
const referenceDir = join(
  repoRoot,
  'node_modules/@sublang/playbook/reference/sdlc/code.playbook',
);

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

const profileState = {
  value: 'ready',
  activeStateIds: ['ready'],
  tags: ['playbook.parked'],
  status: 'active' as const,
  quiescent: true,
};

function withRuntimeProfile(
  compiled: CompiledPlaybook,
  profile: RuntimeCapabilityProfile,
): CompiledPlaybook {
  return {
    ...compiled,
    playbook: {
      runtimeContractProfile: profile,
      default: () => ({
        init: async () => {},
        handleBossInput: async () =>
          profile === 'composed-v2'
            ? { outcome: 'no-action', state: profileState }
            : undefined,
        ...(profile === 'composed-v2'
          ? { resumePlaybookCall: async () => {} }
          : {}),
        dispose: async () => {},
      }),
    },
  };
}

function unmarkedStrictRuntime(profile: 'legacy' | 'session-v1'): unknown {
  return {
    default: () => {
      let ports: { callJudge(prompt: string, signal: AbortSignal): unknown };
      return {
        async init(value: unknown) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('invalid init value');
          }
          const record = value as Record<string, unknown>;
          const selected =
            profile === 'legacy'
              ? record
              : (record.ports as Record<string, unknown> | undefined);
          if (
            profile === 'session-v1' &&
            (record.sessionId !== 'slc-profile-probe' ||
              record.playbookId !== 'probe')
          ) {
            throw new Error('session identity is required');
          }
          if (typeof selected?.callJudge !== 'function') {
            throw new Error('exact profile ports are required');
          }
          ports = selected as typeof ports;
        },
        async handleBossInput(turn: { signal: AbortSignal }) {
          await ports.callJudge('classify probe', turn.signal);
        },
        async dispose() {},
      };
    },
  };
}

function unmarkedStrictComposedRuntime(): unknown {
  return {
    default: () => {
      let ports: {
        callCaptain(
          prompt: string,
          signal: AbortSignal,
          options: {
            visibility: 'visible' | 'hidden';
            resume: false;
            allowedTools: readonly [];
          },
        ): Promise<unknown>;
      };
      return {
        async init(value: unknown) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('invalid init value');
          }
          const record = value as Record<string, unknown>;
          if (
            record.sessionId !== 'slc-profile-probe' ||
            record.playbookId !== 'probe' ||
            record.rootSessionId !== 'slc-profile-probe' ||
            record.depth !== 0
          ) {
            throw new Error('causal root identity is required');
          }
          if (typeof record.ports !== 'object' || record.ports === null) {
            throw new Error('composed ports are required');
          }
          const selected = record.ports as Record<string, unknown>;
          const names = Object.keys(selected).sort();
          if (
            JSON.stringify(names) !==
              JSON.stringify([
                'callCaptain',
                'callJudge',
                'callPlaybook',
                'callPlayer',
                'emitStatus',
                'emitTelemetry',
              ]) ||
            names.some((name) => typeof selected[name] !== 'function')
          ) {
            throw new Error('exact six-port profile is required');
          }
          ports = selected as unknown as typeof ports;
        },
        async handleBossInput(turn: { signal: AbortSignal }) {
          await ports.callCaptain('direct probe', turn.signal, {
            visibility: 'hidden',
            resume: false,
            allowedTools: [],
          });
          return { outcome: 'no-action', state: profileState };
        },
        async resumePlaybookCall() {
          return { outcome: 'no-action', state: profileState };
        },
        async dispose() {},
      };
    },
  };
}

describe('reference equivalence harness (VERIFY-9)', () => {
  it('accepts the reference compared to itself', async () => {
    const reference = await loadReference();
    expect(
      await checkReferenceEquivalence({ produced: reference, reference }),
    ).toEqual([]);
  });

  it('accepts each matching exact runtime contract profile', async () => {
    const reference = await loadReference();
    for (const profile of ['legacy', 'session-v1', 'composed-v2'] as const) {
      const compiled = withRuntimeProfile(reference, profile);
      expect(await runtimeCapabilityProfile(compiled.playbook)).toBe(profile);
      expect(
        await checkReferenceEquivalence({
          produced: compiled,
          reference: compiled,
        }),
      ).toEqual([]);
    }
  });

  it.each([
    ['legacy', 'session-v1'],
    ['session-v1', 'composed-v2'],
    ['legacy', 'composed-v2'],
  ] as const)(
    'rejects a %s vs %s runtime contract mismatch',
    async (producedProfile, referenceProfile) => {
      const reference = await loadReference();
      const findings = await checkReferenceEquivalence({
        produced: withRuntimeProfile(reference, producedProfile),
        reference: withRuntimeProfile(reference, referenceProfile),
      });
      expect(findings).toContain(
        `runtime contract profiles differ: produced ${producedProfile} vs reference ${referenceProfile}`,
      );
    },
  );

  it('treats an unmarked released three-method runtime as legacy', async () => {
    const reference = await loadReference();
    expect(await runtimeCapabilityProfile(reference.playbook)).toBe('legacy');
  });

  it('distinguishes unmarked legacy and session-v1 init boundaries', async () => {
    expect(
      await runtimeCapabilityProfile(unmarkedStrictRuntime('legacy')),
    ).toBe('legacy');
    expect(
      await runtimeCapabilityProfile(unmarkedStrictRuntime('session-v1')),
    ).toBe('session-v1');
  });

  it('supplies the exact six-port composed-v2 probe boundary', async () => {
    expect(
      await runtimeCapabilityProfile(unmarkedStrictComposedRuntime()),
    ).toBe('composed-v2');
  });

  it.each([
    [
      'session-v1 with a resumable surface',
      {
        runtimeContractProfile: 'session-v1',
        default: () => ({
          init: async () => {},
          handleBossInput: async () => {},
          resumePlaybookCall: async () => {},
          dispose: async () => {},
        }),
      },
      'session-v1 runtime unexpectedly exposes resumePlaybookCall()',
    ],
    [
      'composed-v2 without a resumable surface',
      {
        runtimeContractProfile: 'composed-v2',
        default: () => ({
          init: async () => {},
          handleBossInput: async () => {},
          dispose: async () => {},
        }),
      },
      'composed-v2 runtime lacks resumePlaybookCall()',
    ],
  ] as const)(
    'rejects an inconsistent marker: %s',
    async (_name, playbook, expected) => {
      const reference = await loadReference();
      const compiled = { ...reference, playbook };
      expect(await runtimeCapabilityProfile(playbook)).toBeNull();
      expect(await checkPlaybookIntegrity('marked', compiled)).toContain(
        `marked: ${expected}`,
      );
    },
  );

  it('recognizes a branch-local structured Boss-reply wait surface', () => {
    expect(
      hasBossReplySurface({
        states: {
          parallel: {
            type: 'parallel',
            states: {
              branch: {
                states: {
                  waiting: {
                    id: 'waitBranchReply',
                    tags: 'playbook.parked',
                    on: { BOSS_REPLY: { target: 'working' } },
                  },
                },
              },
            },
          },
        },
      }),
    ).toBe(true);
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

  it('binds the reference prompt lines to Coder, Reviewer, and Committer', async () => {
    const reference = await loadReference();
    const players = [...playerLineSets(reference.gears).keys()].sort();
    expect(players).toEqual(['Coder', 'Committer', 'Reviewer']);
  });

  it('keys nested calls by playbook target rather than Captain', () => {
    const nested = (target: string) => `## Behaviors

### FLOW-1

When review is needed, Captain shall call playbook \`${target}\`:
> Review the current changes.
`;
    expect([...playerLineSets(nested('code-review')).keys()]).toEqual([
      'playbook:code-review',
    ]);
    expect([...playerLineSets(nested('security-review')).keys()]).toEqual([
      'playbook:security-review',
    ]);
  });

  // The real acceptance: `slc playbook <source>` output compared to the manual
  // reference (IR-007 Task 9). Gated on a produced directory — a real agent
  // compile — so a clean checkout skips rather than fails.
  it('accepts real slc playbook output when produced (gated)', async (context) => {
    const producedDir =
      process.env.SLC_EQUIVALENCE_DIR ??
      join(repoRoot, '.scratch/sdlc/code.playbook');
    if (!existsSync(join(producedDir, 'code.playbook.ts'))) {
      console.warn(
        `equivalence: no produced output at ${producedDir}; run \`slc playbook <code.md> --link @sublang/playbook\` there first`,
      );
      context.skip();
      return;
    }
    const produced = await loadProduced(producedDir);
    const reference = await loadReference();
    expect(await checkReferenceEquivalence({ produced, reference })).toEqual(
      [],
    );
  });
});
