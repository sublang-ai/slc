<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# RELEASE: Release Workflow

## Intent

This package defines the release workflow for publishing `@sublang/slc` to npm
and creating the corresponding GitHub release.

## Versioning

### RELEASE-1

The project shall follow Semantic Versioning 2.0.0 [[1]]: `MAJOR.MINOR.PATCH`,
where MAJOR indicates breaking changes, MINOR indicates new features, and PATCH
indicates bug fixes.

### RELEASE-2

When a release tag is created, the `version` in `package.json`, the version the
`slc --version` command reports, and the git tag without its `v` prefix shall
match.

## Changelog

### RELEASE-3

All notable changes shall be documented in `CHANGELOG.md` following the Keep a
Changelog format [[2]].

### RELEASE-4

When preparing a release, the developer or agent shall review all commits since
the previous release, move the relevant `[Unreleased]` entries into a section
for the new version and release date, preserve an empty `[Unreleased]` section,
and update the comparison links.

### RELEASE-5

Changelog entries shall be grouped under these headings in order when present:
`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

## Release Process

### RELEASE-6

Releases shall be triggered by pushing a git tag matching
`vMAJOR.MINOR.PATCH`.

### RELEASE-7

When a release tag is pushed, the GitHub release workflow shall verify the tag
against `package.json`, require the CI workflow for the tagged commit on `main`
to have concluded successfully, install the locked dependency closure, run the
release checks and package smoke, extract the matching changelog section into a
file, publish the package with lifecycle scripts disabled, and create a GitHub
release from those notes. Disabling lifecycle scripts at that final step shall
not skip validation because the same `release:check` has already completed in
the workflow without registry credentials in its environment.

### RELEASE-8

When an existing package is published, npm shall use OIDC trusted publishing
and the `--provenance` flag without a static npm token. Because npm requires a
package to exist before its trusted publisher can be configured [[3]], the
first publication may use only the `NPM_BOOTSTRAP_TOKEN` Actions secret as a
fallback. That secret shall contain a short-lived granular token authorized for
the `@sublang` package scope with read/write access and bypass 2FA enabled for
the noninteractive direct publication [[4]]. After the first publication, a
maintainer shall configure `sublang-ai/slc` and `release.yml` as the package's
trusted GitHub Actions publisher, revoke the granular token on npm, and remove
the bootstrap secret before another release tag is pushed.

### RELEASE-9

When the scoped package is published, npm shall use `--access public`.

## Package Contract

### RELEASE-10

The publishable tarball shall include the built executable, public JavaScript
and declaration surfaces, normalization definition, starter configuration,
README, license, and package manifest, and shall exclude source, tests, specs,
demo artifacts, repository scripts, and workflow files.

### RELEASE-11

Where a compiled thin artifact imports `@sublang/playbook/xstate-runtime` and
its FSM imports `xstate` from the artifact's destination, the documented
installation shall place `@sublang/slc` and `@sublang/playbook` in the target
project rather than relying on global-only package resolution.

### RELEASE-12

The package's `prepublishOnly` lifecycle shall run `release:check` to protect
manual publication. The tag workflow shall run that same gate explicitly and
then invoke npm with lifecycle scripts disabled so registry credentials cannot
reach formatting, lint, build, tests, immutable Playbook-definition
verification, release-workflow verification, reviewed-artifact verification,
reproducible pin verification, the English demo reference check, or the
installed-tarball smoke.

## Pre-release Checklist

### RELEASE-13

When preparing a release tag, the developer or agent shall verify that all
release checks pass from a clean locked install, the changelog and package
version name the release, all changes are committed and pushed to `main`, the
publishable tarball contains only intended production files, and CI is green
for the release commit. Before the first tag, a maintainer shall also configure
the one-time bootstrap secret required by RELEASE-8.

## References

[1]: https://semver.org/spec/v2.0.0.html "Semantic Versioning 2.0.0"
[2]: https://keepachangelog.com/en/1.1.0/ "Keep a Changelog 1.1.0"
[3]: https://docs.npmjs.com/cli/v11/commands/npm-trust/ "npm trust"
[4]: https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/ "Publishing scoped public packages"
