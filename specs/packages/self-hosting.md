<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# self-hosting: Self-Hosting Meta-Pipeline

## Intent

This package specifies the user-facing and component contracts of the reserved `slc` meta-pipeline: how a user compiles a phase or link definition into a runnable compiled artifact, and how `slc` realizes that pipeline and its distinct `playbook` linked format, per [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md).
The meta-pipeline is another explicitly named pipeline that runs through the generic mechanics specified in the `pipeline` package, produces an artifact the `phase-execution` package executes and the `pinning` package pins, and shares its Playbook-authored definitions with the `playbook` domain pipeline under [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), including the successive atomic reviewed-asset adoptions initiated under [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md).
The Playbook 10 schema-3 definition and artifact set is current under [DR-024](../decisions/024-playbook-10-schema-3-adoption.md) and its completed activation in [DR-027](../decisions/027-complete-playbook-10-activation.md), with schema-1 support retained only for historical artifacts.
Verification exercises an `slc`-named fixture pipeline, the reserved `slc`, and the `playbook` domain pipeline end to end with a faked agent transport.
Essential project-specific references: `slc`, this project's compiler CLI; the reserved `slc` pipeline, the `playbook` linked format, and the host-side phase-runner facade of [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md); and `@sublang/playbook`, which provides the meta-pipeline definitions `slc` consumes.

## External Behavior

### Compiling definitions

#### self-hosting-1

When the user runs the reserved `slc` pipeline on a phase or link definition, the slc command shall compile that definition through the meta-pipeline's phases into an `fsm` object artifact in the invocation working directory's artifact directory, and, when the user links it against an explicit runtime target, into a runnable compiled `playbook` artifact, so the user authors no transformation code to obtain a reviewable compiled phase ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-002](../decisions/002-slc-link-phases.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

#### self-hosting-14

Where `-o` is absent, the deterministic entry path does not alias the raw source, and no two distinct declared role names collide case-insensitively, when the user runs the `playbook` pipeline on a source without `--link`, the slc command shall additionally produce a runnable entry module `<basename>.ts` beside the artifact directory — a `Roles` source's schema-3 registry entry, which a Playbook host performs through its effective slash command once the entry is enabled and role-bound in Playbook configuration, or a historical `Players` source's schema-1 entry, consumed as `playbook run ./<basename>.ts "<task>"` under its historical host — so the compiled workflow runs with no hand-written wiring ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md), [DR-017](../decisions/017-playbook-2-0-thin-runtime-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md), [[self-hosting-15](#self-hosting-15)]).

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

Where a full-link run of the `playbook` pipeline has produced its linked artifact, when the slc command settles deterministic outputs, the command shall apply the entry-module outcome for the applicable case, selecting the emitted generation from the gears role declaration alone — a `Roles` source emits the schema-3 entry and a historical `Players` source retains the schema-1 entry — without inspecting link-target provenance or factory compatibility ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md), [DR-017](../decisions/017-playbook-2-0-thin-runtime-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)):

