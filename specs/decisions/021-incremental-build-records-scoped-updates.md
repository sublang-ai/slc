<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-021: Incremental Build Records and Scoped Updates

## Status

Accepted

## Context

[DR-014](014-cwd-output-invocation-defaults-entry-emission.md) places a bundle under the invocation working directory and derives its name from the source basename and pipeline.
The bundle records neither which source bytes produced it nor the semantic inputs of the successful run, so two same-basename sources can target the same directory and every full invocation executes the complete pipeline again.

That behavior is unusually costly for agent-compiled pipelines: one compile can take tens of minutes to more than two hours ([DR-019](019-compile-progress-stall-watchdog.md)), and a fresh nondeterministic generation can churn reviewed-good regions unrelated to a small source edit.
The intermediate artifacts are inspectable and refinable products, not a disposable cache ([DR-001](001-slc-pipeline-layout-naming-invocation.md)).

A source hash can prove equality but cannot describe a change.
Scoped updating therefore also needs the prior source bytes and a trace from source units through phase outputs.
The Playbook artifacts already supply part of that trace — FSM states carry their GEARS `sourceItem` — but they do not yet provide a complete raw-source-to-normalized-step-to-GEARS mapping.

The host must retain [DR-003](003-slc-phase-execution.md)'s boundary: `slc` may plan from hashes, ranges, scope identifiers, and dependency edges, but pipeline definitions must own the meaning of a safe update.
The ordinary-build record also must not be confused with [DR-007](007-slc-phase-artifact-pinning.md): pins select reviewed compiler implementations, while this record binds one user's source and invocation to one accepted output lineage.

## Decision

### Build lineage

- After a successful full or full-link invocation at canonical paths other than the reserved `slc` meta-pipeline that executes at least one scheduled step, `slc` records `<art-dir>/.slc-build.json` and a verbatim prior-source snapshot at `<art-dir>/.slc-source`.
  [DR-014](014-cwd-output-invocation-defaults-entry-emission.md)'s CWD placement and entry-module location do not change.
  The names are reserved host metadata rather than legal artifact-format names, so they cannot collide with `<basename>.<format><ext>`.
- The reserved `slc` meta-pipeline remains non-incremental and writes no lineage metadata, because its canonical result is the reviewed bundle whose complete tree [DR-007](007-slc-phase-artifact-pinning.md) pins.
  Putting a record that identifies the selected pin inside that same tree would create a pin-to-output identity cycle, and the source snapshot would add a non-artifact entry to the closed reviewed bundle.
- A full or full-link invocation with `-o` retains its existing non-incremental behavior and creates or advances neither a build record nor a source snapshot.
  This first design keeps one lineage inside one canonical artifact bundle rather than making it own an arbitrary external output.
- The record is a regular, non-symbolic-link strict JSON file with schema `sublang.slc.build.v1`, hash algorithm `sha256`, and:
  - a normalized relative POSIX locator from the resolved canonical artifact directory to the resolved invocation source path, the snapshot path, and exact SHA-256 identities for both current source and snapshot;
  - the ordered pipeline plan and exact content identities for normalization, phase, pass, link, selected executor, declared semantic-input closure, link target, and semantic options that can affect the plan or output;
  - producer package versions — including `slc` and the resolved pipeline and link-runtime packages such as `@sublang/playbook` — plus format-specific compatibility values such as Playbook `spec.compat`, as provenance or explicit compatibility gates rather than substitutes for content identity;
  - for each scheduled step, its exact input key, definition/executor identity, target path and hash, and any validated input-unit, target-scope, and dependency trace emitted under an update contract;
  - a complete artifact-product inventory with hashes, including generated verification and the entry module outside the artifact directory but excluding the build record and source snapshot themselves; and
  - the successful lineage generation and whether ordinary execution or scoped update produced it, as provenance.
- Hashes cover exact bytes without text normalization.
  Timestamps and generation counters never establish currentness.
