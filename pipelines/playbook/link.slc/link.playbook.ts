// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Linked `PlaybookRuntime` module — FSM-to-Runtime Linking.
//
// Linker inputs (this file is reproducible from these alone):
//   FSM artifact:          ./link.fsm.ts
//   Adjudication strategy: LLM-judge per state (default)
//   Boss-event mapping:    free-text judge classification (default)
//   Link options:          (none)
//
// `link.fsm.ts` declares no `type: 'parallel'` state, so this is the thin
// shared-factory module: the FSM-interpreter machinery — actor wiring,
// boundary tracing, Boss-event mapping, adjudication, script execution,
// nested-playbook bridging, session lifecycle, abort handling, and the
// optional parked-session snapshot, retained-snapshot adoption, and control
// surface capabilities — is not regenerated here. It ships once as
// `createXStatePlaybookRuntime` in `@sublang/playbook/xstate-runtime`, and
// every behavioral requirement of slc/link.md binds this module's runtime
// through that factory.
//
// The FSM is imported with a `.ts` runtime specifier: this workspace is
// source-only — it ships no JavaScript build beside the artifact (the
// repository's `tsc` project is rooted at `src`), and its host loads
// TypeScript directly under type stripping.

import { createXStatePlaybookRuntime } from '@sublang/playbook/xstate-runtime';
import type {
  PlaybookCaptainInput,
  XStatePlaybookRuntimeConstruction,
  XStatePlaybookRuntimeFactory,
  XStateRepositoryCapability,
} from '@sublang/playbook/xstate-runtime';
import type { PlaybookEffectLedgerCapability } from '@sublang/playbook/runtime';
import machine from './link.fsm.ts';

// One shared contract definition per linked playbook: these names are sourced
// from the single type-only module rather than redeclared here, and
// re-exported for this module's consumers.
export type {
  PlayerResult,
  PlayerCallOptions,
  PlayerSessionStore,
  CaptainResult,
  CaptainCallOptions,
  PlaybookPorts,
  PlaybookSession,
  PlaybookTraceEvent,
  PlaybookCallRequest,
  PlaybookCallResult,
  PlaybookCallStart,
  PlaybookStateValue,
  PlaybookState,
  PlaybookRunResult,
  PlaybookRuntime,
  PlaybookRuntimeFactory,
} from '@sublang/playbook/runtime';

/**
 * Configured options for this playbook, derived from the FSM's machine input.
 * `link.fsm.ts` declares no required input field: both members are optional
 * seeds for the transformation request, which a Boss turn ordinarily supplies
 * instead, and a host may bind at construction. The FSM contains no `script`
 * state, so no `cwd` option is declared.
 */
export interface PlaybookRuntimeOptions {
  source?: string;
  target?: string;
}

/**
 * The live schema-3 authority this artifact's capabilities are bound to: this
 * artifact's id and schema, its detached role and cohort declarations, the
 * host's current configured working directory, the logical session and
 * lease-owner identities, and the canonical worktree. This artifact declares
 * neither roles nor cohorts — `link.fsm.ts` invokes no `player` actor and
 * declares no parallel state — so both declarations are empty. The Captain
 * host validates every binding before runtime construction.
 */
export interface PlaybookHostAuthority {
  readonly playbookId: string;
  readonly artifactSchema: 3;
  readonly requiredRoleIds: readonly string[];
  readonly concurrentRoleSets: readonly (readonly string[])[];
  readonly cwd: string;
  readonly sessionId: string;
  readonly leaseOwnerId: string;
  readonly canonicalWorktree: {
    readonly worktree: string;
    readonly gitDir: string;
  };
}

/**
 * Live current-host capabilities for a Captain-hosted schema-3 artifact:
 * exactly `authority`, `repository`, and `effectLedger`. They are disjoint
 * from the configured options and never enter `PlaybookPorts`, machine input
 * or context, snapshots, retained generations, or continuation identity.
 */
export interface HostCapabilities {
  readonly authority: PlaybookHostAuthority;
  readonly repository: XStateRepositoryCapability;
  readonly effectLedger: PlaybookEffectLedgerCapability;
}

/**
 * Validate and JSON-snapshot the caller's configured options, rejecting
 * undeclared keys and non-conforming values, so the factory binds an
 * immutable options record before constructing any actor.
 */
const snapshotOptions = (value: unknown): PlaybookRuntimeOptions => {
  if (value === undefined) {
    return Object.freeze({});
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError('link options must be a plain object');
  }
  const options: PlaybookRuntimeOptions = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new TypeError('link options must not carry symbol keys');
    }
    if (key !== 'source' && key !== 'target') {
      throw new TypeError(
        `link options carry undeclared key ${JSON.stringify(key)}`,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      throw new TypeError(
        `link option ${key} must be an enumerable own data property`,
      );
    }
    const optionValue: unknown = descriptor.value;
    if (typeof optionValue !== 'string') {
      throw new TypeError(`link option ${key} must be a string`);
    }
    options[key] = optionValue;
  }
  return Object.freeze(options);
};

