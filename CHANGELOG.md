<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Incremental compilation.** A full or full-link compile at its
  canonical output that runs any phase records a numbered build under
  `<artifact-dir>/.slc/` — a manifest plus verbatim copies of the
  source and the phase outputs it accepted, and no build at all when
  no accepted work survives; failed or rejected work is
  never recorded. An
  unchanged repeat prints `up to date` and calls no agent; after a
  source edit, each affected phase's agent receives the prior input, a
  best-effort unified diff, and the existing output to update in place, while
  phases whose inputs still match are reused byte-for-byte — including
  hand-refined artifacts, which become the baseline of the next update.
  A failed run keeps its completed phases and forgets any phase an
  executor may have touched — the history marker is removed durably
  before the first executor runs — so a retry resumes there and never
  trusts what a failed executor left behind; an abruptly interrupted
  run compiles fresh next time. An all-reuse repeat also re-derives the entry module and
  verification files, restoring them if deleted. History is advisory
  memory: corrupt or deleted `.slc/` state means a fresh compile, never
  an error, and the new `--rebuild` flag recompiles everything while
  still enforcing pin validation.
  `-o` outputs, the reserved `slc` meta-pipeline, and single-phase,
  standalone-pass, and direct-link runs stay outside history.
  ([DR-021](specs/decisions/021-incremental-compilation.md))

### Fixed

- **A compile target can no longer destroy its own input.** A target
  that is a symbolic link, physically the same file as a protected
  input — the same path or a hard link — or inside a protected
  directory is refused before the executor runs, instead of being
  detected only after the input was overwritten; deterministic
  derivatives refuse to write through symbolic links, and a raw `.ts`
  source named like the runnable entry is reported and left untouched
  instead of being overwritten by entry emission. The refusal covers
  everything the run writes and reads — exactly the files this
  invocation will emit, the pin index, every local path any pin
  record names (package locators included), the installed
  verifier-support sources, and the reserved `.slc`/`.slc-verify`
  directories, resolved prospectively so a symlinked alias with
  missing parents cannot slip through, with no directory created for
  a refused plan. A phase that swaps a
  protected file for byte-identical content still fails, a protected
  file the run cannot fully observe fails the phase before its
  executor runs, the published source is captured before any executor
  can touch it, and `.slc`/`.slc-verify` are only ever used as real
  directories — a symlinked store is foreign: never read as this
  bundle's history, never unlinked through, never written through.
  Planned writes — the directories a run creates included — are
  compared as prospective physical files, so aliased parents cannot
  make two absent writes coincide, and a source aliasing the runnable
  entry compiles with emission skipped instead of being refused.
  Reuse observes a recorded target atomically — the bytes it reads
  are the identity it records — and a recorded target that cannot be
  observed fails the run instead of being silently skipped.
- **A phase cannot succeed without producing its artifact.** A
  textually successful executor that left a pre-existing target
  untouched now fails the phase on both transports, so update mode can
  never record stale output as current.
- **Pass phases can be pinned.** `slc.pins.json` keys now accept any
  portable phase or pass name, so pinning a format-preserving pass such
  as `optimize` no longer makes the whole pin index unloadable.

## [0.3.0] - 2026-08-06

### Added

- **In-run progress reporting.** A compile now reports each phase on
  stderr as it starts and as its artifact lands with the elapsed time,
  streams a compiled phase's runtime status lines live instead of
  buffering them until the run ends, and emits a heartbeat so the
  terminal is never silent for more than 30 seconds while work is in
  flight. `runSlc` takes an optional progress sink; hosts that supply
  none keep the previous quiet behavior.
- **An agent-stall watchdog.** An agent call that observes no activity
  for `stallTimeout` seconds — the new config-file key, overridden by
  `SLC_STALL_TIMEOUT`, defaulting to 600 with `0` disabling — is
  aborted and reported as a failed phase naming the inactivity
  duration, instead of hanging indefinitely on a stalled session. The
  aborted call is never retried and a pinned phase still fails closed
  ([DR-019](specs/decisions/019-compile-progress-stall-watchdog.md)).

### Changed

