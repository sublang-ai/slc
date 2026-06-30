<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-005: SLC Self-Hosting Meta-Pipeline

## Status

Accepted

## Context

Interpreted execution ([DR-004](004-slc-interpreted-phase-execution.md)) is the default but re-runs the agent on every invocation and gives a phase no fixed, inspectable control flow.
A phase benefits from compilation when it wants determinism, speed, fixed and auditable control flow, statefulness, or per-step model binding — for example a phase with internal draft-then-verify structure.
`slc` can compile phase definitions with the same pipeline machinery it uses for any pipeline, making the compiler self-hosting.

This DR builds on [DR-003](003-slc-phase-execution.md) and [DR-004](004-slc-interpreted-phase-execution.md): interpreted execution stays the reference semantics and the fallback, and compiled execution is a later layer that does not change the execution boundary.
Implementation sequencing across these DRs is tracked in iteration records, not in this DR.

## Decision

### Reserved `slc` pipeline

The pipeline name `slc` shall be reserved for the meta pipeline that compiles phase and link definitions into runnable phase artifacts.
Its source is a phase or link definition rather than a domain workflow, so a single `slc.text2gears` accepts any phase definition (for example `text2gears.md`, `gears2fsm.md`, or `link.md`).
The reserved `slc` resolves to Playbook's authored `slc/` definitions, which the `playbook` domain pipeline also uses ([DR-009](009-slc-playbook-pipeline-compilation.md)), so the reservation fixes the name's resolution and the source semantics rather than a phase-file set unique to `slc`.
Where the `slc` pipeline directory resolves from is consumer-defined per [DR-001](001-slc-pipeline-layout-naming-invocation.md).

