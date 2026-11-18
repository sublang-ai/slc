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

The project shall follow Semantic Versioning 2.0.0 [[1]] using stable `MAJOR.MINOR.PATCH` and candidate `MAJOR.MINOR.PATCH-rc.N`, where MAJOR indicates breaking changes, MINOR indicates new features, and PATCH indicates bug fixes.

#### release-2

When a release tag is created, the project shall keep the `version` in `package.json`, the version the `slc --version` command reports [[cli-1](cli.md#cli-1)], and the git tag without its `v` prefix identical.

### Changelog

#### release-3

The project shall document all notable changes in `CHANGELOG.md` following the Keep a Changelog format [[2]].

#### release-4

When preparing a stable release, the developer or agent shall review all commits since the previous release, move the relevant `[Unreleased]` entries into a section for the new version and release date, preserve an empty `[Unreleased]` section, and update the comparison links.

#### release-5

The changelog shall group entries under the headings `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`, in that order when present.

### Release process

#### release-6

A stable release shall be triggered by pushing a git tag matching `vMAJOR.MINOR.PATCH`.

#### release-7

When a stable release tag is pushed, the GitHub release workflow shall execute the release process and applicable idempotency outcomes:

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

#### release-25

The published package shall require `@sublang/playbook` as a non-optional peer whose range is the stable caret range, or exact coordinated candidate version under [[release-30](#release-30)], of the development release verified with its definitions, bundles, and pins [[self-hosting-11](self-hosting.md#self-hosting-11)], with no ordinary or optional Playbook dependency ([DR-061](../decisions/061-consumer-supplied-playbook.md)).

#### release-11

Where a compiled thin artifact imports the shared Playbook runtime and XState, the documentation shall describe global-once standalone compilation with internal dependency preparation [[standalone-compilation-2](standalone-compilation.md#standalone-compilation-2)] and the manifest-declared entry [[standalone-compilation-4](standalone-compilation.md#standalone-compilation-4)], distinguish the compiler's toolchain from the artifact runtime, explain independence from surrounding project dependencies without modifying them [[standalone-compilation-1](standalone-compilation.md#standalone-compilation-1)], and explain machine-local links, compatible repair and rebuild requirements [[standalone-compilation-6](standalone-compilation.md#standalone-compilation-6)].

#### release-23

Where SLC emits a schema-3 registry entry, the README and English and Chinese demo instructions shall show its activation through an explicit Playbook registry configuration and role bindings, followed by its effective slash command [[self-hosting-14](self-hosting.md#self-hosting-14)], with a supplied demo configuration that enables both retained reference entries and pins its agent models and effort explicitly.

#### release-12

When publication validation is configured, the project shall apply the corresponding release-gate outcome:

| Publication path | Release-gate outcome |
| --- | --- |
| Manual publication | Run `release:check` through the package's `prepublishOnly` lifecycle. |
| Tag-workflow publication | Run the same `release:check` explicitly, then invoke npm with lifecycle scripts disabled so registry credentials cannot reach validation. |
| `release:check` execution | Run formatting, lint, build, tests, immutable Playbook-definition verification, release-workflow verification, reviewed-artifact verification, reproducible pin verification, the English and Chinese demo reference checks [[continuous-integration-5](continuous-integration.md#continuous-integration-5)], and the installed-tarball smoke. |

#### release-21

Where a role-bearing schema-3 registry fixture and deterministic live host capabilities are available, when automatic release checks probe the entry contract without a Boss turn, the gate shall exercise one quiescent consumer lifecycle ([DR-024](../decisions/024-playbook-10-schema-3-adoption.md)):

| Lifecycle area | Required outcome |
| --- | --- |
| Registry and construction | Load the source-relative linked factory, require the entry's exact canonical role and concurrency declarations, validate absent configured options to an exact empty plain record, and construct once with that same option identity plus exact live authority, repository, and effect-ledger capabilities [[verification-10](verification.md#verification-10)]. |
| Initialization and disposal | Initialize one causal-root six-port session, keep status and telemetry ports available so lifecycle trace emission such as `playbook.trace` `session.started` is not mistaken for a work call, drive no Boss turn, and dispose. |
| Quiescence | Invoke no player, Captain, judge, or nested-playbook port, no repository operation, and no effect-ledger writer; allow every ledger snapshot read while requiring each value and nested array to be a fresh detached exact empty ledger; and leave the scratch Git baseline history and clean status unchanged after disposal. |

### Pre-release checklist

#### release-19

When the package build runs, it shall remove any previously generated output before compiling, so a rename or deletion in the sources cannot leave a superseded artifact in the publishable tarball [[release-10](#release-10)].

#### release-13

When preparing a stable release tag, the developer or agent shall complete the checklist for every applicable case:

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
| Stage and lineup selection | Refuse an invocation that selects no stage; bind every entry-declared player and the Captain explicitly, each in cligent's protected auto permission mode as the Playbook host's seeded template does so the run stage's edit-and-commit work needs no interactive grant, so the maintainer's host defaults cannot change the test; and require exactly the agent CLIs that the bound lineup invokes. |
| Missing prerequisite | State the missing prerequisite in an actionable message rather than failing inside a downstream tool. |
| Candidate preparation | Build the candidate from the working tree before packing it, because generated output is untracked and an unbuilt checkout would pack no executable while a stale build would test superseded output; install the package into a scratch consumer project. |
| Any selected stage fails | Report a non-zero exit and retain the scratch tree so the compiled artifacts and agent commits remain inspectable. |
| Cold compile | Compile a minimal workflow through the installed executable [[compiler-1](compiler.md#compiler-1)] with the maintainer's configured coding agent [[compiler-5](compiler.md#compiler-5)], then require the freshly emitted entry to load. |
| Unchanged repeat after the cold compile has published active build history [[incremental-compilation-1](incremental-compilation.md#incremental-compilation-1)] | Repeat the installed compile, require the exact `up to date` outcome [[cli-3](cli.md#cli-3)] with an unchanged active marker and recorded phase targets, and thereby verify Reuse without another agent call [[incremental-compilation-2](incremental-compilation.md#incremental-compilation-2)]. |
| Update is not skipped | Refine the canonical GEARS intermediate, repeat the compile, require Update [[incremental-compilation-5](incremental-compilation.md#incremental-compilation-5)] and Reuse that preserves the manual refinement as the accepted snapshot baseline [[incremental-compilation-4](incremental-compilation.md#incremental-compilation-4)], and load the updated entry. |
| The gate invokes the installed Playbook host | Isolate every home that host resolves inside the scratch tree — its shared configuration root, its session state home, and the superseded configuration path it still relocates a configuration from — and write the gate's own configuration where that host reads it, so the gate reads, writes, and relocates no maintainer configuration or session state and only adapter authentication stays outside. |
| Run portion is selected | Select the updated entry when Compile and Update ran, the freshly compiled entry when Compile ran but Update was skipped, or the committed reference when Compile was skipped; copy that schema-3 entry, its bundle, and the buggy sample into a scratch run directory; require at least one entry-declared role; enable the entry in the installed Playbook host's configuration with every declared role and the Captain bound explicitly to real agents, so the maintainer's personal run defaults cannot change the test; drive the entry to a successful terminal result by invoking its effective slash command with the task [[self-hosting-14](self-hosting.md#self-hosting-14)]; require the installed host’s durable session to be settled successfully with no engaged workflow or unresolved effects and its final root settlement trace to carry a successful terminal; require an initial Git commit preserving the original sample followed by at least one agent commit; and require the repaired sample to pass the compiled median driver ([DR-024](../decisions/024-playbook-10-schema-3-adoption.md), [DR-027](../decisions/027-complete-playbook-10-activation.md)). |
| Compile and Run are selected | Include repository initialization and an initial baseline commit in the compiled fixture’s scripted setup before delegation, so the governed player changes tracked code without consuming pre-existing worktree content. |
| Run is selected without Compile | Prepare a clean initial Git baseline before invoking the committed reference workflow, whose authored setup only initializes Git. |

#### release-27

The published compiler shall acquire Claude Agent SDK and Codex SDK through an ordinary Cligent dependency whose minimum release supplies both as ordinary dependencies, without restating SDK runtime ranges or requiring users to install either SDK separately, while preserving the required Playbook peer [[release-25](#release-25)] and Cligent-owned readiness checks before Agent work ([DR-068](../decisions/068-standalone-compilation-environment.md)).

#### release-28

When compiler-changing release acceptance runs against a freshly packed candidate installed alone into an isolated global prefix, the gate shall verify the actual global-install and backend matrix rather than substitute SDK import or cached success for generation:

- both included SDKs load through the installed compiler's actual Cligent dependency tree without a checkout, development-only package or unrelated global SDK [[release-27](#release-27)];
- credential-free installed-CLI checks cover automatic internal environment preparation, the entry's actual import, initialization and disposal, and actionable prerequisite failures [[standalone-compilation-2](standalone-compilation.md#standalone-compilation-2)], [[verification-79](verification.md#verification-79)];
- credentialed cold compilation exercises Codex and Claude Code separately as Coder backends, using the same complete natural-language fixture, equivalent compiler/check settings and fresh directories without prior artifacts or history; for this standalone-environment delivery, Claude/GLM may use a separate simplest self-contained fixture for its workability smoke [[delivery-acceptance-4](delivery-acceptance.md#delivery-acceptance-4)];
- at least two independent cold runs per backend are recorded, with at least one accepted complete generation and entry initialization/disposal per backend required to establish backend support; for this standalone-environment delivery, the explicitly scoped single Claude/GLM workability smoke [[delivery-acceptance-4](delivery-acceptance.md#delivery-acceptance-4)] replaces repeated Claude samples, while Codex retains the native-platform and parent-directory matrix; retain failures and scoped cancellations separately rather than requiring or claiming universal generation success;
- repeated samples and their fixed sample count are declared before the run, generation outcomes are reported separately from deterministic environment acceptance, and a later retry uses another fresh directory with its own record;
- only after a successful cold run, execute a separate unchanged-repeat reuse check and record it as reuse, never as another generation success [[release-13](#release-13)];
- record every phase's inputs, outputs, corrections, checks, elapsed time, exit status, backend/SDK identity and final outcome, with absent authentication reported as an unmet prerequisite [[standalone-compilation-8](standalone-compilation.md#standalone-compilation-8)].

### release-30

When a same-repository branch candidate is published for pre-merge delivery acceptance, the publisher shall use a distinct candidate lane under [DR-068](../decisions/068-standalone-compilation-environment.md):

- a unique SemVer `MAJOR.MINOR.PATCH-rc.N` package version, a matching immutable candidate source/tag identity, passing checks for that exact branch/PR head, and no requirement that the candidate already be merged into `main`;
- an explicit non-`latest` npm dist-tag, provenance, public scoped-package access and the existing trusted OIDC publication authority, with no stable-tag publication or stable GitHub release as a side effect;
- ordinary build, package, dependency-audit and credential-free gates retained, with the stable-only `main` and final stable preparation-record requirements confined to stable publication;
- coordinated candidate dependencies naming the exact intended Cligent/Playbook candidate versions where needed, recorded separately from stable caret-range policy, with no checkout path, workspace link or manual SDK installation in the registry consumer;
- a durable record of source head, PR, version, dependency candidate set, tarball integrity and actual registry installation results; runtime-source or packed-file changes require a new candidate and affected verification, while unpacked documentation-only changes retain the immutable published source/tag identity and require current-head CI plus recorded packed-file equivalence;
- formal stable publication remains a later, separately gated operation, and acceptance does not require moving `latest` before merge.

## Verification

### Package smoke

#### release-14

Where the project is built, when the release package smoke creates and installs the npm tarball in an empty consumer project, the smoke shall verify that the tarball carries the package identity and required production files and excludes development-only trees [[release-10](#release-10)], and that the installed package exposes both public module exports plus an `slc --version` value matching `package.json` [[release-2](#release-2)].

#### release-15

Where the publishable tarball is installed into an empty project, when the committed English demo bundle is copied outside the repository and its freshly completed entry is imported from that project, the entry shall resolve the shared Playbook engine and XState FSM dependency from the consumer install without relying on this checkout or a global module path [[release-11](#release-11)].

#### release-26

Where the built tarball is installed with npm's normal peer resolution into isolated consumer projects, when package acceptance runs, the suite shall verify the required Playbook peer contract [[release-25](#release-25)] through these cases:

| Consumer | Required outcome |
| --- | --- |
| No explicit Playbook dependency | npm installs the required peer and the installed compiler launches. |
| An explicit Playbook dependency at the adopted development release | The consumer, compiler definitions and default link target, and emitted artifact resolve the same real Playbook package; the retained bundle completes and its runtime initializes and disposes through that engine. |
| An explicit incompatible Playbook dependency | Installation fails with npm's peer-resolution conflict rather than adding a private compiler engine. |

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
| Acceptance isolation | The opt-in acceptance entry binds the installed Playbook host's shared configuration root, session state home, and superseded configuration path to its own scratch tree, writes its configuration under that configuration root, and passes those homes to the host invocation [[release-17](#release-17)]. |

### Installed-package acceptance

#### release-18

Where the publishable tarball is installed into an empty consumer project, when installed-package acceptance runs, it shall produce the outcome for each selected flow:

| Acceptance flow | Required outcome |
| --- | --- |
| Automatic release checks | Inside the installed consumer, complete the committed canonical English reference bundle through the installed executable without credentials or seeded config [[completion-6](completion.md#completion-6)], import its freshly emitted schema-3 entry through its artifact-local dependencies [[release-11](#release-11)], and — without driving a compiled Boss turn, because SLC does not substitute for Playbook's governed repository and effect-ledger protocol — construct its runtime once with validated configured options and exact live host capabilities, initialize one causal-root session, and dispose it, retaining consumer-side engine resolution and schema-3 construction, initialization, and disposal coverage as part of the publication gate [[release-12](#release-12)]. |
| Opt-in local gate | Compile a minimal workflow through the installed executable and require a loadable entry; require an unchanged repeat to report exactly `up to date`, preserve the active marker, and leave every recorded phase target equal to its snapshot; unless Update is skipped, require a repeat after a manual GEARS refinement to report both Update and Reuse, preserve and record the refinement in a new build, and leave the updated entry loadable; run the selected schema-3 entry through the installed Playbook host — enabled and role-bound in Playbook configuration with explicit player and Captain bindings and invoked through its effective slash command — to a durably verified successful root terminal with no unresolved effects, whose initial commit preserves the original sample and whose subsequent agent commit passes a compiled median check; and use the committed reference set when Compile is skipped [[release-17](#release-17)], thereby exercising the compiler-change gate required by [[release-13](#release-13)]. |

### Schema-3 consumer acceptance

#### release-22

Where the source suite places the role-bearing schema-3 registry fixture and its linked factory in a scratch Git repository with one clean baseline, when schema-3 consumer acceptance runs, the acceptance shall require the exact roles, concurrency, option validation, and one exact live-capability construction, initialize and dispose one causal-root runtime without a Boss turn, observe no call-port, repository-operation, or ledger-write use, require detached empty-ledger snapshots, and leave repository history and status unchanged [[release-21](#release-21)].

### Demo onboarding acceptance

#### release-24

Where the supplied demo configuration is copied into an isolated demo home with a clean sample baseline, when demo onboarding acceptance invokes the installed Playbook host's list command, the host shall load and list both English and Chinese reference entries with their exact declared role bindings and explicit model and effort selections, without any agent call or baseline change [[release-23](#release-23)].

#### release-29

Where a packed candidate is ready, when its isolated production and global consumer installation matrix runs, the suite shall verify ordinary Cligent delivery of both SDKs without duplicated SDK ranges [[release-27](#release-27)], automatic internal-environment instructions and preservation of surrounding projects [[release-11](#release-11)], and the distinct deterministic and credentialed cold/reuse acceptance outcomes [[release-28](#release-28)].

### release-31

When candidate publication and exact-version clean-prefix installation are exercised through the actual configured publisher, the system suite shall verify source/PR identity, candidate version and tag, trusted publication, intended transitive candidate acquisition, retained stable-lane restrictions and no mutation of `latest`, retaining failed and skipped publication evidence rather than claiming an unperformed install [[release-30](#release-30)].

## References

[1]: https://semver.org/spec/v2.0.0.html "Semantic Versioning 2.0.0"
[2]: https://keepachangelog.com/en/1.1.0/ "Keep a Changelog 1.1.0"
[3]: https://docs.npmjs.com/cli/v11/commands/npm-trust/ "npm trust"
