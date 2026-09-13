<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Clarification corpus design

Evaluation plan reviewed before live experiments. The fifteen source fixtures, direct-GEARS triplet, and ordinary phase recorder are committed; real evaluation is in progress and recorded in [the current result matrix](performance/complex-workflows-2026-09-12.json). Fixture preparation and deterministic checks are not provider evidence.
The aim is to measure whether SLC asks only when compilation requires an unresolved domain choice, while preserving its existing stop, protection, and original-source rerun contract.
The behavioral authority remains [source clarification](../specs/packages/clarification.md) and [DR-032](../specs/decisions/032-noninteractive-source-clarification.md); experiment accounting follows [compilation measurement](../specs/packages/compilation-measurement.md).

## Separate the questions being tested

| Intent | Evidence needed | Evidence that does not establish it |
| --- | --- | --- |
| Detect a missing or contradictory domain choice | A real performing agent identifies the injected choice and locates its source evidence. | A fixture transport programmed to emit a question. |
| Avoid unnecessary clarification | An unchanged sufficient source completes the tested phase without a marker, preserving authored runtime questions. | Silence followed by a malformed or incomplete artifact. |
| Preserve the generic protocol | Real compiler/executor/CLI integration stops, reports the original source, preserves protected inputs, and reruns normally after an edit. | An isolated JSON parser test or a question printed by an agent outside SLC. |
| Compile a correct workflow efficiently | Cold full compilation, strict checking, entry loading, four generated suites, and source-aware runtime acceptance all pass. | A successful source-to-GEARS probe or a fast clarification. |

An authored instruction to ask Boss during workflow execution is complete runtime behavior, not a request for a compile-time answer.
In particular, CODE's unresolved caller IR and DEV's planning discussion are intentional runtime branches.
Caller-supplied task text, repository revisions, concrete player identities, child registrations, and other declared runtime inputs need no compile-time value merely because they are unknown during compilation.
Real incompatibilities or malformed protected artifacts remain execution failures; not every detected flaw is a clarification case.

## Freeze inputs before live work

First complete the requested latest-dependency update and its compatibility checks, then freeze the measured compiler, verification harness, provider SDK, selected Playbook runtime, definitions, and transitive declared inputs.
Record exact versions and byte identities; changing a dependency, definition, model, effort, executor mode, or optimization setting starts a new comparison cohort.
Use one explicit configuration, fresh output directories outside the source repositories, and no inherited build history or maintained CODE, DEV, DECIDE, or REVIEW reference outputs in the provider-facing dependency graph.
SLC statically imports the host-capabilities facade even for interpreted execution; the facade requires the Captain control closure, which is retained and inventoried as an engine dependency rather than a workflow oracle.
Keep the unchanged references as immutable positive controls and create every mutation in a separate fixture copy.

The initial source baseline is Playbook `a000e37815024acc8051855adda72fcedbbfcedb` (13.2.0).
The integration of retained compiler definitions at `677a9ea21f902a256f2b34957512374daae5fd1b` preserves these reference bytes.
If a later source revision is selected, create new identities rather than replacing the recorded controls.

| Control | Exact source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| DEV | `reference/sdlc/dev.md` | 5,959 | `608c8c8ce07b50fc1ef27e8d112937ebd13206b99f6fb7e9498e44d15d124a2c` |
| DECIDE | `reference/sdlc/decide.md` | 3,504 | `229a6b77889558c20ef1a26a55d2073fea5ca00601ac62e61a08c88c394459cc` |
| REVIEW | `reference/sdlc/review.md` | 6,097 | `373e9bedf8b75dd031b5f80fdc6aaa5fc95ec56a94f68960ba24faeaaf0c32c6` |
| CODE | `reference/sdlc/code.md` | 5,687 | `42987d1a13ee38e0f555c32dec6bb0d32c31153c5d855e56f8fc7ea97333ade5` |

Validate authentication in the same execution environment as the later provider calls, using the supported adapter and a bounded preflight before charging a source case with a failure.
A sandbox can expose credentials differently from an authorized execution outside that sandbox; an authentication symptom alone does not establish that the account is logged out everywhere.
Preserve the original `compile-YRP1PS` result as its recorded authentication failure, with no retrospective relabeling or throughput claim.
Record any subsequent environment diagnosis and successful preflight separately; do not change saved configuration, erase sessions, or consume a reset to obtain a clean result.

## Source controls and one-defect mutations

Each family has three independently recorded members: unchanged clean source, a copy with one documented semantic defect, and a restored source whose bytes exactly match the clean member.
The mutation manifest records the base hash, exact edit, resulting hash, affected source range, expected unresolved choice, and why the remaining text cannot settle it.
A reviewer checks that rationale before a provider sees the case.
Do not add an answer hint, `MISSING` token, expected question, or oracle file to the provider workspace.

