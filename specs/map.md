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
| DR-001 | [001-slc-pipeline-layout-naming-invocation.md](decisions/001-slc-pipeline-layout-naming-invocation.md) | Pipeline layout, naming conventions, and CLI invocation |
| DR-002 | [002-slc-link-phases.md](decisions/002-slc-link-phases.md) | Generic link phases and link-target invocation |

## Iterations

| ID | File | Goal |
| --- | --- | --- |
| IR-000 | [000-spdx-headers.md](iterations/000-spdx-headers.md) | Add SPDX headers to applicable files |

## Packages

### GIT

| Group | File | Summary |
| --- | --- | --- |
| dev | [git.md](dev/git.md) | Commit message format and AI co-authorship trailers |

### LIC

| Group | File | Summary |
| --- | --- | --- |
| dev | [licensing.md](dev/licensing.md) | SPDX header requirements and file-scope rules |
| test | [licensing.md](test/licensing.md) | Copyright and license header presence checks |
