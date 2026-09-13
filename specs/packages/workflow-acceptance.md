<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# workflow-acceptance: Workflow Runtime Acceptance

## Intent

This package specifies the repository's opt-in CODE and DEV runtime acceptance harness for maintained controls and separately reviewed generated-artifact profiles.
It does not run providers, perform complete compiler acceptance, or join the default test suite.

## External Behavior

### workflow-acceptance-1

When invoked explicitly with a profile and runtime config, the workflow-acceptance harness shall use that profile's actual registry, host-capability constructor, runtime snapshot assertion, public entry construction, original source text, output directory, and protected path set.

### workflow-acceptance-2

When the workflow-acceptance harness runs a generated-artifact profile, the profile shall map only the artifact's advertised semantic outcomes and role ids, treat unmapped semantics as unsupported-profile, and shall not inherit maintained CODE or DEV guard names as an oracle.

### workflow-acceptance-3

When the workflow-acceptance harness composes governed replies, the harness shall select only fields advertised by the runtime contract and shall not inject unadvertised receipt, presentation, or control values.

### workflow-acceptance-4

When the workflow-acceptance harness writes outputs, the harness shall write only under the caller-selected output directory or an operating-system temporary directory, preserve before/after protected hashes, record zero provider calls, and leave the repository default test command unchanged.

## Verification

### workflow-acceptance-5

When the opt-in maintained controls run against the current maintained package root, the verification shall require one positive control plus controls for dropped relays, unoffered outcomes, bad child correlation, and protected-input mutation to pass [[workflow-acceptance-1](#workflow-acceptance-1)], [[workflow-acceptance-2](#workflow-acceptance-2)], [[workflow-acceptance-3](#workflow-acceptance-3)], [[workflow-acceptance-4](#workflow-acceptance-4)].

### workflow-acceptance-6

When the opt-in maintained workflow commands run against the current maintained package root, the verification shall require eighteen CODE cases and twenty-four DEV cases to pass with protected artifacts unchanged and no provider calls [[workflow-acceptance-1](#workflow-acceptance-1)], [[workflow-acceptance-3](#workflow-acceptance-3)], [[workflow-acceptance-4](#workflow-acceptance-4)]:

| Workflow | Required case coverage |
| --- | --- |
| CODE | Direct implementation, new-IR two-phase path, existing-IR two-phase paths for two identities, real review fix, malformed review child outcomes, review-authored failure and abort, review control failure, restored resumed and fresh question/answer continuations, and real Git effect violations for unchanged, multiple-commit, residual-worktree, and rewritten-history classifications. |
| DEV | Six planning outcomes across question, discussionComplete, code, decideThenCode, codeViaPullRequest, and decideThenCodeViaPullRequest; premature discussionComplete rejection as a separate negative control; four child routes through branch, decide, code, and PR; restored resumed and fresh discussion continuations; child failure, abort, control-error, and missing-field outcomes; and planning worktree and commit effect rejection. |
