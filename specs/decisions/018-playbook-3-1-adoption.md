<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-018: Playbook 3.1 Adoption

## Status

Accepted.

## Context

- `@sublang/playbook@3.1.0` is published [[1]]. Its `runtime.ts` — the six-port
  composed contract SLC's compiled executor binds — is byte-identical to
  2.0.0's, and the shared engine gains only the additive DR-022 compatibility
  self-report (`RUNTIME_ABI`, `SUPPORTED_ARTIFACT_SCHEMAS`, optional
  `spec.compat` fail-fast) [[2]][[3]].
- The release's `slc/link.md` changes what a linker emits in two normative
  ways: judge prompts must carry the hidden-control envelope (prohibit tool
  use, file inspection, and external evidence; require exactly one JSON
  object), and emitted thin modules must stamp `spec.compat` with the
  module format's own schema, `1`, verified against the installed engine at
  link time [[1]][[4]]. `text2gears.md`, `gears2fsm.md`, and `optimize.md` are
  normatively unchanged from 2.0.0 [[2]].
- 3.1.0's `playbook run` provisions the engine beside a filesystem artifact
  whose imports do not resolve (Playbook DR-024 [[5]]), which changed SLC's
  documented consumption model ([[release-11](../packages/release.md#release-11)]).
- `3.0.0` was never installed or reviewed here; adopting it separately would
  create a mixed set for no benefit.

## Decision

### Provenance mapping

Exact `@sublang/playbook@3.1.0` link-target provenance selects the six-port `composed-v2` profile, joining 0.10.0, 1.0.0, and 2.0.0.
`1.3.0` and `3.0.0` remain fail-closed as unmapped ([[phase-execution-30](../packages/phase-execution.md#phase-execution-30)]).

### Atomic reviewed-asset adoption

The dependency range moves to `^3.1.0` with the lock resolving exactly 3.1.0.
The vendored definitions re-sync from the registry tarball with SLC's explicit `## Pin Inputs` retained — only `link.md` changes content [[2]][[4]].
Because the link emission contract changed, all three meta-phase bundles are rebuilt via interpreted `slc slc` runs from the synced definitions, so every bundle's runtime module carries the hardened judge prompts and the `spec.compat` declaration; pins regenerate with exact 3.1.0 provenance [[3]][[4]].
Manifest, lock, definitions, bundles, and pins move as one reviewed set ([[self-hosting-11](../packages/self-hosting.md#self-hosting-11)]).

### Version-coupled consumers

`demo/package.json` moves to the same majors in the same unit, so the demo's contained install can never split the engine across majors.
The demo's Chinese reference set is regenerated through the packed candidate exactly as an end user would run it, serving as compile acceptance for the interpreted consumer path.

## Consequences

- Artifacts SLC now emits under the vendored pipeline declare
  `spec.compat = { artifactSchema: 1, runtimeAbi: 1 }` and fail fast on a
  genuinely incompatible engine instead of misbehaving mid-session [[3]][[4]].
- Reference and meta artifacts emitted before this adoption carry no
  `compat` member and remain loadable by the 3.1 engine [[3]].
- The documented consumption model is global-first [[5]], as recorded by
  [[release-11](../packages/release.md#release-11)]; a project-local install
  remains authoritative wherever it resolves.

## References

[1]: https://github.com/sublang-ai/playbook/blob/v3.1.0/CHANGELOG.md#310---2026-07-27 "Playbook 3.1.0 release"
[2]: https://github.com/sublang-ai/playbook/compare/322a33266fc0ae2b262f330484937eaa5c8ce172...88fa24810c2f7e1d5482240a39538b0d01ffadb4 "Playbook 2.0.0 to 3.1.0 source comparison"
[3]: https://github.com/sublang-ai/playbook/blob/v3.1.0/specs/decisions/022-runtime-compatibility-contract.md "Playbook DR-022: Versioned runtime compatibility contract"
[4]: https://github.com/sublang-ai/playbook/blob/v3.1.0/slc/link.md "Playbook 3.1.0 link definition"
[5]: https://github.com/sublang-ai/playbook/blob/v3.1.0/specs/decisions/024-runtime-engine-provisioning.md "Playbook DR-024: Runtime engine provisioning"
