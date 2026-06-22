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
| DR-008 | [008-slc-file-capability.md](decisions/008-slc-file-capability.md) | File capability: confined paths, exact-byte hashes, and target-scoped writes |

## Iterations

| ID | File | Goal |
| --- | --- | --- |
| IR-000 | [000-spdx-headers.md](iterations/000-spdx-headers.md) | Add SPDX headers to applicable files |
| IR-001 | [001-slc-phase-execution.md](iterations/001-slc-phase-execution.md) | Implement DR-003/DR-004: interpreted slc phase execution |
| IR-002 | [002-slc-cli-bin.md](iterations/002-slc-cli-bin.md) | Wire the slc bin to runSlc: resolver, agent config, reporting, CLI |
| IR-003 | [003-slc-config-file.md](iterations/003-slc-config-file.md) | Add a simple YAML config file for slc's cligent invocation |
| IR-004 | [004-slc-pin-validator.md](iterations/004-slc-pin-validator.md) | Implement DR-007's pin model and host-side currency validator |
| IR-005 | [005-slc-compiled-execution.md](iterations/005-slc-compiled-execution.md) | Implement DR-005, DR-008, and the compiled-execution DR-007 items: file capability, compiled execution, selection, meta-pipeline |
| IR-006 | [006-slc-playbook-runtime-reconciliation.md](iterations/006-slc-playbook-runtime-reconciliation.md) | Reconcile compiled execution with Playbook 0.7.0's playbook/PlaybookRuntime contract |

## Packages

### CLI

| Group | File | Summary |
| --- | --- | --- |
| user | [cli.md](user/cli.md) | Executable surface: version/help, success and failure reporting, cancellation, config file |
| dev | [cli.md](dev/cli.md) | Bin wiring: resolver, agent/config-file selection, executor injection, process control |
| test | [cli.md](test/cli.md) | Integration: version/help, reporting, exit codes, cancellation, config file/env |

### COMPILE

| Group | File | Summary |
| --- | --- | --- |
| user | [compiler.md](user/compiler.md) | User-facing compiler contract: invocation forms, artifacts, run outcomes, and compiled-pin selection |

### FCAP

| Group | File | Summary |
| --- | --- | --- |
| dev | [file-capability.md](dev/file-capability.md) | Host-side file capability and per-run grants: confined paths, exact-byte hashes, atomic writes, compare-and-swap, default-deny grants |
| test | [file-capability.md](test/file-capability.md) | Acceptance: path confinement, hash round-trip, listing order, ifMatch, and default-deny grants over a fixture root |

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
| dev | [phase-execution.md](dev/phase-execution.md) | Execution boundary, generic checks, blocked protocol, interpreted execution, compiled phase-runner facade, Cligent ports adapter, and compiled selection |
| test | [phase-execution.md](test/phase-execution.md) | End-to-end interpreted execution, generic checks, blocked-protocol, compiled-artifact, and pin-selection acceptance |

### PIN

| Group | File | Summary |
| --- | --- | --- |
| dev | [pinning.md](dev/pinning.md) | Pin-currency validator and build-and-review generation: presence, currency, stale/malformed verdicts, pin writing |
| test | [pinning.md](test/pinning.md) | Acceptance: no-pins, current, stale, malformed verdicts, and a generate-then-validate round-trip |

### PIPE

| Group | File | Summary |
| --- | --- | --- |
| dev | [pipeline.md](dev/pipeline.md) | Pipeline mechanics: resolution, formats, chain, naming, paths, CLI, link |
| test | [pipeline.md](test/pipeline.md) | End-to-end pipeline run, chain, naming, path, and link acceptance |

### SELFHOST

| Group | File | Summary |
| --- | --- | --- |
| user | [self-hosting.md](user/self-hosting.md) | Reserved `slc` meta-pipeline: compiling a definition into a runnable `playbook` artifact |
| dev | [self-hosting.md](dev/self-hosting.md) | Reserved `slc` name and the `playbook` linked format realized through generic pipeline/link mechanics |
| test | [self-hosting.md](test/self-hosting.md) | Acceptance: reserved-name resolution, `playbook` linking, and DR-001 locations |
