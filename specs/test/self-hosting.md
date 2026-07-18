<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# SELFHOST: Self-Hosting Meta-Pipeline

## Intent

This package specifies integration acceptance tests for the reserved `slc`
meta-pipeline and its `playbook` linked format in the `self-hosting` packages,
running an `slc`-named fixture pipeline, the reserved `slc`, and the `playbook`
domain pipeline resolved to the definitions `@sublang/playbook` provides, end to
end with a faked agent transport per
[DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) and
[DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), including the
Playbook 1.0 adoption of
[DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md).

Essential project-specific references: `slc`, this project's compiler CLI; and
`@sublang/playbook`, whose `slc/` definitions the reserved `slc` consumes.

## Meta-pipeline runs

### SELFHOST-4
Verifies: [SELFHOST-1](../user/self-hosting.md#selfhost-1), [SELFHOST-2](../dev/self-hosting.md#selfhost-2), [SELFHOST-3](../dev/self-hosting.md#selfhost-3)

Where a fixture reserves an `slc` pipeline that chains `text2gears` and `gears2fsm` and a `link.md` emitting `playbook`, when the user runs `slc slc <definition>` and then the same run with an explicit `--link <target>`, the slc command shall write the `fsm` object and a `playbook` artifact that resolves to a `createPlaybookRuntime` factory at their canonical locations under the working directory ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)), and shall still fail the run when the `slc` reference itself does not resolve.

### SELFHOST-5
Verifies: [SELFHOST-2](../dev/self-hosting.md#selfhost-2), [SELFHOST-3](../dev/self-hosting.md#selfhost-3), [PIPE-11](../dev/pipeline.md#pipe-11)

Where the reserved `slc` resolves to the meta-pipeline definitions `@sublang/playbook` provides — whose `link.md` declares no `## Link Targets` — when the user runs `slc slc <definition> --link <target>`, the slc command shall chain those definitions and link the result to a `playbook` artifact at its canonical location under the working directory ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

### SELFHOST-7
Verifies: [SELFHOST-6](../dev/self-hosting.md#selfhost-6), [PIPE-11](../dev/pipeline.md#pipe-11)

Where the `playbook` pipeline resolves to the definitions `@sublang/playbook` provides — whose `link.md` declares no `## Link Targets` — when the user runs `slc playbook <source> --link <target>`, the slc command shall resolve the `playbook` reference to those shared definitions, load that target-less link, and write the `playbook` artifact into the working directory's `<basename>.playbook/` at its canonical name ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

### SELFHOST-8
Verifies: [COMPILE-1](../user/compiler.md#compile-1), [COMPILE-2](../user/compiler.md#compile-2), [SELFHOST-6](../dev/self-hosting.md#selfhost-6), [SELFHOST-13](../dev/self-hosting.md#selfhost-13)

Where the `playbook` pipeline resolves to the definitions `@sublang/playbook` provides, when the user runs `slc playbook code.md --link <target>` through interpreted execution, the slc command shall write the `code.gears.md` intermediate, the `code.fsm.ts` object, and the `code.playbook.ts` runtime, each at its canonical location under the working directory's `code.playbook/`; when the user runs the bare `slc playbook code.md`, the slc command shall run the same full-link form against the installed `@sublang/playbook` runtime as the default target.

### SELFHOST-16
Verifies: [SELFHOST-14](../user/self-hosting.md#selfhost-14), [SELFHOST-15](../dev/self-hosting.md#selfhost-15)

When a full-link run of the `playbook` pipeline succeeds with the linked artifact at its canonical path, the slc command shall write `<cwd>/<basename>.ts` default-exporting a registry entry whose `id` is `<basename>` and whose `requiredRoleIds` equal the source-declared players, importing the linked module by its source-only relative specifier; when `-o` relocates the linked artifact, the slc command shall write no entry module.

### SELFHOST-10
Verifies: [SELFHOST-9](../dev/self-hosting.md#selfhost-9)

Where a pipeline search root holds a `playbook` directory vendoring the shared definitions, when the slc command resolves the reserved `slc` and the `playbook` references, both shall resolve to that vendored directory; whereas where no search root provides one, both shall resolve to the definitions the installed `@sublang/playbook` provides.

## Immutable definition adoption

### SELFHOST-12
Verifies: [SELFHOST-11](../dev/self-hosting.md#selfhost-11)

Where a clean registry install resolves exact `@sublang/playbook@1.0.0` and the repository vendors the adopted shared definitions, when the adoption acceptance runs, the reserved `slc` and `playbook` references shall both resolve to the vendored `text2gears`, `gears2fsm`, and `link` set corresponding to that installed release with explicit pin inputs retained, all three reviewed artifact bundles shall pass all generated verification, every corresponding pin shall be current with exact 1.0.0 link-target provenance, and changing any dependency, definition, bundle, or pin component back to its 0.9.0 form shall make the set fail acceptance rather than pass as a mixed version.
