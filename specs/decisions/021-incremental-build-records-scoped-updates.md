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

The host must retain [DR-003](003-slc-phase-execution.md)'s boundary: `slc` may plan from hashes, ranges, scope identifiers, and definition-supplied complete dependency closures, but pipeline definitions must own the meaning of a safe update.
The ordinary-build record also must not be confused with [DR-007](007-slc-phase-artifact-pinning.md): pins select reviewed compiler implementations, while this record binds one user's source and invocation to one accepted output lineage.

## Decision

### Build lineage

- After a successful full or full-link invocation at canonical paths other than the reserved `slc` meta-pipeline that executes at least one scheduled step or accepts an explicit adoption, `slc` records `<art-dir>/.slc-build.json` and a verbatim prior-source snapshot at `<art-dir>/.slc-source`.
  [DR-014](014-cwd-output-invocation-defaults-entry-emission.md)'s CWD placement and entry-module location do not change.
  The names are reserved host metadata rather than legal artifact-format names, so they cannot collide with `<basename>.<format><ext>`.
- The reserved `slc` meta-pipeline remains non-incremental and writes no lineage metadata, because its canonical result is the reviewed bundle whose complete tree [DR-007](007-slc-phase-artifact-pinning.md) pins.
  Putting a record that identifies the selected pin inside that same tree would create a pin-to-output identity cycle, and the source snapshot would add a non-artifact entry to the closed reviewed bundle.
- A full or full-link invocation with `-o` retains its existing non-incremental behavior and creates or advances neither a build record nor a source snapshot.
  This first design keeps one lineage inside one canonical artifact bundle rather than making it own an arbitrary external output.
- The record is a regular, non-symbolic-link strict JSON file whose exact `sublang.slc.build.v1` field model is defined below.
- Hashes cover exact bytes without text normalization.
  Timestamps and generation counters never establish currentness.
- Managed paths are relative POSIX paths confined to the artifact directory, except for the one exact canonical entry-module path [DR-014](014-cwd-output-invocation-defaults-entry-emission.md) owns; managed products and their parent path components are not symbolic links, and the read-only source locator may resolve outside that boundary but never authorizes an output write.
- `slc` stages new state, completes the applicable verification, and promotes only the validated managed-path overlay plus any canonical entry module as one recoverable lineage transaction.
  Rejecting binding-compliant execution, or rejecting promotion before any canonical application, writes no candidate byte to a canonical path.
  An interrupted promotion is finished forward to the complete accepted candidate from its intact sealed stage; without one, the already-applied candidate paths surface as an ordinary conflict that blocks reuse, and a mixed state is never accepted as current because the record marker has not moved.
- Phase execution carries two distinct address layers: definitions and the compiled Boss request receive canonical logical source and target locators as semantic identifiers that grant no filesystem authority, while the host gives the performing agent the sole authorized physical workspace binding for named host-supplied reads and the one write sink.
  In staged state that binding names candidate predecessors and the write sink in an equivalent staged layout while unchanged read-only inputs retain their canonical physical paths; without staging every physical path is canonical.
  Writing a canonical logical path when its physical binding differs is a write-scope violation: detection fails the run and prevents promotion, but this design does not claim to roll back arbitrary writes made outside the binding by an unrestricted coding agent.
  Staging locators guide I/O only and never enter artifact content or trace identity.
- The candidate overlays changed managed products and removes obsolete managed products without replacing the artifact directory, so every unrecorded file under it — including one changed concurrently — remains untouched.
  The overlay is an exact set of staged or explicitly retained candidate paths plus obsolete leaf products calculated only by canonical path from a trusted schema-valid prior inventory, and a recorded leaf whose current bytes no longer match that inventory is outside removal authority and is preserved; those candidate paths are explicit replacement authority even before a lineage pair exists, while an existing regular file or absence at each destination is captured and revalidated, and the overlay never derives deletion authority from an artifact-directory scan or from malformed, orphaned, or otherwise untrusted metadata.
  Paths outside that set are outside both its mutation and baseline authority, while every retained, replaced, removed, or newly claimed canonical path and every caller-supplied source/build-input guard is revalidated before promotion.
  The snapshot and build record are committed with the candidate; the record is the lineage commit marker, not a promise that writing one file can atomically replace multiple paths.
- Immediately before promotion, `slc` revalidates the source, build inputs, accepted record, and managed bytes it planned from.
  A concurrent managed change aborts promotion as a conflict and blocks reuse instead of being overwritten or rolled back; a conflict detected before any canonical application changes no canonical byte, while one detected mid-application leaves the already-applied candidate paths to recovery and conflict classification, and the external edit remains either way.
- The source snapshot deliberately makes the output bundle contain a copy of its source.
  Distribution and retention policy must therefore treat the bundle as at least as sensitive as that source.

#### `sublang.slc.build.v1`

The top-level object contains exactly these required fields; field omission, `null` outside a declared nullable branch, or an unknown field at any depth is invalid.

