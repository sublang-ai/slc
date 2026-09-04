<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-09-04

### Added

- **A deterministic Source-fidelity gate runs before the Reviewer.** The
  text2gears phase must conserve every prompt fragment the Source
  authors, yet a reviewed compile of a maintained playbook produced an
  item whose prompt lines the Source never authored and the Reviewer
  accepted it. Outside the reserved meta-pipeline, the host now checks
  each text2gears output mechanically against the invocation Source —
  fenced instruction blocks and blockquotes reach the GEARS verbatim and
  in Source order, and an unauthored prompt line is an invention — and
  relays the numbered findings to the Coder in place of that round's
  Reviewer call, counting them as one permitted call and failing an
  unreviewed phase closed. The same hook runs under compiled execution,
  so the compiled text→gears performing call gets the identical
  correction round. The check also requires a result description to name
  its output properties by the ASCII identifier pattern, since downstream
  artifacts and calling playbooks consume them by name; a quoted
  kebab-case property is a finding
  ([DR-029](specs/decisions/029-source-fidelity-gate.md)).

- **A deterministic link-fidelity gate runs before the Reviewer.** The
  emitted prompt-contract suite ran only after the link phase was
  accepted, so its checks arrived too late to correct the Coder — one
  reviewed compile accepted a linked module after three hours whose
  synthesis state composed its prompt under the wrong role identity. The
  host now runs those same checks on the live linked module beside its
  FSM before any Reviewer call: the module imports and its factory
  constructs, and every player-invoking state's prompt composer yields
  the authored prompt on an ordinary turn with each placeholder
  substituted per the link contract. Findings are relayed to the Coder
  under the same mechanical protocol
  ([DR-030](specs/decisions/030-link-fidelity-gate.md)).

- **A failed run names what it kept and how to continue.** A run that
  fails partway keeps its accepted live phase targets, but the
  diagnostics said nothing about them, so salvaging one meant guessing.
  The failure report now names the accepted phases and the single-phase
  invocation that resumes from the last one, so manual recovery needs no
  recovery state
  ([DR-021](specs/decisions/021-incremental-compilation.md)).

- **An output-less compiled terminal reports a recoverable reason.** A
  compiled phase that reaches an authored terminal producing no output —
  a rejected link, for instance — reported nothing to act on. It now
  names the reached state and carries the performing call's last text,
  the way a failure does.

### Changed

- **Playbook 12.2.2 is the adopted release.** `@sublang/playbook` moves
  to `^12.2.2` as a routine contract-based adoption — 12.2.2 also binds the
  governed worktree lazily, which the acceptance gate's scripted `git init`
  run stage requires: the four vendored
  definitions are byte-identical to that release — a nested-call item
  carries no `Results:` label, output property names are identifiers, and
  an empty relay composes no quoted line — and the pins were regenerated
  with the new provenance. Every definition's `## Compiled execution`
  section is preserved verbatim, so the three meta-phase bundles were
  retained and re-verified against the installed engine rather than
  rebuilt
  ([DR-028](specs/decisions/028-contract-based-adoption-without-recompilation.md)).

### Fixed

- **The acceptance gate's lineup can edit and commit.** The gate bound its
  scratch players with adapter, model, and effort only, so a Claude player
  fell to Claude Code's ask-everything default, could not apply its fix in
  the scratch repository, and parked the run on a Boss question; every bound
  agent now carries cligent's protected auto permission mode, the posture
  the Playbook host's seeded template gives every agent.

- **Control calls stay isolated on an agent CLI without tool lists.** A
  compiled phase's hidden judge call and routing-only Captain call ask for
  an empty tool allowlist to run tool-free, which Cligent's `codex`,
  `kimi`, and `opencode` adapters refuse outright — so every `SLC_AGENT=codex`
  compiled run died at its first judge call with "cannot enforce explicit
  allowedTools". The host now decides where that request can be honored:
  the empty allowlist still reaches an adapter with a provider-enforced
  tool-restriction surface and an unrecognized adapter alike, and is omitted
  for those three, whose isolation then rests on the artifact's authored
  hidden-control prompt envelope — a documented reduction in enforcement,
  not an equivalence. A non-empty restriction is never substituted and
  still fails closed
  ([DR-012](specs/decisions/012-playbook-routing-control-separation.md)).