- Managed paths are relative POSIX paths confined to the artifact directory, except for the one exact canonical entry-module path [DR-014](014-cwd-output-invocation-defaults-entry-emission.md) owns; managed products and their parent path components are not symbolic links, and the read-only source locator may resolve outside that boundary but never authorizes an output write.
- `slc` stages new state, completes the applicable verification, and promotes only the validated managed-path overlay plus any canonical entry module as one recoverable lineage transaction.
  A rejected candidate leaves prior accepted managed and unmanaged files unchanged; an interrupted promotion is recovered to one complete accepted lineage before reuse, never accepted as a mixed state.
- Phase execution carries two distinct address layers: definitions and the compiled Boss request receive canonical logical source and target locators, while the host gives the performing agent a separate physical workspace binding for reads and the one write sink.
  In staged state that binding names candidate predecessors and the write sink in an equivalent staged layout while unchanged read-only inputs retain their canonical physical paths; without staging every physical path is canonical.
  Staging locators guide I/O only and never enter artifact content or trace identity.
- The candidate overlays changed managed products and removes obsolete managed products without replacing the artifact directory, so every unrecorded file under it — including one changed concurrently — remains untouched.
  The snapshot and build record are committed with the candidate; the record is the lineage commit marker, not a promise that writing one file can atomically replace multiple paths.
- Immediately before promotion, `slc` revalidates the source, build inputs, accepted record, and managed bytes it planned from.
  A concurrent change aborts promotion as a conflict instead of being overwritten.
- The source snapshot deliberately makes the output bundle contain a copy of its source.
  Distribution and retention policy must therefore treat the bundle as at least as sensitive as that source.

### Exact reuse and conflicts

- A canonical full or full-link invocation with neither reserved lineage path runs normally and creates the pair only after success, except that the reserved `slc` meta-pipeline never creates it.
- On a lineage-eligible pipeline, `.slc-build.json` and `.slc-source` are a mutually valid reserved pair.
  Either path present without the other, or either path being a symbolic link or having the wrong file type, is a conflict rather than an unrecorded file or a cold build; automatic mode never overwrites it.
- A present record with malformed JSON, a missing, unknown, or wrong-typed schema field, an unsupported schema or hash algorithm, a symbolic-link path, an invalid managed path, or an inventory path not derivable from its canonical plan is a conflict rather than an absent cache; automatic mode refuses to overwrite it.
- A recorded step is reusable only when its current input key, definition/executor identity, semantic options, and existing output bytes match the record exactly.
  The planner walks the ordered chain and recomputes downstream keys after every executed step; if an executed step reproduces its prior output bytes, still-current downstream steps remain reusable.
- Reuse additionally requires an explicit closed, content-identified declaration of every output-affecting readable input, using the phase definition's existing semantic-input declaration where applicable.
  A phase whose readable semantic closure is undeclared or incomplete remains executable but is never reusable or update-eligible.
- For a pinned phase, currentness validation and executor selection under [DR-007](007-slc-phase-artifact-pinning.md) precede reuse.
  Cached user output never makes a stale or malformed pin runnable.
- When the source locator, complete build identity, source bytes, snapshot bytes, and every scheduled output all match and every scheduled semantic step is reuse-eligible, `slc` reports the bundle up to date, exits successfully, invokes no agent, and rewrites nothing.
- A changed source is expected input evolution.
  A different source locator targeting the recorded bundle, a snapshot whose bytes do not match its recorded identity, or a managed artifact whose bytes changed outside the accepted recorded lineage is instead a conflict: automatic mode refuses to overwrite or adopt it.
- `--rebuild` on a canonical full or full-link invocation without `-o` explicitly bypasses reuse and scoped update, authorizes replacement or source rebinding of the named bundle, and, for a lineage-eligible pipeline, writes a new record only after the complete run succeeds.
  It derives every replacement or removal path from the new canonical plan, never trusts an invalid prior inventory to delete a file, and replaces an invalid reserved metadata entry itself without following a symbolic link target.
  For the reserved `slc` meta-pipeline it still executes the complete ordinary plan but writes no lineage metadata.