| Field | Exact value |
| --- | --- |
| `schema` | `"sublang.slc.build.v1"` |
| `hashAlgorithm` | `"sha256"` |
| `source` | `SourceRecord` |
| `plan` | `PlanRecord` |
| `products` | `ProductRecord[]` |
| `provenance` | `ProvenanceRecord` |
| `lineage` | `LineageRecord` |

`Hash` is a string matching `sha256:[0-9a-f]{64}` over exact bytes.
Every `id` matches `[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9._-]*)*`, is unique in its containing array, and every ID reference resolves exactly once.

| Type | Exact fields |
| --- | --- |
| `SourceRecord` | `locator: string`, `hash: Hash`, `snapshot: ".slc-source"`, `snapshotHash: Hash` |
| `PlanRecord` | `identity: Hash`, `pipeline: string`, `invocation: InvocationRecord`, `inputs: PlanInput[]`, `deterministicInputs: string[]`, `steps: StepRecord[]` |
| `InvocationRecord` | `kind: "full" \| "full-link"`, `normalize: boolean`, `optimize: boolean`, `link: null \| LinkRecord` |
| `LinkRecord` | `target: string`, `options: LinkOptionRecord[]` |
| `LinkOptionRecord` | `name: string`, `value: string` |
| `PlanInput` | `id: string`, `kind: PlanInputKind`, `locator: null \| string`, `value: null \| string`, `identity: Hash` |
| `StepRecord` | `id: string`, `kind: StepKind`, `name: string`, `source: FormatRecord`, `target: TargetRecord`, `inputKey: Hash`, `inputs: string[]`, `inputClosure: "closed" \| "open"`, `origin: Origin`, `trace: null \| UpdateTrace` |
| `FormatRecord` | `format: string`, `ext: string` |
| `TargetRecord` | `format: string`, `ext: string`, `path: string`, `product: string` |
| `ProductRecord` | `id: string`, `kind: "semantic" \| "entry" \| "verification"`, `path: string`, `hash: Hash`, `inputs: string[]` |
| `ProvenanceRecord` | `packages: PackageRecord[]`, `compatibility: CompatibilityRecord[]` |
| `PackageRecord` | `role: "slc" \| "pipeline" \| "link-runtime"`, `name: string`, `version: null \| string` |
| `CompatibilityRecord` | `name: string`, `value: string`, `currentness: "provenance" \| "gate"`, `input: null \| string` |
| `LineageRecord` | `generation: number`, `transition: null \| IdentityTransition` |
| `IdentityTransition` | `from: Hash`, `to: Hash` |

