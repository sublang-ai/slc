<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-068: Standalone Compilation Environment

## Status

Approved direction; implementation and delivery acceptance authorized by the user on 2026-11-17.
Amends [DR-009](009-slc-playbook-pipeline-compilation.md), [DR-014](014-cwd-output-invocation-defaults-entry-emission.md), [DR-020](020-playbook-4-0-adoption.md), [DR-039](039-strict-fsm-boundary.md), and [DR-061](061-consumer-supplied-playbook.md) only as stated below.

## Context

A globally installed compiler can load its own dependencies while its generated files cannot resolve those same packages from an empty destination.
An unrelated ancestor package can also classify generated TypeScript as CommonJS, and checking or importing a changed artifact in a reused process can observe the wrong module format or stale exports.
Agent-selected verification commands have treated missing ambient declarations and dependency diagnostics as workflow defects.
Bounded coverage can fail to discover a valid public input, which is insufficient evidence that a workflow is unreachable.

## Decision

- Normal SLC installation acquires both default Agent SDKs through the adopting Cligent release, with no duplicate SDK runtime ranges in SLC.
- Keep the required compatible Playbook peer and exact reviewed development provenance; no private conflicting engine is introduced.
- Give every workflow one internal environment; provide no independent/project modes or environment-selection flag, and do not select dependencies from surrounding project manifests.
- Prepare standalone artifacts through Playbook's shared environment service, using compiler-owned private ESM metadata and direct runtime links inside the artifact directory, without an npm project or registry install at the destination root.
- Select one Playbook/XState pair before Agent work, and use it for authoritative definitions, the default link target, generated imports, checking, and loading.
- Record that pair, compiler and source identities, compatibility, module formats, and entry location in a versioned build manifest; environment changes invalidate unchecked reuse.
- Emit a real JavaScript `.mjs` entry for new workflows; preserve historical `.ts` artifact consumption without introducing another compilation mode.
- Extend compiler-owned strict verification from FSM roots to linked and emitted entry modules; check changed revisions in fresh execution contexts and require safe entry initialization/disposal before acceptance.
- Distinguish environment failure, an established artifact defect, and incomplete verification; incomplete verification remains fail-closed without asserting semantic impossibility, and known return-contract omissions are checked at the producing GEARS boundary.
- Permit finite, recorded public-input witnesses for coverage, replayed from the real initial state under the existing limits; context patching alone is never reachability evidence.
- Keep phase commands, input/output identities, timing, exit status, reuse decisions, and final gate evidence inspectable, without making compiler archives required for runtime loading.
- Locate managed manifests through explicit entry metadata, reject a lost managed manifest without legacy downgrade, preserve the existing already-in-artifact layout, and add no blanket `-o` directory restriction.
- Verify packed global installations with separate real Codex and Claude cold-generation samples and an independent reuse check; retain each sampled outcome without claiming all natural-language generation is stable.
- Under the user’s narrowed 2026-11-18 acceptance scope, use Codex for the native-platform/parent matrix and only one successful simple-flow Claude/GLM compilation for workability; stop additional Claude scenarios and preserve their records as scope cancellations.
- Unpacked documentation-only integration does not replace the already immutable public candidate: compare every packed file and run current-head CI, without repeating unaffected model calls or publication; runtime-source or packed-file changes still need a new candidate.

- Pre-merge validation separates locally built/installed functional candidates from real branch prerelease registry installs, retaining stable publication gates without making a formal stable release a prerequisite.
- The shared compilation dependency/environment contract supports macOS, Linux and native Windows; POSIX-only historical front-end constraints do not exempt the native Windows compiler/library path.

## Consequences

Users can compile in an empty output directory after installing SLC once, without creating a Node project or installing project dependencies.
The compiler's own TypeScript, Node typings, and Agent SDKs remain distinct from an artifact's linked runtime environment.
The new entry extension requires coordinated SLC entry emission and Playbook loading support; adaptation or release gates for the separate `spex-playbook` Skill are outside this change.
Runtime links are machine-local and can require compatible repair or recompilation after global upgrades; portable dependency bundles are outside this change.
Extra local checks add bounded work and may expose real defects earlier, but neither SDK inclusion nor deterministic checking guarantees AI generation success or business-result quality.

## Implementation Evidence

Independent native checks reproduced a constructor bypass through an unrelated child IPC message and an actual loopback business write on Node 23.6, whose permission model does not restrict networking.
The SLC minimum is therefore Node 25.5.0, whose native network permission is checked before Agent work, while Cligent and Playbook retain their separate runtime floors.
Checker reports carry a private per-run capability and a complete validated envelope; artifact-visible IPC is not an acceptance signal.
A generated witness cannot establish the Source permission of its own arbitrary startup options, so a nonempty witness input without an independent Source contract remains unverified; events-only replay remains supported.

Native acceptance also exposed an occupied private manifest and actual proxy/workspace-routing refusals being labeled as artifact defects.
Their established environment cause is retained through failure reporting; unknown isolated-check exceptions remain checker failures rather than invented workflow defects.

Actual-initial replay exposed maintained bounded review loops that the former synthetic-context driver had bypassed. Repeated invocations therefore remain eligible only through actual transitions and newly reached actor starts, with every revisit charged to the unchanged configured depth, attempt and duration limits; no private snapshot or larger default budget substitutes for proof.

Maintained demo completion now records an explicit 64-invocation/1,024-attempt/900,000 ms proof policy after the smaller 12/256 policy exhausted finite exploration. Product defaults remain 8/64/300,000. Actual reached-context interrupts into the audited target, action-observed guard-free entry fields and progress-aware question scheduling close the observed gaps; unsearched public-event combinations remain unverified rather than receiving a reachability claim. Original demo FSM, GEARS and Source bytes are retained.

The independent meta-artifact review also exposed link’s legitimate required `definition` input. Caller-supplied bounded JSON `machineInput` is a separate host-owned API input, never an artifact export or context patch. The repository review supplies exact definition bytes only after its own current pin and compiled-execution contract establish DR-028 authority; ordinary workflows and nonempty artifact witnesses receive no inferred startup values.
