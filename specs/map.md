<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Spec Map

Quick-reference index for locating decisions and spec packages.
Spec items are the source of truth.
Code can be inconsistent with specs during development.

## Authoring and reviewing specs

Know the rules in [`meta.md`](meta.md) before authoring, modifying, or reviewing a DR, IR, or item.

## Layout

```text
decisions/    Decision records (DRs)
intents/      Intent records (IRs)
packages/     Spec packages (one file per package)
map.md        This index
meta.md       The spec of specs
```

## Decisions

| ID | File | Summary |
| --- | --- | --- |
| [DR-000](decisions/000-spec-structure-format.md) | 000-spec-structure-format.md | Spec structure, format, and naming conventions |
| [DR-001](decisions/001-slc-pipeline-layout-naming-invocation.md) | 001-slc-pipeline-layout-naming-invocation.md | Pipeline layout, naming, CLI invocation, and output locations |
| [DR-002](decisions/002-slc-link-phases.md) | 002-slc-link-phases.md | Generic link phases and link-target invocation |
| [DR-003](decisions/003-slc-phase-execution.md) | 003-slc-phase-execution.md | Phase execution boundary: generic slc vs phase-specific |
| [DR-004](decisions/004-slc-interpreted-phase-execution.md) | 004-slc-interpreted-phase-execution.md | Interpreted phase execution: agent bootstrap and reference semantics |
| [DR-005](decisions/005-slc-self-hosting-meta-pipeline.md) | 005-slc-self-hosting-meta-pipeline.md | Self-hosting meta pipeline: compiled phase artifacts |
| [DR-006](decisions/006-slc-configuration-sources.md) | 006-slc-configuration-sources.md | Configuration sources and precedence: env over config file, discovery, schema |
| [DR-007](decisions/007-slc-phase-artifact-pinning.md) | 007-slc-phase-artifact-pinning.md | Phase artifact pinning: currentness, semantic inputs, and compiled selection |
| [DR-008](decisions/008-slc-file-capability.md) | 008-slc-file-capability.md | File capability (superseded): compiled execution writes through agents and relies on the [DR-003](decisions/003-slc-phase-execution.md) generic checks |
| [DR-009](decisions/009-slc-playbook-pipeline-compilation.md) | 009-slc-playbook-pipeline-compilation.md | `playbook` pipeline compilation: generic invocation, compile-output scope, compiled performing, link reconciliation, and artifact-derived verification |
| [DR-010](decisions/010-playbook-runtime-contract-evolution.md) | 010-playbook-runtime-contract-evolution.md | Playbook runtime evolution: exact legacy/session-v1/composed-v2 profiles, fail-closed adoption, structured outcomes, host ports, trace privacy, and CI deferral |
| [DR-011](decisions/011-playbook-1-0-captain-contract-adoption.md) | 011-playbook-1-0-captain-contract-adoption.md | Playbook 1.0 adoption: final six-port composed profile, distinct Captain/player verification, dynamic child wiring, scripted child coverage, and atomic reviewed assets |
| [DR-012](decisions/012-playbook-routing-control-separation.md) | 012-playbook-routing-control-separation.md | Playbook routing/control separation: source-owned result metadata, exact Boss text, isolated Captain calls, and visible-prose ownership |
| [DR-013](decisions/013-normalize-and-pass-phases.md) | 013-normalize-and-pass-phases.md | Generic input normalization (`--normalize` over a pipeline-agnostic built-in definition) and LLVM-style format-preserving pass phases scheduled with `-O` |
| [DR-014](decisions/014-cwd-output-invocation-defaults-entry-emission.md) | 014-cwd-output-invocation-defaults-entry-emission.md | Artifacts in the invocation CWD, raw-entry auto-normalization, default-on passes, a default playbook link target, and deterministic entry-module emission |
| [DR-015](decisions/015-first-run-config-seeding.md) | 015-first-run-config-seeding.md | First-run seeding of `~/.config/slc/config.yaml` from a bundled starter template (`agent: claude-code`), superseding [DR-006](decisions/006-slc-configuration-sources.md)'s never-written consequence |
| [DR-016](decisions/016-gears-grammar-provenance.md) | 016-gears-grammar-provenance.md | The pinned GEARS grammar comes from the published `@sublang/spex` package (en + zh), replacing this repo's drifted local copies in the compile-pin closure |
| [DR-017](decisions/017-playbook-2-0-thin-runtime-adoption.md) | 017-playbook-2-0-thin-runtime-adoption.md | Playbook 2.0 adoption: 2.0.0 provenance to `composed-v2`, resolved Captain-failure mapping, thin-artifact pin closure with the shared engine, registry-entry role binding, and atomic reviewed assets |
| [DR-018](decisions/018-playbook-3-1-adoption.md) | 018-playbook-3-1-adoption.md | Playbook 3.1 adoption: 3.1.0 provenance to `composed-v2`, link.md judge-envelope and compat-stamping re-sync, full bundle rebuild, coupled demo manifest, and the global-first consumption model |
| [DR-019](decisions/019-compile-progress-stall-watchdog.md) | 019-compile-progress-stall-watchdog.md | In-run progress on stderr: per-phase lines with elapsed times, live compiled-status streaming, a 30 s silence-bounded heartbeat, a configurable agent-inactivity watchdog, and measured time estimates |
| [DR-020](decisions/020-playbook-4-0-adoption.md) | 020-playbook-4-0-adoption.md | Playbook 4.0 adoption: 4.0.0 provenance to `composed-v2` on a byte-identical runtime, retained bundles with regenerated pins, Cligent 0.18 as runtime-version authority, SDKs as devDependencies and demo-named vendors |
| [DR-021](decisions/021-incremental-compilation.md) | 021-incremental-compilation.md | Incremental compilation through complete versioned snapshots, exact phase reuse, and ordinary execution with prior-input/diff update context |
| [DR-022](decisions/022-two-agent-reviewed-compilation.md) | 022-two-agent-reviewed-compilation.md | Opt-in independent review/fix/re-review for transformation-performing compilation calls |
| [DR-023](decisions/023-host-settled-link-object-imports.md) | 023-host-settled-link-object-imports.md | Generic post-link settlement and reporting of declared-object import extensions from materialized siblings |
| [DR-024](decisions/024-playbook-10-schema-3-adoption.md) | 024-playbook-10-schema-3-adoption.md | Playbook 10 adoption: exact schema-3 `composed-v3`, Roles migration, mandatory bundle rebuild, Cligent 0.23 authority, and atomic reviewed assets |

