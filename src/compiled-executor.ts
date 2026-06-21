// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Compiled phase execution: load a `phase` artifact and run it through the SLC
 * phase-runner facade (PHEXEC-23, PHEXEC-24, PHEXEC-25; DR-005).
 *
 * {@link loadPhaseRunner} imports a compiled `phase` module and calls its
 * `createPhaseRunner` default export. {@link createCompiledExecutor} adapts that
 * runner to the DR-003 {@link PhaseExecutor} boundary: per run it constructs the
 * default-deny file capability (writable target/linked, reads closed over the run
 * inputs and the pin's semantic-input closure) and the Cligent-backed Playbook
 * ports, maps the request's host paths to the capability's virtual paths, calls
 * `run`, then maps the {@link PhaseResult} onto an {@link ExecutorResult} and
 * appends the runtime's drained status and telemetry. A thrown or unloadable
 * artifact becomes an `error` outcome, so `runPhase` stops the phase like a failed
 * generic check. See specs/dev/phase-execution.md.
 */

import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  ExecuteRequest,
  ExecutorResult,
  LinkOptionPair,
  PhaseExecutor,
} from './execution.js';
import { buildRunGrants, createGuardedCapability } from './file-grants.js';
import type { Hash } from './hash.js';
import type { AgentClient } from './interpreter.js';
import { mapPhaseResult } from './phase-runner.js';
import type {
  CreatePhaseRunner,
  PhaseInput,
  PhaseRunner,
  RunnerPorts,
} from './phase-runner.js';
import { createPlaybookPorts } from './playbook-ports.js';

/**
 * Imports a compiled `phase` module and returns its runner (PHEXEC-23).
 *
 * @throws when the module has no callable `createPhaseRunner` default export.
 */
export async function loadPhaseRunner(
  artifactPath: string,
): Promise<PhaseRunner> {
  const module: { default?: unknown } = await import(
    pathToFileURL(resolve(artifactPath)).href
  );
  const create = module.default;
  if (typeof create !== 'function') {
    throw new Error(
      `compiled artifact "${artifactPath}" has no createPhaseRunner default export`,
    );
  }
  return (create as CreatePhaseRunner)();
}

/** A recorded semantic-input closure member for read grants (DR-007). */
export interface ClosureInput {
  path: string;
  identity?: Hash;
}

/**
 * Adapts a compiled `phase` artifact to the {@link PhaseExecutor} boundary
 * (PHEXEC-24, PHEXEC-25).
 */
export function createCompiledExecutor(opts: {
  /** Path to the compiled `phase` module to load. */
  artifactPath: string;
  /** Run root that bounds the file capability. */
  runRoot: string;
  /** Agent transport backing `callPlayer`. */
  player: AgentClient;
  /** Agent transport backing `callJudge`. */
  judge: AgentClient;
  /** Per-player model binding, applied as configuration (PHEXEC-13). */
  models?: Readonly<Record<string, string>>;
  /** Working directory handed to the agent transports. */
  cwd?: string;
  /** The pin's semantic-input closure, enumerated as read grants (DR-008). */
  semanticInputs?: readonly ClosureInput[];
  /** Loader seam; defaults to {@link loadPhaseRunner}. */
  loadRunner?: (artifactPath: string) => Promise<PhaseRunner>;
}): PhaseExecutor {
  const load = opts.loadRunner ?? loadPhaseRunner;

  return {
    async run(
      request: ExecuteRequest,
      signal: AbortSignal,
    ): Promise<ExecutorResult> {
      const adapter = createPlaybookPorts({
        player: opts.player,
        judge: opts.judge,
        models: opts.models,
        cwd: opts.cwd,
      });
      const toVirtual = (path: string): string =>
        virtualPath(path, opts.runRoot);
      const grants = buildRunGrants(
        grantSpec(request, toVirtual, opts.semanticInputs),
      );
      const capability = createGuardedCapability(opts.runRoot, grants);
      // Hand the artifact only Playbook's ports and the file capability — never
      // the host-only drainDiagnostics, which the host keeps to itself so the
      // artifact cannot clear its own diagnostics (DR-005, PHEXEC-23).
      const ports: RunnerPorts = {
        ...capability,
        callPlayer: adapter.callPlayer,
        callJudge: adapter.callJudge,
        emitStatus: adapter.emitStatus,
        emitTelemetry: adapter.emitTelemetry,
      };

      let mapped: ExecutorResult;
      try {
        const runner = await load(opts.artifactPath);
        const result = await runner.run(
          phaseInput(request, toVirtual),
          ports,
          signal,
        );
        mapped = mapPhaseResult(result);
      } catch (error) {
        mapped = {
          status: 'error',
          diagnostics: [`compiled artifact failed: ${messageOf(error)}`],
        };
      }

      return {
        status: mapped.status,
        diagnostics: [...mapped.diagnostics, ...adapter.drainDiagnostics()],
      };
    },
  };
}

/** Maps an {@link ExecuteRequest} to the artifact-facing {@link PhaseInput} (DR-005). */
function phaseInput(
  request: ExecuteRequest,
  toVirtual: (path: string) => string,
): PhaseInput {
  if (request.kind === 'compile') {
    return {
      kind: 'compile',
      source: toVirtual(request.source),
      target: toVirtual(request.target),
    };
  }
  return {
    kind: 'link',
    objects: request.objects.map(toVirtual),
    linkTarget: toVirtual(request.linkTarget),
    options: optionsRecord(request.options),
    linked: toVirtual(request.linked),
  };
}

function grantSpec(
  request: ExecuteRequest,
  toVirtual: (path: string) => string,
  semanticInputs: readonly ClosureInput[] = [],
): Parameters<typeof buildRunGrants>[0] {
  const inputs = semanticInputs.map((input) => ({
    path: toVirtual(input.path),
    identity: input.identity,
  }));
  if (request.kind === 'compile') {
    return {
      kind: 'compile',
      source: toVirtual(request.source),
      target: toVirtual(request.target),
      semanticInputs: inputs,
    };
  }
  return {
    kind: 'link',
    objects: request.objects.map(toVirtual),
    linkTarget: toVirtual(request.linkTarget),
    linked: toVirtual(request.linked),
    semanticInputs: inputs,
  };
}

/** Maps a host path to its virtual run-root path (a leading-`/` POSIX path). */
function virtualPath(path: string, runRoot: string): string {
  const root = resolve(runRoot);
  const rel = relative(root, resolve(root, path));
  return `/${rel.split(sep).join('/')}`;
}

function optionsRecord(
  options: readonly LinkOptionPair[],
): Record<string, string> {
  return Object.fromEntries(
    options.map((option) => [option.name, option.value]),
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
