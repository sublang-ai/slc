<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Incremental recompilation with complete snapshots.** Canonical full and
  full-link runs of ordinary pipelines now keep numbered, private builds under
  `<artifact-dir>/.slc/`, each with verbatim source and accepted phase-output
  copies. A re-run reuses a live output when its inputs are unchanged, gives a
  changed compile phase its recorded prior input plus a bounded best-effort diff
  as an update hint, or compiles ordinarily when no usable record exists; phase
  definitions need no update section and retain their normal acceptance rules.
  Any missing or corrupt member discards the whole build for selection. The
  active marker is removed before executor work and published only after the
  complete invocation succeeds, while `--rebuild` forces an ordinary fresh
  build. Runs using `-o`, the reserved `slc` meta-pipeline, a partial phase or
  pass, or direct link remain outside history selection and publication.

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