| Case | Entry-module outcome |
| --- | --- |
| `-o` relocates the linked artifact. | Skip entry-module emission. |
| `-o` is absent and the raw source physically aliases `<cwd>/<basename>.ts`. | Preserve the compiled bundle, omit the entry, and report the diagnostic required by [[phase-execution-42](phase-execution.md#phase-execution-42)]. |
| `-o` is absent; the entry path does not alias the raw source; and no two distinct declared role names collide case-insensitively. | Deterministically emit `<cwd>/<basename>.ts` — an erasable-TypeScript module importing the linked module via `./<basename>.<pipeline>/<basename>.playbook.ts` and default-exporting a registry entry with `id` and `command` set to `<basename>`, `requiredRoleIds` set to the verbatim non-alias declared names in source order, `intent` derived from the normalized source's title and lead line, `validateOptions` a fail-closed allowlist that admits only `cwd` when the workflow contains a script item and otherwise admits no linked option, and `createRuntime` validating `captainOptions`, defaulting its omitted `cwd` to `process.cwd()` only for that script-capable case, and calling the linked default factory once — a `Roles` source's entry additionally advertising `artifactSchema: 3`, the linked factory's `composed-v3` runtime profile, and the declared concurrent-role sets, and composing the validated options with `createRuntime`'s second live-capability parameter into the factory's single `{ configuredOptions, hostCapabilities }` argument; wrap sessions passed to `init` and optional `restore` so a lowercased runtime player id maps back to its declared form while unknown ids and every other port, runtime member, and optional capability cross unchanged. |
| `-o` is absent; the entry path does not alias the raw source; and two distinct declared role names collide case-insensitively. | Fail entry-module emission closed with a diagnostic. |

### Immutable definition adoption

#### self-hosting-11

Where the dependency manifest selects `@sublang/playbook@^10.0.0` and `@sublang/cligent@^0.23.0` and the lock resolves immutable Playbook 10.0.0 and Cligent 0.23.0, when the SLC repository maintains the current shared definition set, the adopted set shall contain the released `text2gears`, `gears2fsm`, `link`, and `optimize` definitions byte-identical to the installed immutable release with their pin-input declarations carried by the SLC-owned `slc.pin-inputs.json` sidecar rather than inline `## Pin Inputs` sections, the three reviewed meta-phase artifact bundles rebuilt as shared-factory schema-3 artifacts and independently verified from those definitions, and every corresponding pin regenerated with exact `@sublang/playbook@10.0.0` link-target provenance and the shared-engine `@sublang/playbook` runtime dependency recorded beside `xstate`; the Playbook dependency manifest and lock, all four definitions, all three bundles, and `slc.pins.json` shall be accepted only as one current set produced from a clean registry install without a sibling checkout ([DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-018](../decisions/018-playbook-3-1-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md), [DR-026](../decisions/026-slc-owned-pin-input-declarations.md), [DR-027](../decisions/027-complete-playbook-10-activation.md), [[pinning-15](pinning.md#pinning-15)]).

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

Where the `playbook` pipeline can produce a full-link linked artifact, when entry-module acceptance runs, the slc command shall produce the required outcome for each case:

| Case | Required outcome |
| --- | --- |
| `-o` relocates the linked artifact | Write no entry module [[self-hosting-15](#self-hosting-15)]. |
| `-o` is absent and the raw source aliases the canonical entry path | Preserve the bundle, preserve the source, omit the entry, and report the omission [[self-hosting-15](#self-hosting-15)]. |
| `-o` is absent; the entry path does not alias the raw source; and no two distinct declared role names collide case-insensitively | Write `<cwd>/<basename>.ts` default-exporting the source generation's registry entry — a historical `Players` fixture's schema-1 entry, or a `Roles` fixture's schema-3 entry advertising `artifactSchema: 3`, the `composed-v3` runtime profile, and the declared concurrent-role sets and composing the `{ configuredOptions, hostCapabilities }` factory argument — whose `id` is `<basename>` and whose `requiredRoleIds` equal the verbatim non-alias declared names, importing the linked module by its source-only relative specifier, and whose `createRuntime` returns a runtime that hands the host's `callPlayer` port only declared role ids — a lowercased declared id maps back to its declared form, an unknown id passes through, and the runtime's optional capabilities keep their presence [[self-hosting-15](#self-hosting-15)]; the entry performs the compiled workflow with no hand-written wiring through its generation's host [[self-hosting-14](#self-hosting-14)]. |
| `-o` is absent; the entry path does not alias the raw source; and two distinct declared role names collide case-insensitively | Fail entry emission with a diagnostic [[self-hosting-15](#self-hosting-15)]. |

#### self-hosting-10

When the slc command resolves the reserved `slc` and the `playbook` references, both shall produce the required outcome for the applicable case [[self-hosting-9](#self-hosting-9)]:

| Case | Required outcome |
| --- | --- |
| A pipeline search root holds a `playbook` directory vendoring the shared definitions. | Resolve both references to that vendored directory. |
| No search root provides a `playbook` directory. | Resolve both references to the definitions the installed `@sublang/playbook` provides. |

### Adoption acceptance

#### self-hosting-12

Where a clean registry install resolves exact `@sublang/playbook@10.0.0` and `@sublang/cligent@0.23.0` and the repository vendors the adopted shared definitions, when adoption acceptance runs, the reserved `slc` and `playbook` references shall both resolve to the vendored `text2gears`, `gears2fsm`, `link`, and `optimize` set byte-identical to that installed release with pin-input declarations carried by the SLC-owned sidecar, all three reviewed artifact bundles shall pass their generated verification and independent reviews as shared-factory schema-3 artifacts, every corresponding pin shall be current with exact 10.0.0 link-target provenance and the recorded shared-engine runtime dependency, and changing the Playbook dependency, any definition, bundle, or pin away from the Playbook 10 set shall make acceptance fail rather than pass a mixed version [[self-hosting-11](#self-hosting-11)].