- **A narrated correction survives review.** The private correction
  envelope is now the last complete top-level JSON object in the Coder
  reply — bare or inside one lone `json`/unlabeled fence — with any
  narration before it ignored, because an adapter may join an agent's
  progress commentary ahead of its final message and a commenting Coder
  then lost a whole reviewed compile to a fail-closed "not one JSON
  object". Every structural rule is unchanged, and a reply with no
  complete object, a second object adjacent to the last, or any
  non-whitespace text after the object still fails closed with a precise
  reason ([DR-022](specs/decisions/022-two-agent-reviewed-compilation.md)).

- **A reasoned Reviewer approval is still an approval.** A Reviewer that
  prefaced `NO_FINDINGS` with its rationale failed the approved call
  closed; the verdict is now read from the end of the reply, matching the
  correction-envelope rule. The Reviewer prompt also confines inspection
  to the request's workspace, so review cannot wander outside the
  material under review
  ([DR-022](specs/decisions/022-two-agent-reviewed-compilation.md)).

- **A transient Reviewer transport error no longer discards a finished
  phase.** One errored Reviewer call threw away a completed Coder phase.
  An errored call is now retried once after a short pause, and only a
  repeated error fails the performing call closed. A stall-watchdog abort
  is excluded: it is marked structurally on the result and still fails
  the performing call closed after a single run.

- **The prompt-contract check stops rejecting valid artifacts.** It
  refused any prompt identity lookup other than the acting role and
  synthesized array-typed context fields as strings, so three maintained
  playbooks that pass real runs failed it. The lookup now rejects only
  undeclared roles, and an ordinary turn's input starts from the
  machine's initial context, preserving each field's authored type
  ([DR-030](specs/decisions/030-link-fidelity-gate.md)).

