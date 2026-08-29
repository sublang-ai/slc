<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Spec Map

Quick-reference index for locating spec files.
Spec items are the source of truth.
Code can be inconsistent with specs during development.

## Layout

```text
decisions/  Decision records (DRs)
iterations/ Iteration records (IRs)
user/       Spec item files for user-visible behavior
dev/        Spec item files for implementation requirements
test/       Spec item files for acceptance testing
map.md      This index
meta.md     The spec of specs
```

## Decisions

| ID | File | Summary |
| --- | --- | --- |
| DR-000 | [000-spec-structure-format.md](decisions/000-spec-structure-format.md) | Spec structure, format, and naming conventions |
| DR-001 | [001-slc-pipeline-layout-naming-invocation.md](decisions/001-slc-pipeline-layout-naming-invocation.md) | Pipeline layout, naming, CLI invocation, and output locations |
| DR-002 | [002-slc-link-phases.md](decisions/002-slc-link-phases.md) | Generic link phases and link-target invocation |
| DR-003 | [003-slc-phase-execution.md](decisions/003-slc-phase-execution.md) | Phase execution boundary: generic slc vs phase-specific |
| DR-004 | [004-slc-interpreted-phase-execution.md](decisions/004-slc-interpreted-phase-execution.md) | Interpreted phase execution: agent bootstrap and reference semantics |
| DR-005 | [005-slc-self-hosting-meta-pipeline.md](decisions/005-slc-self-hosting-meta-pipeline.md) | Self-hosting meta pipeline: compiled phase artifacts |
| DR-006 | [006-slc-configuration-sources.md](decisions/006-slc-configuration-sources.md) | Configuration sources and precedence: env over config file, discovery, schema |
| DR-007 | [007-slc-phase-artifact-pinning.md](decisions/007-slc-phase-artifact-pinning.md) | Phase artifact pinning: currentness, semantic inputs, and compiled selection |
| DR-008 | [008-slc-file-capability.md](decisions/008-slc-file-capability.md) | File capability (superseded): compiled execution writes through agents and relies on the DR-003 generic checks |
| DR-009 | [009-slc-playbook-pipeline-compilation.md](decisions/009-slc-playbook-pipeline-compilation.md) | `playbook` pipeline compilation: generic invocation, compile-output scope, compiled performing, link reconciliation, and artifact-derived verification |
| DR-010 | [010-playbook-runtime-contract-evolution.md](decisions/010-playbook-runtime-contract-evolution.md) | Playbook runtime evolution: exact legacy/session-v1/composed-v2 profiles, fail-closed adoption, structured outcomes, host ports, trace privacy, and CI deferral |
| DR-011 | [011-playbook-1-0-captain-contract-adoption.md](decisions/011-playbook-1-0-captain-contract-adoption.md) | Playbook 1.0 adoption: final six-port composed profile, distinct Captain/player verification, dynamic child wiring, scripted child coverage, and atomic reviewed assets |
| DR-012 | [012-playbook-routing-control-separation.md](decisions/012-playbook-routing-control-separation.md) | Playbook routing/control separation: source-owned result metadata, exact Boss text, isolated Captain calls, and visible-prose ownership |
| DR-013 | [013-normalize-and-pass-phases.md](decisions/013-normalize-and-pass-phases.md) | Generic input normalization (`--normalize` over a pipeline-agnostic built-in definition) and LLVM-style format-preserving pass phases scheduled with `-O` |
| DR-014 | [014-cwd-output-invocation-defaults-entry-emission.md](decisions/014-cwd-output-invocation-defaults-entry-emission.md) | Artifacts in the invocation CWD, raw-entry auto-normalization, default-on passes, a default playbook link target, and deterministic entry-module emission |
| DR-015 | [015-first-run-config-seeding.md](decisions/015-first-run-config-seeding.md) | First-run seeding of `~/.config/slc/config.yaml` from a bundled starter template (`agent: claude-code`), superseding DR-006's never-written consequence |
| DR-016 | [016-gears-grammar-provenance.md](decisions/016-gears-grammar-provenance.md) | The pinned GEARS grammar comes from the published `@sublang/spex` package (en + zh), replacing this repo's drifted local copies in the compile-pin closure |
| DR-017 | [017-playbook-2-0-thin-runtime-adoption.md](decisions/017-playbook-2-0-thin-runtime-adoption.md) | Playbook 2.0 adoption: 2.0.0 provenance to `composed-v2`, resolved Captain-failure mapping, thin-artifact pin closure with the shared engine, registry-entry role binding, and atomic reviewed assets |
| DR-018 | [018-playbook-3-1-adoption.md](decisions/018-playbook-3-1-adoption.md) | Playbook 3.1 adoption: 3.1.0 provenance to `composed-v2`, link.md judge-envelope and compat-stamping re-sync, full bundle rebuild, coupled demo manifest, and the global-first consumption model |
| DR-019 | [019-compile-progress-stall-watchdog.md](decisions/019-compile-progress-stall-watchdog.md) | In-run progress on stderr: per-phase lines with elapsed times, live compiled-status streaming, a 30 s silence-bounded heartbeat, a configurable agent-inactivity watchdog, and measured time estimates |
| DR-020 | [020-playbook-4-0-adoption.md](decisions/020-playbook-4-0-adoption.md) | Playbook 4.0 adoption: 4.0.0 provenance to `composed-v2` on a byte-identical runtime, retained bundles with regenerated pins, cligent 0.18 as runtime-version authority, SDKs as devDependencies and demo-named vendors |
| DR-021 | [021-incremental-compilation.md](decisions/021-incremental-compilation.md) | Incremental compilation through complete versioned snapshots, exact phase reuse, and ordinary execution with prior-input/diff update context |
| DR-022 | [022-two-agent-reviewed-compilation.md](decisions/022-two-agent-reviewed-compilation.md) | Opt-in independent review/fix/re-review for transformation-performing compilation calls |
| DR-023 | [023-host-settled-link-object-imports.md](decisions/023-host-settled-link-object-imports.md) | Generic post-link settlement and reporting of declared-object import extensions from materialized siblings |

