<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# completion: Retained Bundle Completion

## Intent

This package specifies deterministic verification and derived-output emission for an explicitly selected retained Playbook bundle under [DR-054](../decisions/054-deterministic-bundle-completion.md).
It owns neither phase execution nor proof of the retained bundle's compilation or semantic review.

## External Behavior

### completion-1

When the user runs `slc playbook <source> --complete`, the slc command shall select the entry-form Source named explicitly and the canonical GEARS, FSM, and linked module under the invocation-directory rule [[pipeline-6](pipeline.md#pipeline-6)], [[pipeline-7](pipeline.md#pipeline-7)], [[pipeline-15](pipeline.md#pipeline-15)], accepting only optional `--link <target>` to declare the retained link target otherwise defaulted to the installed runtime [[self-hosting-13](self-hosting.md#self-hosting-13)], requiring the declared text `.md` → GEARS `.md` → FSM `.ts` → Playbook `.ts` formats and a regular-file runtime target, and refusing other pipelines, named phases, raw input, `-o`, normalization, optimization, rebuilding, and link options.

### completion-2

When completion resolves its pipeline, the slc executable shall apply existing config discovery, schema validation, and environment-over-file precedence [[cli-22](cli.md#cli-22)] to the pipeline search path without seeding a config, selecting or constructing an agent, invoking an executor, or falling back to a compile.

### completion-3

Where all selected artifacts are readable regular files, when completion checks them, the slc command shall require the current-bundle checks to succeed before writing a derived output:

| Check | Required boundary |
| --- | --- |
| Source and GEARS | Authored prompt conservation [[verification-25](verification.md#verification-25)] and GEARS actor/result/role validity [[verification-1](verification.md#verification-1)]. |
| FSM | Strict TypeScript [[verification-33](verification.md#verification-33)], GEARS conformance [[verification-1](verification.md#verification-1)], schema/continuation [[verification-21](verification.md#verification-21)], [[verification-35](verification.md#verification-35)], child suspension [[verification-45](verification.md#verification-45)], and actual transition coverage [[verification-6](verification.md#verification-6)]. |
| Linked module | Reconciled artifact schema and prompt composition [[verification-27](verification.md#verification-27)], resolved imports [[verification-18](verification.md#verification-18)], a declared FSM object edge value-importing the selected TypeScript artifact rather than its JavaScript sibling, and callable/type-compatible validation when present while retaining historical option fallback [[self-hosting-17](self-hosting.md#self-hosting-17)]. |

### completion-4

When completion loads or probes a selected module during validation or content preparation, the slc command shall detect changes to its selected Source, artifacts, definitions, link target, and discovered local semantic and pin-validation inputs through before/after path identities [[phase-execution-3](phase-execution.md#phase-execution-3)], fail before completion output on mutation even after a probe error, and make no guarantee of reversing arbitrary module side effects.

### completion-5

Where current-bundle checks and preparation of every promised file succeed and every derived target passes physical alias protection [[phase-execution-42](phase-execution.md#phase-execution-42)], when completion emits outputs, the slc command shall emit artifact-local verification support and tests [[verification-2](verification.md#verification-2)], [[verification-4](verification.md#verification-4)], [[verification-5](verification.md#verification-5)], [[verification-6](verification.md#verification-6)] and a registry entry derived from the explicit Source and GEARS through the retained entry boundary [[self-hosting-15](self-hosting.md#self-hosting-15)], [[self-hosting-17](self-hosting.md#self-hosting-17)], report only those output paths and a current-bundle/no-phase-execution diagnostic, and leave authored artifacts and build history unchanged without asserting prior compilation, semantic review, host registration, or runtime acceptance, while an output-write failure reports failure and the paths already written without claiming rollback.

## Verification

### completion-6

Where real English and Chinese retained bundles, a historical validator-free bundle, and absent or existing history are supplied, when the public executable completes them without credentials, it shall emit loadable entries with source-language metadata and the normal verification files [[completion-1](#completion-1)], [[completion-3](#completion-3)], [[completion-5](#completion-5)], run those verification files and the actual factory contract checks successfully [[completion-3](#completion-3)], construct no agent or seeded configuration [[completion-2](#completion-2)], and preserve the selected input and history bytes [[completion-4](#completion-4)], [[completion-5](#completion-5)].

### completion-7

Where real retained bundles are altered by missing files, malformed Source/GEARS, invalid FSM typing or continuation or reachability, incompatible linked composition/schema/options, unresolved imports, a declared FSM JavaScript edge including a valid stale sibling, a declared FSM edge naming any file other than the selected TypeScript artifact or no value edge to it, physical target aliases, or probe input mutation including before an exception, when completion runs, it shall fail before writing derived outputs with an actionable reason [[completion-3](#completion-3)], [[completion-4](#completion-4)], [[completion-5](#completion-5)], while an unused JavaScript sibling remains admissible [[completion-3](#completion-3)] and incompatible flags and invocation forms are refused [[completion-1](#completion-1)].
