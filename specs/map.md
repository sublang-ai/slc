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

## Iterations

| ID | File | Goal |
| --- | --- | --- |
| IR-000 | [000-spdx-headers.md](iterations/000-spdx-headers.md) | Add SPDX headers to applicable files |
| IR-001 | [001-slc-phase-execution.md](iterations/001-slc-phase-execution.md) | Implement DR-003/DR-004: interpreted slc phase execution |
| IR-002 | [002-slc-cli-bin.md](iterations/002-slc-cli-bin.md) | Wire the slc bin to runSlc: resolver, agent config, reporting, CLI |
| IR-003 | [003-slc-config-file.md](iterations/003-slc-config-file.md) | Add a simple YAML config file for slc's cligent invocation |
| IR-004 | [004-slc-pin-validator.md](iterations/004-slc-pin-validator.md) | Implement DR-007's pin model and host-side currency validator |
| IR-005 | [005-slc-compiled-execution.md](iterations/005-slc-compiled-execution.md) | Implement DR-005, DR-008 (since superseded), and the compiled-execution DR-007 items: file capability, compiled execution, selection, meta-pipeline |
| IR-006 | [006-slc-playbook-runtime-reconciliation.md](iterations/006-slc-playbook-runtime-reconciliation.md) | Reconcile compiled execution with Playbook 0.7.0's playbook/PlaybookRuntime contract |
| IR-007 | [007-slc-playbook-pipeline-compilation.md](iterations/007-slc-playbook-pipeline-compilation.md) | Implement `slc playbook` end to end: resolve the playbook pipeline, complete compiled execution, bootstrap pinned meta-phase artifacts, auto-generate verification tests, and compare to the reference |
| IR-008 | [008-playbook-runtime-contract-evolution.md](iterations/008-playbook-runtime-contract-evolution.md) | Reconcile three runtime profiles, structured results, composition-aware verification, CI, and the immutable-release boundary |
| IR-009 | [009-playbook-1-0-captain-adoption.md](iterations/009-playbook-1-0-captain-adoption.md) | Adopt Playbook 1.0's six-port runtime, Captain and dynamic-child compiler primitives, reviewed definitions and artifacts, and pins as one reproducible set |
| IR-010 | [010-playbook-routing-control-separation.md](iterations/010-playbook-routing-control-separation.md) | Separate routing prose from control metadata, preserve exact Boss text, isolate Captain calls, and verify explicit result contracts |
| IR-011 | [011-playbook-0-10-adoption.md](iterations/011-playbook-0-10-adoption.md) | Adopt the Playbook 0.10 generation: frozen local legacy contract, composed-v2 pin mapping, re-synced definitions, rebuilt meta artifacts, and refreshed pins |
| IR-012 | [012-normalize-optimize-demo.md](iterations/012-normalize-optimize-demo.md) | Implement DR-013 (--normalize, -O pass phases, script-actor verification) and land the end-to-end demo/ acceptance workflow |
| IR-013 | [013-cwd-output-entry-emission-demo.md](iterations/013-cwd-output-entry-emission-demo.md) | Implement DR-014 (CWD output, raw-entry normalization, default passes, default link target, entry emission) and rebase demo/ on the three-line flow |
| IR-014 | [014-gears-provenance-adoption.md](iterations/014-gears-provenance-adoption.md) | Adopt DR-016: spex dependency, vendored definition sync, grammar Pin Inputs swap, pin regeneration (meta-artifact recompile deferred) |
| IR-015 | [015-playbook-2-0-adoption.md](iterations/015-playbook-2-0-adoption.md) | Adopt DR-017: dependency bumps, 2.0.0 provenance mapping, definition re-sync, meta-artifact rebuild, pin regeneration, entry role binding, and the English demo reference |
| IR-016 | [016-first-release.md](iterations/016-first-release.md) | Prepare the first npm release: 0.1.0 metadata and changelog, project-local thin-runtime install, package smoke, and CI-green bootstrap/OIDC publication |

## Packages

### CI

