<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-021: Incremental Compilation

## Goal

Implement [DR-021](../decisions/021-incremental-build-records-scoped-updates.md) as generic SLC lineage, reuse, scoped-update, rebuild, and adoption behavior through independently reviewable commits that keep the relevant repository gates green.
This record plans the work only; no task is implemented by the commit that creates it.
Published Playbook semantic-input closures and update contracts are an unplanned upstream follow-on, so this iteration uses fixtures and does not consume the sibling checkout or claim installed-Playbook automatic reuse or update support.

## Deliverables

- [ ] Schema-exact source-bound build lineage with safe path handling and recoverable staged promotion.
- [ ] Conflict detection, explicit rebuild, exact step reuse, and a write-free whole-bundle no-op.
- [ ] Generic interpreted and compiled update-metadata transport plus deterministic scoped-update planning and enforcement.
- [ ] Whole-lineage adoption with compatible build-identity rebaselining and regenerated deterministic derivatives.
- [ ] Coordinated specs, integration acceptance, user documentation, and a green deterministic release gate.

## Tasks

Tasks are ordered, and each numbered task shall land as exactly one commit.
Each task's commit shall check that task in this record.
Each implementation task's commit shall include its focused unit or integration tests and make any named spec correction before or atomically with the affected code.

1. [x] **Specify the lineage wire format.** Define the exact `sublang.slc.build.v1` JSON fields, identity and relative-path encodings, managed inventory, step origins, adoption transition, snapshot pairing, and promotion-recovery observables in DR-021 and the INCR dev/test items; update map summaries only if their scope changes.
2. [x] **Specify the update wire format.** Define the machine-readable `## Update` grammar, exact `sublang.slc.update.v1` trace and update request/result shapes, an SLC-owned interpreted response envelope carried by the existing Cligent final result without a Cligent API change, and logical-locator versus physical-workspace-binding shapes in the INCR and PHEXEC dev/test items; keep pipeline meaning definition-owned.
3. [x] **Add the lineage codec.** Implement strict record and snapshot loading/encoding, exact SHA-256 identities, artifact-directory-relative source locators, unknown-field rejection, metadata pairing, and symlink/path confinement with focused unit tests; keep this commit to the codec foundation and make any INCR-7/9 schema clarification in it.
4. [x] **Identify canonical build plans.** Extract full/full-link planning from the runner and derive ordered topology plus definition, declared semantic-input, selected executor/pin, link-target, option, generator/checker, version, and compatibility identities with plan-identity tests; keep any INCR-7/INCR-10 clarification in this commit.
5. [x] **Build staged overlays.** Add candidate managed-path overlays, pre-promotion identity checks, obsolete-product calculation, and unrecorded-file preservation with focused unit tests; defer canonical-run integration and INCR-8/27/30 acceptance to later tasks.
6. [x] **Promote with record-last renames.** Add ordered per-file rename promotion over the sealed overlay, commit-marker ordering, and forward-only interruption recovery with interruption tests; the sealed stage and the two records are the only recovery state — no separate journal.
7. [x] **Bind physical phase workspaces.** Thread the sole-authority physical read/write binding through generic execution, interpreted prompts, compiled Player calls, and transformation-performing Captain calls while retaining canonical logical Boss/request locators; cover PHEXEC-34/35 with alternate-sink and scope-violation executor tests, and reserve INCR-31's canonical staged run for task 9.
8. [x] **Make deterministic derivatives stage-capable.** Refactor entry, verifier, and verifier-support generation to explicit candidate paths, expose stable generator/checker identities, and provide load-integrity and emitted-suite runners while preserving current canonical behavior; coordinate the supporting VERIFY and SELFHOST specs in this commit without claiming promotion or incremental acceptance yet.
9. [x] **Persist cold-build lineage.** Route eligible canonical full/full-link runs through the transaction, bind staged workspaces, run deterministic checks, and promote artifacts, entry/verifiers, `.slc-source`, and `.slc-build.json` only after acceptance; cover the non-trace core of INCR-7/8/20, INCR-31, and existing cold-run PIPE, COMPILE, CLI, and SELFHOST behavior.
10. [x] **Preserve non-lineage forms.** Keep `-o`, single-phase, standalone-pass, direct-link, and the reserved `slc` meta-pipeline on their specified non-lineage paths, prove the self-host pin fixed point, and cover INCR-28's `-o` branch plus INCR-32 and affected PIPE/SELFHOST acceptance.
11. [x] **Classify existing lineage.** Load and validate the metadata pair, verify pins before every lineage mode, distinguish cold, dirty-input, automatic conflict, adoption-eligible conflict, and incompatible state, and produce structured recovery choices without mutating the bundle; cover INCR-6/9/11 and the classification branches of INCR-26/29/37.
12. [x] **Execute explicit rebuilds.** Parse, validate, route, and document `--rebuild`; make it bypass reuse and update for a valid or source-rebound canonical plan, execute every step ordinarily in staged state, and replace the binding only after successful verification; cover PIPE-9, CLI help, and the normal and reserved-pipeline paths of INCR-6/19/26/28.
13. [x] **Harden conflict recovery.** Safely replace malformed, orphaned, wrong-typed, or symbolic-link metadata without trusting the old inventory, preserve unrecorded files, remove only newly derived obsolete products, detect concurrent edits, and recover interrupted promotion; cover the remaining INCR-26/27/30 conflict and fault cases and update recovery diagnostics/specs in this commit.
14. [x] **Reuse exact steps.** Walk recorded steps by recomputed input keys, preserve each reused origin, retain downstream reuse after byte-identical regeneration, enforce closed readable-input eligibility, and cover INCR-10/11/22/29 plus affected PIPE/COMPILE execution branches.
15. [x] **Return a whole-build no-op.** Detect an exactly current derived lineage, invoke no executor, perform no write, return/report `up to date`, and cover INCR-2/21, CLI-3/11/38, and the normalization, pass, entry, PIPE, COMPILE, and SELFHOST reuse branches.
16. [x] **Decode interpreted update metadata.** Reuse the exact trace codec from task 3, extend the host phase result with optional namespaced metadata, extract task 2's SLC-owned interpreted response envelope, and preserve ordinary success when metadata is absent or malformed; cover the interpreted branches of PHEXEC-39/40 and INCR-13 with focused tests.
17. [x] **Capture compiled update metadata.** Divert the reserved compiled telemetry topic into the protected metadata sink, exclude it from Playbook results/status/diagnostics, and persist only valid ordinary interpreted or compiled traces in the build record; cover the compiled branches of PHEXEC-39/40 and complete INCR-13/20's valid, absent, and malformed trace acceptance.
18. [x] **Plan generic scoped updates.** Parse the exact `## Update` contract, compute source-byte diffs and opaque dependency closures, and select ordinary execution before an agent call for unmapped, ambiguous, structural, global, or incomplete cases; cover INCR-12/14 and fixture-based INCR-24 without adding a real pipeline definition yet.
19. [x] **Enforce scoped candidates.** Supply prior/current inputs, exact diff, prior target, and allowed closure; enforce replacement-trace, protected-input, protected-byte, and scope invariants; and reject blocked or invalid candidates without a hidden ordinary retry; cover INCR-5/13/15/16 and INCR-25.
20. [x] **Accept scoped build lineages.** Replan downstream steps from actual output hashes, execute dirty links in full, regenerate and verify deterministic derivatives, record updated/reused/ordinary origins, and promote only the complete accepted lineage; cover INCR-3/17 and INCR-23 with any affected VERIFY spec correction in this commit.
21. [x] **Enable SLC normalization updates.** Add the SLC-owned normalization update/trace contract and exercise its raw-source scope mapping through the generic engine; cover the normalization side of INCR-18/24 while retaining the documented absence of published Playbook-owned closures and later mappings.
22. [x] **Validate adoption requests.** Parse, validate, route, and document `--adopt`; require unchanged-source continuity, safe complete semantic products, valid current pins, and compatible topology; route eligible refinements/rebaselines and reject unsafe, drifted, incompatible, or unsupported forms without mutation; cover INCR-6/9/34, the adoption portions of INCR-28/37, and applicable PIPE/CLI help and diagnostics.
23. [x] **Execute whole-lineage adoption.** Attest every semantic product without an executor, derive the current compatible build identity, clear traces, regenerate and check deterministic derivatives in staged state, record user-adopted origins and identity transitions, and promote/return the adopted result only after acceptance; cover INCR-33/35 and the adoption-success core of INCR-36.
24. [x] **Enforce adopted currentness.** Return the exact adopted no-op, classify later source, topology, identity, and semantic-product drift, report adopted versus written paths through the CLI, and cover the final/rebaseline branches of INCR-36/37 plus CLI-3/11/39 and related COMPILE/PIPE/SELFHOST behavior.
25. [ ] **Close the iteration.** Update user documentation and examples, explicitly retain the installed-Playbook limitation, run the complete deterministic release gate, apply only final traceability or map corrections, and mark the remaining deliverables complete in one docs-only commit; plan any future Playbook IR/release and atomic SLC adoption separately rather than consuming the sibling checkout.