| Family | Clean behavior that must survive | Proposed minimal mutation | Semantic clarification oracle |
| --- | --- | --- | --- |
| CODE: contradictory review | Every CODE-owned commit is reviewed before another phase or successful completion. Ambiguous caller IR identity is asked at runtime. | Immediately after the universal after-each-commit review obligation, add the same universal condition forbidding a review call. | Identify both incompatible obligations and ask which governs. Citing only the runtime IR question is wrong. |
| REVIEW: contradictory completion | Review/fix/rebuttal rounds finish only after affirmative completion with no unsettled findings and return the evaluated revision. | Keep that rule and add a rule under the identical clean-completion condition forbidding return and starting another round. | Ask whether the clean result returns or starts another round without returning. |
| DECIDE: contradictory dispatch | Coder and Reviewer propose concurrently and independently; Coder synthesizes and commits before nested REVIEW. | Replace the no-wait sentence with a requirement to await Coder's completed proposal before requesting Reviewer, retaining the concurrent-dispatch requirement. | Ask whether dispatch must be concurrent or await Coder's completed proposal. Independence alone cannot settle concurrency. |
| DEV: reachable undefined route | Six planning outcomes route directly, with discussion resumed after Boss replies and PR paths using their required children. | Add the planning criterion “If the request is documentation-only, choose `documentation only`,” and include that seventh outcome in the result list, without adding its action or terminal behavior. | Ask what the reachable new outcome does: its work, child call, or terminal result. Do not infer CODE, discussion completion, or another route from the label. |

The three contradictions deliberately use identical conditions or mutually exclusive ordering requirements, without a precedence clause or a plausible narrower exception.
The DEV edit has two textual sites because a declared outcome must also be reachable to make this a routing gap rather than an unused label.
Deleting an explicit termination sentence or renaming a role can still leave a coherent interpretation; those weaker mutations are excluded from the measured corpus.
Do not accept a test merely because any question appears; the question must address its injected choice.

Start with the reviewed support-triage family after the maintained-source wave; the other families remain optional proposals requiring their own semantic review:

| Family | Sufficient control | One defect to inject |
| --- | --- | --- |
| Support-ticket triage | Explicit urgent/ordinary/rejected routes, plus a runtime customer question when a ticket lacks required instance data. | Add conflicting destinations under the same urgent condition. |
| Bounded editorial approval | Author/Reviewer roles, two review attempts, and an explicit failure with last findings at the cap. | Remove the cap's required terminal behavior. |
| Chinese data-import workflow | Explicit validation, valid/invalid outcomes, exact output location, and a runtime request for a missing input file. | Send invalid input to an undeclared action while leaving the successful route complete. |

These are fixture proposals, not additional product behavior.
They introduce different vocabulary, source structure, runtime-input questions, and one non-English case without requiring real external messages, credentials, or business operations.
Use a consistent role rename and a harmless prose rewording as benign variants where useful; those must not be mistaken for a material source defect.

## Oracle and result records

For a mutant, success requires a valid nonempty clarification report whose question, reason, and evidence together identify the intended unresolved choice without choosing its answer.
Accept equivalent wording, question order, ids, and optional choice phrasing.
For a contradiction, the evidence must locate both incompatible obligations or describe their exact relationship; for an omission, it must locate the source condition whose response is missing.
Do not score by literal question strings or loose keyword matching.
An independent review against the predeclared rationale resolves semantic scoring; a self-review by the generating agent is not independent evidence.

For a clean or restored member, success requires ordinary completion of the tested phase, no clarification marker, source preservation, and the applicable phase checks.
Preserve runtime question branches in the output; eliminating them to suppress compiler questions fails fidelity.
Generated-code errors, provider failures, timeouts, checker defects, unsupported acceptance profiles, and inconclusive semantic judgments stay separate from false-positive and false-negative clarification counts.
Keep every attempt; do not select only the fastest or most favorable sample.

The machine-readable case record should include family/member, source and mutation identities, cohort identity, invocation scope, actual executor selection and pin status, API outcome, actual CLI exit status when exercised, stopping phase, question count, semantic verdict with source locations, preservation/history verdicts, phase/call accounting, and separate artifact-validation outcome.
Raw questions and diagnostics remain in local evidence; a shareable summary contains hashes, counts, classifications, and the adjudication rationale without copying source or response text.
Report detection and false-ask counts with their denominators, plus inconclusive cases and first-detection phases.
A single sample per family demonstrates cases, not a universal accuracy rate.

## Phased execution matrix

