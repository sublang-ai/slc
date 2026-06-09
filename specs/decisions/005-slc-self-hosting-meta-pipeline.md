<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-005: SLC Self-Hosting Meta-Pipeline

## Status

Accepted

## Context

Interpreted execution ([DR-004](004-slc-interpreted-phase-execution.md)) is the default but re-runs the agent on every invocation and gives a phase no fixed, inspectable control flow.
A phase benefits from compilation when it wants determinism, speed, fixed and auditable control flow, or per-step model binding — for example a phase with internal draft-then-verify structure.
`slc` can compile phase definitions with the same pipeline machinery it uses for any pipeline, making the compiler self-hosting.

This DR builds on [DR-003](003-slc-phase-execution.md) and [DR-004](004-slc-interpreted-phase-execution.md): interpreted execution stays the reference semantics and the fallback, and compiled execution is a later layer that does not change the execution boundary.
Implementation sequencing across these DRs is tracked in iteration records, not in this DR.

## Decision

### Reserved `slc` pipeline

The pipeline name `slc` shall be reserved for the meta pipeline that compiles phase and link definitions into runnable phase artifacts.
Its phase definitions are distinct from any domain pipeline's like-named phases: their source is a phase or link definition rather than a domain workflow, so a single `slc.text2gears` accepts any phase definition (for example `text2gears.md`, `gears2fsm.md`, or `link.md`).
Where the `slc` pipeline directory resolves from is consumer-defined per [DR-001](001-slc-pipeline-layout-naming-invocation.md).

