<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-063: Recovery review round four

## Status

Complete; one new review-fix commit on the existing branch, without merge or release.

## Intent

Resolve finding 34 without hiding valid duplicate controller routes.

## Deliverables

- [x] Restrict the defensive fallback exception to a distinct failure target and an unconditional error fallback.
- [x] Verify and commit once without merging.

## Tasks

1. Fix the coverage check, expand its regression matrix, align the spec and record verification in one new review-fix commit.

## Verification

Finding 34 is accepted: the previous exception could hide a real duplicate action route.
The checker now requires a distinct parked leaf without invocation, children or automatic transition, shared with the last unconditional error arm and with no earlier result arm.
[DR-053](../decisions/053-recovery-controller-discrimination.md) and [[verification-6](../packages/verification.md#verification-6)] match that rule.

| Run | Result |
| --- | --- |
| Coverage suite | 137 passed, 3 new cases failed because their fixture missed the `createMachine` import. |
| Corrected cases | 3 passed, 137 unchanged cases skipped. |
| Independent guarded/nonfinal error cases | 2 passed, 140 skipped; each error-arm requirement is tested independently of the action-target requirement. |
| Build | Passed after the checker change; unchanged production inputs were not rebuilt. |
| ESLint | Initial fixture typing produced 2 errors; replaced those casts and the corrected run passed. Final changed-test check passed. |
| Formatting | A check found the later type-cast line needed formatting; Prettier corrected it and formatted the final new cases. |
| Spec lint | Clean initially; the completed-record draft had 1 citation-format error, corrected before the final clean lint. |
| Generated Captain checker | Playbook's copy was re-emitted using the built SLC emitter, all six files matched its inputs, and Captain transition coverage passed. |
| Whitespace | `git diff --check` passed. |

Logs are `/private/tmp/review4-slc-*.log` and `/private/tmp/review4-captain-coverage.log`.
The final coverage suite has 142 cases, verified through the original run and targeted corrections/additions.
No unchanged suite or build was rerun for a final aggregate result.

The request to publish SLC in this round is rejected as unnecessary for these unmerged review fixes.
DR-053 keeps the verifier independent of pipeline assets, and `src/verify-support.ts` copies built checker files without compiling Captain.
Playbook DR-066's release-before-Captain-compilation gate remains in force for eventual publication; this round changes no compiled Captain or package version.
