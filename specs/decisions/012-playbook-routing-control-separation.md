<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-012: Separate Playbook Routing and Control

## Status

Accepted

## Context

The Playbook 1.0 compiler contract does not give GEARS a source-owned syntax for per-state result guards.
The judgment-based phases can therefore invent or leak guard descriptions into an acting agent's prompt.

A live default-Captain run also showed two provenance and authority failures.
Its Boss classifier paraphrased the Boss turn before routing, and its visible Captain call could inspect the workspace and solve the task instead of selecting a route.
The adjudicator then supplied the human-facing response, so a terminal transition could discard the Captain's visible prose or reduce the round to an acknowledgement.

These failures are compiler-contract defects rather than XState scheduling defects.
The state machine should continue to own suspension, nested calls, and terminal completion while generated prompts and runtime adapters preserve the routing boundary.

## Decision

### Source-owned result contracts

Each Captain- or player-acting GEARS item may declare its domain result contract immediately after its acting blockquote with this canonical form:

```markdown
Results:
- `delegation`: Captain selected a playbook and supplied its call input.
- `question`: Captain needs one material routing answer from Boss.
```

`Results:` is a plain label, and each result is one single-line bullet in the exact form ``- `<guardName>`: <nonblank description>``.
`<guardName>` shall match the ASCII identifier pattern `[A-Za-z_$][A-Za-z0-9_$]*`.
Declaration order and descriptions are authoritative and shall be preserved in the FSM's `invoke.input.result` map.
The `Results:` block is control metadata, not acting prose, and shall never be included in the blockquoted prompt.

`needsBossReply` remains a framework-owned result added by `gears2fsm` to every Captain- or player-invoking state.
It shall not occur in source result metadata.
Nested-playbook call items shall not declare Captain result metadata because their outcome contract is the child invocation's `onDone` and `onError` surface.

Newly compiled GEARS shall use explicit result metadata wherever a Captain or player outcome branches.
Immutable reviewed artifacts produced before this decision may omit it until their release-coordinated refresh.
SLC's release-vendored Playbook definitions and their pins shall remain unchanged until that refresh; local development may resolve Playbook's maintained definitions explicitly.

### Exact Boss-text provenance

The linker shall assign ownership of Boss-event payload fields before generating the runtime.
Fields that represent the Boss's utterance, such as an intent or answer, shall always receive the exact nonblank `handleBossInput.turn.text` supplied by the host.

When the current state admits one ordinary Boss entry event and only its Boss-text field is missing, the runtime shall construct that event deterministically without calling the classifier.
When classification is necessary to distinguish a reply, fresh directive, interrupt, or another event kind, the classifier shall return only the event kind and non-text control fields.
The runtime shall attach or overwrite every Boss-text field with exact `turn.text` after parsing the classification.

### Routing authority and presentation ownership

A routing Captain call shall decide from the exact Boss text, the playbook catalog, and accumulated routing state only.
It shall not inspect files, invoke tools, research the intent, or perform the routed work.
Its acting prompt shall contain no guard names, result-property schema, adjudicator instructions, or private control payload.

Every generated direct-Captain control call shall request a fresh transport session and no tools through required call options `{ resume: false, allowedTools: [] }` in addition to visibility.
Hosts shall fail closed when they cannot honor that restriction.
Every hidden adjudication call shall use the same fresh-session and empty-tool isolation instead of resuming the visible Captain conversation.

The visible Captain's successful `finalText` shall own any `question` or `response` payload that is presented to Boss.
The adjudicator may choose a declared guard and extract structural routing fields, but it shall not author, paraphrase, or replace those human-facing fields.
Generated terminal output shall therefore preserve the visible Captain prose exactly.

### Deterministic verification

SLC shall parse explicit GEARS result metadata separately from blockquoted prompts.
For each item that declares it, GEARS-to-FSM conformance shall compare the ordered source result map with the FSM map after removing only compiler-owned `needsBossReply`.
Malformed metadata, a source-owned `needsBossReply`, missing or extra guards, reordered guards, and changed descriptions shall be findings.

This decision extends [DR-009](009-slc-playbook-pipeline-compilation.md)'s artifact-derived verification and supersedes [DR-011](011-playbook-1-0-captain-contract-adoption.md)'s direct-Captain transport rule where it omitted fresh-session and tool-isolation options.
The immutable dependency, reviewed-artifact, pin, and release boundary of [DR-011](011-playbook-1-0-captain-contract-adoption.md) remains in force.

## Consequences

- Acting prompts contain domain instructions only, while control metadata stays deterministic and auditable.
- Boss text reaches routing and resumed branches without classifier paraphrase.
- A routing Captain cannot turn a routing call into repository investigation on a conforming host.
- XState terminal states remain meaningful because terminal output is the Captain's exact visible response.
- Existing reviewed meta-phase bundles and pins are not rewritten before a coordinated release refresh.
