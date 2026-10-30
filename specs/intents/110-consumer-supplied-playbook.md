<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-110: Consumer-Supplied Playbook

## Status

Complete: SLC 0.20.0 is published.
The change merged through pull request #97 to `acaee3fae6cf902c33961d006d7cff139b3c7007`, whose main CI passed [[1]].
The signed `v0.20.0` tag's trusted publication workflow succeeded, including its complete release checks, OIDC npm publication, and public release creation [[2]].

## Intent

Deliver [DR-061](../decisions/061-consumer-supplied-playbook.md) with the verified Playbook 18.1.0 adoption and SLC 0.20.0 release.

## Deliverables

- [x] Specify and declare the required consumer peer and exact development reference.
- [x] Synchronize the published definitions and local inputs, retain verified bundles, and regenerate current pins.
- [x] Verify installed consumer sharing, automatic peer installation, incompatible-peer rejection, and the automated release gate.
- [x] Complete live compile, reuse, update, and run acceptance.
- [x] Merge on green and publish through the trusted tag workflow.

## Tasks

1. Adopt the peer contract and Playbook 18.1.0 atomically with its package acceptance and release metadata.
2. Complete local verification, merge through the required checks, and publish SLC 0.20.0 from the successful main commit.

## Verification

Registry resolution changes Playbook 17.11.0 to 18.1.0 without changing any other locked package version.
The published compilation definitions and their local inputs match the registry package; only `link.md` changed, every reviewed compiler and demo bundle is retained, and official generation reports all three pins current and reproduces them byte-identically.
The literal `npm run release:check` passes from the clean registry install: formatting, lint, build, all 93 test files with 1,929 passing tests and two skips, definition and release audits, retained-artifact review, reproducible pins, both demo languages, and the installed 181-file tarball with automatic, shared, and incompatible peer cases.
Spec lint and prepush pass.

| Live attempt | Outcome |
| --- | --- |
| Configured Claude Code | Authentication fails before normalization because its OAuth session expired; no compiler result is accepted. |
| Codex `gpt-6-sol` at `xhigh` for compiler and runtime | Normalization through prefix pass; FSM acceptance fails closed after three checking rounds with `state repo2 has no reachable entry transition`. |
| Codex `gpt-6-astra` at `xhigh` for compiler; `gpt-6-sol` at `xhigh` for player and Captain | Full gate exits zero: cold compilation and entry loading, exact unchanged reuse, downstream update retaining the manual refinement and upstream reuse, then a 186-second real run reaching successful durable settlement with no unresolved effects, two Git commits preserving the baseline, and the repaired median passing its executable test. |

The successful installed consumer contains SLC 0.20.0 and Playbook 18.1.0.
The failed and successful scratch trees remain available, no generated artifact was hand-repaired, every acceptance stage and assertion remained enabled, and provider selection used per-command settings without changing the user's configuration.
The successful command was:

```sh
SLC_AGENT=codex SLC_MODEL=gpt-6-astra SLC_EFFORT=xhigh ACCEPTANCE_PLAYER=codex:gpt-6-sol@xhigh ACCEPTANCE_CAPTAIN=codex:gpt-6-sol@xhigh npm run test:acceptance -- --keep
```

| Local evidence | SHA-256 |
| --- | --- |
| `/private/tmp/slc-peer-release.log` | `ac2be63026b243b779f9a08817eb9b03b509b7a9b039f22395e162d96937dd20` |
| `/private/tmp/slc-peer-acceptance-astra.log` | `6a1ae67e8a866b808b6d634eed0a6496e9c16653ef6644753e88104d4264d0a1` |

The npm registry verifies version `0.20.0`, required Playbook peer `^18.1.0`, exact development Playbook `18.1.0`, no ordinary Playbook dependency or optional peer metadata, and `gitHead` equal to the release commit [[3]].
Its tarball integrity is `sha512-1d3yP8m/Y/hGk0k8GK1JhbGgon8zEwGeVhdN4Z163T1Y7MyEeeLT56tkf0RG1gYhp5azAu8GIHq/aSXqndXBTw==`.
The public non-draft, non-prerelease `v0.20.0` release was created on 2026-10-29 Pacific time [[4]].

## References

[1]: https://github.com/sublang-ai/slc/actions/runs/41006531235 "Successful main CI for the release commit"
[2]: https://github.com/sublang-ai/slc/actions/runs/41008999766 "SLC 0.20.0 trusted release workflow"
[3]: https://registry.npmjs.org/@sublang%2fslc/0.20.0 "Published SLC 0.20.0 npm metadata"
[4]: https://github.com/sublang-ai/slc/releases/tag/v0.20.0 "SLC 0.20.0 release"
