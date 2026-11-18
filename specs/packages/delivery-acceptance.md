<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# delivery-acceptance: Global CLI Compilation Delivery

## Intent

This package states the delivery goal governing SLC, its Cligent and Playbook dependencies, and the acceptance evidence for their coordinated change.
The user installs SLC once, enters a new empty child directory beneath different parent-directory states, and compiles one workflow definition through environment variables and the real SLC CLI.
The goal applies to macOS, Linux and native Windows; the separate `spex-playbook` Skill and business-workflow result quality are outside this change.

## External Behavior

### delivery-acceptance-1

Where Node/npm and the selected Agent's authorized authentication context are available, when the user installs only `@sublang/slc` and runs `slc playbook <definition-file>` from a fresh empty child directory with Agent/model choices supplied through environment variables, SLC shall complete supported workflow compilation using its automatically acquired dependency closure and workflow-owned environment [[standalone-compilation-1](standalone-compilation.md#standalone-compilation-1)], without a user-created project manifest, lockfile, tsconfig, dependency installation, Git initialization or hand-edited generated code.

### delivery-acceptance-2

The delivery acceptance shall exercise the real installed SLC CLI and actual configured Agent on macOS, Linux and native Windows, recording OS version, architecture, Node/npm version and native shell, with WSL, a Linux container, mocked Agent output or a checkout invocation providing no substitute for a native-platform pass.

### delivery-acceptance-3

When testing parent-directory independence, acceptance shall create a new empty child for every case and use the same frozen self-contained workflow definition and equivalent Agent/model settings across this case matrix, with factorization permitted only under all conditions below:

| Parent or path state | Required outcome |
| --- | --- |
| No Node project or dependency tree | Compile through the workflow-owned environment. |
| Ancestor `package.json` declares CommonJS | Compile without inheriting that module format. |
| Ancestor `package.json` declares ESM | Same compilation and dependency selection. |
| Ancestor declares Playbook/XState with a compatible installation | Use the compiler-selected workflow runtime, without changing the parent. |
| Ancestor declares missing or incompatible runtime dependencies | Same workflow-owned environment, without installing or repairing parent dependencies. |
| Ancestor has unrelated compiler settings, Node typings or dependency versions | Compiler-owned checking, without reading parent tsconfig as authority. |
| Paths contain spaces and Chinese characters, including native Windows drive paths | Correct input, output, command and runtime-link handling. |
| Child is inside or outside a Git repository | No user-created child repository as a compilation prerequisite. |

Permitted factorization conditions:

- Separately identified current evidence of real source-only cold compilation with Codex on every native platform in both a no-project, outside-Git empty parent and a CommonJS stress fixture with a real Git ancestor, spaces and Chinese characters in the child path, conflicting parent runtimes and unrelated compiler/types settings.
- Current installed-CLI environment/checking/initialization revalidation of immutable independently accepted workflow inputs for each matrix state, exercising the actual selected runtime and checks in fresh children, preserving independent accepted-code hashes and disclosing zero generation calls, without describing retained-input cases as source-only cold compilation.
- Identification of the common workflow-owned preparation and compiler-owned checking paths exercised by both layers, with independent review of why remaining parent-state differences cannot select another Agent runtime or checking environment; any uncovered Agent trust, path or environment branch requires a further real cold case.

### delivery-acceptance-4

When validating this standalone-environment delivery, acceptance shall use `codex` with the owner's login configuration for the native-platform and parent-directory matrix and only one successful simple-flow compilation with `claude-code` in the authorized GLM Coding Plan context to confirm that backend works, recording actual provider/model and SDK/native-runtime identities in isolated test contexts without credentials in evidence or describing GLM as an Anthropic model, with no additional Claude/GLM platform or scenario matrix required.

### delivery-acceptance-5

When evaluating a compilation case, acceptance shall count success only after a zero exit status, current accepted output identity and the required compiler-owned checks including safe entry initialization/disposal [[verification-79](verification.md#verification-79)], recording failure phase and cause otherwise, with no complete business-task execution or business-output-quality score required.

### delivery-acceptance-6

When preparing delivery evidence, maintainers shall separate functional and registry-install acceptance:

| Layer | Method and claim |
| --- | --- |
| Local functional acceptance | Build and pack the candidate sources, install their production artifacts into an isolated tool environment, record how the coordinated local package graph was supplied, and run the native-platform/backend/parent matrix [[delivery-acceptance-2](#delivery-acceptance-2)], [[delivery-acceptance-3](#delivery-acceptance-3)], [[delivery-acceptance-4](#delivery-acceptance-4)]; this proves operation of the installed candidate, not registry dependency acquisition. |
| Registry-install acceptance | Publish coordinated branch candidates through the candidate release gate [[release-30](release.md#release-30)], install only the exact SLC candidate globally from the registry into a fresh isolated prefix, inspect the actual complete production dependency tree and packaged files, then perform real post-install compilation smoke on every native platform with Codex, plus the separately scoped Claude/GLM workability smoke [[delivery-acceptance-4](#delivery-acceptance-4)]; this proves acquisition and installed-package usability. |

### delivery-acceptance-7

When registry-install acceptance runs, it shall require automatically installed Cligent, Playbook, XState, selected compiler/checking tools and both included SDKs at the intended candidate identities, refusing evidence supplied by a sibling checkout, `npm link`, development-only dependencies, unrelated global packages or a manual SDK/Playbook install, with the post-install smoke including the empty-parent and CommonJS-parent cases.

### delivery-acceptance-8

When a coordinated candidate set is evaluated for merge, maintainers shall merge its PRs only after the required functional matrix, registry-install matrix, regression checks and repository CI pass for the recorded source heads, retaining source/package identities, definition digests, non-secret commands and effective settings, timings, exit codes, outputs and failure classifications, with a functional or packaged-code change invalidating affected prior evidence and no formal stable npm release required before acceptance.

## Verification

### delivery-acceptance-9

When the installed-candidate acceptance harness runs the frozen workflow through real CLI processes, the system suite shall verify the single-install/empty-child contract [[delivery-acceptance-1](#delivery-acceptance-1)], the complete native-platform/backend/parent matrix [[delivery-acceptance-2](#delivery-acceptance-2)], [[delivery-acceptance-3](#delivery-acceptance-3)], [[delivery-acceptance-4](#delivery-acceptance-4)], the separately identified cold-generation and retained-input layers permitted by [[delivery-acceptance-3](#delivery-acceptance-3)], and truthful compile/initialization outcomes without business execution [[delivery-acceptance-5](#delivery-acceptance-5)].

### delivery-acceptance-10

When the release acceptance harness compares local production-package runs with exact registry-candidate installs in clean prefixes, it shall verify that the two evidence layers remain distinct [[delivery-acceptance-6](#delivery-acceptance-6)], every required package resolves from the intended acquired tree with no manual dependency repair [[delivery-acceptance-7](#delivery-acceptance-7)], and an incomplete platform, wrong package identity, failed smoke or changed source prevents the merge gate from passing [[delivery-acceptance-8](#delivery-acceptance-8)].