- Single-phase, standalone-pass, and direct-link invocations retain their existing explicit behavior and do not silently rebase a full-build record.
  If they change a recorded artifact, the next automatic full invocation reports the resulting conflict rather than erasing the refinement.

### Deterministic update planning

- A phase is update-capable only when its authoritative definition declares a `## Update` contract.
  The contract owns stable input units, target scopes, dependency expansion, structural or global scopes, update instructions, and semantic verification.
  `slc` does not hard-code GEARS, FSM, Players, or any other pipeline-specific concept.
- Before invoking an agent, `slc` compares the current source with the recorded source snapshot and maps every changed byte span through the prior validated trace.
  Scoped update is provisionally eligible only when the build identity other than the source remains current, every changed span maps unambiguously to stable units, the declared dependency closure is complete, and no mechanically affected region is recorded as structural or global.
- An evident unmapped insertion or deletion, cross-unit change, broken recorded ordering, definition/runtime/options drift, or incomplete trace selects ordinary execution of the earliest affected phase before any update agent is called.
  A semantic split, merge, reclassification, or new dependency that cannot be known from the old trace is instead detected from the update outcome and replacement trace and rejects that candidate with `--rebuild` guidance.
- There is no change-ratio or generation threshold.
  Textual size cannot establish semantic locality, and a fresh nondeterministic generation is not intrinsically more correct than a verified update.

### Trace contract

- A definition that supports scoped update owns a generic trace contract in addition to its semantic update rules.
  The executing phase returns trace metadata out of band as optional `sublang.slc.update.v1` metadata on the host-owned phase result; the trace is not another filesystem output, so the phase still writes only its one declared target under [DR-003](003-slc-phase-execution.md).
- This decision amends [DR-005](005-slc-self-hosting-meta-pipeline.md)'s host-owned `PhaseResult` with an optional namespaced metadata member whose `sublang.slc.update.v1` value is the trace described below.
  It does not amend a Playbook runtime's turn-result variants.
- Interpreted execution returns that metadata directly from its executor.
  Compiled execution may receive it only when the artifact emits the reserved `sublang.slc.update.v1` topic through Playbook's existing `emitTelemetry` port; the host adapter diverts that topic to a dedicated protected SLC-update metadata sink, never to the Playbook turn result, `playbook.trace`, status, or diagnostics.
  The sink is optional host capability: an immutable runtime or compiled definition that does not emit the namespaced payload still executes normally but supplies no trace, so scoped update remains disabled for that step.
- The host adapter validates at most one schema-exact JSON metadata payload after the runtime turn and ordinary result mapping complete.
  The existing exact `legacy`, `session-v1`, and `composed-v2` Playbook result variants and diagnostic-privacy rules remain unchanged.
- A trace binds the exact input and target hashes and represents each as a complete ordered partition of non-overlapping half-open byte ranges carrying stable opaque scope identifiers.
  It also carries the definition-declared dependency edges and structural or global classifications needed to expand an input-unit change into a closed target scope.
  Complete coverage makes separators and otherwise unclassified bytes protected rather than invisible to the byte guard.
- `slc` validates only this generic shape, byte coverage, identities, and graph integrity.
  It does not interpret scope names or decide whether the declared dependency graph is semantically sufficient.
- A missing or malformed trace from an otherwise successful ordinary execution does not invalidate its artifact, but disables scoped update from that step.
  A missing or malformed replacement trace from an update candidate rejects that candidate because protected-scope enforcement is then impossible.

### Scoped execution and acceptance

- An update execution receives the authoritative definition, the complete current input, the prior input, their exact diff, the prior complete target, and the allowed target-scope closure.
  It writes a complete candidate target and returns a replacement trace out of band, rather than emitting an accumulated patch or a second file.
- `slc` runs the candidate in staged space and enforces the generic update boundary deterministically: every target scope outside the allowed closure remains byte-identical, all protected inputs and definitions remain unchanged, the trace is structurally valid, and ordinary [DR-003](003-slc-phase-execution.md) checks still pass.
  Semantic sufficiency remains definition-owned.