/**
 * Framework continuation preamble (slc/link.md §Player prompt composition),
 * supplied by the runtime and never part of the GEARS blockquote.
 */
const CONTINUATION_PREAMBLE =
  'You previously paused this task to ask Boss a question; Boss has now replied. Continue the same task using the reply below.';

/**
 * The runtime-value placeholders LINK-1 declares, each backed by a typed
 * `CaptainInput` field. Every other angle-bracketed token in this playbook's
 * domain body is a metavariable quoted inside its own instructions — the
 * `<stateId>` of a script status line, the `<bossReply>` of the quoted
 * continuation template — and stays ordinary prompt text.
 */
const DECLARED_PLACEHOLDERS = /<(source|target)>/g;

/**
 * Compose the direct Captain prompt: the verbatim GEARS domain body with one
 * callback-based pass over the original template substituting the declared
 * placeholders from field presence alone, preceded by the continuation
 * preamble and labelled Q&A blocks when the task resumes from its own Boss
 * question. Replacement strings are literal, and the composed prompt carries
 * no result map, guard names, result-property schema, adjudication request,
 * workspace context, or tool instructions.
 */
const composeCaptainPrompt = (input: PlaybookCaptainInput): string => {
  const fields = input as unknown as {
    readonly source?: unknown;
    readonly target?: unknown;
  };
  const body = input.prompt.replace(
    DECLARED_PLACEHOLDERS,
    (match: string, token: string) => {
      const value = token === 'source' ? fields.source : fields.target;
      return typeof value === 'string' ? value : match;
    },
  );
  const question = input.pendingBossQuestion?.question;
  const reply = input.bossReply;
  if (typeof question !== 'string' || typeof reply !== 'string') {
    return body;
  }
  // Two trailing empty strings emit exactly two newline characters at the
  // boundary before the domain body.
  return (
    [
      CONTINUATION_PREAMBLE,
      '',
      'Boss question:',
      question,
      '',
      'Boss reply:',
      reply,
      '',
      '',
    ].join('\n') + body
  );
};

const createPlaybookRuntime: XStatePlaybookRuntimeFactory<
  XStatePlaybookRuntimeConstruction<PlaybookRuntimeOptions, HostCapabilities>,
  3
> = createXStatePlaybookRuntime<PlaybookRuntimeOptions, HostCapabilities>(
  machine,
  {
    label: 'link',
    // Compatibility values current at link time: the artifact format emitted
    // here, and the `RUNTIME_ABI` self-report of the engine it was linked
    // against. The loading engine checks this declaration and fails
    // construction on a mismatch.
    compat: { artifactSchema: 3, runtimeAbi: 1 },
    snapshotOptions,
    // LINK-1's domain body quotes angle-bracketed metavariables of its own
    // subject matter, so the shared presence-based replacement table would
    // rewrite prompt text that is not a declared placeholder. This composer
    // keeps the body verbatim outside `<source>` and `<target>`.
    composeCaptainPrompt,
    // No FSM state invokes the typed `player` actor, so there is no governed
    // delegated-player state and no Boss-facing role status entry.
    outcomeAuthority: { governedPlayerStates: {} },
    roleStates: {},
    // `BOSS_INTENT`'s optional routing fields are erased from the FSM's typed
    // event union; neither carries the exact Boss text, so both stay
    // judge-selected and optional. `BOSS_INTERRUPT`'s closed `targetId` set is
    // derived from the machine's own root transitions, and `NO_ACTION` and
    // `BOSS_REPLY` are runtime-owned, so none of the three appears here.
    bossEvents: [
      {
        type: 'BOSS_INTENT',
        fields: {
          source: { source: 'judge' },
          target: { source: 'judge' },
        },
      },
    ],
    // The string payload fields the FSM's Boss union declares.
    transitionEventFields: [
      'source',
      'target',
      'targetId',
      'answer',
      'questionId',
    ],
    // `linking` is the sole recorded Boss-reply resume destination; the
    // `awaitBossReply` state's remaining arm is the malformed-reply sink,
    // which is not a resume route.
    resumableStateIds: new Set(['linking']),
    // No result description annotates a delegated-player field as the
    // player's verbatim final text. The direct-Captain `question` field is
    // presentation the engine injects from the visible call, not a verbatim
    // payload field.
    verbatimPayloadFields: new Set<string>(),
    // The machine's one root final state, `done`, publishes a completed
    // terminal outcome, so no terminal outcome leaves the procedure
    // unfinished.
    unfinishedFinalStateIds: new Set<string>(),
  },
);

/**
 * Pure helpers compilation-correctness tests exercise without a host. Not a
 * public API and not semver-stable. This playbook makes direct-Captain calls
 * and calls no players, so it exposes the Captain composer only — the exact
 * composer its own machine uses.
 */
export const _internal = {
  composeCaptainPrompt,
};

export default createPlaybookRuntime;