Reuse [the existing clarification integration suite](../test/clarification.test.ts) for transport and lifecycle behavior; extend only demonstrated gaps.
Its fixture transports are appropriate for deterministic host assertions and do not establish a model's semantic judgment.

| Wave | Execution | Required evidence and stopping rule |
| --- | --- | --- |
| 0: environment | No corpus provider calls. Finish dependency, pin, package, ordinary compiler, and existing clarification checks. | Freeze the cohort and supported authentication context. Resolve failures before evaluating source semantics. |
| 1: deterministic integration | Actual compiler, protected filesystem, interpreted executor, committed compiled phase/current runtime, and CLI with fixture transport. | Normalization, entry, later compile, link, compiled player, compiled direct Captain, and reviewed correction all stop and rerun correctly. Retain existing routing/judge exclusion and failure-precedence coverage. |
| 2: maintained semantics | Ordinary single-phase `playbook.text2gears` probes for the four clean/mutant/restored families, one complete triplet at a time. | Twelve bounded phase invocations, rather than twelve full compiles. Clean and restored members pass phase checks; each mutant asks about its defect. Stop the family for diagnosis after an unexpected result, retaining it. |
| 3: diversity and later discovery | Start with one diversity triplet; expand to the other two only after its oracle and execution work. Use one small, syntactically valid GEARS clean/mutant/restored triplet at `gears2fsm` for a choice requiring no parser failure. | Measure additional semantic coverage without regenerating earlier stages. A direct GEARS invocation correctly reports that GEARS as its original input. Do not manufacture an invalid FSM merely to demand a live link question. |
| 4: full workflow acceptance | Reuse the planned cold CODE and DEV performance controls as selected full clean controls; validate their full outputs and source-specific runtime behavior. | Full correctness is mandatory for a compilation-speed claim. DEV's Boss-discussion/resumption and CODE's runtime IR question must remain executable. DECIDE/REVIEW phase results alone earn no full-compilation claim. |
| 5: repeats after a finding or change | Rerun the affected clean/mutant/restored family under the corrected, newly frozen cohort; repeat matched performance measurements separately. | Preserve earlier failures and compare only matching settings/inputs. No new broad cross-product of every source, phase, model, and transport. |

Use a five-minute deadline for an individual live semantic phase probe initially, with a separately bounded full-compilation deadline.
A timeout is incomplete evidence, not “no clarification.”
Review progress after each family, so a stalled source cannot block unrelated deterministic checks, runtime acceptance, or optimization analysis for hours.
Do not overlap provider calls used for comparative timings; independent local work can continue while one runs.
The existing compilation benchmark supports full and fixed-FSM link scope, so a phase-probe recorder must use the ordinary single-phase invocation and existing accounting seams rather than pretend a new benchmark flag already exists.

A valid question may be discovered earlier than expected: that is useful detection, not a phase-selection failure.
Test exact later-phase transport deterministically instead of forcing a real agent to ignore an earlier defect.
Cover one live interpreted and one live compiled performing path with actual selection evidence if compatible compiled phase pins are available; a silent interpreted fallback does not count as compiled coverage.
Keep the compiler definition's ordinary mechanical repair budget; the corpus does not add retries that can hide unstable behavior.

## Preservation and rerun assertions

At every stopping boundary, hash all already-declared protected paths, including original invocation inputs, current source/objects, definitions, sidecar inputs, and link target where applicable.
Valid clarification cannot hide a protected-input mutation or unsafe physical target.
No later performing, judge, or queued control call runs; a compiled runtime is disposed, while cancellation, unrelated runtime failure, and disposal failure retain their existing precedence.
The stopped draft is not an accepted output; no successful build history or clarification/answer/resume state is published.
When prior successful history exists, it remains unchanged rather than being erased.

The API result is `clarification-required` with schema `sublang.slc.clarification.v1`, the actual phase/target, and original invocation source paths.
The real CLI writes its complete `SLC_CLARIFICATION: ` JSON line and actionable instructions to stderr, leaves stdout empty, exits `2`, and reads no answer from the terminal.
The compilation benchmark may classify this non-success with its own exit `1`; that is not evidence about CLI exit `2`.

After the test author restores or resolves only the fixture's original source, repeat the identical command in the same case workspace to test the user workflow and ordinary incremental rules.
Also use a fresh output directory for the restored member's independent semantic/performance observation, distinguishing that cold record from the same-directory rerun.
Do not edit generated intermediates, inject an answer through a session, or rewrite the immutable positive reference.

The reviewed private corpus has five unique clean sources and fifteen cases. Ten clean/restored invocations represent five unique positive sources, not ten independent source designs. The durable corpus and phase recorder are implemented; real semantic and complete-workflow acceptance remain separate deliverables, with any new production behavior resolved in the specs first.