## Packages

### continuous-integration

| Group | File | Summary |
| --- | --- | --- |
| package | [continuous-integration.md](packages/continuous-integration.md) | Push and pull-request gates for source quality, reviewed artifacts, reproducible current pins, runtime-transition boundaries, immutable Playbook adoption, demo acceptance, and package publication checks |

### cli

| Group | File | Summary |
| --- | --- | --- |
| package | [cli.md](packages/cli.md) | Published executable behavior, host wiring, configuration, progress and heartbeat reporting, cancellation, and bin-boundary verification |

### compiler

| Group | File | Summary |
| --- | --- | --- |
| package | [compiler.md](packages/compiler.md) | User-facing compiler contract: invocation forms, artifacts, run outcomes, optional reviewed execution, compiled-pin selection, raw-input normalization, and optimization passes |

### git

| Group | File | Summary |
| --- | --- | --- |
| package | [git.md](packages/git.md) | Commit identity checks, message conventions, AI attribution, intent references, and audit |

### incremental-compilation

| Group | File | Summary |
| --- | --- | --- |
| package | [incremental-compilation.md](packages/incremental-compilation.md) | Complete build history, reuse/update/ordinary selection, update context, success-only publication, rebuilds, exclusions, and fixture acceptance |

### licensing

| Group | File | Summary |
| --- | --- | --- |
| package | [licensing.md](packages/licensing.md) | SPDX header scope, license detection, required headers, upstream preservation, and verification |

### phase-execution

| Group | File | Summary |
| --- | --- | --- |
| package | [phase-execution.md](packages/phase-execution.md) | Execution boundary, generic checks, blocked protocol, interpreted and optional reviewed execution, compiled runtime profiles, pin selection, status streaming, and the agent-stall watchdog |

### pinning

| Group | File | Summary |
| --- | --- | --- |
| package | [pinning.md](packages/pinning.md) | Pin-currency validation and generation: presence, current/stale/malformed verdicts, and fixture acceptance |

### pipeline

| Group | File | Summary |
| --- | --- | --- |
| package | [pipeline.md](packages/pipeline.md) | Pipeline resolution, format and chain validation, source and artifact paths, invocation and link mechanics, pass and normalization scheduling, and system acceptance |

### release

| Group | File | Summary |
| --- | --- | --- |
| package | [release.md](packages/release.md) | SemVer and changelog policy, package and publication gates, trusted idempotent release workflow, installed-package smoke, and opt-in live acceptance |

### self-hosting

| Group | File | Summary |
| --- | --- | --- |
| package | [self-hosting.md](packages/self-hosting.md) | Reserved and `playbook` pipeline resolution, runnable `playbook` artifacts and entry modules, atomic reviewed-asset adoption, and system acceptance |

### verification

| Group | File | Summary |
| --- | --- | --- |
| package | [verification.md](packages/verification.md) | Compilation correctness: actor, child, and script conformance; introspection, prompt, transition, and runtime checks; portable generated tests; and emitted-module load integrity |
