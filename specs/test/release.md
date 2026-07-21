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

Where the release workflow is publishing a package version, when the npm
package already exists, the publish step shall use trusted OIDC without a
static token. When the package does not exist, only the first-publication step
shall receive `NPM_BOOTSTRAP_TOKEN`, and it shall fail with an explicit error
when that secret is absent. A deterministic workflow check shall enforce this
separation, reject every additional static-secret or publication path, and
require lifecycle scripts to remain disabled for both publication commands in
CI and the prepublish release gate.
