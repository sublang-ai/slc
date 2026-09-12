<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-027: Measured Compilation Performance

## Status

In progress

## Intent

Measure fresh, one-agent compilation of the minimal acceptance workflow and reduce its elapsed time toward five minutes while preserving the normal transformation and verification contracts.
Evaluate the existing two-agent demo as a broader workload.

## Deliverables

- [x] Reproducible baseline with phase and agent-call measurements using Opus 5 and GPT-6, retaining failed outcomes explicitly.
- [ ] Individually measured optimizations, retaining only techniques supported by comparative evidence and correctness checks.
- [ ] Updated decisions, behavior specs, user guidance, and a concise experiment report.
- [ ] Validated commits and full integration closeout.

## Tasks

1. [x] Add an opt-in measurement harness and record the current baseline.
2. [ ] Specify, implement, and measure each candidate technique in a separate commit-sized experiment.
3. [ ] Verify the retained combination on the minimal and existing demo workflows and publish reproducible results.

## Verification

- Use isolated output directories with no prior successful build for fresh measurements.
- Record model, effort, dependency versions, source identity, phase and call timings, completion status, and validation results.
- Compare equivalent settings and input before and after each retained technique.
- Keep unfinished or rejected runs in the experiment evidence rather than reporting them as successful compiles.
- Run global Spex 3.0.0 lint and the repository checks appropriate to each committed change.