- The replacement trace must preserve the eligible input-unit structure and classifications and must not expand the allowed dependency closure.
  A split, merge, reorder, new structural or global classification, or closure expansion rejects the scoped candidate rather than silently widening it after execution.
- For every executed step, the canonical logical locators remain in the semantic request while the host's separate physical workspace binding directs the performing agent to corresponding staged reads and the staged write sink; later steps consume those staged bytes through the same binding, and canonical paths receive the new bytes only during promotion.
  This preserves the one-target execution rule while making rejection non-destructive.
- The complete requested run is transactional with respect to its prior accepted bundle: no staged candidate, deterministic derivative, source snapshot, or build record replaces accepted state until every required downstream step and verification succeeds and the host begins the recoverable lineage promotion.
- After an accepted candidate, downstream planning uses its actual output hash.
  Link phases are not scoped-update-capable in this schema version, so a dirty link always executes in full; deterministic entry and verification products are regenerated when their inputs change; and the complete emitted verification suite runs before the new lineage is accepted.
- A scoped-update violation, `BLOCKED` outcome, or verification failure discards the complete staged run, preserves the prior accepted bundle and record, and fails with a diagnostic recommending `--rebuild`.
  It does not automatically spend a second agent invocation on ordinary execution, preserving [PHEXEC-12](../dev/phase-execution.md#phexec-12)'s one-invocation contract and avoiding a hidden double-cost retry.
- A fresh nondeterministic generation is not periodic ground truth.
  The source, authoritative definitions, protected-region equality, and full verification are the acceptance authority; lineage generation remains audit metadata only.

### Playbook traceability

- When generic normalization is scheduled, the SLC-owned `normalize.md` definition must supply the raw-source-to-normalized-unit trace and update semantics.
  Playbook-owned phase definitions must supply the normalized-input-to-GEARS-to-FSM scopes, mappings, dependencies, and update semantics; without normalization, the entry definition starts that trace at the source bytes it consumes.
  Existing FSM `sourceItem` values provide only the GEARS-to-FSM edge, so all earlier edges remain an explicit definition coupling before automatic Playbook updates are eligible.
- Exact reuse on the installed Playbook consumer path separately requires Playbook's published phase definitions to carry package-portable, closed semantic-input declarations.
  The repository-relative `## Pin Inputs` added to SLC's vendored definitions close its reviewed self-host pins only and cannot establish the installed package's consumer-build closure.
  Until the published definitions provide that closure, the installed Playbook pipeline gains source association and conflict detection but its unclosed semantic steps execute and prevent a whole-bundle no-op.
- A local change whose complete dependency closure is mapped may preserve every reviewed GEARS item and FSM region outside that closure.
  Changes to declared global scopes such as players, results, identifiers, or control-flow topology select ordinary phase execution regardless of textual size.

## Consequences

- For a pipeline whose scheduled semantic steps all declare closed content-identified readable-input closures, an unchanged full invocation becomes a deterministic no-op, while exact phase-level reuse remains available even when an earlier executed phase reproduces identical bytes.
- A small, traceable source edit can revise only its semantic closure without re-gambling unrelated reviewed output; byte preservation is enforced by the host and semantic correctness by the definitions and verification.
- Pipelines without complete update contracts and traces still benefit from exact reuse when their readable-input closures are closed, but a changed input follows ordinary phase execution; a pipeline with an unclosed semantic step gains association and conflict detection but cannot reuse that step or take the whole-bundle no-op.
- Reserved self-host builds remain ordinary so reviewed artifact bundles and their pins have no lineage feedback cycle.
- Same-basename collisions and manual artifact edits become visible conflicts instead of silent overwrites.
- Source snapshots enable deterministic pre-agent diffing and portable lineage at the cost of duplicating source content in the bundle.
- The feature adds one explicit destructive override, `--rebuild`; automatic update failure remains fail-closed rather than retrying at potentially multi-hour cost.