| Group | File | Summary |
| --- | --- | --- |
| dev | [continuous-integration.md](dev/continuous-integration.md) | Push and pull-request gates for source quality, reviewed artifacts, reproducible current pins, the runtime-transition boundary, and atomic Playbook 2.0 adoption |

### CLI

| Group | File | Summary |
| --- | --- | --- |
| user | [cli.md](user/cli.md) | Executable surface: version/help, success and failure reporting, cancellation, config file |
| dev | [cli.md](dev/cli.md) | Bin wiring: resolver, agent/config-file selection, executor injection, process control |
| test | [cli.md](test/cli.md) | Integration: version/help, reporting, exit codes, cancellation, config file/env, pinned compiled execution |

### COMPILE

| Group | File | Summary |
| --- | --- | --- |
| user | [compiler.md](user/compiler.md) | User-facing compiler contract: invocation forms, artifacts, run outcomes, compiled-pin selection, raw-input normalization, and optimization passes |

### GIT

| Group | File | Summary |
| --- | --- | --- |
| dev | [git.md](dev/git.md) | Commit message format and AI co-authorship trailers |

### LIC

| Group | File | Summary |
| --- | --- | --- |
| dev | [licensing.md](dev/licensing.md) | SPDX header requirements and file-scope rules |
| test | [licensing.md](test/licensing.md) | Copyright and license header presence checks |

### PHEXEC

| Group | File | Summary |
| --- | --- | --- |
| dev | [phase-execution.md](dev/phase-execution.md) | Execution boundary, generic checks, blocked protocol, interpreted execution, compiled phase-runner facade, six-port Cligent adapter, and provenance-driven selection |
| test | [phase-execution.md](test/phase-execution.md) | End-to-end interpreted execution, generic checks, blocked protocol, compiled runtime profiles including direct Captain, and pin-selection acceptance |

### PIN

| Group | File | Summary |
| --- | --- | --- |
| dev | [pinning.md](dev/pinning.md) | Pin-currency validator and build-and-review generation: presence, currency, stale/malformed verdicts, pin writing |
| test | [pinning.md](test/pinning.md) | Acceptance: no-pins, current, stale, malformed verdicts, and a generate-then-validate round-trip |

### PIPE

| Group | File | Summary |
| --- | --- | --- |
| dev | [pipeline.md](dev/pipeline.md) | Pipeline mechanics: resolution, formats, chain, naming, paths, CLI, link, pass phases, and the generic normalization step |
| test | [pipeline.md](test/pipeline.md) | End-to-end pipeline run, chain, naming, path, link, pass-scheduling, and normalization acceptance |

### RELEASE

| Group | File | Summary |
| --- | --- | --- |
| dev | [release.md](dev/release.md) | SemVer, changelog, package contract, first-publication bootstrap, CI-green OIDC publication, GitHub release, and pre-release checks |
| test | [release.md](test/release.md) | Tarball hygiene, installed executable and exports, external thin-artifact resolution, and bootstrap/OIDC isolation |

### SELFHOST

| Group | File | Summary |
| --- | --- | --- |
| user | [self-hosting.md](user/self-hosting.md) | Reserved `slc` meta-pipeline: compiling a definition into a runnable `playbook` artifact |
| dev | [self-hosting.md](dev/self-hosting.md) | Reserved `slc` name, the `playbook` linked format, shared-definition resolution, and atomic Playbook 2.0 definition/artifact/pin adoption |
| test | [self-hosting.md](test/self-hosting.md) | Acceptance: reserved-name and `playbook`-pipeline resolution, compilation and linking, plus clean-install consistency of the adopted reviewed set |

### VERIFY

| Group | File | Summary |
| --- | --- | --- |
| dev | [verification.md](dev/verification.md) | Compilation correctness: distinct Captain/player/child/script conformance, dynamic context wiring, pinned introspection, prompt contracts, scripted transition coverage, and artifact-local checker support |
| test | [verification.md](test/verification.md) | Acceptance: reference and synthetic checks, injected actor/dynamic/transition drift, runtime equivalence, and portable emitted verification artifacts |
