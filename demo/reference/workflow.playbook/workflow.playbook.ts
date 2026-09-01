// Linked playbook runtime for the Two-Agent Change-and-Review Workflow.
//
// Linker inputs (slc link, link.md §Linker inputs):
//   FSM artifact:          ./workflow.fsm.ts   (gears2fsm output for workflow.gears.md)
//   Adjudication strategy: LLM-judge per state (default)
//   Boss-event mapping:    free-text judge classification (default)
//   Output profile:        shared-factory (the FSM declares no parallel state)
//
// The FSM interpreter is not regenerated here: this module hands its machine
// and a small per-playbook `spec` to `createXStatePlaybookRuntime`.

import {
  RUNTIME_ABI,
  createXStatePlaybookRuntime,
  defaultComposePlayerPrompt,
} from '@sublang/playbook/xstate-runtime';
import type {
  XStateOutcomeAuthoritySpec,
  XStatePlaybookRuntimeConstruction,
  XStatePlaybookRuntimeFactory,
  XStatePlaybookRuntimeSpecV3,
  XStateRepositoryCapability,
  XStateRoleStateStatus,
} from '@sublang/playbook/xstate-runtime';
import type {
  CaptainCallOptions,
  CaptainResult,
  JsonValue,
  NormalizedError,
  PlaybookCallRequest,
  PlaybookCallResult,
  PlaybookCallStart,
  PlaybookEffectLedgerCapability,
  PlaybookPorts,
  PlaybookRunResult,
  PlaybookRuntime,
  PlaybookRuntimeFactory,
  PlaybookSession,
  PlaybookState,
  PlaybookStateValue,
  PlaybookTraceEvent,
  PlayerCallOptions,
  PlayerResult,
  PlayerSessionStore,
} from '@sublang/playbook/runtime';
import { workflowMachine } from './workflow.fsm.ts';

// One shared contract definition: consumers import these names from here
// rather than redefining them (link.md §Output).
export type {
  CaptainCallOptions,
  CaptainResult,
  JsonValue,
  NormalizedError,
  PlaybookCallRequest,
  PlaybookCallResult,
  PlaybookCallStart,
  PlaybookEffectLedgerCapability,
  PlaybookPorts,
  PlaybookRunResult,
  PlaybookRuntime,
  PlaybookRuntimeFactory,
  PlaybookSession,
  PlaybookState,
  PlaybookStateValue,
  PlaybookTraceEvent,
  PlayerCallOptions,
  PlayerResult,
  PlayerSessionStore,
};

const LABEL = 'workflow';

/* -- Runtime options ------------------------------------------------------ */

/**
 * The FSM's `WorkflowMachineInput` is `Record<string, never>`, so no required
 * machine-input field survives for the host to supply. The only option is the
 * working directory of the WORKFLOW-1 `script` state (link.md §Script
 * execution). Omitted: the shared script actor uses the process cwd.
 *
 * The Boss task text is *not* an option: WORKFLOW-2's `<input-task>` is fed by
 * the `START` event's `inputTask` payload, which the runtime attaches from the
 * exact Boss turn text (link.md §Boss-event mapping).
 */
export interface PlaybookRuntimeOptions {
  readonly cwd?: string;
}

const DECLARED_OPTION_KEYS: ReadonlySet<string> = new Set(['cwd']);

