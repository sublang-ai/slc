<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-016: GEARS Grammar Provenance from @sublang/spex

## Status

Accepted

## Context

The gears artifact grammar is Playbook's specialization of the GEARS pattern, and its definition file cites the pattern through the root-relative link `/specs/meta.md#item-syntax`.
That link rebinds per repository: in the vendored copy it resolves to this repo's own `specs/meta.md` — a drifted spex scaffold output — and `text2gears.md`'s `## Pin Inputs` accordingly hash this repo's `specs/meta.md` and `specs/decisions/000-spec-structure-format.md` as the grammar's pinned identity.
Two defects follow: the compile pins record a local, unversioned copy as the grammar authority, and editing this repo's own spec-authoring conventions stales the compile pins.

The GEARS pattern is maintained by spex and ships in the published `@sublang/spex` package as scaffold data, in English (`scaffold/specs/meta.md`) and Chinese (`scaffold/i18n/zh/specs/meta.md`); the package declares no `exports` map, so those subpaths resolve directly.
Playbook (upstream owner of the artifact grammar) repoints `text2gears.md`'s citation to the spex-shipped definition and states the unified language rule — source-language prose, fixed-English machine syntax — in that same place.

## Decision

- The vendored `text2gears.md`'s `## Pin Inputs` replace `../../specs/meta.md` and `../../specs/decisions/000-spec-structure-format.md` with the spex-shipped GEARS definitions: `../../node_modules/@sublang/spex/scaffold/specs/meta.md` and `../../node_modules/@sublang/spex/scaffold/i18n/zh/specs/meta.md`.
- `@sublang/spex` becomes a runtime dependency, so the pinned grammar identity is the published package's content, versioned through the dependency lock like every other semantic input.
- This repo's `specs/meta.md` governs only its own spec authoring and leaves the compile-pin closure.
- The host's parsing surface is unchanged: `slc` remains agnostic of the natural-language GEARS pattern (it never parses condition prose) and continues to verify only the fixed-English machine syntax the artifact grammar defines.

## Consequences

- The grammar a compile is pinned against is the published spex artifact in both languages, matching how the link target pins `@sublang/playbook` content.
- A spex release adopted through the lock stales all compile pins at once — a second atomic release coupling, identical in shape to the existing playbook coupling.
- Spec-authoring edits in this repo no longer invalidate compile pins.
- Chinese-language sources compile against an authoritative Chinese GEARS definition rather than agent improvisation; language detection stays agent-implicit per the normalization definition.