- **Playbook 4.0 adoption: the transitive Codex freeze ends structurally.**
  The dependency ranges move to `@sublang/playbook` `^4.0.0` and
  `@sublang/cligent` `^0.18.0`. Playbook 4.0.0 no longer depends on any
  agent SDK — which SDK versions work is now cligent's to publish and
  enforce at load — so no SLC install closure carries an SDK range any
  more, and the `^0.139.0` caret that froze Codex below current models
  disappears with it. Exact `@sublang/playbook@4.0.0` link-target
  provenance selects the six-port `composed-v2` profile: the release ships
  `runtime.ts`, the shared engine, and all four phase definitions
  byte-identical to 3.1.0's, so the three reviewed meta-phase bundles are
  retained and every pin regenerates with 4.0.0 provenance as one reviewed
  set. The repository supplies the Claude and Codex SDKs as
  `devDependencies` for the opt-in live acceptance; the published package
  declares none. The demo now names its lineup's SDKs as its own
  dependencies — a project-local tree has no other way to place them where
  its nested cligent resolves — and couples to `@sublang/slc` `^0.3.0`
  ([DR-020](specs/decisions/020-playbook-4-0-adoption.md),
  [IR-020](specs/iterations/020-playbook-4-0-adoption.md)).

- Documented compile and run durations are now measured ranges stated
  as agent- and workload-dependent, replacing the "more than ten
  minutes" estimate.

## [0.2.0] - 2026-07-27

### Added

- An installed-package runtime smoke in the release checks — one Boss turn
  driven from a scratch consumer over fake host ports — and an opt-in
  `test:acceptance` gate that packs the candidate, compiles a minimal
  workflow with a real coding agent, runs the freshly compiled playbook
  with real agents, and verifies the repaired sample by compiling it.
- A self-contained `demo/` npm project with a contained, version-aligned
  install, and the Chinese demo reference set compiled through the pinned
  compiled pipeline — the same provenance as the English reference — with
  the demo checker now asserting the Boss task text reaches the first
  player prompt in both languages.

### Changed

- **Adopted Playbook 3.1.0 as one reviewed unit.** Exact
  `@sublang/playbook@3.1.0` link-target provenance selects the composed
  six-port profile (its `runtime.ts` is byte-identical to 2.0.0; 1.3.0 and
  3.0.0 stay fail-closed); the vendored `link.md` re-syncs the hardened
  judge-prompt envelope and `spec.compat` stamping; all three meta-phase
  bundles are rebuilt from the synced definitions, so artifacts compiled by
  the vendored pipeline now declare their runtime compatibility and fail
  fast on a mismatched engine; every pin regenerates with 3.1.0 provenance.
- **The documented consumption model is global-first.** Playbook 3.1
  provisions its own engine beside a filesystem artifact whose imports do
  not resolve, so the README leads with `npm install -g` and bare CLI
  invocations; a project's own install remains authoritative wherever it
  resolves, and the build now clears generated output before compiling so a
  superseded artifact cannot reach the tarball.

## [0.1.0] - 2026-07-21

### Added

- Agent-executed Markdown phase pipelines with deterministic chaining,
  configuration discovery, and Claude Code, Codex, Gemini, and OpenCode
  adapters.
- Self-hosted compiled phase execution with reviewed artifacts, exact-byte
  pins, dependency closure hashing, and fail-closed provenance selection.
- The `playbook` compiler pipeline from prose through normalization, GEARS,
  XState FSM, optimization, linked runtime, registry entry, and generated
  verification suites.
- Project-local configuration seeding and an English two-agent review-loop
  reference compile.
- CI-gated npm publication with provenance: an interactive first publication
  by a maintainer, then token-free OIDC for every later release.

### Fixed

- Bound runtime-resolved player IDs back to source-declared role IDs.
- Preserved nullish Playbook host-port rejections as control-plane failures.
- Made demo repository-root initialization safe inside a containing checkout.
- Rejected unrelated shared-engine imports as pinned runtime factories.

[Unreleased]: https://github.com/sublang-ai/slc/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/sublang-ai/slc/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sublang-ai/slc/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sublang-ai/slc/releases/tag/v0.1.0
