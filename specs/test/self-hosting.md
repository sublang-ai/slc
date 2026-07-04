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
[DR-009](../decisions/009-slc-playbook-pipeline-compilation.md).

Essential project-specific references: `slc`, this project's compiler CLI; and
`@sublang/playbook`, whose `slc/` definitions the reserved `slc` consumes.

## Meta-pipeline runs

### SELFHOST-4
Verifies: [SELFHOST-1](../user/self-hosting.md#selfhost-1), [SELFHOST-2](../dev/self-hosting.md#selfhost-2), [SELFHOST-3](../dev/self-hosting.md#selfhost-3)

Where a fixture reserves an `slc` pipeline that chains `text2gears` and `gears2fsm` and a `link.md` emitting `playbook`, when the user runs `slc slc <definition>` and then the same run with an explicit `--link <target>`, the slc command shall write the `fsm` object and a `playbook` artifact that resolves to a `createPlaybookRuntime` factory at their [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations) locations, and shall still fail the run when the `slc` reference itself does not resolve.

### SELFHOST-5
Verifies: [SELFHOST-2](../dev/self-hosting.md#selfhost-2), [SELFHOST-3](../dev/self-hosting.md#selfhost-3), [PIPE-11](../dev/pipeline.md#pipe-11)

Where the reserved `slc` resolves to the meta-pipeline definitions `@sublang/playbook` provides — whose `link.md` declares no `## Link Targets` — when the user runs `slc slc <definition> --link <target>`, the slc command shall chain those definitions and link the result to a `playbook` artifact at its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations) location.

### SELFHOST-7
Verifies: [SELFHOST-6](../dev/self-hosting.md#selfhost-6), [PIPE-11](../dev/pipeline.md#pipe-11)

Where the `playbook` pipeline resolves to the definitions `@sublang/playbook` provides — whose `link.md` declares no `## Link Targets` — when the user runs `slc playbook <source> --link <target>`, the slc command shall resolve the `playbook` reference to those shared definitions, load that target-less link, and write the `playbook` artifact at its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations) location under `<basename>.playbook/`.

### SELFHOST-8
Verifies: [COMPILE-1](../user/compiler.md#compile-1), [COMPILE-2](../user/compiler.md#compile-2), [SELFHOST-6](../dev/self-hosting.md#selfhost-6)

Where the `playbook` pipeline resolves to the definitions `@sublang/playbook` provides, when the user runs `slc playbook code.md` and then `slc playbook code.md --link <target>` through interpreted execution, the slc command shall write the `code.gears.md` intermediate and the `code.fsm.ts` object — stopping at the `fsm` object for the bare run — and, with `--link`, the `code.playbook.ts` runtime, each at its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations) location under `code.playbook/`.

### SELFHOST-10
Verifies: [SELFHOST-9](../dev/self-hosting.md#selfhost-9)

Where a pipeline search root holds a `playbook` directory vendoring the shared definitions, when the slc command resolves the reserved `slc` and the `playbook` references, both shall resolve to that vendored directory; whereas where no search root provides one, both shall resolve to the definitions the installed `@sublang/playbook` provides.
