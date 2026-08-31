<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# release: Release Workflow

## Intent

This package defines the workflow for publishing `@sublang/slc` to npm, creating the corresponding GitHub release, and verifying the publishable package and release machinery.
It covers versioning and changelog policy, tag-triggered trusted publication, the package contract, pre-release preparation, deterministic package smoke, and the opt-in installed-package acceptance gate.
Essential project-specific references are `slc`, this project's compiler CLI; `release.yml`, the tag-triggered GitHub Actions workflow; and `release:check`, the credential-free publication gate.

## External Behavior

### Versioning

#### release-1

The project shall follow Semantic Versioning 2.0.0 [[1]] using `MAJOR.MINOR.PATCH`, where MAJOR indicates breaking changes, MINOR indicates new features, and PATCH indicates bug fixes.

#### release-2

When a release tag is created, the project shall keep the `version` in `package.json`, the version the `slc --version` command reports [[cli-1](cli.md#cli-1)], and the git tag without its `v` prefix identical.

### Changelog

#### release-3

The project shall document all notable changes in `CHANGELOG.md` following the Keep a Changelog format [[2]].

#### release-4

When preparing a release, the developer or agent shall review all commits since the previous release, move the relevant `[Unreleased]` entries into a section for the new version and release date, preserve an empty `[Unreleased]` section, and update the comparison links.

#### release-5

The changelog shall group entries under the headings `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`, in that order when present.

### Release process

#### release-6

A release shall be triggered by pushing a git tag matching `vMAJOR.MINOR.PATCH`.

#### release-7

When a release tag is pushed, the GitHub release workflow shall execute the release process and applicable idempotency outcomes:

| Process case | Required outcome |
| --- | --- |
| Baseline ordered process | Verify the tag against `package.json`; require the CI workflow for the tagged commit on `main` to have concluded successfully; install the locked dependency closure; run the release checks including package smoke; extract the matching changelog section into a file; determine whether the tagged package version already exists; publish when needed; and create the GitHub release from the extracted notes when missing. |
| Tagged version is absent from the registry | Publish the package with lifecycle scripts disabled only after the same `release:check` has completed in the workflow without registry credentials, so final publication cannot expose credentials to validation. |
| Tagged version is already on the registry because a maintainer published the first version or a tag is rerun | Skip package publication and continue to the GitHub release step. |
| The corresponding GitHub release already exists | Leave it unchanged, so rerunning the tag completes idempotently. |

#### release-8

When npm publication is established for `@sublang/slc`, the project shall apply the applicable trusted-publication outcome:

| Publication case | Required outcome |
| --- | --- |
| The tag workflow publishes. | Use OIDC trusted publishing with `--provenance`, with no static registry token in workflow configuration or repository Actions secrets. |
| The package does not yet exist, so npm cannot configure its trusted publisher [[3]]. | A maintainer performs the first publication from an interactive `npm login` session protected by the same `prepublishOnly` release gate. |
| The first publication has completed and the next release tag has not yet been pushed. | Configure `sublang-ai/slc` with `release.yml` as the package's trusted GitHub Actions publisher, for example `npm trust github @sublang/slc --repo sublang-ai/slc --file release.yml`, using the bare workflow filename rather than its repository path. |

#### release-9

When the scoped package is published, npm shall use `--access public`.

### Package contract

#### release-10

When the package is packed for publication, the tarball shall include the built executable, public JavaScript and declaration surfaces, normalization definition, starter configuration, README, license, and package manifest, and shall exclude source, tests, specs, demo artifacts, repository scripts, and workflow files.

#### release-11

Where a compiled thin artifact imports `@sublang/playbook/xstate-runtime` and its FSM imports `xstate` from the artifact's destination, the documentation shall provide an installation that resolves those imports from the artifact's own location — either by placing `@sublang/slc` and `@sublang/playbook` in the target project, or by relying on a host that provisions its own engine beside the artifact (`@sublang/playbook` 3.1 and later) — and shall state that a project-local install is authoritative wherever it resolves and that a project manifest declaring `@sublang/playbook` requires its own install because provisioning refuses to shadow a declared dependency.

#### release-12

When publication validation is configured, the project shall apply the corresponding release-gate outcome:

| Publication path | Release-gate outcome |
| --- | --- |
| Manual publication | Run `release:check` through the package's `prepublishOnly` lifecycle. |
| Tag-workflow publication | Run the same `release:check` explicitly, then invoke npm with lifecycle scripts disabled so registry credentials cannot reach validation. |
| `release:check` execution | Run formatting, lint, build, tests, immutable Playbook-definition verification, release-workflow verification, reviewed-artifact verification, reproducible pin verification, the English and Chinese demo reference checks, and the installed-tarball smoke. |

### Pre-release checklist

#### release-19

When the package build runs, it shall remove any previously generated output before compiling, so a rename or deletion in the sources cannot leave a superseded artifact in the publishable tarball [[release-10](#release-10)].

#### release-13

When preparing a release tag, the developer or agent shall complete the checklist for every applicable case:

| Preparation case | Required checklist |
| --- | --- |
| Every release tag | Verify that all release checks pass from a clean locked install, the changelog and package version name the release, all changes are committed and pushed to `main`, the publishable tarball contains only intended production files, and CI is green for the release commit. |
| The release changes compiler execution behavior | Run the opt-in local acceptance gate [[release-17](#release-17)] before tagging. |
| The first tag | Perform the interactive first publication and configure the trusted publisher required by [[release-8](#release-8)]. |

### Local acceptance

#### release-17

Where a maintainer prepares a release tag, when the opt-in local acceptance gate runs, the gate shall execute every selected stage and applicable outcome while remaining outside continuous integration and the [[release-13](#release-13)] release checks because it spends real model calls:

| Gate case | Required outcome |
| --- | --- |
| Stage and lineup selection | Refuse an invocation that selects no stage; configure the Captain, every player selected by a local-role binding, and those bindings explicitly so the maintainer's host defaults cannot change the test; and require exactly the agent CLIs that the bound lineup invokes. |
| Missing prerequisite | State the missing prerequisite in an actionable message rather than failing inside a downstream tool. |
| Candidate preparation | Build the candidate from the working tree before packing it, because generated output is untracked and an unbuilt checkout would pack no executable while a stale build would test superseded output; install the package into a scratch consumer project. |
| Any selected stage fails | Report a non-zero exit and retain the scratch tree so the compiled artifacts and agent commits remain inspectable. |
| Cold compile | Compile a minimal workflow through the installed executable [[compiler-1](compiler.md#compiler-1)] with the maintainer's configured coding agent [[compiler-5](compiler.md#compiler-5)], then require the freshly emitted entry to load. |
| Unchanged repeat after the cold compile has published active build history [[incremental-compilation-1](incremental-compilation.md#incremental-compilation-1)] | Repeat the installed compile, require the exact `up to date` outcome [[cli-3](cli.md#cli-3)] with an unchanged active marker and recorded phase targets, and thereby verify Reuse without another agent call [[incremental-compilation-2](incremental-compilation.md#incremental-compilation-2)]. |
| Update is not skipped | Refine the canonical GEARS intermediate, repeat the compile, require Update [[incremental-compilation-5](incremental-compilation.md#incremental-compilation-5)] and Reuse that preserves the manual refinement as the accepted snapshot baseline [[incremental-compilation-4](incremental-compilation.md#incremental-compilation-4)], and load the updated entry. |
| Run portion is selected | Select the updated entry when Compile and Update ran, the freshly compiled entry when Compile ran but Update was skipped, or the committed reference when Compile was skipped; initialize its scratch run directory as a canonical Git worktree with a baseline commit before host construction; under scratch-owned `XDG_CONFIG_HOME` and `XDG_STATE_HOME`, enable that entry by its absolute `playbooks.<id>.from`, bind every required canonical local role under `playbooks.<id>.roles` [[self-hosting-15](self-hosting.md#self-hosting-15)], and drive it through the installed host with real agents using `playbook run --json "/<command> <task>"` so the slash command is the sole Boss input [[self-hosting-14](self-hosting.md#self-hosting-14)]; require Playbook's own live authority, repository, and atomic effect ledger — not an SLC substitute — to govern and durably acknowledge every delegated call; and require the returned session id to identify a durable record whose `state` is `settled`, whose `unresolvedEffects` is exactly `[]`, whose `snapshot.mode` is `chat`, whose `snapshot.effectLedger` deeply equals its `effectLedger`, and whose ledger contains a completed boundary for every required role with the canonical role id of its binding and a physical-receipt classification admitted by that boundary's declared dispositions. |

## Verification

### Package smoke

#### release-14

Where the project is built, when the release package smoke creates and installs the npm tarball in an empty consumer project, the smoke shall verify that the tarball carries the package identity and required production files and excludes development-only trees [[release-10](#release-10)], and that the installed package exposes both public module exports plus an `slc --version` value matching `package.json` [[release-2](#release-2)].

#### release-15

Where the publishable tarball is installed into an empty project, when an English thin demo entry is copied outside the repository and imported from that project, the entry shall resolve the shared Playbook engine and XState FSM dependency from the consumer install without relying on this checkout or a global module path [[release-11](#release-11)].

### Release-workflow acceptance

#### release-16

Where the release workflow can publish a package version, when deterministic publication acceptance runs, the check shall require one trusted-OIDC publish step with no static registry credential [[release-8](#release-8)] and public access [[release-9](#release-9)], reject every static-secret or additional publication path, and require lifecycle scripts to remain disabled for the publication command in CI while the prepublish release gate remains configured [[release-12](#release-12)].

#### release-20

Where the repository contains its release manifest, changelog, tag workflow, and acceptance entry point, when the deterministic repository release audit runs, the audit shall verify every release-contract area against the committed files:

| Contract area | Required assertion |
| --- | --- |
| Version policy | The manifest version is strict `MAJOR.MINOR.PATCH` and the changelog declares Semantic Versioning [[release-1](#release-1)]. |
| Changelog format | The changelog declares Keep a Changelog [[release-3](#release-3)], keeps `[Unreleased]` first and requires it to be empty in tag context before the manifest's dated release section with a complete comparison-link chain [[release-4](#release-4)], and uses only the allowed change-group headings in required order [[release-5](#release-5)]. |
| Tag trigger and workflow | The workflow selects release tags and strictly validates `vMAJOR.MINOR.PATCH` [[release-6](#release-6)], then in order checks the tag against the manifest, requires successful `main` CI for the tagged commit, installs the lock, runs `release:check`, extracts versioned notes, handles an existing registry version, and creates at most one idempotent GitHub release [[release-7](#release-7)]. |
| Release gates | `prepublishOnly` invokes `release:check`; the explicit release-check closure contains every required check; the workflow runs that gate before lifecycle-disabled publication [[release-12](#release-12)]; and the opt-in live acceptance entry remains separately invocable for compiler-changing release preparation [[release-13](#release-13)]. |
| Clean build | The build command removes generated output before invoking the compiler [[release-19](#release-19)]. |

### Installed-package acceptance

#### release-18

Where the publishable tarball is installed into an empty consumer project, when installed-package acceptance runs, it shall produce the outcome for each selected flow:

| Acceptance flow | Required outcome |
| --- | --- |
| Automatic release checks | In an isolated scratch Git worktree with a baseline commit inside the installed consumer, import the emitted role-bearing English schema-3 entry and require its canonical `requiredRoleIds` to be exactly `coder`, then `reviewer`; require `validateOptions(undefined)` to return the exact empty plain object `{}`; call `createRuntime(options, hostCapabilities)` with that validated object as `options` and with `hostCapabilities` carrying matching live Captain authority, fail-on-use repository operations, and an effect ledger whose every snapshot returns the exact detached value `{ schemaVersion: 1, revision: 0, boundaries: [], logicalOperations: [] }` and whose writer fails on use; initialize one causal-root session with six fake ports whose four call ports fail on use while status and telemetry emission remain available, then dispose it without a Boss turn; and fail if initialization or disposal invokes any call port, repository operation, or effect-ledger write or leaves the worktree's baseline history or clean status changed [[release-11](#release-11)], [[release-12](#release-12)]. |
| Opt-in local gate | When Compile is selected, compile a minimal workflow through the installed executable and require a loadable entry, then require an unchanged repeat to report exactly `up to date`, preserve the active marker, and leave every recorded phase target equal to its snapshot; when Compile and Update are selected, require a repeat after a manual GEARS refinement to report both Update and Reuse, preserve and record the refinement in a new build, and leave the updated entry loadable; select that updated entry when Compile and Update ran, the freshly compiled entry when Compile ran but Update was skipped, or the committed reference when Compile was skipped; initialize the selected entry's run directory as a canonical Git worktree with a baseline commit before host construction; under isolated configuration and state homes, enable the entry by absolute `playbooks.<id>.from`, bind every required canonical local role, and invoke `playbook run --json "/<command> <task>"` so the slash command is the sole Boss input without removed direct-run flags or positional module arguments; require the installed Playbook host's own authority, repository, and effect ledger to govern and durably acknowledge every delegated call; require the returned session id to identify a durable record whose `state` is `settled`, whose `unresolvedEffects` is exactly `[]`, whose `snapshot.mode` is `chat`, whose `snapshot.effectLedger` deeply equals its `effectLedger`, and whose ledger contains a completed boundary for every required role with the canonical role id of its binding and a physical-receipt classification admitted by that boundary's declared dispositions; and require the repaired sample to pass a compiled median check [[release-17](#release-17)], thereby exercising the compiler-change gate required by [[release-13](#release-13)]. |

## References

[1]: https://semver.org/spec/v2.0.0.html "Semantic Versioning 2.0.0"
[2]: https://keepachangelog.com/en/1.1.0/ "Keep a Changelog 1.1.0"
[3]: https://docs.npmjs.com/cli/v11/commands/npm-trust/ "npm trust"
