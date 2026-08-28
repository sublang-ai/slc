<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-000: SPDX Headers

## Status

In progress — SPDX headers are present, while their project-specific format is not yet specified in the licensing package.

## Intent

Apply [[licensing-1](../packages/licensing.md#licensing-1)], [[licensing-2](../packages/licensing.md#licensing-2)], [[licensing-5](../packages/licensing.md#licensing-5)] to in-scope files and pin the project's header format.

## Deliverables

- [x] Add SPDX headers to applicable files missing them
- [ ] Document header format in a dev spec

## Tasks

1. Resolve scope: detect a project-root license file per [[licensing-7](../packages/licensing.md#licensing-7)]; enumerate in-scope files per [[licensing-6](../packages/licensing.md#licensing-6)].

2. Insert SPDX lines in each file's first comment block (after any shebang), using the file's native comment syntax.

3. Add `licensing-9` to the `## External Behavior` section of [`packages/licensing.md`](../packages/licensing.md), showing the concrete header for each native comment style:

   ```markdown
   <!-- SPDX-License-Identifier: Apache-2.0 -->
   <!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->
   ```

   ```typescript
   // SPDX-License-Identifier: Apache-2.0
   // SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
   ```

   The legacy record's `CC-BY-SA-4.0` content example is not a target because the repository has a single `Apache-2.0` license and its tracked content uses that identifier.

## Verification

- [[licensing-3](../packages/licensing.md#licensing-3)], [[licensing-4](../packages/licensing.md#licensing-4)] pass on all in-scope files.
