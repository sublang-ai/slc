<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-060: Merge on Green

## Status

Accepted (2026-10-23) on the owner's direction to make merging timely while several branches land on `main` in one day.

## Context

As many as four pull requests have merged into `main` in one day.
`main` required the `quality` check with the branch up to date, so every merge made each open pull request merge `main` and run its whole quality job again, and a pull request that turned green still waited for a person to merge it while `main` moved on.
The CI workflow ran on every push and every pull request, grouping runs by ref and cancelling the run in progress for any event:

- every push to a branch with an open pull request ran the job twice, once per event;
- a second merge into `main` could cancel the first merge's run, the run the release workflow requires before it publishes a tagged commit [[release-7](../packages/release.md#release-7)].

Nothing ran before a push: CI runs no spec lint, so a duplicate item ID or a broken citation could reach a pull request unless its author ran the linter, and a type error showed only after a CI install.
The suites held assumptions a loaded runner did not share: a cancellation case bounded by a 250 ms wall-clock deadline failed a pull request's run after passing locally and on its branch, and each such hazard cost a full CI round to find.

## Decision

- `main` is protected: a merge into it requires every job of the CI workflow — its one `quality` job — to have passed on the pull request's head, with no requirement that the branch be up to date with `main`, so a green run stands until the branch itself changes.
- A pull request merges with a merge commit by GitHub's auto-merge once its checks pass, the maintainer having asked for the merge when the pull request was ready, so no interval stands between green and merged for `main` to move in.
- The CI workflow runs for a push to `main` and for every pull request, one run per pull-request head: a push to the branch cancels the run of the head it supersedes, while a push to `main` cancels nothing, so every commit on `main` keeps the run the release workflow reads.
  A branch push no longer starts a run of its own beside its pull request's.
- The matrix is left alone: the workflow has no macOS matrix, its one `quality` job running on Linux for every event, so a pull request already runs the whole matrix and no reduced pull-request matrix or nightly run is needed.
- A base branch is never deleted while a pull request still targets it: deleting a base that has not merged closes the pull requests stacked on it.
- Before a push, the contributor or maintainer runs the pre-push check — no conflict marker left in the tree, the spec lint and the TypeScript type check — so a push carries neither a tree CI's build would refuse nor specs the linter rejects.
- A suite is deterministic by construction: it takes no order from Git's listings or a directory listing but sorts both sides or reads the order its subject promises, bounds no step by wall-clock time but by the event the behavior names, counts no tool's calls exactly but asserts where they went, and scripts a fault to outlast every call that may consume it before the call under test.

## Consequences

- A red test on `main` blocks every merge until `main` is fixed, which is what keeps `main` green: a fix for `main` is a pull request like any other, and it merges once its own checks pass.
- `continuous-integration` states the merge rule, the run per head, the pre-push check and the suites' determinism, and scopes its gates to pushes to `main` and pull requests; its merge-gate audit asserts the triggers, the cancellation rule, the one required job and the pre-push check's refusal of a conflict marker.
- A branch pushed without a pull request, and a tag, no longer run CI; the release workflow still finds the run of the push to `main` that carried the tagged commit.
- The repository's branch protection — the up-to-date requirement turned off — and its auto-merge setting are the operator's to set; the record names them so a person can check them against the specs.
