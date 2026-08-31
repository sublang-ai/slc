<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-024: Adopt the Playbook 10 Schema-3 Contract

## Status

Accepted

## Context

[DR-020](020-playbook-4-0-adoption.md) made exact `@sublang/playbook@4.0.0` provenance select `composed-v2`, retained the three reviewed meta-phase bundles because every pin-recorded input was byte-identical to 3.1.0, and made `@sublang/cligent@0.18.0` the runtime-version authority.
Playbook published 5.0.0 through 10.0.0 without an SLC review of any intermediate release, while [DR-010](010-playbook-runtime-contract-evolution.md) requires every unreviewed provenance to fail closed without contract inference or initialization retry [[8]].
Playbook 10.0.0 retains six runtime ports and runtime ABI 1, but its linked contract is not `composed-v2`: linked artifacts carry schema 3, the engine supports schema 3 rather than schema 1, and a Captain-hosted factory receives exactly separate configured options and live host capabilities instead of the empty options object SLC supplies today [[1]][[2]][[3]].
Captain-hosted schema-3 capabilities contain authority, repository, and effect-ledger seams, while the runtime engine itself requires the effect ledger on every construction and consults only the repository's exclusive and deferred operations for governed player states; the runtime also adds the `unresolved-effect` result, terminal state descriptions, role bindings, retained-generation metadata, adoption and control operations, and unresolved-effect inspection [[2]][[3]][[7]].
The source language also changes from concrete `Players` to playbook-local `Roles`, removes `=` and `|` aliases, rejects declarations that collide after canonical lowercase-id derivation, and changes delegated FSM input from `player` to canonical `role` while adding role metadata, concurrent-role sets, and a controller decision-state class [[4]][[5]].
Playbook 10 also removes the positional registry-module argument from `playbook run`: an external entry is enabled under `playbooks.<id>.from`, its local roles are bound under `playbooks.<id>.roles`, and Boss invokes its effective slash command [[10]][[11]].
Those changes invalidate [DR-020](020-playbook-4-0-adoption.md)'s byte-identity premise even though `optimize.md` remains unchanged, and the current schema-1 bundles cannot run against the Playbook 10 engine merely because both generations report runtime ABI 1 [[9]].
Playbook 10.0.0 also depends on `@sublang/cligent@^0.23.0`, whose optional peers define the supported agent-SDK floors, while SLC's direct `@sublang/spex@^0.3.0` remains the separately reviewed compiled-grammar semantic input under [DR-016](016-gears-grammar-provenance.md) [[1]][[6]].

## Decision

### Immutable profile boundary

Exact `@sublang/playbook@10.0.0` link-target provenance shall select a new `composed-v3` runtime contract profile.
Absent provenance and exact 0.9.0 provenance shall continue to select `legacy`, and exact 0.10.0, 1.0.0, 2.0.0, 3.1.0, and 4.0.0 provenance shall continue to select `composed-v2`.
Exact 5.0.0, 6.0.0, 7.0.0, 8.0.0, and 9.0.0 provenance shall remain unmapped and fail closed with every other unreviewed provenance because reviewing 10.0.0 establishes no contract identity for an intermediate release.
The `composed-v3` profile shall construct a schema-3 linked runtime with exact separate configured options and live current-host capabilities; SLC's phase host shall supply an effect-ledger capability and a repository capability exposing `runExclusive` and `runDeferred` on every construction even though the engine consults that repository only for governed player states; the phase host shall initialize the same six-port causal root session with canonical local-role semantics and shall never serialize the live capabilities into options, machine input, or snapshots [[2]][[3]].
A shared-factory `composed-v3` implementation shall carry the factory's own immutable `createPlaybookRuntime.compat` record equal to `{ artifactSchema: 3, runtimeAbi: 1 }`, while a bespoke implementation shall instead carry the exact registry declaration `{ kind: 'bespoke', artifactSchema: 3 }` with no runtime-ABI claim [[2]][[3]].
Playbook's roleless session-Captain options-only wrapper is not a compiled phase artifact, and the phase host shall reject that wrapper rather than retry its exceptional public signature or infer a different profile [[2]].
The full authority, repository-observation, acquisition, and cohort contract belongs to a Captain-hosted registry entry rather than to SLC's root phase host, so it shall not impose a Git-worktree or lease-owner precondition on compiled phase execution [[2]][[3]].
The profile shall treat the first `callPlayer` argument as a canonical local role id, validate the schema-3 structured-result union including optional terminal `stateDescription`, and map `unresolved-effect` to a phase error rather than to success or `BLOCKED`.
SLC's compiled `composed-v3` phase host shall support any roleless shared-factory artifact that carries the required compatibility record, accepts exact empty configured options, and completes against a host-owned snapshot returning the exact detached empty effect-ledger value plus fail-closed `runExclusive`, `runDeferred`, and ledger-write seams; the three rebuilt roleless meta-phase artifacts are the instances SLC ships, not an artifact-identity allowlist.
The phase host shall reject a bespoke implementation or an artifact that lacks the required shared-factory compatibility record or requires a delegated role, runtime option, repository operation, or effect-ledger write; emitted role-bearing or bespoke playbooks remain runnable through a Playbook schema-3 host rather than through SLC's non-interactive phase host.
SLC's non-interactive phase host shall not initiate adoption or controller actions, and the presence of `adopt`, retained-generation metadata, `describe`, `apply`, or `unresolvedEffectEnvelopes` shall neither select a profile nor relax exact provenance checks.
The phase host shall continue to reject nested playbook execution deterministically because it owns no child stack.
Preparatory host and verification support may land while 10.0.0 remains unmapped, but the dependency and provenance mapping shall not activate until the complete adopted set below can move atomically.