- **The emitted entry names its roles the way the host binds them.** A
  current `Roles:` source compiles to a machine that delegates by the
  canonical lowercase local role id, but the generated registry entry
  declared `requiredRoleIds` by the source display name — so `playbook
  run` refused the entry outright ("must use a canonical lowercase local
  role id") and no compiled workflow could be bound. The entry now
  declares exactly the ids its machine delegates to and returns the
  linked factory's runtime unchanged, with no translation left at the
  `callPlayer` port; a historical `Players:` source keeps its verbatim
  names and role-binding boundary. Both demo reference entries are
  regenerated
  ([DR-024](specs/decisions/024-playbook-10-schema-3-adoption.md)).

- **The opt-in acceptance gate stops touching the maintainer's home.** It
  isolated only `XDG_CONFIG_HOME`, but the installed Playbook host reads
  its shared configuration under the Spex root and its session store
  under `XDG_STATE_HOME` — and relocates a configuration found at the
  former path into that Spex root, which is how a gate run moved its own
  scratch config into the maintainer's home. The gate now writes its
  configuration where the host reads it and points `SPEX_HOME`,
  `XDG_STATE_HOME`, and `XDG_CONFIG_HOME` into the scratch tree, so a run
  reads, writes, and relocates nothing personal but adapter
  authentication. The deterministic release audit checks it.

- **The emitted entry declares the runtime profile the host reads.** The
  generated registry entry advertised `composed-v3` — slc's own internal
  contract marker — where the Playbook host requires an implementation
  declaration, so it refused every generated entry ("runtimeProfile must
  be a plain object"). The entry now emits
  `{ kind: 'shared-factory', compat }` carrying the linked factory's own
  captured `{ artifactSchema, runtimeAbi }` record, and both demo
  reference entries are regenerated. The demo reference check gained a
  stage that offers each committed entry to the installed host's own
  registry validation under scratch Spex, state, and configuration homes
  — it lists the English entry and pins the Chinese one's known refusal
  by its non-ASCII role key — so a manifest field only the host reads can
  no longer pass `release:check`
  ([DR-024](specs/decisions/024-playbook-10-schema-3-adoption.md)).

## [0.7.0] - 2026-09-02

### Added

- **Adapter-scoped fast mode for the Coder and the Reviewer.** `fastMode`
  and `reviewerFastMode` — plain YAML booleans — with `SLC_FAST_MODE` and
  `SLC_REVIEWER_FAST_MODE` (exactly `true` or `false`; anything else refuses
  the run naming the variable) request an agent CLI's fast mode the way
  `effort` selects reasoning effort: a non-blank environment value wins over
  the file, `false` is a literal request, and omission keeps the agent CLI's
  default. Cligent's fast-mode capability contract decides support — a
  literal on an adapter it reports unsupported refuses the run naming the
  adapter before any agent call, and slc keeps no support list of its own.
  The accepted literal rides every interpreted, compiled-player, and Reviewer
  call's settings, and the seeded starter config, `--help`, and README show
  the new keys beside effort
  ([DR-006](specs/decisions/006-slc-configuration-sources.md)).

- **Compiled execution relays the definition at run time.** A `composed-v3`
  bundle whose options contract requires the single configured option
  `definition` receives the exact bytes of the phase or link definition the
  request names through its configured options: the host constructs the
  factory with `{ definition }` first — the single construction for every
  current bundle — and offers the exact empty options once only when a
  bundle declaring no option refuses it, so a bundle declaring a
  `<definition>` placeholder receives the definition instead of a
  build-time transcription while the seeded `Request:` line keeps carrying
  paths only and never routes the definition through a classifier judge;
  an unreadable definition fails the phase before the artifact loads
  ([DR-028](specs/decisions/028-contract-based-adoption-without-recompilation.md)).

- **Compiled-execution fidelity check.** The independent artifact review
  and the pin generator compare a definition's closing
  `## Compiled execution` section — its acting blockquote, with Markdown
  backslash escapes resolved so a Source-escaped `\<definition\>` matches
  the compiled `<definition>`, and its `Results:` bullets — with the
  bundle's GEARS and refuse a bundle whose control shell drifted; a
  definition without the section is reported not applicable
  ([DR-028](specs/decisions/028-contract-based-adoption-without-recompilation.md)).

### Changed

- **Playbook adoption keys on the engine's declared contract, not its
  release number.** A current pin selects `composed-v3` when its link
  target resolves inside an installed `@sublang/playbook` whose engine
  declares `RUNTIME_ABI` 1 and `SUPPORTED_ARTIFACT_SCHEMAS` containing 3,
  whatever the version, and fails closed naming the declaration
  otherwise; the exact historical maps for `legacy` and `composed-v2`
  stay as recorded. The verification-only schema decision accepts the
  same declaration as schema-3 evidence, and the definitions guard, pin
  generator, and CI audit take the accepted release from the dependency
  lock, so a routine adoption changes only the manifest, lock,
  definitions, and pins. `SlcDeps.compiled` may now return a promise
  ([DR-028](specs/decisions/028-contract-based-adoption-without-recompilation.md)).

- **Breaking: Playbook 12.1.0 and Cligent 0.24.0 are the adopted set.**
  `@sublang/playbook` moves to `^12.1.0` and `@sublang/cligent` to
  `^0.24.0`, the four vendored definitions are byte-identical to that
  release, and the three meta-phase bundles were rebuilt once — the last
  rebuild — through interpreted real-agent runs from definitions that
  now close with a `## Compiled execution` section: each bundle's GEARS is
  one direct-Captain item whose prompt relays the definition through the
  configured option `definition` with the results `compiled` and
  `rejected`, so the bundles are stable control shells and later
  definition edits reach compiled runs at the next adoption without a
  rebuild. Pins were regenerated with `@sublang/playbook@12.1.0`
  provenance, and both demo reference sets were retained unchanged and
  re-verified by their checkers against the installed engine. Cligent
  0.24.0 types each adapter by its own effort and fast-mode vocabulary, so
  the adapter factory is typed at the widest adapter shape
  ([DR-028](specs/decisions/028-contract-based-adoption-without-recompilation.md)).

- **Host capabilities come from the published facade.** The compiled
  executor constructs its roleless fail-closed capabilities with
  `createFailClosedHostCapabilities()` and the demo reference checker
  drives its governed smoke with `createWorktreeHostCapabilities()`, both
  from `@sublang/playbook/host-capabilities`, the same implementation
  `playbook run` uses; SLC's own `src/host-capabilities.ts` copy of the
  worktree classifier and its tests are deleted, so engine-contract changes
  to receipt classification now arrive with the dependency
  ([DR-028](specs/decisions/028-contract-based-adoption-without-recompilation.md)).

- **Playbook 12.2.0 is the adopted release.** Adopted Playbook 12.2.0 as a
  routine contract-based adoption: definitions re-synchronized, pins
  regenerated, no bundle rebuilt
  ([DR-028](specs/decisions/028-contract-based-adoption-without-recompilation.md)).

## [0.6.0] - 2026-09-01

### Changed

- **Breaking: the `playbook` pipeline compiles for Playbook 10's schema-3
  contract.** Exact `@sublang/playbook@10.0.0` provenance selects the
  `composed-v3` runtime profile; sources declare `Roles` instead of
  `Players`; compiled artifacts carry artifact schema 3 with the
  shared-factory compatibility record and separate
  `{ configuredOptions, hostCapabilities }` construction; emitted entries
  are enabled through Playbook configuration and invoked by their slash
  command rather than as a positional `playbook run` argument. All three
  meta-phase bundles were rebuilt through real interpreted runs, pins were
  regenerated over the synchronized byte-identical definitions with
  [DR-026](specs/decisions/026-slc-owned-pin-input-declarations.md)
  sidecar pin-input declarations, and Cligent 0.23 became the
  runtime-version authority
  ([DR-024](specs/decisions/024-playbook-10-schema-3-adoption.md),
  [DR-027](specs/decisions/027-complete-playbook-10-activation.md)).

- **The activation is complete rather than half-landed.** The package
  specs, the definitions guard, the CI audit, the installed-package
  smoke, the opt-in live acceptance script, and the demo manifest now all
  describe the one Playbook 10 set; no Playbook 4 authority or
  dormant-readiness framing remains
  ([DR-027](specs/decisions/027-complete-playbook-10-activation.md),
  [IR-024](specs/intents/024-complete-playbook-10-activation.md)).

### Fixed

- **Both demo reference sets are regenerated and checker-clean.** The
  previous rebuilds shipped a first player prompt that never received the
  Boss task (en) and a reviewer role renamed against source (zh). Fresh
  real-agent compiles — with the task relay carried as a typed
  `<inputTask>` placeholder and a deterministic textual Boss entry event —
  pass every stage of `demo/reference/check.mjs` in both languages,
  including the runtime smoke and the independent artifact review.

- **Governed worktree capabilities now match the engine contract.**
  `src/host-capabilities.ts` classifies by the boundary's declared
  dispositions with real `git status --porcelain` projections, attaches
  `commitOid` only to `one-descendant-commit`, distinguishes ancestry
  errors from non-ancestry, serializes exclusive operations, funds the
  engine's one corrective semantic re-ask, and binds deferred Boss
  questions instead of hard-erroring. An uncommitted rewrite under an
  `unchanged` disposition — previously green-lit by an empty projection —
  now stays unresolved; 18 new integration tests drive real Git
  worktrees through the installed engine's own validators.

## [0.5.0] - 2026-08-28

### Added

- **Opt-in two-agent reviewed compilation.** Setting `reviewerAgent` — with
  optional `reviewerModel` and `reviewerEffort`, each overridden by the
  matching `SLC_REVIEWER_*` variable — turns every transformation that runs
  into a Coder/Reviewer loop. The existing `agent`/`model`/`effort` selection
  remains the Coder; an independent Reviewer inspects each successful,
  non-`BLOCKED` result read-only and reports only material correctness or spec
  defects, which the Coder disposes of with evidence and minimal root-cause
  repair. A performing call permits at most three Reviewer calls: `NO_FINDINGS`
  succeeds, while findings on the third fail the phase closed and report them.
  The loop covers interpreted execution, compiled players, and
  transformation-performing Captain calls; explicit-`allowedTools` control
  calls bypass it, and incremental Reuse invokes neither agent. Review stays
  off by default and costs at least one extra agent call per transformation
  when enabled
  ([DR-022](specs/decisions/022-two-agent-reviewed-compilation.md)).

### Fixed

- **The demo consumer project requires the current compiler.**
  `demo/package.json` asked for `@sublang/slc` `^0.3.0`, which excludes 0.4.x
  and later, so a fresh `npm install` in `demo/` installed a compiler without
  incremental compilation.

## [0.4.0] - 2026-08-22

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

### Changed

- **A reused run no longer prints artifact paths.** A run that reuses every
  phase prints `up to date` instead of the artifact paths, and a partially
  reused run prints the artifact paths written during that run. Anything
  scripting `slc` and reading stdout for a path should treat `up to date` as
  "the previously reported paths are current", or pass `--rebuild` to force a
  full recompile.

### Fixed

- **Pass phases can be pinned by their legal names.** Pin indexes now accept
  portable pass names such as `optimize`, while non-portable pass names are
  rejected when the pipeline is loaded.

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
  [IR-020](specs/intents/020-playbook-4-0-adoption.md)).

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

[Unreleased]: https://github.com/sublang-ai/slc/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/sublang-ai/slc/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/sublang-ai/slc/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/sublang-ai/slc/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/sublang-ai/slc/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/sublang-ai/slc/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/sublang-ai/slc/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sublang-ai/slc/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sublang-ai/slc/releases/tag/v0.1.0