const snapshotOptions = (value: unknown): PlaybookRuntimeOptions => {
  if (value === undefined || value === null) return Object.freeze({});
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${LABEL} options must be a plain object`);
  }
  const source = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key !== 'string' || !DECLARED_OPTION_KEYS.has(key)) {
      throw new TypeError(`${LABEL} options declare no ${String(key)} member`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`${LABEL} options.${key} must be a data property`);
    }
  }
  const cwd = source.cwd;
  if (cwd === undefined) return Object.freeze({});
  if (typeof cwd !== 'string' || cwd.trim().length === 0) {
    throw new TypeError(`${LABEL} options.cwd must be a non-empty string`);
  }
  return Object.freeze({ cwd });
};

/* -- Host capabilities ---------------------------------------------------- */

/**
 * The artifact's live schema-3 authority capability: this artifact's id and
 * schema, its detached role and cohort declarations, the current configured
 * working directory, the logical session and lease-owner identities, and the
 * canonical worktree. It is a live host seam and never enters options,
 * machine input, context, or any snapshot.
 */
export interface WorkflowArtifactAuthority {
  readonly artifactId: string;
  readonly artifactSchema: 3;
  readonly roles: readonly string[];
  readonly cohorts: readonly (readonly string[])[];
  readonly cwd: string;
  readonly sessionId: string;
  readonly leaseOwnerId: string;
  readonly canonicalWorktree: {
    readonly worktree: string;
    readonly gitDir: string;
  };
}

/** Exactly `authority`, `repository`, and `effectLedger` (link.md §PlaybookRuntime contract). */
export interface HostCapabilities {
  readonly authority: WorkflowArtifactAuthority;
  readonly repository: XStateRepositoryCapability;
  readonly effectLedger: PlaybookEffectLedgerCapability;
}

/* -- FSM-derived spec metadata -------------------------------------------- */

/** Every FSM state that invokes the typed `player` actor, with its exact role and description. */
const ROLE_STATES: Readonly<Record<string, XStateRoleStateStatus>> = {
  implement: {
    role: 'coder',
    label: 'Coder modifies the code for the input task and commits it to Git.',
  },
  review: {
    role: 'reviewer',
    label: "Reviewer reviews Coder's commit and raises reasonable findings.",
  },
  judgeFindings: {
    role: 'coder',
    label:
      "Coder judges Reviewer's findings, accepting or rejecting them with reasons.",
  },
  argue: {
    role: 'reviewer',
    label:
      "Reviewer states agreement with Coder's judgment or argues its case.",
  },
  judgeArgument: {
    role: 'coder',
    label:
      "Coder judges Reviewer's argument, accepting or rejecting it with reasons.",
  },
  apply: {
    role: 'coder',
    label:
      'Coder changes the code per the concluded judgment and commits again.',
  },
};

/**
 * Payload fields annotated `<verbatim final text>` in the FSM result maps: the
 * judge selects the guard, the player's canonical final text fills the field.
 */
const VERBATIM_PAYLOAD_FIELDS: ReadonlySet<string> = new Set([
  'reviewFindings',
  'coderJudgment',
  'reviewerArgument',
]);

/**
 * Schema-3 authority and repository contract per governed player outcome.
 * `implement` (WORKFLOW-2) and `apply` (WORKFLOW-7) are the two behaviors the
 * GEARS source has commit to Git, so their completing outcome declares
 * `one-descendant-commit` and their Boss question may defer that commit; every
 * other player behavior reviews, judges, or argues and leaves the repository
 * `unchanged`.
 */
const OUTCOME_AUTHORITY: XStateOutcomeAuthoritySpec = {
  governedPlayerStates: {
    implement: {
      done: { fields: {}, repositoryDisposition: 'one-descendant-commit' },
      needsBossReply: {
        fields: { question: 'presentation' },
        repositoryDisposition: 'deferred',
      },
    },
    review: {
      findings: {
        fields: { reviewFindings: 'presentation' },
        repositoryDisposition: 'unchanged',
      },
      clean: { fields: {}, repositoryDisposition: 'unchanged' },
      needsBossReply: {
        fields: { question: 'presentation' },
        repositoryDisposition: 'unchanged',
      },
    },
    judgeFindings: {
      judged: {
        fields: { coderJudgment: 'presentation' },
        repositoryDisposition: 'unchanged',
      },
      needsBossReply: {
        fields: { question: 'presentation' },
        repositoryDisposition: 'unchanged',
      },
    },
    argue: {
      agreement: { fields: {}, repositoryDisposition: 'unchanged' },
      argument: {
        fields: { reviewerArgument: 'presentation' },
        repositoryDisposition: 'unchanged',
      },
      needsBossReply: {
        fields: { question: 'presentation' },
        repositoryDisposition: 'unchanged',
      },
    },
    judgeArgument: {
      judged: {
        fields: { coderJudgment: 'presentation' },
        repositoryDisposition: 'unchanged',
      },
      needsBossReply: {
        fields: { question: 'presentation' },
        repositoryDisposition: 'unchanged',
      },
    },
    apply: {
      done: { fields: {}, repositoryDisposition: 'one-descendant-commit' },
      needsBossReply: {
        fields: { question: 'presentation' },
        repositoryDisposition: 'deferred',
      },
    },
  },
};

/**
 * Root final states whose terminal outcome leaves the procedure unfinished.
 * `reviewedClean` is the finished outcome; `loopLimitReached` stops at the
 * source's limit of 2 loops with its last commit unreviewed.
 */
const UNFINISHED_FINAL_STATE_IDS: ReadonlySet<string> = new Set([
  'loopLimitReached',
]);

/* -- Spec ----------------------------------------------------------------- */

const spec: XStatePlaybookRuntimeSpecV3<PlaybookRuntimeOptions> = {
  label: LABEL,
  compat: { artifactSchema: 3, runtimeAbi: RUNTIME_ABI },
  snapshotOptions,
  // The FSM declares no machine-input member; `cwd` is a script-actor option.
  machineInput: () => ({}),
  // `START` is the FSM's only Boss entry event and carries the task as its
  // `inputTask` payload, so `ready`, `failed`, and a reconstructed terminal
  // each accept exactly one ordinary textual entry event: the turn enters
  // deterministically with the exact Boss text and spends no judge call
  // (link.md §Boss-event mapping). `startRun` copies that text into the
  // context member named below, so the failure-state retry of the control
  // surface (DR-034) sources its payload from the persisted machine snapshot
  // and survives `restore`. `BOSS_INTERRUPT` (with its closed target set) and
  // `BOSS_REPLY` are derived by the factory from the machine itself, and the
  // factory supplies this entry contract too — hence no `bossEvents` entry.
  entryEvent: {
    type: 'START',
    textField: 'inputTask',
    contextField: 'inputTask',
  },
  transitionEventFields: ['inputTask', 'targetId', 'answer', 'questionId'],
  roleStates: ROLE_STATES,
  outcomeAuthority: OUTCOME_AUTHORITY,
  verbatimPayloadFields: VERBATIM_PAYLOAD_FIELDS,
  unfinishedFinalStateIds: UNFINISHED_FINAL_STATE_IDS,
  // The Boss-authored task under way plus loop and argument-round progress.
  // The review findings, judgments, and rebuttals are player-authored text and
  // stay private; `inputTask` is Boss's own words, so a controller host can
  // say what this workflow is working on without quoting a player.
  controlContextFields: ['inputTask', 'reviewLoops', 'judgmentCount'],
};

const createPlaybookRuntime: XStatePlaybookRuntimeFactory<
  XStatePlaybookRuntimeConstruction<PlaybookRuntimeOptions, HostCapabilities>,
  3
> = createXStatePlaybookRuntime<PlaybookRuntimeOptions, HostCapabilities>(
  workflowMachine,
  spec,
);

export default createPlaybookRuntime;

/**
 * Not a public API: the pure composers verification exercises without a host.
 * This playbook calls players only, so it exposes the player composer alone.
 */
export const _internal = {
  composePlayerPrompt: defaultComposePlayerPrompt,
};
