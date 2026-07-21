<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-017: Adopt the Playbook 2.0 Thin-Runtime Generation

## Status

Accepted

## Context

[DR-011](011-playbook-1-0-captain-contract-adoption.md) finalized the six-port `composed-v2` profile and mapped exact immutable `@sublang/playbook@1.0.0` provenance to it, and the committed definitions, reviewed meta-phase bundles, dependency lock, and pin index form one 1.0.0 provenance set.
Playbook has since published 1.3.0 and 2.0.0 together [[1]].
Playbook 2.0.0 keeps the six-port causal-session init boundary, the structured turn result, and `resumePlaybookCall` unchanged, so it does not alter any surface the `composed-v2` profile gates.
It changes three things SLC observes.
First, a failing host Captain reply now resolves `handleBossInput` with the structured `failed` outcome instead of rejecting the public boundary, while non-abort thrown ports, malformed host results, and rejecting trace sinks remain control-plane rejections (Playbook PBRT-47 [[2]]).
Second, Playbook DR-019 makes `slc/link.md` emit one thin linked module per playbook — the FSM import, a derived options interface, shared-contract re-exports, and a default-exported `createXStatePlaybookRuntime(machine, spec)` factory call — so a linked artifact's executable closure now includes the shared engine at `@sublang/playbook/xstate-runtime` beside `xstate` [[3]].
Third, the release raises the registry dependency closure to `@sublang/cligent` `^0.16.0`, whose contract keeps the explicit player resume and isolated tool-restricted Captain calls SLC's ports already implement.
Playbook 1.3.0 is an intermediate release SLC never installed; no SLC-reviewed artifact carries or will carry its provenance.
Separately, [PHEXEC-30](../dev/phase-execution.md#phexec-30) still names only `@sublang/playbook@0.10.0` for `composed-v2` while the configured selector and the test spec also accept `1.0.0`, a wording drift this adoption must close.
Finally, the demo exposed a role-identity gap between two published contracts: `text2gears` capitalizes English player names, so [SELFHOST-15](../dev/self-hosting.md#selfhost-15) emits `requiredRoleIds` like `Coder` verbatim, while `slc/link.md`'s default player binding resolves acting players to their lowercased names and Playbook's `playbook run` host keys its agents by the verbatim ids with exact-case `callPlayer` lookup — so a cased English source fails at its first delegated state (`unknown player coder`) even though caseless sources run.

## Decision

### Immutable profile boundary

SLC shall adopt exact immutable `@sublang/playbook@2.0.0` provenance as the existing six-port `composed-v2` profile, unchanged in init shape, structured-result contract, player-continuation enforcement, and `resumePlaybookCall` surface.
The complete mapped set becomes: absent provenance and exact `@sublang/playbook@0.9.0` select `legacy`; exact `@sublang/playbook@0.10.0`, `@sublang/playbook@1.0.0`, and `@sublang/playbook@2.0.0` select `composed-v2`.
`@sublang/playbook@1.3.0` shall not be mapped: SLC never installed it, no reviewed artifact records it, and DR-010's fail-closed rule governs it like every other unmapped provenance, without shape inference or initialization retry.
PHEXEC-30 shall be corrected to state this complete mapped set, closing its current 0.10.0-only drift from the configured selector.

### Captain-failure result semantics

A 2.0.0 runtime delivers a failing host Captain reply as the structured `failed` outcome, which [DR-010](010-playbook-runtime-contract-evolution.md#phase-result-mapping)'s existing mapping already turns into the phase `error` result; no new mapping row is added.
The host's thrown-turn error path remains reserved for what PBRT-47 keeps as control-plane rejections: non-abort thrown ports, malformed host results, and rejecting trace sinks.
SLC's `callCaptain` port shall keep returning Playbook's Captain status, final text, and error shape as a resolved host result rather than throwing, so the runtime — not the host — decides failure routing.
Because immutable 2.0.0 cannot retain `null` or `undefined` in its nullish-coalescing control-error latch, SLC's `composed-v2` port boundary shall replace any non-abort nullish host-port rejection with a deterministic `Error` before it reaches the runtime; every non-nullish rejection and any rejection causally identical to the active abort reason cross unchanged.

### Thin linked artifacts and pin closure

The thin linked artifact remains loadable through the unchanged callable `createPlaybookRuntime` default-export contract, and SLC shall keep treating the module as opaque rather than inspecting its factory internals.
Because the emitted module executes through the shared engine, each pin's recorded out-of-bundle runtime dependencies shall include the `@sublang/playbook` package (resolved from the artifact's own location, like `xstate`) so the pinned identity covers the machinery a runtime fix would change ([DR-007](007-slc-phase-artifact-pinning.md), [DR-010](010-playbook-runtime-contract-evolution.md)).
Generated verification keeps running at the destination with the destination's own package resolution, now covering `@sublang/playbook/xstate-runtime` in addition to `xstate`.

### Registry-entry role binding

The deterministic entry module is SLC-owned host glue ([DR-014](014-cwd-output-invocation-defaults-entry-emission.md)), and it shall close the role-identity gap at the host boundary it already owns.
`requiredRoleIds` stay the source-declared player names verbatim, keeping the documented `--player <Player>=…` bindings true to the source.
The emitted `createRuntime` shall return the linked runtime behind a role-binding boundary: sessions passed to `init` — and to `restore` when the runtime offers it — carry a `callPlayer` port that maps a runtime-resolved player id back to its declared role id (lowercased declared id → declared id, unknown ids passed through), while every other port, member, and optional capability crosses unchanged, so the host observes only ids from `requiredRoleIds`.
For caseless player names the map is the identity, so existing flows are byte-for-byte unaffected in behavior.
Two declared players that collide case-insensitively make the binding ambiguous; the emission shall fail closed with a diagnostic instead of emitting a colliding map.

### Atomic reviewed-asset adoption

The dependency manifest and lock (`@sublang/playbook@^2.0.0`, `@sublang/cligent@^0.16.0`), the vendored `text2gears`, `gears2fsm`, `link`, and `optimize` definitions, all three reviewed meta-phase artifact bundles, and `pipelines/playbook/slc.pins.json` shall move to Playbook 2.0.0 as one review unit.
The definition refresh shall start from the immutable installed package, retain SLC's explicit `## Pin Inputs` including the DR-016 spex-shipped grammar identities, rebuild all three bundles as thin linked modules, independently run all generated verification, and regenerate pins with exact `@sublang/playbook@2.0.0` link-target provenance.
The adoption shall run from a clean registry install and shall not read a sibling checkout; no mixed 1.0.0/2.0.0 definition, artifact, dependency, or pin set shall pass review or be committed as the adopted state.
The demo reference sets shall be recompiled against the adopted set: the English reference immediately, through the documented `slc playbook workflow.txt` → `playbook run ./workflow.ts` flow including the documented role flags, and the Chinese reference by the maintainer from the released packages.

## Consequences

- SLC executes 2.0.0 thin artifacts through the existing `composed-v2` host without a new profile, and a Playbook runtime fix reaches compiled phases through an ordinary atomic version bump instead of a re-link.
- A host Captain failure surfaces through the structured `failed` mapping (`compiled runtime failed: …`) instead of the thrown-turn diagnostic (`compiled run failed: …`), while control-plane rejection diagnostics keep their meaning.
- Even a host port that rejects without an error value remains a thrown control-plane failure at the SLC boundary instead of being misreported as an authored `failed` outcome.
- Pins bind the shared engine's identity, so shared-machinery changes stale pins the way link-target changes always have.
- Cased English sources run end to end under Playbook's published `playbook run` host, with `--player` flags matching the names the README documents; caseless sources keep their exact prior behavior.
- 1.3.0 and every other unadopted provenance stay fail-closed, keeping the profile map a record of reviewed adoptions rather than of releases.
- PHEXEC-30's stated provenance set matches the configured selector again.

## References

[1]: https://github.com/sublang-ai/playbook/blob/v2.0.0/CHANGELOG.md "Playbook CHANGELOG 2.0.0 / 1.3.0 (2026-07-20)"
[2]: https://github.com/sublang-ai/playbook/blob/v2.0.0/specs/dev/playbook-runtime.md#pbrt-47 "Playbook PBRT-47: Captain host failure resolves the failed outcome"
[3]: https://github.com/sublang-ai/playbook/blob/v2.0.0/specs/decisions/019-shared-linked-runtime-factory.md "Playbook DR-019: Shared linked-runtime factory"