`PlanInputKind` is exactly `"definition" | "executor" | "semantic-input" | "link-target" | "generator" | "checker" | "compatibility" | "option"`.
`StepKind` is exactly `"normalize" | "phase" | "pass" | "link"`.
`Origin` is exactly `"ordinary" | "updated" | "user-adopted"`.
`UpdateTrace` is the schema-exact value governed by the [trace contract](#trace-contract); absence is represented by `null`, never by an omitted field.

The following invariants make the object self-consistent and portable:

- A relative POSIX path is a non-empty `/`-separated string with no NUL, backslash, empty, `.`, or trailing segment and no absolute or drive root.
  `source.locator` and a full-link `invocation.link.target` use that encoding from the resolved canonical artifact directory to their resolved read-only paths and may contain `..` segments; managed product paths additionally contain no `..`, except that the sole entry product is exactly one `..` plus the canonical sibling entry basename.
  A read locator is canonical only when resolving it and re-encoding that resolved path relative to the artifact directory yields the identical locator, so an outward `..` climb may appear only before non-`..` segments and aliases such as `a/../b` are invalid.
- `source.hash` and `source.snapshotHash` equal the exact source bytes and the sealed candidate snapshot when promotion is authorized; the canonical `.slc-source` and `.slc-build.json` hold those same bytes once the record commits, since neither exists at authorization. Promotion is forward-only past authorization, so a source path rebound during the rename sequence is outside this equality: such a rebind leaves the original input unmodified, and detecting it would require a durable non-alias fact the manifest deliberately does not carry.
- `invocation.kind` is `"full"` exactly when `invocation.link` is `null`; `"full-link"` requires a link object whose option order preserves invocation order.
- A file-backed `plan.inputs` member — definition, semantic input, link target, or file/tree-backed executor, generator, or checker — has its normalized artifact-directory-relative read locator, `value: null`, and exact byte or deterministic tree hash as `identity`.
  A value-backed executor, generator, checker, compatibility, option, or package-resolved link target has `locator: null`, an exact canonical string `value`, and `identity` equal to the hash of that value's UTF-8 bytes; exactly one representation is non-null.
- `plan.inputs` is sorted by `id` and contains every output-affecting definition, selected executor, individual declared semantic input, link target, deterministic generator/checker, compatibility gate, and semantic option as a re-readable file/tree or exact value identity.
  Every link target, invocation option, compatibility gate, and step executor has exactly one corresponding input ID used by its owning step or compatibility record; `plan.deterministicInputs` is a sorted unique list containing every and only `"generator"` and `"checker"` input ID used by entry or verification products.
- `slc` derives this result-independent plan before creating or changing an artifact directory and never infers an identity from a JavaScript function object.
  The host supplies exact interpreted and compiled implementation/configuration file, tree, or canonical value identities; a selected compiled executor combines that host transport/player/judge configuration with a canonical value projection of the current reviewed artifact and bundle, runtime dependencies, link target, immutable external inputs, and runtime profile, excluding producer provenance.
- A scheduled definition has `inputClosure: "closed"` only when its authoritative root definition contains an explicit `## Pin Inputs` section, including a present empty section; a missing root section records `"open"`.
  Every transitively cited member is recorded individually, and an explicit request reference such as normalization's entry definition is recorded as a semantic input without making an otherwise-open definition closed.
- Deterministic generator/checker and compatibility identities come from explicit host-owned descriptors whose exact bytes or canonical values are available before execution.
  Package versions and provenance-only compatibility values remain provenance and never establish or defeat `plan.identity` currentness.
- `plan.steps` is in execution order; each step's `inputs` is a sorted unique list of `plan.inputs` IDs, `inputClosure` records whether its complete readable semantic closure was explicitly declared, and `target.product` names one unique `"semantic"` product with the same path.
  Plan step and product IDs use their stable kind and execution ordinal rather than the authored definition basename; executor selection uses the authored phase/pass basename as its pin key, uses `link` for the reserved link phase, and gives the SLC-owned built-in normalization step no pin key, so a pipeline pass named `normalize` cannot select an executor for the built-in step.
- A step's `inputKey` is the exact-byte hash of the canonical compact JSON array `[step.id, [<RequestInput>, ...]]`, where request inputs are in logical request order and each exact object is either `{ "kind": "source", "hash": <Hash> }` for the invocation source or `{ "kind": "product", "product": <id>, "hash": <Hash> }` for a predecessor semantic product; every product ID resolves exactly once and its recorded hash equals the entry hash.
  A compile step has exactly one operand: the external source for the first scheduled step, otherwise its immediate predecessor product; a link step has its object products in invocation order, while its target and options remain plan inputs rather than result-key operands.
  Plan inputs already cover definitions, executors, semantic options, and other build identity, so they do not repeat in this result-specific key.
- Canonical JSON uses the RFC 8259 compact form, escapes every control character plus `"` and `\\` with lowercase `\u00xx` where no two-character JSON escape exists, emits every other Unicode scalar as its UTF-8 character without escaping solidus or non-ASCII text, and orders object fields exactly as listed in this contract.
  Every array described as sorted uses ascending lexicographic order over the named key's UTF-8 bytes; package roles instead use `"slc"`, `"pipeline"`, `"link-runtime"` order.
  `.slc-build.json` is exactly that canonical compact UTF-8 JSON followed by one LF byte, and the LF is framing rather than part of any identity projection.
- `plan.identity` is the exact-byte hash of the canonical JSON encoding of an object, in field order, containing `pipeline`, `invocation`, `inputs`, `deterministicInputs`, and `steps`; each projected step contains `id`, `kind`, `name`, `source`, `target`, `inputs`, and `inputClosure` in that order, while result-specific `inputKey`, `origin`, and `trace` do not enter it.
- `origin` records the mode that most recently established the step's current target bytes: ordinary execution records `"ordinary"`, an accepted scoped update records `"updated"` with its non-null replacement trace, explicit adoption records `"user-adopted"` with a null trace, and exact reuse preserves the prior origin and trace unchanged.
  A link step is never `"updated"`; a non-null adoption transition requires every current step to remain `"user-adopted"` with null traces, while a later state-changing ordinary or update run may create mixed origins only after clearing the transition.
- `products` is sorted by `path`, has unique IDs and paths, contains every accepted semantic, entry, and verification product and no lineage metadata, and records exact current bytes; semantic and verification paths remain within the artifact directory, while the sole `"entry"` product may use only the exact canonical sibling path derived under [DR-014](014-cwd-output-invocation-defaults-entry-emission.md).
  A semantic product has `inputs: []`; each entry or verification product's sorted unique `inputs` names the exact generator and checker plan inputs that produce or accept it, generator/checker inputs do not belong to semantic steps, and the union across deterministic products equals `plan.deterministicInputs`.
- `pipeline`, step names, format names, link-option names, package names, and compatibility names are non-empty; format extensions retain [DR-001](001-slc-pipeline-layout-naming-invocation.md)'s canonical form.
- `provenance.packages` is sorted in the role order above with one `"slc"`, one `"pipeline"`, and exactly one `"link-runtime"` only for a full-link plan; `null` records that the resolved component has no package version.
  `provenance.compatibility` is sorted by unique `name`; package versions and a `"provenance"` record have `input: null` and do not establish currentness, while a `"gate"` record's `input` names exactly one `"compatibility"` plan input whose `value` equals the record's value.
- `lineage.generation` is a positive safe integer.
  A cold or source-rebound lineage, or a rebuild over untrusted or unreadable prior metadata, starts at `1`; every later accepted state-changing ordinary, update, rebuild, or adoption run records the prior generation plus one; a write-free no-op preserves it.
  A same-binding state-changing command whose prior generation is `Number.MAX_SAFE_INTEGER` refuses before executor work or promotion rather than wrapping or resetting the counter; explicit source rebinding still starts the replacement lineage at `1`.
  `lineage.transition` is non-null only when the most recent state-changing lineage action is explicit adoption and its prior and replacement `plan.identity` values differ; its `to` value equals the current `plan.identity`.
- The build record is the promotion commit marker, and the sealed staged candidate is the only recovery state.
  Recovery finishes the complete candidate record and inventory forward from an intact sealed stage and removes the stage before currentness evaluation, never accepting mixed bytes; without an intact sealed stage, a record/byte mismatch is an ordinary conflict resolved by the explicit recovery choices.
  Promotion therefore needs no separate journal, prior-byte copies, or rollback branch: the sealed stage and the prior and candidate records already carry every hash recovery consults.

### Exact reuse and conflicts

- A canonical full or full-link invocation with neither reserved lineage path runs normally and creates the pair only after success, except that the reserved `slc` meta-pipeline never creates it.
- On a lineage-eligible pipeline, `.slc-build.json` and `.slc-source` are a mutually valid reserved pair.
  Either path present without the other, or either path being a symbolic link or having the wrong file type, is a conflict rather than an unrecorded file or a cold build; automatic mode never overwrites it.
- A present record with malformed or noncanonically encoded JSON, a missing, unknown, or wrong-typed schema field, an unsupported schema or hash algorithm, a symbolic-link path, an invalid managed path, or an inventory path not derivable from its canonical plan is a conflict rather than an absent cache; automatic mode refuses to overwrite it.
- A recorded step is reusable only when its current input key, definition/executor identity, semantic options, and existing output bytes match the record exactly.
  The planner walks the ordered chain and recomputes downstream keys after every executed step; if an executed step reproduces its prior output bytes, still-current downstream steps remain reusable.
- Reuse additionally requires an explicit closed, content-identified declaration of every output-affecting readable input, using the phase definition's existing semantic-input declaration where applicable.
  Absent explicit whole-lineage adoption, a phase whose readable semantic closure is undeclared or incomplete remains executable but is never phase-result reusable or update-eligible.
- For a pinned phase, currentness validation and executor selection under [DR-007](007-slc-phase-artifact-pinning.md) precede reuse, adoption, and ordinary execution including `--rebuild`.
  Cached user output never makes a stale or malformed pin runnable, and neither lineage option repairs one; the diagnostic names the stale input or malformed field so the explicit compiled-artifact build-and-review flow can restore a current pin before lineage recovery is reconsidered.
- When the source locator, complete build identity, source bytes, snapshot bytes, and every scheduled output all match and either every scheduled semantic step is reuse-eligible or the complete lineage is current under [explicit adoption](#explicit-adoption), `slc` reports the bundle up to date, exits successfully, invokes no agent, and rewrites nothing.
- For a non-adopted lineage, a changed source is expected input evolution.
  A different source locator targeting the recorded bundle, a snapshot whose bytes do not match its recorded identity, or a managed artifact whose bytes changed outside the accepted recorded lineage is instead a conflict: automatic mode refuses to overwrite or adopt it.
- An automatic conflict that meets every adoption precondition except carrying `--adopt` reports both explicit choices: `--adopt` attests the complete current semantic lineage, while `--rebuild` regenerates it.
  Malformed or unsafe lineage, source, snapshot, or locator drift, an incompatible plan, or a missing semantic product is not adoption-eligible and reports only `--rebuild`; an invalid current pin instead fails under [DR-007](007-slc-phase-artifact-pinning.md) with pin-repair guidance before either lineage option is considered.
- `--rebuild` on a canonical full or full-link invocation without `-o` or `--adopt` explicitly bypasses reuse and scoped update, authorizes replacement or source rebinding of the named bundle, and, for a lineage-eligible pipeline, writes a new record only after the complete run succeeds.
  It derives every replacement or removal path from the new canonical plan, never trusts an invalid prior inventory to delete a file, and replaces an invalid reserved metadata entry itself without following a symbolic link target.
  For the reserved `slc` meta-pipeline it still executes the complete ordinary plan but writes no lineage metadata.
- Single-phase, standalone-pass, and direct-link invocations retain their existing explicit behavior and do not silently rebase a full-build record.
  If they change a recorded artifact, the next automatic full invocation reports the resulting conflict rather than erasing the refinement.

### Explicit adoption

- `--adopt` is a non-destructive, explicit user attestation for a complete manually refined lineage.
  It is accepted only on a canonical non-`slc` full or full-link invocation without `-o` or `--rebuild`, and only when a schema-valid record and snapshot still name the same source locator and exact source bytes, every current applicable pin validates, all managed paths are safe, and the recorded and current canonical plans have the same ordered semantic-product topology: scheduled normalization, phase, pass, and link roles, formats, and canonical target paths.
  Within that boundary, definitions, executors, declared semantic inputs, link target, compatibility values, semantic options, and deterministic generator or checker identities may change: adoption derives and records their current identities rather than claiming the old toolchain produced the adopted bytes.
  Malformed or orphaned metadata, source or snapshot drift, source rebinding, incompatible plan topology, or an unsafe, missing, wrong-typed, or symbolic-link semantic product remains a conflict requiring `--rebuild`; an invalid current pin first requires the explicit compiled-artifact build-and-review flow, while a safe missing or changed deterministic entry or verification derivative is regenerated rather than adopted.
- Adoption is not proof that the producing step emitted the current bytes.
  The command makes the user the semantic authority for the complete current set of scheduled normalization, phase, pass, and link products; deterministic verification establishes only the consistency it actually checks, including Playbook's GEARS-to-FSM and linked-runtime invariants, not raw-source fidelity.
- Adoption is whole-lineage rather than partial.
  `slc` records exact current hashes and `origin: "user-adopted"` for every scheduled semantic product, records any prior-to-current build-identity transition as provenance, clears all update traces, and does not invoke a semantic executor; unchanged products are attested together with changed products so an unclosed upstream phase cannot immediately disturb an adopted suffix.
- Existing generated entry and verification products are not trusted as adoption evidence.
  `slc` regenerates those deterministic derivatives from the current semantic products and trusted current generators in staged state, applies generic and load-integrity checks, and runs the complete applicable regenerated verification suite before promoting the derivatives and new record.
  Failure writes no candidate byte to a canonical path within the [physical-binding transaction boundary](#build-lineage), while success leaves the semantic products and source snapshot byte-identical and reports what was adopted.
  A generic, load-integrity, or verification failure attributable to inconsistent semantic products tells the user to repair the reported products and retry `--adopt`, or use `--rebuild`; every other failure reports its actual cause and applicable recovery.
- A current adopted lineage may take the exact whole-bundle no-op even when a phase lacks a closed readable-input declaration, because explicit user attestation rather than inferred phase derivation is its authority.
  Any later source, snapshot, source-locator, build-identity, or semantic-product drift makes automatic execution conflict; another unchanged-source refinement or compatible build-identity rebaseline may be attested with `--adopt`, while source evolution or an incompatible plan requires `--rebuild`.

### Deterministic update planning

- A phase is update-capable only when its authoritative definition declares a `## Update` contract.
  The contract owns stable input units, target scopes, dependency expansion, structural or global scopes, update instructions, and semantic verification.
  `slc` does not hard-code GEARS, FSM, Players, or any other pipeline-specific concept.
- Before invoking an agent, `slc` compares the current source with the recorded source snapshot and maps every changed byte span through the prior validated trace.
  Scoped update is provisionally eligible only when the build identity other than the source remains current, every changed span maps unambiguously to stable units, the declared dependency closure is complete, and no mechanically affected region is recorded as structural or global.
- An evident unmapped insertion or deletion, cross-unit change, broken recorded ordering, definition/runtime/options drift, or incomplete trace selects ordinary execution of the earliest affected phase before any update agent is called.
  A semantic split, merge, reclassification, or new dependency that cannot be known from the old trace is instead detected from the update outcome and replacement trace and rejects that candidate with `--rebuild` guidance.
- An adopted lineage does not enter automatic update or ordinary-execution planning.
  Any drift first conflicts under [explicit adoption](#explicit-adoption), preserving the user-attested bundle until the user explicitly adopts another unchanged-source refinement or compatible build-identity rebaseline, or rebuilds it.
- There is no change-ratio or generation threshold.
  Textual size cannot establish semantic locality, and a fresh nondeterministic generation is not intrinsically more correct than a verified update.

#### Update grammar

An update contract is present only when the first three nonblank lines under one `## Update` heading are exactly an opening ```` ```json ```` line, the following compact object line, and a closing ```` ``` ```` line, with no surrounding prose:

```json
{"schema":"sublang.slc.update-contract.v1","traceSchema":"sublang.slc.update.v1"}
```

The definition contains at most one `## Update` heading.
The object rejects omitted, additional, or different fields and is followed by these six nonempty direct `###` subsections exactly once and in this order: `Stable input units`, `Target scopes`, `Dependency closure`, `Structural and global scopes`, `Update instructions`, and `Semantic verification`; no other direct `###` subsection is permitted before the next `##` heading.
The first four subsections own how the executor emits generic trace scopes and dependencies; the last two own update execution and semantic checking.
`slc` validates only this structure.
A missing or malformed contract leaves ordinary phase semantics valid but makes the phase update-ineligible.

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
  It also carries the definition-declared complete expanded target closure for each input scope and the structural or global classifications needed to select update safely.
  Complete coverage makes separators and otherwise unclassified bytes protected rather than invisible to the byte guard.
- `slc` validates only this generic shape, byte coverage, identities, and closure cross-references and order.
  It does not interpret scope names or decide whether the declared complete closure is semantically sufficient.
- A missing or malformed trace from an otherwise successful ordinary execution does not invalidate its artifact, but disables scoped update from that step.
  A missing or malformed replacement trace from an update candidate rejects that candidate because protected-scope enforcement is then impossible.

#### `sublang.slc.update.v1`

The `UpdateTrace` referenced by `sublang.slc.build.v1` is exactly one object with required fields `schema: "sublang.slc.update.v1"`, `input: PartitionRecord`, `target: PartitionRecord`, and `dependencies: DependencyRecord[]` in that order.
Every object rejects omitted, additional, null, or wrong-typed fields.

| Type | Exact fields |
| --- | --- |
| `PartitionRecord` | `hash: Hash`, `byteLength: number`, `scopes: ScopeRecord[]` |
| `ScopeRecord` | `scope: string`, `start: number`, `end: number`, `classification: "local" \| "structural" \| "global"` |
| `DependencyRecord` | `input: string`, `targets: string[]` |

`byteLength`, `start`, and `end` satisfy JavaScript `Number.isSafeInteger`, are nonnegative UTF-8 byte offsets, and every scope string is nonempty, contains no U+0000 through U+001F or U+007F through U+009F scalar, and is unique within its partition.
For nonempty bytes, scopes are ordered, adjacent, nonempty half-open ranges beginning at `0` and ending at `byteLength`; zero bytes require an empty scopes array.
Each partition hash identifies the exact bytes with that byte length.
Dependencies contain exactly one entry per input scope in input order; its `input` names that scope and its unique `targets` name existing target scopes in target order.
The targets are the definition-owned complete expanded closure, not a graph whose semantic sufficiency SLC infers.
In a recorded step, `trace.input` matches the exact sole compile operand represented in `inputKey`, and `trace.target` matches the step's semantic product bytes; link steps always record `trace: null`.

#### Executor metadata transport

The host-owned executor result retains `status` and `diagnostics` and may add exactly one optional `metadata` object whose sole field is `"sublang.slc.update.v1": UpdateTrace`.
An absent member means no trace.
An interpreted agent uses its existing Cligent final text without an API change and may append this exact final nonblank suffix at most once:

```text
SLC_RESULT_BEGIN
{"schema":"sublang.slc.interpreted-result.v1","metadata":{"sublang.slc.update.v1":{...}}}
SLC_RESULT_END
```

The middle is one canonical-JSON line, the envelope and metadata objects reject every other field, and `{...}` denotes the exact trace object above rather than literal text.
`slc` removes a valid suffix before applying existing `BLOCKED:` and diagnostic parsing, never includes reserved marker or envelope text in diagnostics, and treats Cligent's transport status and the remaining prose as the only status authority.
A duplicate, misplaced, unterminated, or malformed marker occurrence causes every reserved marker block or marker-start suffix to be withheld from status and diagnostic parsing, supplies no metadata, and adds one host diagnostic; ordinary success remains valid, while an update candidate is later rejected for lacking valid replacement metadata.
Compiled execution instead diverts every `emitTelemetry` event whose topic is exactly `sublang.slc.update.v1` from ordinary telemetry handling.
Exactly one schema-valid reserved event supplies the metadata member; a malformed payload or more than one reserved event supplies no metadata and adds one host diagnostic without changing the ordinary Playbook result, and no reserved payload appears in trace, status, or ordinary diagnostics.

### Scoped execution and acceptance

- An update execution receives the authoritative definition, the complete current input, the prior input, their exact diff, the prior complete target, and the allowed target-scope closure.
  It writes a complete candidate target and returns a replacement trace out of band, rather than emitting an accumulated patch or a second file.
- `slc` runs the candidate in staged space and enforces the generic update boundary deterministically: every target scope outside the allowed closure remains byte-identical, all protected inputs and definitions remain unchanged, the trace is structurally valid, and ordinary [DR-003](003-slc-phase-execution.md) checks still pass.
  Semantic sufficiency remains definition-owned.
- The replacement trace must preserve the eligible input-unit structure and classifications and must not expand the allowed dependency closure.
  A split, merge, reorder, new structural or global classification, or closure expansion rejects the scoped candidate rather than silently widening it after execution.
- For every executed step, the canonical logical locators remain in the semantic request while the host's separate physical workspace binding is sole authority for named host-supplied reads and directs the performing agent to corresponding staged reads and the staged write sink; later steps consume those staged bytes through the same binding, and canonical paths receive the new bytes only during promotion.
  This preserves the one-target execution rule and makes rejection non-destructive for binding-compliant execution; an out-of-binding write instead fails under [DR-003](003-slc-phase-execution.md) without an unsafe rollback promise.
- Within that authority boundary, the complete requested run is transactional with respect to its prior accepted bundle: no staged candidate, deterministic derivative, source snapshot, or build record replaces accepted state until every required downstream step and verification succeeds and the host begins the recoverable lineage promotion.
- After an accepted candidate, downstream planning uses its actual output hash.
  Link phases are not scoped-update-capable in this schema version, so a dirty link always executes in full; deterministic entry and verification products are regenerated when their inputs change; and the complete emitted verification suite runs before the new lineage is accepted.
- A scoped-update violation, `BLOCKED` outcome, or verification failure during binding-compliant execution discards the complete staged run, writes no candidate bundle, source-snapshot, or record byte to a canonical path, and fails with a diagnostic recommending `--rebuild`.
  A detected out-of-binding write also fails and prevents promotion, but arbitrary external mutation lies outside the transaction's rollback guarantee.
  It does not automatically spend a second agent invocation on ordinary execution, preserving [PHEXEC-12](../dev/phase-execution.md#phexec-12)'s one-invocation contract and avoiding a hidden double-cost retry.
- A fresh nondeterministic generation is not periodic ground truth.
  Absent explicit adoption, the source, authoritative definitions, protected-region equality, and full verification are the acceptance authority; lineage generation remains audit metadata only.

#### Update request

Only an update-capable compile request may add a required `update` object; ordinary compile and every link request retain their existing shape and carry no such field.
The update object contains exactly these fields in order:

| Field | Exact value |
| --- | --- |
| `schema` | `"sublang.slc.update-request.v1"` |
| `priorInput` | `{ "read": "prior-input", "hash": Hash, "byteLength": number }` |
| `currentInput` | `{ "read": "source", "hash": Hash, "byteLength": number }` |
| `priorTarget` | `{ "read": "prior-target", "hash": Hash, "byteLength": number }` |
| `priorTrace` | `UpdateTrace` |
| `changes` | `ChangeRecord[]` |
| `allowedTargetScopes` | `string[]` |

Each `ChangeRecord` contains exactly safe nonnegative integers `priorStart`, `priorEnd`, `currentStart`, and `currentEnd` naming one half-open UTF-8 byte hunk.
For prior bytes `a` of length `n` and current bytes `b` of length `m`, `slc` defines `D(n,j) = m - j`, `D(i,m) = n - i`, and `D(i,j)` as the minimum of `D(i + 1,j + 1)` when `a[i] = b[j]`, `1 + D(i + 1,j)`, and `1 + D(i,j + 1)`.
It walks from `(0,0)`, choosing an equal-byte match whenever it preserves `D`, otherwise a deletion whenever it preserves `D`, and otherwise an insertion; this match-before-delete-before-insert priority resolves every repeated-byte alignment.
Each maximal run of operations without an intervening match becomes one hunk, so adjacent deletion and insertion operations coalesce.
Each hunk satisfies `start <= end` within both byte lengths and changes at least one side; hunks are strictly ordered and nonoverlapping on both coordinate axes, unchanged gaps and outer ranges are byte-identical, replacing each prior hunk range with its corresponding current range reconstructs the current bytes, and `changes` is empty exactly when the two byte arrays are equal.
The embedded prior trace is field-for-field equal to the accepted step's recorded trace, and its input and target hashes and lengths equal `priorInput` and `priorTarget` respectively.
After the planner identifies dirty local input scopes from those hunks under the prior trace, `allowedTargetScopes` is exactly the duplicate-free union of those scopes' complete target closures in prior-target partition order; it is never a caller-chosen subset or superset.
The three read names resolve through the physical workspace binding below, their hashes and lengths match those bytes, and the request does not otherwise duplicate their content.
Replacement metadata binds its input partition to `currentInput` and its target partition to the complete candidate bytes.
Every unchanged input scope retains its exact recorded target closure, while each dirty local input scope's replacement closure contains only scopes in `allowedTargetScopes`.
Update success uses the ordinary executor status plus a complete candidate file at the one write sink and a valid replacement trace in executor metadata; it never returns a patch.

#### Physical workspace binding

The host-owned binding is exactly one `sublang.slc.workspace.v1` object with required fields `schema`, `reads`, and `write`; every object rejects omitted, additional, null, or wrong-typed fields.

| Type | Exact fields |
| --- | --- |
| `WorkspaceRecord` | `schema: "sublang.slc.workspace.v1"`, `reads: ReadBinding[]`, `write: WriteBinding` |
| `ReadBinding` | `role: string`, `logicalPath: string`, `physicalPath: string`, `kind: "file" \| "directory"`, `identity: Hash` |
| `WriteBinding` | `role: "target" \| "linked"`, `logicalPath: string`, `physicalPath: string`, `kind: "file"` |

Logical and physical values are normalized absolute host paths.
An ordinary compile binding contains exactly one `definition`, exactly one `source`, then contiguous `reference:<zero-based-index>` and `semantic-input:<zero-based-index>` roles matching their semantic-request and declared-input order; an update compile appends exactly one `prior-input` and one `prior-target`.
A link binding instead contains exactly one `definition`, contiguous `object:<zero-based-index>` roles matching object request order, exactly one `link-target`, then contiguous declared `semantic-input:<zero-based-index>` roles; no other role is valid.
Each logical path equals the corresponding canonical request or declared-input path, each file identity matches exact bytes, and each directory identity uses [DR-007](007-slc-phase-artifact-pinning.md#hashing-and-portability)'s deterministic tree framing and applicable symbolic-link policy.
The write role matches the request kind, and the write's logical path equals the canonical semantic target while its physical path is the sole authorized sink.
Its normalized physical path is distinct from every read's physical path, resolves through no writable symbolic-link component, and is provisioned as a fresh file rather than a symbolic or hard link to a readable input.
Distinct read roles may name the same logical path when prior and current bytes require different physical files; read roles with the same physical path must record the same kind and identity.
The semantic request and compiled Boss JSON carry only canonical logical paths plus any update object; physical paths appear only in the host binding and are the sole filesystem authority for the named host-supplied paths and the write sink.
The authoritative definition may separately permit read-only tools, commands, or cited content under [DR-004](004-slc-interpreted-phase-execution.md#interpreter); any such content not enumerated as a semantic-input binding leaves the readable closure open and therefore prevents reuse or scoped update without making ordinary execution invalid.
The interpreted prompt and each transformation-performing compiled Player or Captain prompt end with exactly one `SLC_WORKSPACE_BEGIN`, one canonical-JSON-line workspace object, and `SLC_WORKSPACE_END`; routing-only Captain and judge prompts remain unchanged.
The binding never enters artifact bytes, trace scope strings, build identity, Playbook results, or diagnostics.

### Playbook traceability

- When generic normalization is scheduled, the SLC-owned `normalize.md` definition must supply the raw-source-to-normalized-unit trace and update semantics.
  Playbook-owned phase definitions must supply the normalized-input-to-GEARS-to-FSM scopes, mappings, dependencies, and update semantics; without normalization, the entry definition starts that trace at the source bytes it consumes.
  Existing FSM `sourceItem` values provide only the GEARS-to-FSM edge, so all earlier edges remain an explicit definition coupling before automatic Playbook updates are eligible.
- Exact reuse on the installed Playbook consumer path separately requires Playbook's published phase definitions to carry package-portable, closed semantic-input declarations.
  The repository-relative `## Pin Inputs` added to SLC's vendored definitions close its reviewed self-host pins only and cannot establish the installed package's consumer-build closure.
  Until the published definitions provide that closure, the installed Playbook pipeline gains source association and conflict detection but its unclosed semantic steps execute and prevent an automatically derived whole-bundle no-op; explicit whole-lineage adoption remains available as a separate user authority.
- A local change whose complete dependency closure is mapped may preserve every reviewed GEARS item and FSM region outside that closure.
  Changes to declared global scopes such as players, results, identifiers, or control-flow topology select ordinary phase execution regardless of textual size.

## Consequences

- For a pipeline whose scheduled semantic steps all declare closed content-identified readable-input closures, an unchanged full invocation becomes a deterministic no-op, while exact phase-level reuse remains available even when an earlier executed phase reproduces identical bytes.
- A small, traceable source edit can revise only its semantic closure without re-gambling unrelated reviewed output; byte preservation is enforced by the host and semantic correctness by the definitions and verification.
- Pipelines without complete update contracts and traces still benefit from exact reuse when their readable-input closures are closed, but a changed input follows ordinary phase execution; absent explicit whole-lineage adoption, a pipeline with an unclosed semantic step gains association and conflict detection but cannot reuse that step or take the whole-bundle no-op.
- Reserved self-host builds remain ordinary so reviewed artifact bundles and their pins have no lineage feedback cycle.
- Same-basename collisions and manual artifact edits become visible conflicts instead of silent overwrites, while `--adopt` lets the user attest a complete unchanged-source refinement across a compatible toolchain rebaseline without an expensive destructive rebuild.
- Source snapshots enable deterministic pre-agent diffing and portable lineage at the cost of duplicating source content in the bundle.
- The feature adds explicit recovery choices: destructive `--rebuild` re-establishes phase-produced lineage, while non-destructive `--adopt` records user-attested semantic bytes; automatic update failure remains fail-closed rather than retrying at potentially multi-hour cost.
