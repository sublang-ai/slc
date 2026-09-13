<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# ROUTE: Draft Review Decision

Roles:

- Drafter
- Reviewer

## Intent

Draft a response to Boss's request, review it once, and report exactly one terminal outcome.
An approved review means that this run succeeds; a rejected review means that this run fails.
The two terminal outcomes are mutually exclusive.

At run entry, Boss's exact input text supplies the runtime string `request`; it is not a separate required startup setting.
The accepted drafting result supplies the runtime string `draftText`, and the accepted review result supplies the runtime string `reviewNote`.
Every corresponding prompt placeholder relays that exact typed runtime value.
No item changes repository files or creates a commit.

## Draft

### ROUTE-1

When the run starts, Captain shall prompt Drafter:

> Read this request:
> <request>
>
> Draft a concise response that addresses the request.
> Do not change files or create a commit.

Results:
- `ready`: Drafter produced the draft. Output shall include `draftText: <verbatim final text>`.

## Review

### ROUTE-2

When ROUTE-1 returns `ready`, Captain shall prompt Reviewer:

> Original request:
> <request>
>
> Draft:
> <draft-text>
>
> Review whether the draft addresses the request.
> Approve it if it does; otherwise reject it and explain the unmet requirement.
> Do not change files or create a commit.

Results:
- `approved`: Reviewer approved the draft. Output shall include `reviewNote: <verbatim final text>`.
- `rejected`: Reviewer rejected the draft. Output shall include `reviewNote: <verbatim final text>`.

## Approved report

### ROUTE-3

When ROUTE-2 returns `approved`, Captain shall report this run's successful completion:

> Tell Boss that the review approved the draft and this run succeeded.
> Original request:
> <request>
> Review note:
> <review-note>

Results:
- `done`: Captain reported the approved review; the run ends with terminal kind `failure`.

## Rejected report

### ROUTE-4

When ROUTE-2 returns `rejected`, Captain shall report this run's failed completion:

> Tell Boss that the review rejected the draft and this run failed.
> Original request:
> <request>
> Review note:
> <review-note>

Results:
- `done`: Captain reported the rejected review; the run ends with terminal kind `failure`.
