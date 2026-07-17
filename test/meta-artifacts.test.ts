// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Behavior pins for the reviewed compiled meta-phase artifacts under
// pipelines/playbook/{text2gears,gears2fsm,link}.slc, rebuilt against the
// composed six-port Playbook 0.10 profile: `init` takes a root
// `PlaybookSession`, `handleBossInput` returns a structured
// `PlaybookRunResult`, and every working state performs direct Captain work
// (`callCaptain`, visible) adjudicated through `callJudge` — these machines
// declare no delegated player, so no turn ever crosses `callPlayer`.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type {
  CaptainCallOptions,
  PlaybookPorts,
  PlaybookRuntime,
  PlaybookSession,
} from '@sublang/playbook/runtime';

import createGears2Fsm from '../pipelines/playbook/gears2fsm.slc/gears2fsm.playbook.js';
import createLink from '../pipelines/playbook/link.slc/link.playbook.js';
import createText2Gears from '../pipelines/playbook/text2gears.slc/text2gears.playbook.js';

const pipelineDir = fileURLToPath(
  new URL('../pipelines/playbook/', import.meta.url),
);

// The link classifier supplies LINK_REQUEST's two structured routing fields;
// the runtime substitutes `<fsm-artifact>` in the Captain prompt from context
// seeded by them (link.playbook.ts §Boss-event mapping).
const LINK_CLASSIFICATION =
  '{"type":"LINK_REQUEST","fsmArtifact":"/tmp/machine.fsm.ts","target":"/tmp/machine.playbook.ts"}';

const quietPorts = (overrides: Partial<PlaybookPorts> = {}): PlaybookPorts => ({
  callPlayer: async () => ({ status: 'ok', finalText: 'done' }),
  callCaptain: async () => ({
    status: 'ok',
    finalText: 'The work is complete.',
  }),
  callJudge: async () => '{"guard":"done"}',
  callPlaybook: async () => {
    throw new Error('the meta playbooks make no nested playbook calls');
  },
  emitStatus: async () => {},
  emitTelemetry: async () => {},
  ...overrides,
});

let sessionCounter = 0;

// Root session shape per the composed contract (src/compiled-executor.ts
// rootSession/composedPorts): depth 0, rootSessionId === sessionId, no parent
// identity, and all six composed ports.
const rootSession = (
  overrides: Partial<PlaybookPorts> = {},
): PlaybookSession => {
  sessionCounter += 1;
  const sessionId = `meta-artifacts-session-${sessionCounter}`;
  return {
    sessionId,
    playbookId: 'meta-artifact-under-test',
    rootSessionId: sessionId,
    depth: 0,
    ports: quietPorts(overrides),
  };
};

/** stateId carried by the `to` descriptor of `playbook.fsm.state` telemetry. */
function transitionTarget(event: {
  topic: string;
  payload: unknown;
}): string | undefined {
  if (event.topic !== 'playbook.fsm.state') return undefined;
  const payload = event.payload;
  if (typeof payload !== 'object' || payload === null || !('to' in payload)) {
    return undefined;
  }
  const to = (payload as { to: unknown }).to;
  if (typeof to !== 'object' || to === null || !('stateId' in to)) {
    return undefined;
  }
  const stateId = (to as { stateId: unknown }).stateId;
  return typeof stateId === 'string' ? stateId : undefined;
}

function onceAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

interface ArtifactCase {
  readonly name: string;
  readonly create: () => PlaybookRuntime;
  readonly bossText: string;
  /**
   * Judge replies in call order. text2gears and gears2fsm enter from `ready`
   * through their deterministic COMPILE event, so their sole judge call is the
   * Captain-output adjudication; link classifies first, then adjudicates.
   */
  readonly judgeReplies: readonly string[];
  /** Substring the first judge prompt must carry. */
  readonly firstJudgeAnchor: string;
  /** Substring the composed direct-Captain prompt must carry. */
  readonly promptAnchor: string;
}

const ADJUDICATION_ANCHOR = 'Adjudicate the direct Captain output';

