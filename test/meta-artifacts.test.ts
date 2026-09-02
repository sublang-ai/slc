// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Behavior pins for the reviewed compiled meta-phase artifacts under
// pipelines/playbook/{text2gears,gears2fsm,link}.slc, rebuilt once as
// compiled-execution control shells over the shared
// `createXStatePlaybookRuntime` engine (DR-028; Playbook DR-047): each bundle's
// GEARS is the one direct-Captain item its definition's `## Compiled execution`
// section states, whose prompt relays the definition through the single
// configured option `definition`. The linked factory takes exactly
// `configuredOptions` and `hostCapabilities`, `init` takes a root
// `PlaybookSession`, `handleBossInput` returns a structured `PlaybookRunResult`,
// and the one working state performs direct Captain work (`callCaptain`,
// visible) adjudicated through `callJudge` into `compiled` or `rejected` —
// these machines declare no delegated role, so no turn ever crosses
// `callPlayer`. text2gears and gears2fsm declare a deterministic textual entry
// event, so a fresh Boss turn enters with zero classifier calls; link declares
// a payload-free `TRANSFORMATION_REQUEST` that the classifier judge selects.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CaptainCallOptions,
  PlaybookPorts,
  PlaybookRuntime,
  PlaybookSession,
} from '@sublang/playbook/runtime';

import createGears2Fsm from '../pipelines/playbook/gears2fsm.slc/gears2fsm.playbook.js';
import createLink from '../pipelines/playbook/link.slc/link.playbook.js';
import createText2Gears from '../pipelines/playbook/text2gears.slc/text2gears.playbook.js';

import { checkCompiledExecutionFidelity } from '../src/compiled-execution.js';
import {
  composedV3FactoryInput,
  createCompiledExecutor,
} from '../src/compiled-executor.js';
import type { ExecuteRequest } from '../src/execution.js';
import type { AgentClient } from '../src/interpreter.js';
import type { CompatiblePlaybookRuntimeFactory } from '../src/playbook-contract.js';

const pipelineDir = fileURLToPath(
  new URL('../pipelines/playbook/', import.meta.url),
);

// Fixture definitions relayed as each bundle's single configured option
// (DR-028). The composed Captain prompt must carry these exact lines between
// the `--- DEFINITION ---` markers instead of a build-time transcription.
const DEFINITIONS = {
  text2gears:
    '# text2gears fixture definition\n\nCompose one GEARS item per behavior.\n',
  gears2fsm:
    '# gears2fsm fixture definition\n\nEmit one XState v5 machine per package.\n',
  link: '# link fixture definition\n\nLink the machine into a PlaybookRuntime.\n',
} as const;

// The shared engine's classifier and adjudicator prompt preambles.
const CLASSIFICATION_ANCHOR =
  'Classify the following Boss message into exactly one event.';
const ADJUDICATION_ANCHOR = 'Adjudicate the direct Captain output';

/** link classifies its payload-free entry as `TRANSFORMATION_REQUEST`. */
const TRANSFORMATION_REQUEST = '{"type":"TRANSFORMATION_REQUEST"}';
/** Every meta phase adjudicates its Captain output into `compiled`. */
const COMPILED = '{"guard":"compiled"}';

