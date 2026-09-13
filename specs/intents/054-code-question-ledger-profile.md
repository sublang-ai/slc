<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-054: CODE Question Ledger Profile

## Status

Complete.

## Intent

Make CODE workflow-acceptance question ledger assertions depend on the reviewed profile's explicit repository disposition instead of assuming every question is the maintained canonical deferred chain.

## Deliverables

- [x] CODE question continuation harness profile switch for `deferred` and `unchanged`.
- [x] Maintained CODE profile explicitly declares the deferred question disposition.
- [x] Workflow-acceptance spec and README document the question ledger oracle.
- [x] Maintained CODE and private generated authored-question controls validate without provider calls.

## Tasks

1. Add the profile-disposition hook, document it, and validate maintained CODE plus generated authored-question continuation controls.

## Verification

- `node scripts/workflow-acceptance/maintained.mjs "$PWD/node_modules/@sublang/playbook" "$CODE_OUT"` passed all 18 maintained CODE cases with `questionRepositoryDisposition: "deferred"` and protected artifacts unchanged; log `/private/tmp/slc-ir054-maintained-code.log`, output root `/private/tmp/slc-ir054-maintained-code-tIDIuC`.
- A zero-port unsupported-profile probe confirmed a missing CODE question disposition returns `unsupported-profile` before nested Git, host creation, runtime construction, snapshot assertion, or callbacks; log `/private/tmp/slc-ir054-unsupported-early-probe.log`.
- The unpatched C5 runtime private generated authored-question control used a fresh copy of the existing `anx8n4` busy-only diagnostic control, set `questionRepositoryDisposition: "unchanged"`, made zero provider calls, and preserved both restored question-case failures with `CODE pending governed Boss question has no durable logical operation`; evidence `/private/tmp/slc-ir054-anx8n4-question/evidence.json`.
- The copied runtime-only question-origin proof passed all 12 expected authored and canonical outcomes with zero provider calls, including authored `unchanged` resume/fresh passes, canonical `deferred` resume/fresh passes, open-operation shadow compatibility, and missing-operation, mismatched-origin, and checkpoint-mismatch negative controls; evidence `/private/tmp/slc-question-origin-audit/run-complete/evidence.json` has SHA-256 `b8cf94e7759258c4ee8203f4dbd12f2505b654f2d7d99a79fc8b99611e3fff63`.
- The question-origin proof exercised this IR's final CODE harness: its copied identity for `/Users/basicthinker/Projects/SubLang/slc/scripts/workflow-acceptance/code.mjs` is SHA-256 `075008ab6b3a1596b0333b25ba01e4364273792f396e45380349529940f2dc93`, matching the repository file at verification time.
- The generated authored-question evidence remains scoped to a private runtime-only copy; it does not accept the original generated compilation and does not ship a production runtime fix.
