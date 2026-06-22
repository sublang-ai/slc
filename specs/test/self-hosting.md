<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# SELFHOST: Self-Hosting Meta-Pipeline

## Intent

This package specifies integration acceptance tests for the reserved `slc`
meta-pipeline and its `playbook` linked format in the `self-hosting` packages,
running an `slc`-named fixture pipeline end to end with a faked agent transport
per [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md).

Essential project-specific reference: `slc`, this project's compiler CLI.

## Meta-pipeline runs

### SELFHOST-4
Verifies: [SELFHOST-1](../user/self-hosting.md#selfhost-1), [SELFHOST-2](../dev/self-hosting.md#selfhost-2), [SELFHOST-3](../dev/self-hosting.md#selfhost-3)

Where a fixture reserves an `slc` pipeline that chains `text2gears` and `gears2fsm` and a `link.md` emitting `playbook`, when the user runs `slc slc <definition>` and then the same run with an explicit `--link <target>`, the slc command shall write the `fsm` object and a `playbook` artifact that resolves to a `createPlaybookRuntime` factory at their [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations) locations, and shall still fail the run when the `slc` reference itself does not resolve.
