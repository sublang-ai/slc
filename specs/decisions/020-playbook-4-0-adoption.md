<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-020: Playbook 4.0 Adoption

## Status

Accepted.

## Context

- `@sublang/playbook` 4.0.0 is published. Its breaking change is dependency
  topology, not contract: the agent SDKs leave `dependencies`, and which SDK
  versions work becomes `@sublang/cligent`'s to publish and enforce —
  cligent 0.18.0 ships a runtime descriptor with per-adapter floors and
  pinned repairs, and gates them inside the loaders its probe and `run()`
  share (cligent DR-013, playbook DR-027).
- Everything SLC consumes is byte-identical between 3.1.0 and 4.0.0,
  verified against the published tarballs: the four `slc/*.md` phase
  definitions, `src/runtime.ts` and the `xstate-runtime` engine files
  (`RUNTIME_ABI` 1, `SUPPORTED_ARTIFACT_SCHEMAS` `[1]`), and every registry
  and captain declaration file. The engine gains exactly one additive
  export (`defaultBuildCaptainJudgePrompt`); the captain shells harden
  behind unchanged declarations.
- Staying on 3.1.0 keeps the defect this migration exists to end: 3.1.0
  hard-depends on `@openai/codex-sdk` `^0.139.0`, and a caret on a `0.x`
  version pins the minor, so every SLC install transitively froze Codex
  below the versions current models require — the
  `The 'gpt-5.6-sol' model requires a newer version of Codex` failure.
- With 4.0.0 the dependency closure installs no agent SDK at all: cligent
  declares them as optional peers, so npm skips them. SLC reaches agents
  only through cligent ([DR-004](004-slc-interpreted-phase-execution.md))
  and imports no SDK module, but live runs — the opt-in acceptance and the
  demo — need the SDKs present where cligent resolves them.

## Decision

### Provenance mapping

Exact `@sublang/playbook@4.0.0` link-target provenance selects the six-port
`composed-v2` profile, joining 0.10.0, 1.0.0, 2.0.0, and 3.1.0: 4.0.0 ships
`runtime.ts` byte-identical to 3.1.0's, with the same ABI and artifact
schemas, and its major version marks the SDK-topology break rather than any
runtime-contract change. `1.3.0`, `3.0.0`, and every other unreviewed
release remain fail-closed as unmapped
([[phase-execution-30](../packages/phase-execution.md#phase-execution-30)]).

### Atomic reviewed-asset adoption

The dependency range moves to `^4.0.0` with the lock resolving exactly
4.0.0, and `@sublang/cligent` moves to `^0.18.0` in the same unit — the
release whose descriptor owns the runtime-version policy. The vendored
definitions are verified unchanged against the 4.0.0 tarball, and the three
reviewed meta-phase bundles are retained rather than rebuilt: every input
the pins record for them — definitions, link target, engine — is
byte-identical, so a rebuild could only launder identical bytes through
nondeterministic runs. Pins regenerate with exact 4.0.0 provenance, moving
the lockfile hash and the installed-package identities. Manifest, lock,
definitions, bundles, and pins move as one reviewed set
([[self-hosting-11](../packages/self-hosting.md#self-hosting-11)]).

### Agent runtimes for repository verification

The repository supplies `@anthropic-ai/claude-agent-sdk` and
`@openai/codex-sdk` as `devDependencies` for its own opt-in live acceptance,
resolved by the lock like every other dev tool. The published `@sublang/slc`
declares no agent SDK in any dependency field: cligent's optional-peer
declaration is the single range npm checks, and a second copy could only
drift — drifting is exactly what froze Codex. Hermetic gates are unaffected;
they fake the agent layer.

### Version-coupled consumers

`demo/package.json` moves to `@sublang/playbook` `^4.0.0` in the same unit
and now also names the demo lineup's SDKs as its own dependencies: the demo
is a project-local install, and a project tree has no other way to place the
SDKs where its nested cligent resolves them — playbook's global-install
guidance does not reach inside a project's `node_modules`.

## Consequences

- The transitive Codex freeze ends structurally: no SLC install closure
  carries an agent-SDK range any more, so a vendor release never again
  requires an SLC change — floors and repairs arrive by upgrading cligent.
- Compiled artifacts pinned with 3.1.0 provenance keep running unchanged;
  artifacts pinned after this adoption carry 4.0.0 provenance and run the
  same `composed-v2` profile. Mixed dependency, definition, bundle, or pin
  sets still fail closed.
- A live phase run on a machine without a needed SDK now fails at
  playbook's preflight with cligent's pinned install command, instead of
  mid-run on a vendor error.
