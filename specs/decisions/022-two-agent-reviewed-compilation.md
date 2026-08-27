<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-022: Two-Agent Reviewed Compilation

## Status

Accepted

## Context

An executing phase can produce a structurally complete artifact with a material correctness or specification defect.
The existing one-call interpreted boundary deliberately provides no automatic independent review, and compiled transformation-performing calls have the same gap.
Incremental Reuse, by contrast, accepts existing live output without executing a transformation.

Delegating this loop to a compiled Playbook is not currently practical.
The installed `@sublang/playbook` v4 package exposes no standalone `review` playbook and its `code` playbook owns a commit-oriented workflow, while the current v9 SDLC reference nests the same commit-oriented review workflow; both conflict with the phase boundary's no-commit and single-target write rules, and SLC's compiled host deliberately lacks a child-playbook stack.

## Decision

- The existing `agent`, `model`, and `effort` selection remains the Coder.
  An optional independent `reviewerAgent`, `reviewerModel`, and `reviewerEffort` selection enables review; Reviewer model or effort without Reviewer agent is invalid.
- After each successful, non-`BLOCKED` transformation-performing Coder call, SLC shall create a fresh read-only Reviewer session for that call.
  Calls carrying explicit `allowedTools`, including routing Captain and judge control calls, bypass review.
- The Reviewer shall inspect the request, Coder output, artifact, and relevant workspace state through host-exposed read-only file/search capabilities — treating shell and network as potentially unavailable and any exposed read-only shell as non-mutating inspection only — report only material correctness, behavior, or spec-quality findings, cover worthwhile instances of each defect class, make no edits, writes, mutations, or commits, and return `NO_FINDINGS` with optional surrounding whitespace or `FINDINGS:` with consecutive top-level numbered findings and only indented continuation/evidence lines.
- The Coder shall accept or reject every finding with evidence, minimally repair accepted root causes under the original request and write scope, and return correction feedback in a private host-validated envelope that separates dispositions from the complete replacement result in the original response contract.
  The correction JSON may be bare or wholly enclosed by one unlabeled or `json` Markdown fence, with no surrounding prose, other label, or additional fence; SLC shall expose the validated dispositions and decoded replacement to the Reviewer transcript but return only the decoded result to phase adjudication, and a malformed successful correction fails closed while retaining the preceding usable Coder result.
  The same Reviewer role shall recheck, resuming its session when the immediately preceding result supplies a continuation token, and its guidance shall treat a finding rejected twice with reasoning as settled.
  A performing call permits at most three Reviewer calls; `NO_FINDINGS` succeeds, while well-formed findings on the third call fail closed before another Coder correction, report those unresolved final findings, and retain the latest usable Coder result.
- Coder and Reviewer continuation tokens are role-local and used only when the immediately preceding role result supplies one; the host carries the complete finding/rebuttal transcript explicitly so correctness does not depend on adapter token availability.
  Reviewer error, incompletion, or malformed verdict fails the performing call closed; successful completion returns only the latest Coder result to the existing phase-runtime adjudication.
- The wrapper applies to interpreted execution, compiled players, and transformation-performing direct Captain calls.
  Each compiled player keeps a separate Coder client, and each performing call gets a separate Reviewer conversation.
- Incremental Reuse makes no call and therefore no review.
  Update, Ordinary, and `--rebuild` use the same wrapped executor automatically.

This supersedes [DR-004](004-slc-interpreted-phase-execution.md#scope)'s one-call scope only when the Reviewer is configured.
The phase definition remains the semantic authority, and review adds no phase-specific rules.

## Consequences

- Review is disabled by default and no-review call count and semantics remain unchanged.
- Reviewed execution costs at least one additional agent call for each transformation that runs and may cost more when findings require repair.
- Reuse is intentionally not re-reviewed because it performs no transformation and preserves the accepted live artifact byte-for-byte.
- Review orchestration belongs at the generic agent-client boundary, not in pipeline history or generated Playbook artifacts, because the installed runtime and the current commit-oriented nested SDLC flow cannot satisfy SLC's phase host boundary.
