<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-053: Benchmark Runtime Options

## Status

Complete.

## Intent

Keep the minimal runtime benchmark compatible with artifact-owned entry options while preserving its real host-capability, nested Git, exact Boss-task, one-commit, and terminal-success acceptance checks.

## Deliverables

- [x] The minimal runtime benchmark constructs emitted entries with artifact-owned empty options and relies on host capabilities plus the isolated runtime-check working directory for cwd scope.
- [x] The runtime benchmark tests include an entry whose validator rejects `cwd` while retaining existing compatibility coverage for omitted cwd defaulting to `process.cwd()`.
- [x] The compilation-measurement spec records the benchmark setup and verification matrix.

## Tasks

1. Update the benchmark runtime checker, focused fixtures, and compilation-measurement spec in one reviewed patch.

## Verification

- The focused runtime benchmark suite passes thirteen tests, including artifact-owned options that reject `cwd`, real nested Git initialization, literal and quoted Boss text, one commit, and failure controls.
- Formatting, ESLint, and Spex 3.0.0 pass for the touched files.
- The unchanged earlier accepted minimal artifact fails an empty-options control with the wrong process cwd, then passes with only empty options plus nested process cwd: evidence SHA-256 `c3fc5f34ce1bb574eef67e343f4b322d3ea6088bb9755db85484185ad65de62f` and `9e771a3a4e30f69fddedef1a053b72caec2c4dcc6d6cb3ae1ff98f7085f276fe`, respectively.
- Implementation evidence `/private/tmp/slc-benchmark-runtime-options-implementation/evidence.json` has SHA-256 `7946b7ef7df4e7ed2a0333d6e0647aa8df98d583a4819db25cf547d60e7410e4`.