### Roles and schema-3 output

SLC shall synchronize all four Playbook definitions from immutable 10.0.0 while retaining SLC's explicit `## Pin Inputs` sections.
Current compilation shall accept `Roles`, reject removed player-alias syntax and canonical-id collisions, preserve canonical lowercase local role ids through `meta.playbook.role` and `invoke.input.role`, and carry declared concurrent-role sets and the controller decision-state exception into deterministic verification [[4]][[5]].
Current entry modules shall advertise artifact schema 3, the linked factory's exact runtime profile, canonical `requiredRoleIds`, declared `concurrentRoleSets`, validated configured options, and a two-argument runtime factory that composes `{ configuredOptions, hostCapabilities }` at the linked-artifact boundary.
Entry emission shall support only exact Playbook 10.0.0 schema-3 closures and the reviewed exact 0.10.0, 1.0.0, 2.0.0, 3.1.0, and 4.0.0 schema-1 closures; absent provenance and every other provenance — including exact 0.9.0 and 5.0.0 through 9.0.0 — or a schema or factory declaration inconsistent with its exact reviewed provenance shall fail closed because a compiled-phase runtime mapping does not itself establish a compatible Playbook registry contract.
The schema-3 entry shall be enabled through Playbook configuration with every required local role bound to a configured player and shall be invoked through its effective slash command rather than as a positional `playbook run` module argument [[10]][[11]].
The schema-3 entry path shall remove [DR-017](017-playbook-2-0-thin-runtime-adoption.md)'s lowercase-to-verbatim player-binding shim because concrete player selection and prompt identity now enter through host-owned role bindings rather than emitted aliases.
Existing schema-1 artifacts shall retain their `Players`, `invoke.input.player`, and entry-binding semantics under their complete historical Playbook 4 or earlier dependency closure, and SLC shall neither relabel nor rehash them as schema-3 artifacts.

### Rebuild and pin closure

All three reviewed meta-phase bundles shall be rebuilt as shared-factory schema-3 artifacts through fresh interpreted real-agent `slc slc` runs from the synchronized definitions and shall pass every independently executed generated verification file before pin generation.
No bundle shall be retained under [DR-020](020-playbook-4-0-adoption.md)'s exception because the definitions, link emission, artifact schema, engine, and dependency lock are no longer one byte-identical input closure.
Regenerated pins shall close over the synchronized definitions, complete rebuilt bundle trees whose hashed artifact bytes contain the schema-3 construction contract and required shared-factory compatibility declaration, package lock, exact Playbook 10.0.0 link-target identity, and Playbook and XState runtime-dependency identities, while retaining the direct Spex 0.3 grammar identities required by [DR-016](016-gears-grammar-provenance.md).

### Atomic authority and consumers

The adopted state shall be one reviewed set containing the root manifest ranges `@sublang/playbook@^10.0.0` and `@sublang/cligent@^0.23.0` with the lock resolving exact 10.0.0 and 0.23.0, `composed-v3` host and verification support, schema-3 entry emission, all four definitions, the version-coupled normalization prompt, all three rebuilt bundles, regenerated pins, the demo manifest, every version-coupled demo reference and entry artifact, the demo's version-bearing documentation, and the installed-host acceptance path updated for configured-registry slash-command invocation.
Cligent 0.23.0 shall supersede 0.18.0 as the runtime-version authority, and every installed agent SDK shall meet its optional-peer floor — Anthropic `>=0.3.219`, Codex `>=0.144.0`, and OpenCode `>=1.18.12` — without requiring an absent optional adapter SDK to be added [[6]].
SLC's direct `@sublang/spex@^0.3.0`, its lock resolution, and its pin-recorded grammar paths shall not change; a transitive Spex 3 dependency inside Playbook's tooling closure shall not become SLC's compiled-grammar authority.
No mixed Playbook 4/10 dependency, definition, bundle, pin, entry, or demo set shall pass adoption review.

