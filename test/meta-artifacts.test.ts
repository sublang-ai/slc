// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';

import type { PlaybookPorts } from '@sublang/playbook/runtime';

import createGears2Fsm from '../pipelines/playbook/gears2fsm.slc/gears2fsm.playbook.js';
import createLink, {
  _internal as linkInternal,
} from '../pipelines/playbook/link.slc/link.playbook.js';
import createText2Gears from '../pipelines/playbook/text2gears.slc/text2gears.playbook.js';

const pipelineDir = fileURLToPath(
  new URL('../pipelines/playbook/', import.meta.url),
);

const quietPorts = (overrides: Partial<PlaybookPorts> = {}): PlaybookPorts => ({
  callPlayer: async () => ({ status: 'ok', finalText: 'done' }),
  callJudge: async () => '{"guard":"completed"}',
  emitStatus: async () => {},
  emitTelemetry: async () => {},
  ...overrides,
});

describe('reviewed compiled meta-phase artifacts', () => {
  it('carries post-build definition amendments into the compiled prompts', async () => {
    const gears2fsm = await readFile(
      `${pipelineDir}/gears2fsm.slc/gears2fsm.gears.md`,
      'utf8',
    );
    expect(gears2fsm).toContain('erasable TypeScript syntax');
    expect(gears2fsm).toContain('preserve an existing input-seeded');

    const link = await readFile(
      `${pipelineDir}/link.slc/link.gears.md`,
      'utf8',
    );
    expect(link).toContain(
      'optional as optional in both the classifier contract',
    );
    expect(link).toContain('erasable TypeScript syntax');
  });

  it('passes the active turn abort signal to text2gears player work', async () => {
    const runtime = createText2Gears({});
    const controller = new AbortController();
    let started!: () => void;
    const playerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    await runtime.init(
      quietPorts({
        callJudge: async (prompt) => {
          if (prompt.includes('Classify the Boss input')) {
            return JSON.stringify({
              type: 'START_TEXT_TO_GEARS',
              source: '/tmp/source.md',
              target: '/tmp/target.md',
            });
          }
          return '{"guard":"completed"}';
        },
        callPlayer: async (_player, _prompt, signal) => {
          observedSignal = signal;
          started();
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return { status: 'aborted' };
        },
      }),
    );

    const turn = runtime.handleBossInput({
      text: 'Compile the requested source.',
      signal: controller.signal,
    });
    await playerStarted;
    controller.abort();
    await expect(turn).resolves.toBeUndefined();
    expect(observedSignal?.aborted).toBe(true);
    await runtime.dispose();
  });

  it('aborts link player work when XState stops its invocation', async () => {
    const outer = new AbortController();
    let started!: () => void;
    const playerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const logic = linkInternal.captainBridge(
      quietPorts({
        callPlayer: async (_player, _prompt, signal) => {
          observedSignal = signal;
          started();
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return { status: 'aborted' };
        },
      }),
      linkInternal.DEFAULT_PLAYER_BINDING,
      () => outer.signal,
      () => {},
    );
    const actor = createActor(logic, {
      input: {
        player: 'Captain',
        sourceItem: 'LINK-10',
        prompt: 'Link the input.',
        result: { completed: 'The link is complete.' },
      },
    });

    actor.start();
    await playerStarted;
    actor.stop();

    expect(outer.signal.aborted).toBe(false);
    expect(observedSignal?.aborted).toBe(true);
  });

  it('rejects link player work that resolves successfully after abort', async () => {
    const outer = new AbortController();
    let started!: () => void;
    const playerStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const logic = linkInternal.captainBridge(
      quietPorts({
        callPlayer: async () => {
          started();
          await new Promise<void>((resolve) => {
            outer.signal.addEventListener('abort', () => resolve(), {
              once: true,
            });
          });
          return { status: 'ok', finalText: 'completed' };
        },
        callJudge: async () => '{"guard":"completed"}',
      }),
      linkInternal.DEFAULT_PLAYER_BINDING,
      () => outer.signal,
      () => {},
    );
    const actor = createActor(logic, {
      input: {
        player: 'Captain',
        sourceItem: 'LINK-10',
        prompt: 'Link the input.',
        result: { completed: 'The link is complete.' },
      },
    });
    const settled = new Promise<string>((resolve) => {
      actor.subscribe({
        next: (snapshot) => {
          if (snapshot.status === 'done' || snapshot.status === 'error') {
            resolve(snapshot.status);
          }
        },
        error: () => resolve('error'),
      });
    });

    actor.start();
    await playerStarted;
    outer.abort();

    expect(await settled).toBe('error');
    actor.stop();
  });

  it('returns cleanly from a pre-aborted text2gears turn', async () => {
    const runtime = createText2Gears({});
    let judgeCalls = 0;
    await runtime.init(
      quietPorts({
        callJudge: async () => {
          judgeCalls++;
          return '{"type":"NO_EVENT"}';
        },
      }),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      runtime.handleBossInput({ text: 'Compile.', signal: controller.signal }),
    ).resolves.toBeUndefined();
    expect(judgeCalls).toBe(0);
    await runtime.dispose();
  });

  it('returns cleanly when text2gears classification resolves after abort', async () => {
    const runtime = createText2Gears({});
    const controller = new AbortController();
    let playerCalls = 0;
    await runtime.init(
      quietPorts({
        callJudge: async () => {
          controller.abort();
          return JSON.stringify({
            type: 'START_TEXT_TO_GEARS',
            source: '/tmp/source.md',
            target: '/tmp/target.md',
          });
        },
        callPlayer: async () => {
          playerCalls++;
          return { status: 'ok', finalText: 'done' };
        },
      }),
    );

    await expect(
      runtime.handleBossInput({
        text: 'Compile.',
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined();
    expect(playerCalls).toBe(0);
    await runtime.dispose();
  });

  it.each([
    ['gears2fsm', () => createGears2Fsm({}), '{"event":"START"}'],
    [
      'link',
      () => createLink({}),
      '{"event":"START_LINK","payload":{"request":"Link the artifact."}}',
    ],
  ])(
    '%s ignores a classifier result that resolves after abort',
    async (_name, create, classification) => {
      const runtime = create();
      const controller = new AbortController();
      let playerCalls = 0;
      await runtime.init(
        quietPorts({
          callJudge: async () => {
            controller.abort();
            return classification;
          },
          callPlayer: async () => {
            playerCalls++;
            return { status: 'ok', finalText: 'done' };
          },
        }),
      );

      await expect(
        runtime.handleBossInput({
          text: 'Start the phase.',
          signal: controller.signal,
        }),
      ).resolves.toBeUndefined();
      expect(playerCalls).toBe(0);
      await runtime.dispose();
    },
  );

  it('does not complete gears2fsm from adjudication returned after abort', async () => {
    const runtime = createGears2Fsm({});
    const controller = new AbortController();
    let judgeCalls = 0;
    const states: string[] = [];
    await runtime.init(
      quietPorts({
        callJudge: async () => {
          judgeCalls++;
          if (judgeCalls === 1) return '{"event":"START"}';
          controller.abort();
          return '{"guard":"transformed"}';
        },
        emitTelemetry: async (event) => {
          if (
            event.topic === 'playbook.fsm.state' &&
            typeof event.payload === 'object' &&
            event.payload !== null &&
            'to' in event.payload &&
            typeof event.payload.to === 'string'
          ) {
            states.push(event.payload.to);
          }
        },
      }),
    );

    await expect(
      runtime.handleBossInput({
        text: 'Start the phase.',
        signal: controller.signal,
      }),
    ).resolves.toBeUndefined();
    expect(states).toContain('failed');
    expect(states).not.toContain('done');
    await runtime.dispose();
  });

  it.each([
    ['gears2fsm', () => createGears2Fsm({}), '{"event":"START"}'],
    [
      'link',
      () => createLink({}),
      '{"event":"START_LINK","payload":{"request":"Link the artifact."}}',
    ],
  ])(
    '%s surfaces an undefined adjudicator rejection',
    async (_name, create, classification) => {
      const runtime = create();
      let judgeCalls = 0;
      await runtime.init(
        quietPorts({
          callJudge: async () => {
            judgeCalls++;
            if (judgeCalls === 1) return classification;
            return Promise.reject(undefined);
          },
        }),
      );
      let rejected = false;
      try {
        await runtime.handleBossInput({
          text: 'Start the phase.',
          signal: new AbortController().signal,
        });
      } catch (error) {
        rejected = true;
        expect(error).toBeUndefined();
      }
      expect(rejected).toBe(true);
      await runtime.dispose().catch(() => undefined);
    },
  );

  it.each([
    ['text2gears', () => createText2Gears({})],
    ['gears2fsm', () => createGears2Fsm({})],
    ['link', () => createLink({})],
  ])('%s surfaces host emission failures', async (_name, create) => {
    const runtime = create();
    let statusCalls = 0;
    await expect(
      runtime.init(
        quietPorts({
          emitTelemetry: async () => {
            throw new Error('telemetry sink failed');
          },
          emitStatus: async () => {
            statusCalls++;
          },
        }),
      ),
    ).rejects.toThrow(/telemetry sink failed/);
    expect(statusCalls).toBeGreaterThan(0);
    await runtime.dispose().catch(() => undefined);
  });

  it('surfaces an undefined host emission rejection', async () => {
    const runtime = createLink({});
    let rejected = false;
    try {
      await runtime.init(
        quietPorts({
          emitTelemetry: () => Promise.reject(undefined),
        }),
      );
    } catch (error) {
      rejected = true;
      expect(error).toBeUndefined();
    }
    expect(rejected).toBe(true);
    await runtime.dispose().catch(() => undefined);
  });

  it('does not leak a masked text2gears adjudicator fault into a later turn', async () => {
    const runtime = createText2Gears({});
    let judgeCalls = 0;
    let failEmission = true;
    await runtime.init(
      quietPorts({
        callJudge: async () => {
          judgeCalls++;
          if (judgeCalls === 1 || judgeCalls === 3) {
            return JSON.stringify({
              type: 'START_TEXT_TO_GEARS',
              source: '/tmp/source.md',
              target: '/tmp/target.md',
            });
          }
          if (judgeCalls === 2) throw new Error('judge-fail');
          return '{"guard":"completed"}';
        },
        emitTelemetry: async (event) => {
          if (
            failEmission &&
            typeof event.payload === 'object' &&
            event.payload !== null &&
            'to' in event.payload &&
            event.payload.to === 'failed'
          ) {
            failEmission = false;
            throw new Error('emit-fail');
          }
        },
      }),
    );

    await expect(
      runtime.handleBossInput({
        text: 'First attempt.',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('emit-fail');
    await expect(
      runtime.handleBossInput({
        text: 'Recovery attempt.',
        signal: new AbortController().signal,
      }),
    ).resolves.toBeUndefined();
    await runtime.dispose();
  });
});
