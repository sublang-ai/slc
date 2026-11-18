<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Global CLI delivery acceptance

Final source candidate: SLC `0.23.0-rc.7`, Playbook `19.1.0-rc.4`, Cligent `0.40.0-rc.2`. Frozen cohort 08 records exact tarball and per-file SHA-256. This is an isolated alternative registry candidate, not a public npm release.

`checks.tar.gz` preserves original command receipts, bound source/dist inventories and raw stdout/stderr. `checks-index.json` verifies every archived stream. Current-source results:

| Check | Observed result |
| --- | --- |
| Full integration suite | 2,072 passed, 2 existing skips; 102 files; 217.35 seconds |
| Package-only consumer smoke | Passed; 209 packed files; automatic, shared and incompatible runtime peers |
| Strict types, lint, format | Passed individually |
| Spex 3 lint | Zero errors; baseline warnings retained |
| Runtime definitions, compiled artifacts, release metadata and EN/ZH demo checks | Passed individually |
| Help regression | Red failure retained; corrected source green 6 tests; independent subprocess review passed |

The completed cohort-04 matrix used SLC `0.23.0-rc.4`: 48 actual cold native CLI attempts, 30 successful (Codex 24, GLM 6), 18 GLM HTTP429/1308 quota failures. A new-context execution reviewer independently verified all 48 historical records, final gate/input/output chains and fixture side effects: 30 historical passing opinions, 18 insufficient-evidence opinions. Those records are never relabeled as rc.7 or fresh formal execution. Cohort-04 to final-candidate changes affect diagnostic classification and CLI help; generation and successful checker algorithms remain unchanged. Final-candidate installation/bridge and consolidated evidence follow in an addendum.

Keep the PR draft. Required public acquisition, exact-head CI and remaining native acceptance are not complete. Cligent CI's full development graph audit has an unpatched upstream advisory; Playbook/SLC public installs cannot resolve the unpublished coordinated candidates. No gate was weakened, no public tag or latest version was changed, and no PR is merged. The separate spex-playbook Skill is excluded. Compilation acceptance uses safe initialization/disposal and does not execute a workflow business task.

Full working evidence: sibling `slc-global-delivery-20261117`, acceptance ID `AT-slc-global-20261117`. The consolidated report and native case archive will be committed here once final-candidate bridge review completes.