The `slc` pipeline is named explicitly like any other pipeline, so it claims no default and leaves the [DR-001](001-slc-pipeline-layout-naming-invocation.md#cli) grammar unchanged.
`slc slc <source>` runs it end-to-end and `slc slc.<phase> <source>` runs one named phase, per [DR-001](001-slc-pipeline-layout-naming-invocation.md#cli).

The `slc` pipeline shall chain `text2gears` (`text` `.md` to `gears` `.md`) and `gears2fsm` (`gears` `.md` to `fsm` `.ts`), plus a reserved `link.md` link phase (`fsm` `.ts` to `playbook` `.ts`) per [DR-002](002-slc-link-phases.md).
Each phase's transformation rules live in its own definition, not in this DR.
This DR constrains only the properties self-hosting depends on:

- `gears2fsm` shall preserve the GEARS-to-FSM mapping in machine-readable form, so a generated phase artifact can be audited against its phase definition.
- The link phase shall emit the distinct `playbook` linked format — a `PlaybookRuntimeFactory` per Playbook's source-owned `slc/link.md` — which `slc` drives through a host-side phase-execution facade rather than an artifact-exported one. Per [DR-002](002-slc-link-phases.md#cli), full-pipeline invocation without `--link` stops at the `fsm` object artifact.

### Compiled phase execution

A non-`slc` pipeline may execute its phases through compiled phase artifacts produced by the `slc` pipeline.
Compilation is chosen for phases that need the properties named in [Context](#context).
Compiled execution shall build on Playbook source code [[1]]: a compiled phase artifact is a playbook, a state-machine agent orchestrating coding agents through Playbook's maintained host-supplied ports rather than an SLC-specific duplicate port layer.
Interpreted execution ([DR-004](004-slc-interpreted-phase-execution.md)) remains available for phases without a pinned compiled artifact.

A compiled phase artifact shall be behavior-equivalent to interpreting its definition, per the [DR-004](004-slc-interpreted-phase-execution.md) reference semantics.

### Linked phase artifact contract

`slc` runs a compiled phase by loading its `playbook` module, constructing the
`PlaybookRuntime` its default-exported `PlaybookRuntimeFactory` builds, and
driving it through a stable host-side SLC phase-runner facade.
A compiled phase runs as a non-interactive playbook: the facade seeds the
runtime from `PhaseInput`, drives its turns to quiescence through
`handleBossInput`, and derives the result from the host-observable outcome
(`handleBossInput` returns `void`).

| Result | Mapping |
| --- | --- |
| `ok` | A clean resolve at a successful quiescent state. |
| `blocked` | A quiescent stop where the FSM cannot proceed under the phase definition without guessing through incompatibility, including malformed or incompatible inputs under [DR-003](003-slc-phase-execution.md#blocked-protocol) and parking for Boss input a non-interactive run cannot supply. |
| `error` | A throw out of `handleBossInput`, or a `failed` quiescent state. |

Diagnostics are drained from the runtime's status and telemetry.
Player and judge bindings are baked at link time; the factory's `options`
carry only per-run knobs such as model identity strings.
The artifact carries no host specifics: it reaches coding agents, judges,
status, and telemetry only through Playbook's source-owned `PlaybookPorts`
contract and touches no other host type.
The same artifact runs under any host that can supply those ports.
This DR intentionally does not restate the Playbook port or runtime shape.
The contract is owned by Playbook's authored `slc/link.md` source.
SLC imports the Playbook-owned `PlaybookPorts`, `PlaybookRuntime`, and
`PlaybookRuntimeFactory` types from `@sublang/playbook`'s `./runtime` surface.

The artifact's default export is Playbook's runtime factory:

```typescript
export default function createPlaybookRuntime(
  options: PlaybookRuntimeOptions,
): PlaybookRuntime;
```

`slc` wraps it in a host-side phase-runner facade:

```typescript
type PhaseInput =
  | { kind: 'compile'; source: string; target: string }
  | { kind: 'link'; objects: string[]; linkTarget: string; options: Record<string, string>; linked: string };

interface PhaseResult {
  status: 'ok' | 'blocked' | 'error';
  diagnostics: string[];
}

interface PhaseRunner {
  run(input: PhaseInput, signal: AbortSignal): Promise<PhaseResult>;
}
```

`slc` constructs the facade with a `PlaybookPorts` adapter; the runtime itself
receives only `PlaybookPorts` through `init`.

`PhaseInput` carries workspace paths, not contents; the artifact performs no
direct file I/O.
Agentic phases reach the workspace through the coding agent (`callPlayer`),
which reads the source and writes the `target` or `linked` output directly and
runs any tool the definition calls for, as in interpreted execution
([DR-004](004-slc-interpreted-phase-execution.md)).
Per-step model selection flows through Playbook player and judge bindings plus
host configuration.
Playbook port semantics are source-owned; SLC defines only the phase input,
the phase result, and the mapping to the [DR-003](003-slc-phase-execution.md)
protocol.
`slc` supplies a `PlaybookPorts` adapter.
It backs the agent-facing ports (`callPlayer` and `callJudge`) with Cligent
(npm `@sublang/cligent` [[2]]) per
[DR-004](004-slc-interpreted-phase-execution.md), and supplies status and
telemetry sinks so diagnostics can be drained.
How a host maps Playbook ports to concrete agents, models, process limits,
and diagnostic sinks is host-defined; portability holds over the Playbook
contract and the SLC phase-runner facade, not the execution environment.

The run causes writes only to the `target` or `linked` path from its input,
through the Playbook-mediated coding agent, with the
[DR-003](003-slc-phase-execution.md) generic checks enforcing the write-scope
invariant as they do for interpreted execution.
`slc` constructs the runtime, supplies the ports, drives it to quiescence, then maps the host-observable outcome onto the [DR-003](003-slc-phase-execution.md) protocol: `ok` proceeds to generic checks, `blocked` is the `BLOCKED` outcome, and `error` stops the pipeline like a failed generic check; diagnostics surface for every status, so an `ok` run still reports any ambiguity it resolved ([DR-003](003-slc-phase-execution.md#blocked-protocol)).

### Strategy selection

`slc` interprets every phase by default ([DR-004](004-slc-interpreted-phase-execution.md)).
When a pipeline pins a compiled artifact for a phase (see [Pinning](#pinning)), `slc` runs that artifact instead of interpreting.
Selection shall be explicit and reproducible: a pinned phase whose artifact is missing or stale fails with a diagnostic rather than silently interpreting, so a pinned pipeline runs the same way every time.

### Pinning

A pin associates a phase with a compiled artifact and the inputs that produced that artifact: the phase definition's semantic input closure and the `slc.link` target it was linked against.
The closure is the definition together with the cited or referenced content its rules depend on, so a current pin stays behavior-equivalent to interpreting the definition ([DR-004](004-slc-interpreted-phase-execution.md)), which may read that content.
Every `playbook` artifact is produced by `slc.link`, so the link-target input applies to all of them, not only compiled link phases.
The execution-time `linkTarget` a compiled link phase receives in `PhaseInput` is a `run` input, not a producing input, and is not part of the pin.
A pin is current when the artifact exists and those inputs are unchanged; `slc` then runs the artifact.
A pin whose artifact is missing or whose inputs changed is stale, and `slc` fails per [Strategy selection](#strategy-selection).
A phase with no pin is interpreted.

The concrete pin format — storage location, path resolution, hash algorithm, link-target identity, what belongs in the semantic input closure, and whether the producing meta-pipeline version is a pin input — is settled by [DR-007](007-slc-phase-artifact-pinning.md).
With that settled, compiled selection follows [Strategy selection](#strategy-selection); a phase without a current pin interprets ([DR-004](004-slc-interpreted-phase-execution.md)).

### Artifact stability

Because `slc.gears2fsm` is itself a judgment-based transformation, a phase artifact is a generated program.
Phase artifacts shall be built once, reviewed, and committed per pipeline version, and pinned once the pinning contract exists ([Pinning](#pinning)).
`slc` shall not regenerate them per invocation.

### Locations

Artifacts for the `slc` pipeline follow [DR-001](001-slc-pipeline-layout-naming-invocation.md#output-locations).
For example:

- `slc slc playbook/text2gears.md` writes `playbook/text2gears.slc/text2gears.gears.md` and `playbook/text2gears.slc/text2gears.fsm.ts`.
- `slc slc.link playbook/text2gears.slc/text2gears.fsm.ts <link-target>` writes `playbook/text2gears.slc/text2gears.playbook.ts`, unless `-o` overrides.

## Consequences

- A pipeline can be bootstrapped by compiling its own phase definitions; once the pinning contract exists, `slc` runs it through the resulting artifacts rather than interpreting them.
- Compiled phases gain auditable control flow (the GEARS-to-FSM mapping) while reusing Playbook's maintained runtime port boundary.
- Host and OS specifics stay behind Playbook ports, so compiled artifacts remain OS-agnostic.
- Once the pinning contract exists, version-pinned artifacts keep the toolchain stable across runs.
- Interpreted execution ([DR-004](004-slc-interpreted-phase-execution.md)) remains the reference semantics and the fallback for uncompiled phases.

## References

[1]: https://github.com/sublang-ai/playbook/blob/v0.9.0/slc/link.md "Playbook slc/link.md: FSM-to-runtime contract"
[2]: https://www.npmjs.com/package/@sublang/cligent "Cligent: Unified TypeScript SDK for AI Coding Agent CLIs"
