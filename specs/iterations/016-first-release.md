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
  checks; the tag workflow requires green main CI, publishes through trusted
  OIDC with no registry secret, with provenance and public access, and creates
  the GitHub release.

## Tasks

1. Prepare and validate the complete 0.1.0 release unit: specs, version,
   changelog, documentation, package smoke, CI, and tag workflow.

## Maintainer handoff

- [ ] Publish `0.1.0` from an interactive `npm login` session, as RELEASE-8
  requires while the package does not yet exist and no trusted publisher can
  be configured.
- [ ] Immediately after that first publication and before the next release
  tag, configure `release.yml` as the package's npm trusted publisher, so
  every later tag publishes through OIDC with no Actions secret.

## Acceptance criteria

- A clean `npm ci` followed by `npm run release:check` exits zero.
- `npm pack` identifies `@sublang/slc@0.1.0` and contains only the intended
  production surface.
- The release commit is on `main`, pushed, and green before `v0.1.0` is tagged.
- The first publication is performed interactively by a maintainer, and the
  repository carries no registry secret at any point; after it, `release.yml`
  is configured as the npm trusted publisher for later tags.