## Packages

| File | Summary |
| --- | --- |
| [cli.md](packages/cli.md) | Published executable behavior, host wiring, configuration, successful-diagnostic routing, progress and heartbeat reporting, cancellation, and bin-boundary verification |
| [compiler.md](packages/compiler.md) | User-facing compiler contract: invocation forms, artifacts, run outcomes, optional reviewed execution, compiled-pin selection, raw-input normalization, and optimization passes |
| [continuous-integration.md](packages/continuous-integration.md) | Push and pull-request gates for source quality, reviewed artifacts, reproducible current pins, exact multi-profile runtime contracts, immutable Playbook adoption, demo acceptance, and package publication checks |
| [git.md](packages/git.md) | Commit identity checks, message conventions, AI attribution, intent references, and audit |
| [incremental-compilation.md](packages/incremental-compilation.md) | Complete build history, reuse/update/ordinary selection, update context, success-only publication, rebuilds, exclusions, and fixture acceptance |
| [licensing.md](packages/licensing.md) | SPDX header scope, license detection, required headers, upstream preservation, and verification |
| [phase-execution.md](packages/phase-execution.md) | Execution boundary, generic checks, blocked protocol, interpreted and optional reviewed execution, compiled runtime profiles, pin selection, status streaming, and the agent-stall watchdog |
| [pinning.md](packages/pinning.md) | Pin-currency validation and generation: presence, current/stale/malformed verdicts, and fixture acceptance |
| [pipeline.md](packages/pipeline.md) | Pipeline resolution, format and chain validation, source and artifact paths, invocation and link mechanics, link-object import settlement, pass and normalization scheduling, and system acceptance |
| [release.md](packages/release.md) | SemVer and changelog policy, package and publication gates, trusted idempotent release workflow, installed-package smoke, and opt-in live acceptance |
| [self-hosting.md](packages/self-hosting.md) | Reserved and `playbook` pipeline resolution, runnable `playbook` artifacts and entry modules, atomic reviewed-asset adoption, and system acceptance |
| [verification.md](packages/verification.md) | Compilation correctness: actor, child, and script conformance; introspection, prompt, transition, and runtime checks; portable generated tests; and emitted-module load integrity |
