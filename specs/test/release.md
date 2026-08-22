<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# RELEASE: Release Workflow

## Intent

This package defines acceptance coverage for the release workflow and
publishable package.

## Package Smoke

### RELEASE-14
Verifies: [RELEASE-2](../dev/release.md#release-2), [RELEASE-10](../dev/release.md#release-10)

Where the project is built, when the release package smoke creates the npm
tarball, the tarball shall carry the package identity and required production
files, exclude development-only trees, install into an empty consumer project,
and expose an `slc --version` value matching `package.json` plus both public
module exports.

### RELEASE-15
Verifies: [RELEASE-11](../dev/release.md#release-11)

Where the publishable tarball is installed into an empty project, when an
English thin demo entry is copied outside the repository and imported from
that project, the entry shall resolve the shared Playbook engine and XState FSM
dependency from the consumer install without relying on this checkout or a
global module path.

### RELEASE-16
Verifies: [RELEASE-8](../dev/release.md#release-8)

Where the release workflow is publishing a package version, when that
publication runs, its single publish step shall use trusted OIDC and no static
registry credential shall reach the workflow. A deterministic workflow check
shall reject every static-secret or additional publication path and require
lifecycle scripts to remain disabled for the publication command in CI and for
the prepublish release gate.

### RELEASE-18
Verifies: [RELEASE-10](../dev/release.md#release-10), [RELEASE-17](../dev/release.md#release-17)

Where the publishable tarball is installed into an empty consumer project,
when the release checks exercise it, the consumer shall load the emitted entry
and drive one Boss turn over fake host ports to a terminal outcome, with the
scripted state initializing a repository in the run directory without an agent
call. Where a maintainer additionally runs the opt-in acceptance gate, a
minimal workflow compiled by the installed executable shall emit a loadable
entry; an unchanged repeat shall report exactly `up to date`, preserve the
active marker, and leave every recorded phase target equal to its snapshot;
unless the update stage is skipped, a repeat after a manual GEARS refinement
shall report both Update and Reuse, preserve and record that refinement in a
new build, and leave the updated entry loadable. Running that updated playbook
or the freshly compiled playbook when Update is skipped shall reach a terminal
outcome whose repaired sample passes a compiled median check; where the compile
stage is skipped, the committed reference set shall stand in for it.
