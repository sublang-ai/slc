<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-111: Cligent 0.37.0 Adoption

## Status

Preparation: the dependency floors, specification, adoption refusal, refreshed pins and SLC 0.20.1 metadata are authored.
No merge, tag or publication is complete.

## Intent

Let an application on Playbook 18.1.2 share one Cligent with SLC.
Playbook 18.1.2 requires Cligent `^0.37.0`, the first release whose Codex runtime floor `0.159.1` serves `gpt-6.1-sol`; SLC 0.20.0's direct `^0.36.1` excludes it, so such a consumer installs a second, compiler-private Cligent.

## Deliverables

- [x] Raise the direct Cligent minimum to `^0.37.0` [[self-hosting-11](../packages/self-hosting.md#self-hosting-11)] and enforce it in the repository adoption verifier.
- [x] Adopt Playbook 18.1.2 as the exact development release and `^18.1.2` as the peer [[release-25](../packages/release.md#release-25)], with the demo and README naming the same peer.
- [x] Resolve the registry lock to one Cligent 0.37.0 shared with Playbook, and regenerate the provenance pins without recompiling retained definitions or bundles.
- [ ] Pass the local `release:check`, merge on green, and publish SLC 0.20.1 through the trusted tag workflow.

## Tasks

1. Specify the raised Cligent minimum and record this intent.
2. Raise the floors and the development Playbook, resolve the registry lock, refresh the pins, and prepare the 0.20.1 metadata.
3. Merge on green and publish through the trusted tag workflow.

## Verification

The registry lock resolves Cligent 0.37.0 and Playbook 18.1.2 once each, with Playbook's transitive Cligent requirement met by the root copy.
Cligent's raised floor also moves the Codex SDK from 0.159.0 to 0.159.3 and adds Cligent's own new runtime dependencies; no other direct dependency changes.
`verify:definitions` reports all five definitions and their local inputs byte-identical to Playbook 18.1.2.
The official pin generator reports all three pins current; only their lock digests, identities and Playbook provenance change.
The opt-in live acceptance gate is not run: this release changes no compiler execution behavior [[release-13](../packages/release.md#release-13)].
