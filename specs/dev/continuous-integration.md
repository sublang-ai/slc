<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# CI: Continuous Integration

## Intent

This package specifies the repository checks that continuously protect source
quality and the reviewed compiled meta-phase artifacts.

Essential project-specific references: `slc`, this project's compiler; the
committed Playbook meta-phase artifacts under `pipelines/playbook/`; and their
pin index, `pipelines/playbook/slc.pins.json`.

## Source quality

### CI-1

Where a commit is pushed or proposed by pull request, when repository continuous integration runs, the workflow shall install the package-lock dependency graph under a Node.js version satisfying the package engine and shall fail unless formatting, lint, the TypeScript build, and the full automated test suite pass.

## Reviewed artifacts

### CI-2

Where a commit is pushed or proposed by pull request, when repository continuous integration runs, the workflow shall independently review each committed Playbook meta-phase artifact with the deterministic compilation-correctness checks, regenerate the pin index through the explicit build-and-review generator, and fail unless every generated pin is current and the regenerated index is byte-identical to the committed index.
