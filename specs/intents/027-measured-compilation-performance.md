<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-027: Measured Compilation Performance

## Status

Completed

## Intent

Measure fresh, one-agent compilation of the minimal acceptance workflow and reduce its elapsed time toward five minutes while preserving the normal transformation and verification contracts.
Evaluate the existing two-agent demo as a broader workload.

## Deliverables

- [x] Reproducible baseline with phase and agent-call measurements using Opus 5 and GPT-6, retaining failed outcomes explicitly.
- [x] Individually measured optimizations, retaining only techniques supported by comparative evidence and correctness checks.
- [x] Updated decisions, behavior specs, user guidance, and a concise experiment report.
- [x] Validated commits and full integration closeout.

## Tasks

1. [x] Add an opt-in measurement harness and record the current baseline.
2. [x] Specify, implement, and measure each candidate technique in a separate commit-sized experiment.
3. [x] Verify the retained combination on the minimal and existing demo workflows and publish reproducible results.

## Verification

- Use isolated output directories with no prior successful build for fresh measurements.
- Record model, effort, dependency versions, source identity, phase and call timings, completion status, and validation results.
- Compare equivalent settings and input before and after each retained technique.
- Keep unfinished or rejected runs in the experiment evidence rather than reporting them as successful compiles.
- Run global Spex 3.0.0 lint and the repository checks appropriate to each committed change.
- The [settled report](../../docs/compilation-performance.md) records an original cold minimal success in 196.601 seconds with strict checking, all four emitted suites, and real-runtime task and Git acceptance; separate durable question/reply restoration also passes.
- The matched quoted-link comparison improves successful linking from 213.000 to 78.679 seconds; failed settings and unsupported techniques retain their failed outcomes without speed claims.
- The broader demo evaluation is complete: its original source requests clarification, and the explicit variant passes three separate runtime scenarios but retains 39 coverage findings and has no accepted full-compilation timing.
- The [reproduction guide](../../docs/compilation-reproduction.md) pins the measured compiler and upstream definition revisions; the latest code checkpoint passes 1,290 tests with two skips, with package, artifact, pin, definition, release, and bilingual reference-demo checks also passing at their recorded checkpoints.