const artifacts: readonly ArtifactCase[] = [
  {
    name: 'text2gears',
    create: () => createText2Gears({}),
    bossText: 'Compile the requested source into GEARS.',
    judgeReplies: ['{"guard":"compiled"}'],
    firstJudgeAnchor: ADJUDICATION_ANCHOR,
    promptAnchor: 'free-form natural-language procedure description',
  },
  {
    name: 'gears2fsm',
    create: () => createGears2Fsm({}),
    bossText: 'Compile the GEARS package into an FSM.',
    judgeReplies: ['{"guard":"compiled"}'],
    firstJudgeAnchor: ADJUDICATION_ANCHOR,
    promptAnchor: 'XState v5 finite state machine',
  },
  {
    name: 'link',
    create: () => createLink({}),
    bossText: 'Link /tmp/machine.fsm.ts into /tmp/machine.playbook.ts.',
    judgeReplies: [LINK_CLASSIFICATION, '{"guard":"done"}'],
    firstJudgeAnchor: 'Classify this Boss message for the link playbook FSM.',
    promptAnchor: '/tmp/machine.fsm.ts',
  },
];

describe('reviewed compiled meta-phase artifacts', () => {
  it('carries post-build definition amendments into the compiled prompts', async () => {
    // gears2fsm: the round-2 default single-outcome contract and the universal
    // busy-tag rule, alongside the erasable-syntax rule the artifacts rely on.
    const gears2fsm = await readFile(
      `${pipelineDir}/gears2fsm.slc/gears2fsm.gears.md`,
      'utf8',
    );
    expect(gears2fsm).toContain('default single-outcome contract');
    expect(gears2fsm).toContain('The acting agent completed the behavior.');
    expect(gears2fsm).toContain('Tag every invoking working leaf');
    expect(gears2fsm).toContain('playbook.busy');
    expect(gears2fsm).toContain('erasable TypeScript syntax');

    // link: DR-016 script execution and the composed six-port contract.
    const link = await readFile(
      `${pipelineDir}/link.slc/link.gears.md`,
      'utf8',
    );
    expect(link).toContain('Executed script for');
    expect(link).toContain('sh -c');
    expect(link).toContain(
      'implements the six ports once and inherits every playbook',
    );
    expect(link).toContain('erasable TypeScript syntax');

    // text2gears: the produced-value rule backing placeholders with typed
    // Results properties.
    const text2gears = await readFile(
      `${pipelineDir}/text2gears.slc/text2gears.gears.md`,
      'utf8',
    );
    expect(text2gears).toContain("using the placeholder's exact identifier");
  });

  it.each(artifacts)(
    '$name drives one Boss turn through visible direct Captain work to terminal',
    async ({
      create,
      bossText,
      judgeReplies,
      firstJudgeAnchor,
      promptAnchor,
    }) => {
      const runtime = create();
      const replies = [...judgeReplies];
      const judgePrompts: string[] = [];
      const captainPrompts: string[] = [];
      const captainOptions: CaptainCallOptions[] = [];
      let playerCalls = 0;
      await runtime.init(
        rootSession({
          callPlayer: async () => {
            playerCalls += 1;
            return { status: 'ok', finalText: 'done' };
          },
          callCaptain: async (prompt, _signal, options) => {
            captainPrompts.push(prompt);
            captainOptions.push(options);
            return { status: 'ok', finalText: 'The work is complete.' };
          },
          callJudge: async (prompt) => {
            judgePrompts.push(prompt);
            const reply = replies.shift();
            if (reply === undefined) throw new Error('unexpected judge call');
            return reply;
          },
        }),
      );

      const result = await runtime.handleBossInput({
        text: bossText,
        signal: new AbortController().signal,
      });

      expect(result.outcome).toBe('terminal');
      // Direct Captain work: exactly one visible, non-resuming call carrying
      // the GEARS-derived prompt body. These transformation-performing
      // Captains carry no source-owned tool restriction (link.md
      // §PlaybookPorts contract), so the host Captain works with its tools.
      expect(captainPrompts).toHaveLength(1);
      expect(captainPrompts[0]).toContain(promptAnchor);
      expect(captainOptions).toEqual([
        { visibility: 'visible', resume: false },
      ]);
      // Adjudication goes through callJudge; no callPlayer in these machines.
      expect(judgePrompts).toHaveLength(judgeReplies.length);
      expect(judgePrompts[0]).toContain(firstJudgeAnchor);
      expect(judgePrompts.at(-1)).toContain(ADJUDICATION_ANCHOR);
      expect(playerCalls).toBe(0);
      await runtime.dispose();
    },
  );

  it('passes the active turn abort signal into text2gears direct Captain work', async () => {
    const runtime = createText2Gears({});
    const controller = new AbortController();
    let started!: () => void;
    const captainStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    let judgeCalls = 0;
    await runtime.init(
      rootSession({
        callCaptain: async (_prompt, signal) => {
          observedSignal = signal;
          started();
          await onceAborted(signal);
          return { status: 'aborted' };
        },
        callJudge: async () => {
          judgeCalls += 1;
          return '{"guard":"compiled"}';
        },
      }),
    );

    const turn = runtime.handleBossInput({
      text: 'Compile the requested source.',
      signal: controller.signal,
    });
    await captainStarted;
    controller.abort();
    const result = await turn;
    expect(result.outcome).toBe('aborted');
    expect(observedSignal?.aborted).toBe(true);
    // Entry from `ready` is deterministic (no classifier call) and an aborted
    // Captain call is never adjudicated, so the judge port is never crossed.
    expect(judgeCalls).toBe(0);
    await runtime.dispose();
  });

  it('pairs a gears2fsm Captain result that resolves ok after abort as aborted', async () => {
    const runtime = createGears2Fsm({});
    const controller = new AbortController();
    let started!: () => void;
    const captainStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let judgeCalls = 0;
    await runtime.init(
      rootSession({
        callJudge: async () => {
          judgeCalls += 1;
          return '{"guard":"compiled"}';
        },
        callCaptain: async () => {
          started();
          await onceAborted(controller.signal);
          return { status: 'ok', finalText: 'Compiled the machine.' };
        },
      }),
    );

    const turn = runtime.handleBossInput({
      text: 'Compile the GEARS package.',
      signal: controller.signal,
    });
    await captainStarted;
    controller.abort();
    const result = await turn;
    // A host promise that ignores cancellation and resolves late is paired as
    // aborted; the late ok result is never adjudicated and does not masquerade
    // as success.
    expect(result.outcome).toBe('aborted');
    expect(judgeCalls).toBe(0);
    await runtime.dispose();
  });

  // CONTRACT VIOLATION (reported, not pinned): link.playbook.ts `lastError()`
  // snapshots the raw Error the FSM stores in `context.lastError` without the
  // The link artifact now applies the same normalizeError fallback as its
  // siblings, so an abort routed through link's `failed` state settles as
  // `{ outcome: 'aborted' }` (LINK-1 §Status and telemetry).
  it('pairs a link Captain result that resolves ok after abort as aborted', async () => {
    const runtime = createLink({});
    const controller = new AbortController();
    let started!: () => void;
    const captainStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let judgeCalls = 0;
    await runtime.init(
      rootSession({
        callJudge: async () => {
          judgeCalls += 1;
          return LINK_CLASSIFICATION;
        },
        callCaptain: async () => {
          started();
          await onceAborted(controller.signal);
          return { status: 'ok', finalText: 'Linked the runtime module.' };
        },
      }),
    );

    const turn = runtime.handleBossInput({
      text: 'Link the FSM artifact.',
      signal: controller.signal,
    });
    await captainStarted;
    controller.abort();
    const result = await turn;
    // Late ok result paired as aborted; only the classification judge call ran.
    expect(result.outcome).toBe('aborted');
    expect(judgeCalls).toBe(1);
    await runtime.dispose();
  });

  it.each(artifacts)(
    '$name returns an aborted result from a pre-aborted turn without crossing any agent port',
    async ({ create, bossText }) => {
      const runtime = create();
      let judgeCalls = 0;
      let captainCalls = 0;
      await runtime.init(
        rootSession({
          callJudge: async () => {
            judgeCalls += 1;
            return '{"type":"NO_ACTION"}';
          },
          callCaptain: async () => {
            captainCalls += 1;
            return { status: 'ok', finalText: 'done' };
          },
        }),
      );
      const controller = new AbortController();
      controller.abort();

      const result = await runtime.handleBossInput({
        text: bossText,
        signal: controller.signal,
      });
      expect(result.outcome).toBe('aborted');
      expect(judgeCalls).toBe(0);
      expect(captainCalls).toBe(0);
      await runtime.dispose();
    },
  );

  it('ignores a link classifier result that resolves after abort', async () => {
    const runtime = createLink({});
    const controller = new AbortController();
    let captainCalls = 0;
    await runtime.init(
      rootSession({
        callJudge: async () => {
          controller.abort();
          return LINK_CLASSIFICATION;
        },
        callCaptain: async () => {
          captainCalls += 1;
          return { status: 'ok', finalText: 'done' };
        },
      }),
    );

    const result = await runtime.handleBossInput({
      text: 'Link the artifact.',
      signal: controller.signal,
    });
    expect(result.outcome).toBe('aborted');
    expect(captainCalls).toBe(0);
    await runtime.dispose();
  });

  it('does not complete gears2fsm from an adjudication returned after abort', async () => {
    const runtime = createGears2Fsm({});
    const controller = new AbortController();
    const states: string[] = [];
    await runtime.init(
      rootSession({
        callCaptain: async () => ({
          status: 'ok',
          finalText: 'Compiled the machine.',
        }),
        callJudge: async () => {
          controller.abort();
          return '{"guard":"compiled"}';
        },
        emitTelemetry: async (event) => {
          const target = transitionTarget(event);
          if (target !== undefined) states.push(target);
        },
      }),
    );

    const result = await runtime.handleBossInput({
      text: 'Compile the GEARS package.',
      signal: controller.signal,
    });
    expect(result.outcome).toBe('aborted');
    expect(states).toContain('failed');
    expect(states).not.toContain('done');
    await runtime.dispose();
  });

  it.each([
    {
      name: 'gears2fsm',
      create: (): PlaybookRuntime => createGears2Fsm({}),
      priorReplies: [] as readonly string[],
      bossText: 'Compile the GEARS package.',
    },
    {
      name: 'link',
      create: (): PlaybookRuntime => createLink({}),
      priorReplies: [LINK_CLASSIFICATION] as readonly string[],
      bossText: 'Link the artifact.',
    },
  ])(
    '$name surfaces an adjudicator fault as a turn rejection, not a failed outcome',
    async ({ create, priorReplies, bossText }) => {
      const runtime = create();
      const fault = new Error('adjudicator-fault');
      const replies = [...priorReplies];
      await runtime.init(
        rootSession({
          callJudge: async () => {
            const reply = replies.shift();
            if (reply === undefined) throw fault;
            return reply;
          },
        }),
      );

      // Control-plane exceptions reject the runtime method with the original
      // failure rather than settling into a recoverable `failed` result.
      await expect(
        runtime.handleBossInput({
          text: bossText,
          signal: new AbortController().signal,
        }),
      ).rejects.toBe(fault);
      await runtime.dispose();
    },
  );

  it('normalizes an undefined adjudicator rejection into a control-plane error', async () => {
    const runtime = createText2Gears({});
    await runtime.init(
      rootSession({
        callJudge: () => Promise.reject(undefined),
      }),
    );

    // A degenerate `undefined` judge rejection still rejects the turn; the
    // runtime surfaces it as its normalized missing-reply control error.
    let caught: unknown = 'turn resolved';
    try {
      await runtime.handleBossInput({
        text: 'Compile.',
        signal: new AbortController().signal,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('judge returned no reply');
    await runtime.dispose();
  });

  it('does not leak a masked text2gears adjudicator fault into a later turn', async () => {
    const runtime = createText2Gears({});
    let judgeCalls = 0;
    let failEmission = true;
    await runtime.init(
      rootSession({
        callCaptain: async () => ({
          status: 'ok',
          finalText: 'A GEARS package.',
        }),
        callJudge: async () => {
          judgeCalls += 1;
          if (judgeCalls === 1) throw new Error('judge-fail');
          return '{"guard":"compiled"}';
        },
        emitTelemetry: async (event) => {
          if (failEmission && transitionTarget(event) === 'failed') {
            failEmission = false;
            throw new Error('emit-fail');
          }
        },
      }),
    );

    // The first latched control error (the adjudicator fault) takes precedence
    // over the telemetry sink failure raised while settling into `failed`.
    await expect(
      runtime.handleBossInput({
        text: 'First attempt.',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('judge-fail');
    // Neither error leaks into the recovery turn, which runs to terminal.
    const recovery = await runtime.handleBossInput({
      text: 'Recovery attempt.',
      signal: new AbortController().signal,
    });
    expect(recovery.outcome).toBe('terminal');
    await runtime.dispose();
  });

  it.each(artifacts)(
    '$name surfaces a host telemetry emission failure from init',
    async ({ create }) => {
      const runtime = create();
      await expect(
        runtime.init(
          rootSession({
            emitTelemetry: async () => {
              throw new Error('telemetry sink failed');
            },
          }),
        ),
      ).rejects.toThrow(/telemetry sink failed/);
      // Failed initialization leaves the runtime terminally disposable.
      await expect(runtime.dispose()).resolves.toBeUndefined();
    },
  );
});