When `slc` is invoked without an explicit pipeline argument, the command shall use the `slc` pipeline.
`slc <source>` is equivalent to `slc slc <source>`, and `slc slc.<phase> <source>` runs one named phase per [DR-001](001-slc-pipeline-layout-naming-invocation.md#cli).
This amends the [DR-001](001-slc-pipeline-layout-naming-invocation.md#cli) grammar to make `<pipeline>` optional with default `slc`.
Because a pipeline run always takes a source, a single positional is the source under the default pipeline and a leading positional before the source is the explicit pipeline, so the form stays unambiguous.

The `slc` pipeline shall chain `text2gears` (`text` `.md` to `gears` `.md`) and `gears2fsm` (`gears` `.md` to `fsm` `.ts`), plus a reserved `link.md` link phase (`fsm` `.ts` to `phase` `.ts`) per [DR-002](002-slc-link-phases.md).
Each phase's transformation rules live in its own definition, not in this DR.
This DR constrains only the properties self-hosting depends on:

- `gears2fsm` shall preserve the GEARS-to-phase mapping in machine-readable form, so a generated phase artifact can be audited against its phase definition.
- The link phase shall emit the distinct `phase` linked format, whose runnable artifact exposes the interface `slc` needs to run that phase against its declared inputs and output path. Per [DR-002](002-slc-link-phases.md#cli), full-pipeline invocation without `--link` stops at the `fsm` object artifact.

### Compiled phase execution

A non-`slc` pipeline may execute its phases through compiled phase artifacts produced by the `slc` pipeline.
Compilation is chosen for phases that need fixed control flow, statefulness, or determinism.
Interpreted execution ([DR-004](004-slc-interpreted-phase-execution.md)) remains available for phases without a pinned compiled artifact.

A compiled phase artifact shall be behavior-equivalent to interpreting its definition, per the [DR-004](004-slc-interpreted-phase-execution.md) reference semantics.

### Linked phase artifact contract

`slc` runs a compiled phase by loading its `phase` module and calling a stable entrypoint.
The artifact carries no host specifics: it reaches deterministic tools and coding agents only through ports `slc` supplies, so the same artifact runs under any host.
The module shall default-export a factory of this shape:

```typescript
interface PhasePorts {
  runTool(command: string, signal: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }>;
  callAgent(binding: string, prompt: string, signal: AbortSignal): Promise<string>;
}

type PhaseInput =
  | { kind: 'compile'; source: string; target: string }
  | { kind: 'link'; objects: string[]; linkTarget: string; options: Record<string, string>; linked: string };

interface PhaseResult {
  status: 'ok' | 'blocked' | 'error';
  diagnostics: string[];
}

interface PhaseRunner {
  run(input: PhaseInput, ports: PhasePorts, signal: AbortSignal): Promise<PhaseResult>;
}

export default function createPhaseRunner(): PhaseRunner;
```

The runner takes no construction options; per-step model selection flows through `callAgent`, not construction.
Port semantics are minimal and everything else is host-defined.
`runTool` resolves with the tool's exit `code`, `stdout`, and `stderr`, and a non-zero `code` is a tool outcome the runner inspects rather than a rejection.
`callAgent` resolves with the agent's text; its `binding` is an opaque key the runner chooses per step, which the host maps to a concrete model, so per-step model selection is the runner's while model identities stay the host's.
Both reject only when the call cannot complete or `signal` aborts.
How a host interprets a command — shell or direct process, working directory, environment, resource limits — is host-defined; portability holds over the port shape and these failure and abort semantics, not the execution environment.

The runner writes only the `target` or `linked` path from its input, honoring the [DR-003](003-slc-phase-execution.md) write-scope invariant.
`slc` constructs the runner, supplies the ports, calls `run`, then maps the result onto the [DR-003](003-slc-phase-execution.md) protocol: `ok` proceeds to generic checks, `blocked` is the `BLOCKED` outcome, and `error` stops the pipeline like a failed generic check; `blocked` and `error` both surface the runner's diagnostics.

### Strategy selection

`slc` interprets every phase by default ([DR-004](004-slc-interpreted-phase-execution.md)).
When a pipeline pins a compiled artifact for a phase (see [Pinning](#pinning)), `slc` runs that artifact instead of interpreting.
Selection shall be explicit and reproducible: a pinned phase whose artifact is missing or stale fails with a diagnostic rather than silently interpreting, so a pinned pipeline runs the same way every time.

### Pinning

A pin associates a phase with a compiled artifact and the inputs that produced that artifact: the phase definition's semantic input closure and the `slc.link` target it was linked against.
The closure is the definition together with the cited or referenced content its rules depend on, so a current pin stays behavior-equivalent to interpreting the definition ([DR-004](004-slc-interpreted-phase-execution.md)), which may read that content.
Every `phase` artifact is produced by `slc.link`, so the link-target input applies to all of them, not only compiled link phases.
The execution-time `linkTarget` a compiled link phase receives in `PhaseInput` is a `run` input, not a producing input, and is not part of the pin.
A pin is current when the artifact exists and those inputs are unchanged; `slc` then runs the artifact.
A pin whose artifact is missing or whose inputs changed is stale, and `slc` fails per [Strategy selection](#strategy-selection).
A phase with no pin is interpreted.

The concrete pin format — storage location, path resolution, hash algorithm, link-target identity, and what belongs in the semantic input closure — is deferred to a dedicated pinning DR.
Until that DR exists, compiled selection is unavailable and `slc` interprets every phase ([DR-004](004-slc-interpreted-phase-execution.md)).

### Artifact stability

Because `slc.gears2fsm` is itself a judgment-based transformation, a phase artifact is a generated program.
Phase artifacts shall be built once, reviewed, and committed per pipeline version, and pinned once the pinning contract exists ([Pinning](#pinning)).
`slc` shall not regenerate them per invocation.

### Locations

Artifacts for the `slc` pipeline follow [DR-001](001-slc-pipeline-layout-naming-invocation.md#output-locations).
For example:

- `slc playbook/text2gears.md` writes `playbook/text2gears.slc/text2gears.gears.md` and `playbook/text2gears.slc/text2gears.fsm.ts`.
- `slc slc.link playbook/text2gears.slc/text2gears.fsm.ts <link-target>` writes `playbook/text2gears.slc/text2gears.phase.ts`, unless `-o` overrides.

## Consequences

- A pipeline can be bootstrapped by compiling its own phase definitions; once the pinning contract exists, `slc` runs it through the resulting artifacts rather than interpreting them.
- Compiled phases gain auditable control flow (the GEARS-to-phase mapping) and can mix deterministic and agentic steps.
- Once the pinning contract exists, version-pinned artifacts keep the toolchain stable across runs.
- Interpreted execution ([DR-004](004-slc-interpreted-phase-execution.md)) remains the reference semantics and the fallback for uncompiled phases.
