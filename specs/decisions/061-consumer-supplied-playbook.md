<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-061: Consumer-Supplied Playbook

## Status

Accepted
Amends [DR-028](028-contract-based-adoption-without-recompilation.md) in the dependency contract alone: consumers supply a required Playbook peer, while the repository verifies one exact development release.

## Context

An ordinary Playbook dependency can install a compiler-private engine when an application's runtime requirement differs.
SLC then resolves its definitions and default link target from that private engine while generated artifacts resolve another engine from their destination.
The exact release used to review SLC's definitions, retained bundles, and pins is development provenance, distinct from the compatibility range offered to consumers.

## Decision

- SLC declares Playbook as a required peer, initially `^18.1.0`, and as the exact development dependency `18.1.0`; it declares no ordinary or optional Playbook dependency.
- The peer range is the caret range of the adopted development release; a later adoption retains the existing atomic definition, bundle, and pin verification.
- Installed-package acceptance verifies automatic peer installation, an explicit compatible consumer runtime shared with the compiler and emitted artifact, and rejection of an incompatible explicit runtime under npm's normal peer resolution.
- Cligent and XState remain ordinary dependencies, and the separately versioned Spex grammar remains a semantic input.

## Consequences

An application can select the shared runtime without SLC silently requesting a conflicting private engine.
The compiler remains directly installable with npm's automatic peer installation.
Peers constrain a consumer dependency graph rather than guaranteeing a process-wide singleton: hosts still verify resolution from their own code and generated-artifact destinations.
The development lock, immutable definition checks, and exact pin provenance remain release evidence; the published peer range does not replace them.
