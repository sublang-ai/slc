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