const quietPorts = (overrides: Partial<PlaybookPorts> = {}): PlaybookPorts => ({
  callPlayer: async () => ({ status: 'ok', finalText: 'done' }),
  callCaptain: async () => ({
    status: 'ok',
    finalText: 'The work is complete.',
  }),
  callJudge: async () => COMPILED,
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

/**
 * stateId carried by the `to` descriptor of `playbook.fsm.state` telemetry.
 * The shared factory engine carries `to` as the plain state id string; the
 * pre-2.0.0 fat artifacts carried a `{ stateId }` descriptor.
 */
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
  if (typeof to === 'string') return to;
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

const createArtifact = {
  text2gears: (): PlaybookRuntime =>
    createText2Gears(
      composedV3FactoryInput({ definition: DEFINITIONS.text2gears }),
    ),
  gears2fsm: (): PlaybookRuntime =>
    createGears2Fsm(
      composedV3FactoryInput({ definition: DEFINITIONS.gears2fsm }),
    ),
  link: (): PlaybookRuntime =>
    createLink(composedV3FactoryInput({ definition: DEFINITIONS.link })),
} as const;

interface ArtifactCase {
  readonly name: keyof typeof DEFINITIONS;
  readonly create: () => PlaybookRuntime;
  readonly bossText: string;
  /**
   * Judge replies in call order: link classifies its entry request first;
   * every artifact then adjudicates the direct Captain output against its
   * own authored outcome guards.
   */
  readonly judgeReplies: readonly string[];
  /** Substring the first judge prompt must carry. */
  readonly firstJudgeAnchor: string;
  /** Definition line the composed direct-Captain prompt must relay. */
  readonly promptAnchor: string;
}

const artifacts: readonly ArtifactCase[] = [
  {
    name: 'text2gears',
    create: createArtifact.text2gears,
    bossText: 'Compile the requested source into GEARS.',
    // Deterministic textual entry: the only judge call adjudicates TEXT2GEARS-1.
    judgeReplies: [COMPILED],
    firstJudgeAnchor: ADJUDICATION_ANCHOR,
    promptAnchor: 'Compose one GEARS item per behavior.',
  },
  {
    name: 'gears2fsm',
    create: createArtifact.gears2fsm,
    bossText: 'Compile the GEARS package into an FSM.',
    // Deterministic textual entry: the only judge call adjudicates GEARS2FSM-1.
    judgeReplies: [COMPILED],
    firstJudgeAnchor: ADJUDICATION_ANCHOR,
    promptAnchor: 'Emit one XState v5 machine per package.',
  },
  {
    name: 'link',
    create: createArtifact.link,
    bossText: 'Link /tmp/machine.fsm.ts into /tmp/machine.playbook.ts.',
    // Classified entry, then adjudication of LINK-1.
    judgeReplies: [TRANSFORMATION_REQUEST, COMPILED],
    firstJudgeAnchor: CLASSIFICATION_ANCHOR,
    promptAnchor: 'Link the machine into a PlaybookRuntime.',
  },
];

describe('reviewed compiled meta-phase artifacts', () => {
  it.each(['text2gears', 'gears2fsm', 'link'] as const)(
    "%s preserves its definition's compiled-execution contract verbatim (DR-028)",
    async (name) => {
      // The control shell is exactly the definition's closing section: the
      // acting prompt lines after Markdown unescaping and the `compiled` /
      // `rejected` result contract, on one direct-Captain item.
      const definition = await readFile(`${pipelineDir}/${name}.md`, 'utf8');
      const gears = await readFile(
        `${pipelineDir}/${name}.slc/${name}.gears.md`,
        'utf8',
      );
      expect(checkCompiledExecutionFidelity(definition, gears)).toEqual({
        applicable: true,
        findings: [],
        item: `${name.toUpperCase()}-1`,
      });
      expect(gears).toContain('> <definition>');
      expect(gears).not.toContain('<boss-intent>');
    },
  );

  it.each(artifacts)(
    '$name drives one Boss turn through visible direct Captain work to terminal',
    async ({
      name,
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
      // The adjudicated guard routes into the artifact's authored `compiled`
      // final state, not merely into some terminal state.
      expect(result.state.stateId).toBe('compiled');
      // Direct Captain work: exactly one visible, non-resuming call whose
      // prompt relays the configured definition between the markers with the
      // placeholder substituted (DR-028). These transformation-performing
      // Captains carry no source-owned tool restriction (link.md
      // §PlaybookPorts contract), so the host Captain works with its tools.
      expect(captainPrompts).toHaveLength(1);
      expect(captainPrompts[0]).toContain('--- DEFINITION ---');
      expect(captainPrompts[0]).toContain(promptAnchor);
      expect(captainPrompts[0]).toContain(DEFINITIONS[name].trimEnd());
      expect(captainPrompts[0]).toContain('--- END DEFINITION ---');
      expect(captainPrompts[0]).not.toContain('<definition>');
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
    const runtime = createArtifact.text2gears();
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
          return COMPILED;
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
    // The entry is deterministic, and an aborted Captain call is never
    // adjudicated, so no judge call occurs at all.
    expect(judgeCalls).toBe(0);
    await runtime.dispose();
  });

  it('pairs a gears2fsm Captain result that resolves ok after abort as aborted', async () => {
    const runtime = createArtifact.gears2fsm();
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
          return COMPILED;
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
    // aborted; the entry was deterministic and the late ok result is never
    // adjudicated, so it does not masquerade as success.
    expect(result.outcome).toBe('aborted');
    expect(judgeCalls).toBe(0);
    await runtime.dispose();
  });

  // The link artifact routes an abort through its `failed` state and settles
  // as `{ outcome: 'aborted' }`, the same normalized pairing its siblings
  // apply.
  it('pairs a link Captain result that resolves ok after abort as aborted', async () => {
    const runtime = createArtifact.link();
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
          return TRANSFORMATION_REQUEST;
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
    const runtime = createArtifact.link();
    const controller = new AbortController();
    let captainCalls = 0;
    await runtime.init(
      rootSession({
        callJudge: async () => {
          controller.abort();
          return TRANSFORMATION_REQUEST;
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
    const runtime = createArtifact.gears2fsm();
    const controller = new AbortController();
    const states: string[] = [];
    await runtime.init(
      rootSession({
        callCaptain: async () => ({
          status: 'ok',
          finalText: 'Compiled the machine.',
        }),
        callJudge: async () => {
          // The entry is deterministic, so the first judge call is the
          // adjudication; the abort lands during it.
          controller.abort();
          return COMPILED;
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
    // `compiled` is gears2fsm's completed terminal state.
    expect(states).not.toContain('compiled');
    await runtime.dispose();
  });

  it.each([
    {
      name: 'gears2fsm',
      create: createArtifact.gears2fsm,
      // Deterministic entry: the adjudication is the first judge call.
      priorReplies: [] as readonly string[],
      bossText: 'Compile the GEARS package.',
    },
    {
      name: 'link',
      create: createArtifact.link,
      priorReplies: [TRANSFORMATION_REQUEST] as readonly string[],
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

  it('does not leak a masked text2gears adjudicator fault into a later turn', async () => {
    const runtime = createArtifact.text2gears();
    let adjudications = 0;
    let failEmission = true;
    await runtime.init(
      rootSession({
        callCaptain: async () => ({
          status: 'ok',
          finalText: 'A GEARS package.',
        }),
        callJudge: async (prompt) => {
          // Recovery from `failed` may route through the interrupt classifier;
          // the root `BOSS_INTERRUPT` guard admits only the machine's own
          // working-leaf id and carries the fresh Boss intent.
          if (prompt.startsWith(CLASSIFICATION_ANCHOR)) {
            return JSON.stringify({
              type: 'BOSS_INTERRUPT',
              targetId: 'transform',
              bossIntent: 'Recovery attempt.',
            });
          }
          adjudications += 1;
          if (adjudications === 1) throw new Error('judge-fail');
          return COMPILED;
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

// Regressions at the compiled meta-phase SLC boundary: nullish host-port
// rejections must remain control-plane failures (phase-execution-26), the host
// relays the request's definition as the single configured option (DR-028),
// and the artifacts compose host-agnostic Captain prompts, so the host appends
// its workspace contract (phase-execution-35) before the Captain transport runs.
describe('compiled meta-phase SLC boundary (phase-execution-26, phase-execution-35)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-meta-workspace-'));
    // The composed-v3 host reads each request's definition before the
    // artifact loads and binds its exact bytes as the `definition` option
    // every compiled-execution bundle declares (DR-028).
    for (const name of ['text2gears.md', 'gears2fsm.md', 'link.md']) {
      await writeFile(join(root, name), `# ${name} fixture definition\n`);
    }
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // The meta machines delegate to no player; the port only satisfies wiring.
  const idlePlayer: AgentClient = {
    async run() {
      return { status: 'success', text: '' };
    },
  };

  interface WorkspaceCase {
    readonly name: string;
    readonly factory: CompatiblePlaybookRuntimeFactory;
    /** Phase request with workspace-relative paths, resolved by the executor. */
    readonly request: (dir: string) => ExecuteRequest;
    /** Workspace-relative target the fake Captain writes. */
    readonly target: string;
    /** Relayed definition line the composed prompt must carry. */
    readonly promptAnchor: string;
    /** Host-contract substrings the transported prompt must carry. */
    readonly workspaceAnchors: (dir: string) => string[];
    /** Judge replies: link classifies first; every artifact adjudicates last. */
    readonly judgeReply: (prompt: string) => string;
  }

  const cases: readonly WorkspaceCase[] = [
    {
      name: 'text2gears',
      factory: createText2Gears as CompatiblePlaybookRuntimeFactory,
      request: (dir) => ({
        kind: 'compile',
        definitionPath: join(dir, 'text2gears.md'),
        source: 'workflow.text.md',
        target: 'workflow.gears.raw.md',
      }),
      target: 'workflow.gears.raw.md',
      promptAnchor: '# text2gears.md fixture definition',
      workspaceAnchors: (dir) => [
        `source to read: ${join(dir, 'workflow.text.md')}`,
        `artifact to write: ${join(dir, 'workflow.gears.raw.md')}`,
        `write only ${join(dir, 'workflow.gears.raw.md')}`,
      ],
      judgeReply: () => COMPILED,
    },
    {
      name: 'gears2fsm',
      factory: createGears2Fsm as CompatiblePlaybookRuntimeFactory,
      request: (dir) => ({
        kind: 'compile',
        definitionPath: join(dir, 'gears2fsm.md'),
        source: 'workflow.gears.md',
        target: 'workflow.fsm.ts',
      }),
      target: 'workflow.fsm.ts',
      promptAnchor: '# gears2fsm.md fixture definition',
      workspaceAnchors: (dir) => [
        `source to read: ${join(dir, 'workflow.gears.md')}`,
        `artifact to write: ${join(dir, 'workflow.fsm.ts')}`,
        `write only ${join(dir, 'workflow.fsm.ts')}`,
      ],
      judgeReply: () => COMPILED,
    },
    {
      name: 'link',
      factory: createLink as CompatiblePlaybookRuntimeFactory,
      request: (dir) => ({
        kind: 'link',
        definitionPath: join(dir, 'link.md'),
        objects: ['workflow.fsm.ts'],
        linkTarget: 'runtime.ts',
        options: [],
        linked: 'workflow.playbook.ts',
      }),
      target: 'workflow.playbook.ts',
      promptAnchor: '# link.md fixture definition',
      workspaceAnchors: (dir) => [
        // The write scope and the ordered read list reach the Captain only
        // through the host transport's appended workspace contract
        // (phase-execution-34); the relayed definition names no path.
        `object artifacts to read, in order: ${join(dir, 'workflow.fsm.ts')}`,
        `link target module: ${join(dir, 'runtime.ts')}`,
        `artifact to write: ${join(dir, 'workflow.playbook.ts')}`,
        `write only ${join(dir, 'workflow.playbook.ts')}`,
      ],
      judgeReply: (prompt) =>
        prompt.startsWith(CLASSIFICATION_ANCHOR)
          ? TRANSFORMATION_REQUEST
          : COMPILED,
    },
  ];

  it.each([
    ['undefined', undefined],
    ['null', null],
  ] as const)(
    'normalizes a %s classifier-port rejection before the shared-engine boundary',
    async (_label, rejection) => {
      // link is the meta phase whose entry crosses the classifier judge.
      const rejectingJudge: AgentClient = {
        async run() {
          throw rejection;
        },
      };
      const executor = createCompiledExecutor({
        artifactPath: 'pinned-link-artifact',
        runRoot: root,
        player: idlePlayer,
        judge: rejectingJudge,
        runtimeContract: 'composed-v3',
        loadFactory: async () => createLink as CompatiblePlaybookRuntimeFactory,
      });

      const result = await executor.run(
        {
          kind: 'link',
          definitionPath: join(root, 'link.md'),
          objects: ['workflow.fsm.ts'],
          linkTarget: 'runtime.ts',
          options: [],
          linked: 'workflow.playbook.ts',
        },
        new AbortController().signal,
      );

      expect(result.status).toBe('error');
      expect(result.diagnostics).toContain(
        'compiled run failed: compiled composed-v3 callJudge port rejected without an error',
      );
    },
  );

  it.each(cases)(
    '$name Captain transport relays the definition, names the absolute paths, and a writing Captain maps to ok',
    async ({
      factory,
      request,
      target,
      promptAnchor,
      workspaceAnchors,
      judgeReply,
    }) => {
      const captainPrompts: string[] = [];
      const judgePrompts: string[] = [];
      // One shared Captain/judge transport, as in production (phase-execution-25):
      // the transformation-performing Captain call is the one without an
      // allowed-tool restriction; hidden judge calls carry the empty list.
      const judge: AgentClient = {
        async run(call) {
          if (call.allowedTools === undefined) {
            captainPrompts.push(call.prompt);
            await writeFile(join(root, target), 'produced artifact\n');
            return {
              status: 'success',
              text: 'Wrote and verified the target artifact.',
            };
          }
          judgePrompts.push(call.prompt);
          return { status: 'success', text: judgeReply(call.prompt) };
        },
      };
      const executor = createCompiledExecutor({
        artifactPath: 'pinned-meta-artifact',
        runRoot: root,
        player: idlePlayer,
        judge,
        runtimeContract: 'composed-v3',
        loadFactory: async () => factory,
      });

      const result = await executor.run(
        request(root),
        new AbortController().signal,
      );

      expect(result.status).toBe('ok');
      expect(captainPrompts).toHaveLength(1);
      // The definition the request names is relayed verbatim between the
      // markers (DR-028), ahead of the appended host workspace contract.
      expect(captainPrompts[0]).toContain('--- DEFINITION ---');
      expect(captainPrompts[0]).toContain(promptAnchor);
      expect(captainPrompts[0]).not.toContain('<definition>');
      for (const anchor of workspaceAnchors(root)) {
        expect(captainPrompts[0]).toContain(anchor);
      }
      // Hidden judge prompts cross without the workspace contract.
      for (const prompt of judgePrompts) {
        expect(prompt).not.toContain('Workspace contract');
      }
    },
  );
});
