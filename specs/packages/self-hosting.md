<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# self-hosting: Self-Hosting Meta-Pipeline

## Intent

This package specifies the user-facing and component contracts of the reserved `slc` meta-pipeline: how a user compiles a phase or link definition into a runnable compiled artifact, and how `slc` realizes that pipeline and its distinct `playbook` linked format, per [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md).
The meta-pipeline is another explicitly named pipeline that runs through the generic mechanics specified in the `pipeline` package, produces an artifact the `phase-execution` package executes and the `pinning` package pins, and shares its Playbook-authored definitions with the `playbook` domain pipeline under [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), including the successive atomic reviewed-asset adoptions initiated under [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md).
The current schema-3 definition and artifact set is adopted under [DR-024](../decisions/024-playbook-10-schema-3-adoption.md).
Verification exercises an `slc`-named fixture pipeline, the reserved `slc`, and the `playbook` domain pipeline end to end with a faked agent transport.
Essential project-specific references: `slc`, this project's compiler CLI; the reserved `slc` pipeline, the `playbook` linked format, and the host-side phase-runner facade of [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md); and `@sublang/playbook`, which provides the meta-pipeline definitions `slc` consumes.

## External Behavior

### Compiling definitions

#### self-hosting-1

When the user runs the reserved `slc` pipeline on a phase or link definition, the slc command shall compile that definition through the meta-pipeline's phases into an `fsm` object artifact in the invocation working directory's artifact directory, and, when the user links it against an explicit runtime target, into a runnable compiled `playbook` artifact, so the user authors no transformation code to obtain a reviewable compiled phase ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-002](../decisions/002-slc-link-phases.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

#### self-hosting-14

When the user runs the `playbook` pipeline on a source without `--link` or `-o`, the slc command shall additionally produce a runnable entry module `<basename>.ts` beside the artifact directory, such that `playbook run ./<basename>.ts "<task>"` performs the compiled workflow with no hand-written wiring ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

### Reserved pipeline

#### self-hosting-2

The slc command shall reserve the pipeline name `slc` for the meta-pipeline that compiles phase and link definitions into runnable artifacts, resolving that reference to the shared Playbook-authored definition set [[self-hosting-9](#self-hosting-9)] rather than a duplicate, requiring it to be named explicitly (claiming no default), and leaving the invocation grammar unchanged ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

#### self-hosting-6

When resolving a `playbook` pipeline reference, the slc command shall resolve it to the same shared definition set that backs the reserved `slc` [[self-hosting-9](#self-hosting-9)], so the `playbook` and `slc` pipelines share one definition set, one pin index, and the same compiled artifacts, differing only by name and thus by [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) artifact directory ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

#### self-hosting-9

When resolving the reserved `slc` or the `playbook` pipeline reference, the slc command shall use the applicable shared definition set ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)):

| Case | Shared definition set |
| --- | --- |
| At least one pipeline search root contains a directory named `playbook`. | The pipeline-search-root `playbook` directories — a committed vendor of Playbook's definitions, whose pin index can select compiled execution [[phase-execution-27](phase-execution.md#phase-execution-27)]. |
| No pipeline search root contains a directory named `playbook`. | The meta-pipeline definitions the installed `@sublang/playbook` provides. |

#### self-hosting-13

When a full invocation carries no `--link`, the slc command shall apply the pipeline's required link behavior ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md), [[pipeline-13](pipeline.md#pipeline-13)]):

| Pipeline | Required link behavior |
| --- | --- |
| `playbook` | Supply the installed `@sublang/playbook` package's `src/runtime.ts` — located by the same package resolution the pin generator uses — as the default link target and run the full-link form against it. |
| Reserved `slc` or any other pipeline | Infer no default link target; require an explicit `--link` before running the full-link form. |

### Playbook format

#### self-hosting-3

Where the reserved `slc` pipeline links an `fsm` `.ts` object, the slc command shall produce the distinct `playbook` linked format as a `.ts` artifact at its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) output location, whose runnable module is a `createPlaybookRuntime` factory driven through the host-side phase-runner facade [[phase-execution-23](phase-execution.md#phase-execution-23)], making it the artifact that a current pin selects for compiled execution [[phase-execution-27](phase-execution.md#phase-execution-27)] ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-002](../decisions/002-slc-link-phases.md)).

### Entry-module emission

#### self-hosting-15

When a full-link run of the `playbook` pipeline succeeds, the slc command shall apply the entry-module outcome for the applicable case ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md), [DR-017](../decisions/017-playbook-2-0-thin-runtime-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)):

| Case | Entry-module outcome |
| --- | --- |
| The linked schema-3 artifact is at its canonical path and its GEARS has no `Roles` declaration or a valid one whose names do not collide after canonical lowercase-id derivation. | Deterministically emit `<cwd>/<basename>.ts` — an erasable-TypeScript module importing the linked module via `./<basename>.<pipeline>/<basename>.playbook.ts` and default-exporting a Playbook registry entry with `id` and `command` set to `<basename>`, `artifactSchema` set to `3`, a `runtimeProfile` that truthfully advertises `{ kind: 'shared-factory', compat: createPlaybookRuntime.compat }` for a linked factory carrying its validated immutable compatibility or `{ kind: 'bespoke', artifactSchema: 3 }` for a bespoke linked implementation, `requiredRoleIds` set to the canonical lowercase roles in source order or empty when Roles is absent, `concurrentRoleSets` copied exactly from the FSM's source-derived export, `intent` derived from the normalized source's title and lead line, `validateOptions` a fail-closed validator of the linked configured options not supplied by the Boss turn, and `createRuntime(options, hostCapabilities)` calling the linked default factory with exactly `{ configuredOptions: options, hostCapabilities }`; emit no player-alias proxy because current host role bindings own concrete player and prompt identity. |
| The full-link input closure resolves exact `@sublang/playbook@0.10.0`, `1.0.0`, `2.0.0`, `3.1.0`, or `4.0.0` link-target provenance, the linked factory exposes no own `compat`, and declared player ids are unique case-insensitively. | Preserve the historical entry contract: deterministically emit `<cwd>/<basename>.ts` as an erasable-TypeScript module importing `./<basename>.<pipeline>/<basename>.playbook.ts` and default-exporting a registry entry with `id` and `command` set to `<basename>`, `requiredRoleIds` set to the verbatim source-declared Players in source order, `intent` derived from the normalized source's title and lead line, `validateOptions` a fail-closed allowlist of linked options not supplied by the Boss turn, and `createRuntime` calling the linked default factory with validated options whose `cwd` defaults to `process.cwd()`; wrap sessions passed to `init` and optional `restore` so a lowercased runtime player id maps back to its declared form while unknown ids and every other port, runtime member, and optional capability cross unchanged [[phase-execution-30](phase-execution.md#phase-execution-30)]. |
| A purported schema-3 entry has removed `=` or `|` role-alias syntax, duplicate or canonically colliding role ids, a concurrent role absent from `requiredRoleIds`, a repeated role within one concurrent set, a duplicate concurrent set, or a source/FSM concurrent-set mismatch. | Fail entry-module emission closed with a diagnostic. |
| `-o` relocates the linked artifact. | Skip entry-module emission. |
| Two immutable schema-1 player declarations collide case-insensitively. | Fail entry-module emission closed with a diagnostic. |

### Immutable definition adoption

#### self-hosting-11

Where the root manifest selects `@sublang/playbook@^10.0.0` and `@sublang/cligent@^0.23.0` while retaining direct `@sublang/spex@^0.3.0`, and the dependency lock resolves exact Playbook 10.0.0 and Cligent 0.23.0 with every installed Anthropic, Codex, or OpenCode SDK respectively satisfying `>=0.3.219`, `>=0.144.0`, or `>=1.18.12` while an absent optional SDK remains absent, when the SLC repository adopts that release's shared definition set, the adopted set shall contain the released `text2gears`, `gears2fsm`, `link`, and `optimize` normative content with SLC's explicit `## Pin Inputs` retained; `src/normalize.md` synchronized to Roles terminology; all three reviewed meta-phase artifact bundles rebuilt as shared-factory schema-3 linked modules through fresh interpreted real-agent `slc slc` runs and independently verified from those definitions; every corresponding pin regenerated through the build-and-review flow [[pinning-15](pinning.md#pinning-15)] with exact `@sublang/playbook@10.0.0` link-target provenance, the shared-engine `@sublang/playbook` runtime dependency recorded beside `xstate`, the package lock and complete bundle identities, and the unchanged direct Spex 0.3 grammar identities; and the demo manifest, every committed demo reference and entry artifact, and both version-bearing demo READMEs synchronized to the same release; the root manifest and lock, `composed-v3` execution [[phase-execution-23](phase-execution.md#phase-execution-23)], all four definitions, normalization prompt, all three bundles and their generated tests, `slc.pins.json`, schema-3 entry emission [[self-hosting-15](#self-hosting-15)], and complete demo set shall be accepted only as one current set produced from a clean registry install without a sibling checkout ([DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-018](../decisions/018-playbook-3-1-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)).

## Verification

### Meta-pipeline runs

#### self-hosting-4

Where a fixture reserves an `slc` pipeline that chains `text2gears` and `gears2fsm` and a `link.md` emitting `playbook`, when meta-pipeline acceptance runs, the slc command shall produce the required outcome for each case ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)):

| Case | Required outcome |
| --- | --- |
| Run `slc slc <definition>` and then the same run with an explicit `--link <target>`. | Write the `fsm` object and a `playbook` artifact [[self-hosting-1](#self-hosting-1)] that resolves to a `createPlaybookRuntime` factory [[self-hosting-3](#self-hosting-3)] at their canonical locations under the working directory. |
| The `slc` reference itself does not resolve. | Fail the run [[self-hosting-2](#self-hosting-2)]. |

#### self-hosting-5

Where the reserved `slc` resolves to the meta-pipeline definitions `@sublang/playbook` provides — whose `link.md` declares no `## Link Targets` — when the user runs `slc slc <definition> --link <target>`, the slc command shall chain those shared definitions [[self-hosting-2](#self-hosting-2)] and link the result to a `playbook` artifact [[self-hosting-3](#self-hosting-3)] at its canonical location under the working directory ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

#### self-hosting-7

Where the `playbook` pipeline resolves to the definitions `@sublang/playbook` provides — whose `link.md` declares no `## Link Targets` — when the user runs `slc playbook <source> --link <target>`, the slc command shall resolve the `playbook` reference to those shared definitions [[self-hosting-6](#self-hosting-6)], load that target-less link, and write the `playbook` artifact into the working directory's `<basename>.playbook/` at its canonical name ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

#### self-hosting-8

Where the `playbook` pipeline resolves to the definitions `@sublang/playbook` provides, when interpreted acceptance runs, the slc command shall produce the required outcome for each invocation:

| Invocation | Required outcome |
| --- | --- |
| `slc playbook code.md --link <target>` | Write the `code.gears.md` intermediate, the `code.fsm.ts` object, and the `code.playbook.ts` runtime through the shared definition set [[self-hosting-6](#self-hosting-6)], each at its canonical location under the working directory's `code.playbook/`. |
| `slc playbook code.md` | Run the same full-link form against the installed `@sublang/playbook` runtime as the default target [[self-hosting-13](#self-hosting-13)]. |

#### self-hosting-16

Where the `playbook` pipeline can complete a full-link run, when entry-module acceptance runs, the slc command shall produce the required outcome for each case:

| Case | Required outcome |
| --- | --- |
| Canonical schema-3 linked artifact with absent or valid Roles | Write `<cwd>/<basename>.ts` default-exporting a registry entry whose `id` is `<basename>`, `artifactSchema` is `3`, runtime profile exactly advertises the actual shared-factory compatibility or bespoke schema-3 implementation, `requiredRoleIds` are the source roles' canonical lowercase ids or empty, and `concurrentRoleSets` equal the FSM export; import the linked module by its source-only relative specifier; validate configured options; and have `createRuntime(options, hostCapabilities)` pass exactly `{ configuredOptions: options, hostCapabilities }` to the linked factory without a player-alias proxy [[self-hosting-15](#self-hosting-15)]; `playbook run ./<basename>.ts "<task>"` performs the compiled workflow with no hand-written wiring [[self-hosting-14](#self-hosting-14)]. |
| Exact 0.10.0, 1.0.0, 2.0.0, 3.1.0, or 4.0.0 schema-1 input closure, compat-less linked factory, and unique declared Players | Write the same canonical import, basename `id` and `command`, derived `intent`, fail-closed option validator, and verbatim source-order `requiredRoleIds`; default an omitted validated `cwd` to `process.cwd()` at options-only linked construction; map lowercased declared player ids back to their declared forms in `init` and optional `restore`; and preserve unknown ids and every other port, member, and optional capability [[self-hosting-15](#self-hosting-15)]. |
| Invalid schema-3 role or concurrent-set declaration | Fail entry emission for each removed alias form, duplicate or canonical collision, undeclared or repeated concurrent role, duplicate set, and source/FSM mismatch [[self-hosting-15](#self-hosting-15)]. |
| `-o` relocates the linked artifact | Write no entry module [[self-hosting-15](#self-hosting-15)]. |
| Case-insensitively colliding immutable schema-1 Players | Fail entry emission with a diagnostic [[self-hosting-15](#self-hosting-15)]. |

#### self-hosting-10

When the slc command resolves the reserved `slc` and the `playbook` references, both shall produce the required outcome for the applicable case [[self-hosting-9](#self-hosting-9)]:

| Case | Required outcome |
| --- | --- |
| A pipeline search root holds a `playbook` directory vendoring the shared definitions. | Resolve both references to that vendored directory. |
| No search root provides a `playbook` directory. | Resolve both references to the definitions the installed `@sublang/playbook` provides. |

### Adoption acceptance

#### self-hosting-12

Where a clean registry install resolves exact `@sublang/playbook@10.0.0` and `@sublang/cligent@0.23.0`, retains direct `@sublang/spex@0.3.0`, satisfies the Anthropic `>=0.3.219`, Codex `>=0.144.0`, and OpenCode `>=1.18.12` optional-peer floor for each installed SDK without requiring an absent SDK, and the repository vendors the adopted shared definitions, when the adoption acceptance runs, the reserved `slc` and `playbook` references shall both resolve to the vendored `text2gears`, `gears2fsm`, `link`, and `optimize` set corresponding to that installed release with explicit pin inputs retained; the adoption flow shall perform three fresh interpreted real-agent `slc slc` builds, independently execute every generated verification over their shared-factory schema-3 outputs, and accept only those reviewed outputs as the proposed bundles; every corresponding generated pin shall be current with exact 10.0.0 link-target provenance, recorded Playbook and XState runtime dependencies, complete bundle identity, package-lock input, and unchanged direct Spex 0.3 grammar identities; `src/normalize.md`, the emitted schema-3 entries, and the committed demo manifest, references, entries, and READMEs shall match the same Roles/schema-3 set; and changing any manifest, lock, normalization prompt, definition, bundle, pin, entry, or demo component back to its Playbook 4 form shall make acceptance fail rather than pass a mixed version [[self-hosting-11](#self-hosting-11)].
