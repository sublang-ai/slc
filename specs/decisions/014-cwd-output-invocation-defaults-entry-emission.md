<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-014: CWD Output, Invocation Defaults, and Entry-Module Emission

## Status

Accepted

## Context

AI compilation is nondeterministic: recompiling a source whose reference bundle is committed beside it ([DR-001](001-slc-pipeline-layout-naming-invocation.md#output-locations)) overwrites reviewed artifacts in place with byte-different output.
Classic compilers solve this with out-of-tree builds: outputs follow the invocation, not the source.

The canonical raw-prose invocation carries three flags — `--normalize -O --link <path>` — although each has exactly one sensible value for the `playbook` pipeline, and the `--link` path reaches into `node_modules/`.

[DR-009](009-slc-playbook-pipeline-compilation.md) scoped the registry entry to Playbook host infrastructure, so every compiled playbook needs one hand-written module before `playbook run` can perform it.
Playbook 1.0's `run` CLI consumes any module whose default export matches its registry-entry shape (`id`, `command`, `intent`, `requiredRoleIds`, `validateOptions`, `createRuntime`), defaults every player and the captain per its PBCLI-19, and accepts the task as a positional — so a deterministically derivable entry module is the only missing piece between a compiled bundle and a running workflow.

## Decision

### 1. Artifact directory from the invocation CWD

Supersedes [DR-001 §Output locations](001-slc-pipeline-layout-naming-invocation.md#output-locations) placement; naming is unchanged.

- `<art-dir>` = `<cwd>/<basename>.<pipeline>/`, where `<cwd>` is the invocation working directory.
- When `<cwd>`'s leaf name is exactly `<basename>.<pipeline>`, `<art-dir>` = `<cwd>` — no nesting, so re-runs invoked inside the artifact directory land in place.
- Sources are read wherever they live; only outputs move. The rule is uniform across pipelines and invocation forms (full, single-phase, standalone pass, single-object `.link` placement).
- `-o` overrides and every in-directory naming rule (DR-001 artifact names, [DR-013](013-normalize-and-pass-phases.md) `.raw`/`.opt` names) are unchanged.

### 2. Raw entry sources

Extends [DR-013 §2](013-normalize-and-pass-phases.md); amends DR-001's source-name refusal for the entry role only.

- An entry source whose extension differs from the entry phase's declared extension is a **raw input**: `<basename>` is its name minus the actual extension, and generic normalization is scheduled as if `--normalize` were given.
- Sources with the declared extension behave as before; `--normalize` remains available for them; non-entry sources keep the strict refusal.

### 3. Optimization passes on by default

Amends [DR-013 §1](013-normalize-and-pass-phases.md) ("passes run only on request").

- Full and full-link invocations schedule every discovered pass by default.
- `--no-optimize` runs the chain without passes; `-O`/`--optimize` stays accepted and now states the default.
- Standalone pass invocation and the single-phase refusals are unchanged.

### 4. Default link target for the reserved playbook pipeline

Amends [DR-002 §CLI](002-slc-link-phases.md#cli) ("default link targets are not supported") for the reserved `playbook` pipeline only.

- A full invocation of the reserved `playbook` pipeline without `--link` runs the full-link form against the installed `@sublang/playbook` runtime contract module (the package's `src/runtime.ts`, located by the same package resolution the pin generator uses).
- Every other pipeline keeps DR-002: without `--link`, the run stops at the compile-chain output.

### 5. Entry-module emission

Supersedes the "registry entry" item of [DR-009](009-slc-playbook-pipeline-compilation.md)'s host-infrastructure scoping; the captain shell, launcher, and config template remain Playbook-side.

- After a successful full-link of the reserved `playbook` pipeline with the linked artifact at its canonical path, `slc` deterministically emits `<cwd>/<basename>.ts` — a runnable entry module whose default export satisfies Playbook's registry-entry contract.
- Field derivation:

| Field | Derivation |
| --- | --- |
| `id`, `command` | `<basename>` — stable across recompiles, as parked-session resume requires |
| `requiredRoleIds` | the source-declared players, verbatim in source order (the FSM's player union) |
| `intent` | the normalized source's title and lead line, in the source language |
| `validateOptions` | fail-closed allowlist of the linked options interface minus Boss-turn inputs (`cwd` exactly when the FSM has a script state) |
| `createRuntime` | the linked module's default factory, called with `cwd ?? process.cwd()` |

- The module is erasable TypeScript and imports the linked module by the source-only relative specifier `./<basename>.<pipeline>/<basename>.playbook.ts`, so the pair is relocatable together.
- `<basename>.ts` is a deliberate carve-out from the `<art-dir>/<basename>.<format><ext>` scheme: the entry module is the pipeline's runnable product beside the bundle, mirroring a compiler emitting the executable beside its build directory.
- Emission is skipped when `-o` relocates the linked artifact, like verification emission.

## Consequences

- `cd demo && slc playbook workflow.zh.txt` reproduces the committed bundle and its entry with zero flags: raw input → normalize → chain → passes → link → entry module.
- `playbook run ./workflow.zh.ts "<task>"` performs it; players and the captain default per Playbook's PBCLI-19, so only the roles a user wants to change need `--player`.
- Compiling someone else's source from any other directory leaves its committed bundle untouched — the out-of-tree property.
- Committed reference bundles regenerate in place only when `slc` is invoked from their own directory; meta-pipeline rebuild flows and docs must anchor their CWD accordingly.
- Until the optimize pass is pinned, default-on passes add one interpreted agent step to otherwise-pinned playbook runs; `--no-optimize` opts out.
- Tests and tooling that pinned DR-001's beside-source placement re-anchor to the CWD rule.
