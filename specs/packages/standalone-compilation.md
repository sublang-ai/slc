<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# standalone-compilation: Managed Workflow Compilation Environment

## Intent

This package refines the cross-platform global CLI delivery goal [[delivery-acceptance-1](delivery-acceptance.md#delivery-acceptance-1)] and specifies one workflow-owned environment, isolated artifact preparation, target-runtime identity, entry format, and inspectable build evidence for globally installed SLC compiling Playbook workflows under [DR-068](../decisions/068-standalone-compilation-environment.md).
Essential project-specific references are the `slc` CLI, the `playbook` pipeline, and the installed `@sublang/playbook` environment service and runtime.
Compilation verification remains owned by the verification package; this package supplies its selected environment.

## External Behavior

### standalone-compilation-1

When planning a full, direct-phase, link, or completion-only invocation of the `playbook` pipeline, SLC shall use one workflow-owned internal environment under its canonical artifact directory [[pipeline-7](pipeline.md#pipeline-7)], without an environment-mode flag or selecting dependencies from the invocation directory's ancestor manifests, whether the surrounding directory is empty or belongs to an existing project.

### standalone-compilation-11

Where `-o` explicitly relocates a linked output, SLC shall retain the generic output-location and entry-omission contract [[pipeline-15](pipeline.md#pipeline-15)], [[self-hosting-15](self-hosting.md#self-hosting-15)] without refusing solely because the destination lies outside the internal artifact directory, while checking that output's actual module format and imports against the same workflow environment [[standalone-compilation-3](#standalone-compilation-3)] and reporting an actual unsupported format or unresolved dependency rather than adding a directory-based prohibition.

### standalone-compilation-2

When preparing a workflow's output environment [[standalone-compilation-1](#standalone-compilation-1)], SLC shall use the installed Playbook environment service to create a private `type: module` package and platform-appropriate direct directory links at `node_modules/xstate` and `node_modules/@sublang/playbook` inside the canonical artifact directory [[pipeline-7](pipeline.md#pipeline-7)], without creating or changing a project-root manifest, lockfile, tsconfig, dependency tree, or ancestor settings and without registry installation or `npm link`.

### standalone-compilation-3

When resolving a build's target environment, SLC shall bind all runtime-dependent operations to one compatible resolved Playbook/XState pair, selected from the compiler installation for the workflow-owned environment [[standalone-compilation-1](#standalone-compilation-1)], with XState resolved through the selected Playbook package and artifact resolution required to agree:

- Resolve and validate physical package roots, versions, runtime ABI, artifact schema support, and required compiler assets before Agent work.
- Select authoritative phase definitions and the default runtime link target from that Playbook root, retaining explicit pipeline definitions only with their complete semantic-input identity and supported runtime contract [[self-hosting-9](self-hosting.md#self-hosting-9)].
- Resolve generated imports, dependency declarations, and runtime loading against that same pair; use SLC's own TypeScript and Node typings for compiler-owned checking [[verification-33](verification.md#verification-33)].
- Refuse a custom link target with an unprovable or incompatible runtime identity instead of mixing it with a different installed engine.

### standalone-compilation-4

Where entry emission is eligible [[self-hosting-15](self-hosting.md#self-hosting-15)], when emitting a new workflow entry, SLC shall produce `<cwd>/<basename>.mjs` as real JavaScript with the same registry-entry contract:

- derive the linked-module import and manifest reference from the actual entry/artifact locations, including the case where the invocation directory is already the artifact directory, rather than hard-code a nested `<basename>.playbook` path;
- emit exactly one compiler-owned header comment `// @sublang/slc-build-manifest <JSON string>` containing the relative path to that bundle's `build-manifest.json` before executable code;
- reference the linked module inside its private ESM scope through a relative import, without TypeScript-only syntax, a renamed TypeScript payload, installation-specific absolute imports or environment-mode selection;
- retain historical `.ts` artifact consumption while coordinating new entry emission only with the Playbook loader in this change.

### standalone-compilation-5

Where a canonical registry entry is produced, when accepting its managed bundle, SLC shall publish `<art-dir>/build-manifest.json` with schema `sublang.slc.build.v1` as the declared entry and environment record using the exact public schema accepted by the selected Playbook environment service:

- entry path and format, with the manifest location identifying the artifact directory, plus definition and semantic-input digests and compiler package version/build identity;
- Playbook and XState package names, versions, canonical physical roots and runtime-content digests, runtime ABI and artifact schema;
- relative paths, module formats and content digests, distinguishing runtime-required FSM/linked/entry/support files from Source, GEARS and checker provenance, excluding a manifest self-digest and not making archived compiler evidence a runtime dependency;
- compiler-owned gate results, including entry initialization and disposal before success [[verification-79](verification.md#verification-79)], and links to the invocation evidence [[standalone-compilation-8](#standalone-compilation-8)];
- atomic publication only after every required gate passes, preserving the prior successful build record on failure [[incremental-compilation-1](incremental-compilation.md#incremental-compilation-1)].

### standalone-compilation-6

Where a retained bundle or cached build is available, when evaluating reuse, SLC shall validate its current target environment against the recorded identity [[standalone-compilation-5](#standalone-compilation-5)] before reporting `up to date` [[incremental-compilation-2](incremental-compilation.md#incremental-compilation-2)]:

| Case | Outcome |
| --- | --- |
| Same package roots, versions, compatibility, dependency content identity, and checked artifacts | Ordinary content-based reuse remains available. |
| Changed runtime, changed accepted artifact bytes, or missing identity record | Deterministically revalidate against the selected environment before accepting or recording the current identity; incompatible transformation inputs require normal rebuild rather than silently reusing them. |
| Dangling managed link | Repair only to an installed compatible target with provisioning authority, followed by revalidation; otherwise diagnose the missing target and require restore or rebuild. |
| Occupied foreign path in the workflow-owned environment | Fail with the path and remedy without replacing it; surrounding project dependency declarations do not select or block this environment. |

### standalone-compilation-7

When environment preparation or validation fails, SLC shall report the workflow environment directory, failing dependency or path, detected and required compatibility where known, and an actionable repair as an environment failure, preserving protected sources and dependencies [[phase-execution-42](phase-execution.md#phase-execution-42)] rather than requesting an Agent to rewrite workflow semantics.

### standalone-compilation-8

Where preflight permits safe writes to the artifact directory, when a managed compilation is attempted, SLC shall retain an invocation record under `<art-dir>/.slc/attempts/<unique-id>/` sufficient to trace its execution without provider credentials:

- original argv and effective non-secret configuration, compiler/target identities and resolved Agent SDK/native-runtime versions where exposed by Cligent, source and semantic-input snapshots or retained content-addressed copies;
- ordered phase and check records with input/output paths and digests, executed commands or public API operation names and non-secret parameters, start/end timestamps, elapsed monotonic duration, exit status or structured outcome, and captured stdout/stderr;
- separate reused, executed, repaired-internally, blocked, failed, and canceled outcomes, including each Coder correction and the findings that caused it;
- recorded public-input witnesses, selected coverage budgets, checker version and outcome, and final manifest or failure diagnostics;
- redacted authentication data and no unrelated user-home or session contents.

## Verification

### standalone-compilation-9

Where the packed candidate is installed alone in an isolated global prefix on a supported Node runtime, when the real installed CLI compiles a fresh workflow using the deterministic transport integration seam, the suite shall verify the standalone compilation matrix:

| Fixture | Assertions |
| --- | --- |
| Empty output directory, also below an unrelated CommonJS ancestor and with spaces or Chinese characters | Automatic workflow-owned environment preparation [[standalone-compilation-1](#standalone-compilation-1)], only internal environment preparation [[standalone-compilation-2](#standalone-compilation-2)], target identity agreement [[standalone-compilation-3](#standalone-compilation-3)], importable true-JavaScript `.mjs` entry [[standalone-compilation-4](#standalone-compilation-4)], and accepted manifest [[standalone-compilation-5](#standalone-compilation-5)]. |
| Surrounding project declares compatible, incompatible or missing Playbook/XState dependencies, or no runtime dependency; a separate fixture occupies an internal managed path | The same workflow-owned environment in every surrounding project, without using or changing its dependencies [[standalone-compilation-1](#standalone-compilation-1)], and an occupied-path refusal preserving user content [[standalone-compilation-7](#standalone-compilation-7)]. |
| Repeated compile, changed package content/version/root, removed global target, or legacy record without environment identity | Correct unchanged reuse or revalidation/rebuild requirement with no false cache success [[standalone-compilation-6](#standalone-compilation-6)]. |
| Failure and cancellation during generation or checking | Inspectable phase inputs, outputs, timing, commands, corrections, budget and final cause [[standalone-compilation-8](#standalone-compilation-8)], with no newly accepted manifest [[standalone-compilation-5](#standalone-compilation-5)]. |

### standalone-compilation-10

Where an invocation record exists [[standalone-compilation-8](#standalone-compilation-8)], when an independent process reconstructs the run without its original Agent session, the integration suite shall verify that the recorded source, intermediate revisions, target identity, commands, gate findings, and final result can be cross-checked by digest, with no authentication material present [[standalone-compilation-8](#standalone-compilation-8)].

### standalone-compilation-12

Under [[standalone-compilation-9](#standalone-compilation-9)]'s installed-candidate precondition, when CLI integration compiles from a directory already named as its artifact bundle and exercises supported relocated linked outputs under `-o`, the suite shall verify actual-path entry imports and manifest markers [[standalone-compilation-4](#standalone-compilation-4)], successful supported relocation with no new directory ban and no automatic entry, and honest actual-format/import failures without project mutation [[standalone-compilation-11](#standalone-compilation-11)].