### Supersession

This decision supersedes [DR-020](020-playbook-4-0-adoption.md)'s exhaustive provenance map, Playbook 4.0 and Cligent 0.18 current-version authority, byte-identical bundle-retention decision, and exact-4 pin and demo adoption set.
For schema-3 output only, it also supersedes [DR-017](017-playbook-2-0-thin-runtime-adoption.md)'s verbatim source-name `requiredRoleIds`, lowercase-to-verbatim entry-binding shim, and positional demo invocation with `--player` role flags.
For schema-3 output only, it supersedes [DR-014](014-cwd-output-invocation-defaults-entry-emission.md)'s positional and default-agent `playbook run <entry> <task>` consequence while retaining deterministic entry emission and placement.
For `composed-v3` phase execution only, it supersedes [DR-005](005-slc-self-hosting-meta-pipeline.md)'s assumption that every compiled phase's player port is Cligent-backed; the full schema-3 Playbook host retains delegated-role execution.
[DR-010](010-playbook-runtime-contract-evolution.md)'s exact-provenance and fail-closed rules, [DR-011](011-playbook-1-0-captain-contract-adoption.md)'s atomic reviewed-set boundary, [DR-016](016-gears-grammar-provenance.md)'s direct Spex 0.3 grammar authority, and [DR-018](018-playbook-3-1-adoption.md)'s rebuild and independent-verification rule remain in force.

## Consequences

- A bare dependency bump fails closed: Playbook 10 becomes active only with the `composed-v3` host seam and the complete atomic asset set.
- Every current meta-phase and version-coupled demo bundle is rebuilt as schema 3 even though `optimize.md` itself is unchanged.
- Historical schema-1 artifacts remain meaningful evidence for their exact old closures but cannot execute through the Playbook 10 engine.
- Playbook 5.0.0 through 9.0.0 remain deliberately unsupported until a later decision reviews and maps an exact contract.
- The phase host acquires an explicit fail-closed repository and effect-ledger boundary and treats any unresolved effect as a failed compiler phase.
- A role-bearing phase that ran compiled under `composed-v2` does not migrate directly to compiled `composed-v3`: it must retain its complete historical dependency closure, remove its pin and run interpreted, refactor delegated work to direct Captain work, or run the emitted role-bearing artifact through a full Playbook schema-3 host until a later decision supplies SLC's governed repository and effect-ledger host.
- A schema-3 entry is still emitted without hand-written runtime wiring, but it must be enabled and role-bound in Playbook configuration before Boss invokes its slash command.

## References

[1]: https://github.com/sublang-ai/playbook/blob/v10.0.0/package.json "Playbook 10.0.0 package manifest"
[2]: https://github.com/sublang-ai/playbook/blob/v10.0.0/slc/link.md "Playbook 10.0.0 link definition"
[3]: https://github.com/sublang-ai/playbook/blob/v10.0.0/src/xstate-playbook-runtime.ts "Playbook 10.0.0 XState runtime engine"
[4]: https://github.com/sublang-ai/playbook/blob/v10.0.0/slc/text2gears.md "Playbook 10.0.0 text-to-GEARS definition"
[5]: https://github.com/sublang-ai/playbook/blob/v10.0.0/slc/gears2fsm.md "Playbook 10.0.0 GEARS-to-FSM definition"
[6]: https://github.com/sublang-ai/cligent/blob/v0.23.0/package.json "Cligent 0.23.0 package manifest"
[7]: https://github.com/sublang-ai/playbook/blob/v10.0.0/src/runtime.ts "Playbook 10.0.0 public runtime contract"
[8]: https://github.com/sublang-ai/playbook/blob/v10.0.0/CHANGELOG.md "Playbook changelog through 10.0.0"
[9]: https://github.com/sublang-ai/playbook/compare/v4.0.0...v10.0.0 "Playbook 4.0.0 to 10.0.0 source comparison"
[10]: https://github.com/sublang-ai/playbook/blob/v10.0.0/docs/cli.md "Playbook 10.0.0 CLI"
[11]: https://github.com/sublang-ai/playbook/blob/v10.0.0/docs/configuration.md "Playbook 10.0.0 configuration"
