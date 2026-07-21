<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-016: Prepare the first npm release

## Goal

Prepare `@sublang/slc` 0.1.0 as the first npm release under the current RELEASE
package, with a reproducible tarball, CI-gated publication with provenance,
accurate local installation guidance for Playbook 2.0 thin artifacts, and
auditable notes.

## Deliverables

- [x] RELEASE dev and test items plus the map record versioning, changelog,
  package, CI-green, provenance, and pre-release contracts.
- [x] `package.json`, `package-lock.json`, and the CLI report 0.1.0; package
  metadata identifies the source repository.
- [x] `CHANGELOG.md` contains the first-release notes and comparison links.
- [x] README and demo commands use project-local installs so generated thin
  artifacts resolve their Playbook runtime closure.
- [x] The package smoke validates tarball contents, installed executable and
  exports, and an external thin entry import.
- [x] CI runs the release-grade definition, artifact, pin, demo, and package
  checks; the tag workflow requires green main CI, uses a one-time bootstrap
  credential while the npm package is absent and OIDC thereafter, publishes
  with provenance and public access, and creates the GitHub release.

## Tasks

1. Prepare and validate the complete 0.1.0 release unit: specs, version,
   changelog, documentation, package smoke, CI, and tag workflow.

## Maintainer handoff

- [ ] Immediately before `v0.1.0`, create the short-lived npm bootstrap token
  described by RELEASE-8 and store it as the `NPM_BOOTSTRAP_TOKEN` Actions
  secret.
- [ ] Immediately after the first publication, configure the npm trusted
  publisher, revoke the granular token on npm, and remove the Actions secret.

## Acceptance criteria

- A clean `npm ci` followed by `npm run release:check` exits zero.
- `npm pack` identifies `@sublang/slc@0.1.0` and contains only the intended
  production surface.
- The release commit is on `main`, pushed, and green before `v0.1.0` is tagged.
- Before `v0.1.0` is tagged, a maintainer stores the one-time
  `NPM_BOOTSTRAP_TOKEN` Actions secret. After publication, the maintainer
  configures `release.yml` as the npm trusted publisher, revokes the granular
  token on npm, and removes the secret.
