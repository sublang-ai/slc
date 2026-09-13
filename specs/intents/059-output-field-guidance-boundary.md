<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-059: Output Field Guidance Boundary

## Status

In progress.

## Intent

Reject ambiguous generated output-field guidance before downstream compilation while retaining existing field extraction and runtime authority checks.

## Deliverables

- [x] Record the bounded syntax decision and synchronize verification requirements.
- [x] Implement the producer diagnostic and integration coverage for repair, protected consumption, and legal guidance.
- [ ] Record preserved real-artifact controls and a corrected live compilation with runtime acceptance.

## Tasks

1. [x] Implement and validate the result-guidance boundary with unchanged runtime field extraction.
2. [ ] Record real-run evidence and corrected workflow acceptance.

## Verification

- The preserved C9 CODE `compile-LoUfNr` completed compilation in 594547 ms and the complete benchmark in 615743 ms with four provider calls and eight passing generated tests.
- Its independent runtime acceptance failed all 18 cases before player execution because `firstPhase.directImplementation` described the extra field `code` inside parenthetical guidance, while outcome authority declared only `codeCommit` and `coderOutput`.
- The runtime summary is `/private/tmp/slc-c9-code-LoUfNr-runtime-acceptance/summary.json`, SHA-256 `b69056404f5da68dc10c87fa14f4d779885f4d4f235a1253512bb435248a0a97`; `/private/tmp/slc-c9-code-LoUfNr-runtime-postrun.json`, SHA-256 `c9e77d39860bcde36085172b473777f255d122992985bcce20af31b6e0b3e1ca`, records all 11935 protected inputs unchanged and zero provider calls for that runtime check.
- Compiler success is retained as historical evidence, without accepting the original workflow or reclassifying the generated defect as Source ambiguity.
- The full SLC suite passed 1430 tests with two expected skips under two workers; `/private/tmp/slc-ir059-full.json` has SHA-256 `4c1833b9058aaeacb7b59bf58ee6bf1d2d5cbc453bb4cb9b147d142b095a671e`.
- `/private/tmp/slc-ir059-real-artifact-control.json`, SHA-256 `6422f8556de5e33a520d38c3b1aee27907ad1f719e04668010a41376d75b04bf`, records the previous parser accepting original LoUfNr, the new parser rejecting both ambiguous descriptions, both accepting the corrected copy and unchanged DEV, and actual protected-GEARS consumer rejection in 8.329 ms before zero executor selections; all 11932 protected records remained unchanged.
- A separate retrospective copy removes only the two explanatory backtick pairs from each of the GEARS and FSM files; its unchanged linked module passes all 18 runtime scenarios with a corrected private profile, recorded by `/private/tmp/slc-ir059-LoUfNr-guidance-control-v2/runtime-acceptance-corrected-profile/summary.json`, SHA-256 `f5e9f056d91061b9e61538325c43e08a20872ee03ac3ccf66770c206990e0428`.
- That control is not a compilation: its postrun proof, SHA-256 `fa6fe2d32df5204d569513bbf4b591594cb84bbcdcb0b35378af39db69363cc0`, records zero provider calls and all 11935 protected records unchanged.
- The initial control setup expected one occurrence instead of the actual two and stopped before execution; the first runtime control passed 16 cases because two private negative fixtures accidentally mutated the parent-output field name rather than the child REVIEW field `evaluatedRevision`.
- The corrected profile restores those two child mutations and explicitly asserts their malformed shape before running the unchanged acceptance harness; the initial setup, original profile, and 16-case result remain preserved.
- Build, scoped ESLint, global Spex, published-definition verification, artifact verification, and unchanged pin currentness passed; live corrected compilation remains pending.
