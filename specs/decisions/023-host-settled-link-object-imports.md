<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-023: Host-Settled Link-Object Imports

## Status

Accepted

## Context

[DR-003](003-slc-phase-execution.md) makes `link.md` the semantic source of truth for a link phase and otherwise keeps format-aware transformation out of the host.
The Playbook link definition permits either a NodeNext `.js` import or a direct-loading `.ts` import for its TypeScript object, but the executing agent cannot reliably choose between them from its declared inputs.
The host already knows the declared link objects, the linked module's location, and which sibling files currently exist there.
Rejecting an agent's wrong extension only after a successful link wastes the completed pipeline, while accepting an unresolved edge produces a module that cannot load.

An existing JavaScript sibling is useful evidence that the linked source belongs with materialized JavaScript output.
Where only the declared TypeScript object exists, the only immediately loadable edge is its `.ts` path.
A clean destination that will later build JavaScript is observationally identical to a source-only destination at link time, so its future output mode cannot be inferred reliably from current sibling files, build configuration, or scripts.

## Decision

- After a link phase successfully writes a `.ts` or `.js` module, and before the output is accepted or hashed into build history, `slc` shall settle extension-bearing relative imports of the declared link objects against the files that currently exist from the linked module's location.
- Matching is limited to relative `.js` and `.ts` specifiers whose extensionless resolved path equals a declared link object's extensionless resolved path.
  For each match, an existing regular `.js` sibling wins, otherwise an existing regular `.ts` sibling wins, and otherwise the specifier remains unchanged.
  The linked module itself is not eligible as its own sibling.
- `slc` shall report every changed specifier as a successful diagnostic naming the linked module, the original specifier, and the replacement.
- After settlement, the existing load-integrity check shall still refuse every relative import that does not resolve exactly from the linked module's location.
  Imports unrelated to declared link objects are never repaired by this rule.
- The settled bytes are the accepted link output used by subsequent verification, output hashing, and history publication.
  A later Reuse accepts that live output under [DR-021](021-incremental-compilation.md) without reapplying settlement.
- This is a narrow generic link-completion exception to [DR-003](003-slc-phase-execution.md)'s rule against host-side format-aware transformation and supersedes any link definition's `.js`-versus-`.ts` extension choice for matching declared-object imports processed by `slc`, including Playbook's extension-selection clause.
  The rest of the link definition remains authoritative for module semantics; the host makes the current filesystem locator final for this one edge.
- `slc` shall not infer an unmaterialized future JavaScript build mode from workspace configuration or package scripts.
  Supporting such a clean build before JavaScript siblings exist requires a separate explicit destination-mode contract.

## Consequences

- Source-only TypeScript consumers no longer fail because an agent guessed a `.js` object import.
- Consumers with an already materialized JavaScript sibling deterministically retain or receive the `.js` import.
- Every host correction is visible in successful run diagnostics instead of being silently attributed to the executing phase.
- Genuinely unresolved imports still fail, and unrelated imports remain untouched.
- A clean JavaScript-emitting destination is not claimed to be supported by sibling evidence alone; adding that product mode requires explicit input rather than another heuristic.
- The reviewed Playbook link definition and its pinned compiled artifacts remain unchanged.
