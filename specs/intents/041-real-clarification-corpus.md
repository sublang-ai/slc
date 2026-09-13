<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-041: Real Clarification Corpus

## Status

In progress

## Intent

Comprehensively verify noninteractive clarification and performance together using sufficient maintained workflows, controlled source defects, source-only repairs, and bounded real model runs.

## Deliverables

- [x] Reviewed clean, mutant, and byte-identical restored cases for CODE, DEV, DECIDE, and REVIEW.
- [ ] A diverse typical workflow and a later-phase semantic case.
- [x] A phase recorder using ordinary compiler execution with explicit scope and authentic outcome evidence.
- [ ] Real model results, independent semantic adjudication, and regressions for demonstrated defects.
- [ ] Full CODE and DEV correctness and matched performance evidence integrated with the source controls.

## Tasks

1. [x] Preserve the reviewed experiment design and implement the corpus and phase recorder.
2. [ ] Run bounded maintained-source triplets against a validated frozen dependency cohort and resolve demonstrated defects.
3. [ ] Exercise diverse vocabulary, later discovery, actual interpreted and compiled performing paths, and source-only reruns.
4. [ ] Validate full workflows and compare supported optimizations with accepted matching controls.
5. [ ] Publish the complete result matrix and reproduce the durable regression checks.

## Verification

- Review each mutation's unresolved choice before a provider sees it, preserving the original maintained source hashes and keeping oracle metadata outside provider workspaces.
- Require clean sources to complete the tested scope and preserve authored runtime questions; absence of a compiler question alone is insufficient.
- Require mutant questions to identify the intended defect without resolving it by invention; report unrelated questions and inconclusive results separately.
- Separate phase completion, full compilation, runtime acceptance, API outcomes, and actual CLI exit codes.
- Record every attempt, exact environment and source identities, measured cost, protected-input preservation, history behavior, and independent adjudication.
- Bound live calls and continue independent local work while a case runs or a provider is unavailable.
- Retain performance techniques only with comparable accepted evidence and state the scope of every measured saving.