## Acceptance criteria

- Every task is represented by exactly one commit, and no implementation commit precedes the spec contract it implements.
- A successful eligible cold build records exact source, plan, product, provenance, and optional trace identities without adding lineage metadata to `-o` or reserved self-host output.
- An exact repeat invokes no executor, performs no filesystem write, reports `up to date`, and preserves recorded origins.
- Malformed, unsafe, orphaned, rebound, manually changed, concurrently changed, and stale-pin states fail closed with only the recovery choices valid for that state; `--rebuild` never bypasses pin validation.
- Candidate execution and deterministic derivatives remain staged until complete verification, preserve unrecorded paths, remove only obsolete managed paths, and recover interrupted promotion to one accepted lineage.
- Interpreted, compiled Player, and compiled Captain execution receive canonical semantic locators and the sole authorized physical workspace binding without leaking staging locators into products or trace identity.
- Valid trace contracts enable deterministic scoped update, protected bytes remain exact, dirty links execute in full, and any blocked, structurally widened, invalid, or unverified candidate is discarded without an automatic retry.
- `--adopt` preserves the complete user-attested semantic lineage, permits only compatible identity rebaselining, regenerates trusted deterministic derivatives, clears traces, and establishes a subsequent exact no-op.
- Fixture pipelines cover the generic engine without live model calls, and `npm run release:check` passes before the iteration closes.
