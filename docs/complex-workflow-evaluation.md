<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Complex workflow evaluation

Evaluation is in progress. The first fifteen real source-to-GEARS cases are settled; full CODE/DEV compilation, runtime acceptance, corrected-case reruns, and matched optimization measurements remain separate gates. The [reviewed design](clarification-corpus-design.md) predates these runs.

## Initial current-dependency cohort

The immutable C1 compiler uses production commit `84b80bb`, the `39475e7` measurement harness, Playbook 13.2.0, Cligent 0.27.0, Claude SDK 0.3.270, and XState 5.33.0. All runs use one Opus 5 agent, low effort, fast mode off, no Reviewer, and actually selected compiled `text2gears`. [Dependency adoption](dependency-adoption.md) records the remaining compatible TypeScript and Node-type constraints.

| Family | Clean execution | Restored execution | Injected source defect | Independent outcome |
| --- | ---: | ---: | --- | --- |
| CODE | 143.9 s | 100.2 s | Review required and forbidden after every owned commit | Targeted question in 17.9 s. Restored translation passes; clean review-predicate placement remains inconclusive until runtime validation. |
| DECIDE | 119.4 s | 102.2 s | Concurrent proposals versus waiting for Coder | Targeted question in 23.5 s; both translations pass. |
| REVIEW | 101.9 s | 55.7 s | Return versus another round under the same completion condition | Targeted question in 16.9 s. Clean translation passes; restored translation omits required revision relays from all four actor prompts. |
| DEV | 129.2 s | 109.3 s | Reachable documentation-only outcome without an action | Intended omission identified in 53.3 s, but incomplete JSON causes an execution error. Both sufficient translations pass. |
| Support triage | 59.0 s | 64.3 s | Two destinations for the same urgent ticket | Targeted question in 15.4 s; both translations preserve routing and runtime customer questions. |

Times are recorder execution durations, including ordinary phase checks and excluding separately recorded preparation. These are phase measurements, not full compilations. Clean/restored timing differences are uncontrolled model variation, not optimization savings. The [complete initial matrix](performance/complex-workflows-2026-09-12.json) retains every attempt, exact source/cohort identities, call counts, preservation/history evidence, and private independent adjudication hashes.

No sufficient-source invocation asked a compiler question. Of ten positive invocations over five unique sources, eight pass semantic review, one is inconclusive, and one loses authored behavior. Four of five mutants deliver valid questions about their intended defect; the fifth recognizes the defect but fails report serialization. Every source and recorded cohort remains unchanged, and no phase probe publishes successful build history. These observations demonstrate the cases, not a universal accuracy rate.

## Findings and follow-up controls

The REVIEW loss is a compiler-output defect: the original source explicitly requires revision information in each acting prompt. Existing transformation rules already require this delivery. A narrow common clarification now states that conditions, result contracts, and machine context do not substitute for the required prompt relay. The affected family must be repeated before claiming the correction effective.

DEV's visible model final already lacked the top-level closing brace. The strict decoder correctly rejected it. Commit `2832d63` reinforces complete JSON syntax in the shared performing prompt, with no parser relaxation, automatic answer invention, new model call, or interactive step. Frozen C2 changes only that production prompt and its generated source maps; all C1 dependency and pipeline bytes remain unchanged. The C2 DEV rerun took 158.3 seconds and completed the first phase without a question, preserving the reachable `documentationOnly` result but supplying no route for it. This misses the targeted first-phase oracle; later detection remains untested. Since it emitted no report, the rerun does not establish report-guidance effectiveness. The actual CLI source-only repair check passes: CODE's contradiction produces one targeted diagnostic, empty stdout, exit `2`, and no accepted output or history in 21.0 seconds; changing only the source back to the exact original and repeating identical arguments produces exit `0`, no question, and a semantically accepted GEARS translation in 106.5 seconds. All 11,888 recorded compiler/dependency members remain unchanged.

The direct GEARS triplet also passes its tested scope through actual interpreted `gears2fsm`: the sufficient controls compile in 156.1 and 121.9 seconds without questions, while the contradictory terminal outcome produces one targeted question in 31.8 seconds. Each generated control passes six real XState execution cases for approval, rejection, runtime question/resume, exact field relays, and malformed actor outputs. These are generated-FSM checks with deterministic actor outcomes, separate from linked runtime acceptance.

A separate definition conflict incorrectly equated child bridge completion with all caller-required success conditions. The Playbook branch now distinguishes bridge/terminal handling from explicit caller-authored acceptance predicates. The runtime is unchanged; real Git integration checks verify that CODE rejects missing or ill-typed review evidence and unsettled findings after bridge delivery.

Repeated mechanical Results repairs are a measured cost. In three first-cohort runs, moving prose below Results caused another formatting error and another correction; those second correction dispatch intervals total 75.075 seconds. The proposed Results-boundary guidance is isolated in a matched phase pair and excluded from the common full-compilation baseline. Its speed benefit remains unmeasured.

The supported nested/labelled linker prototype passes strict checks and maintained CODE/DEV runtime and prompt assertions. Its optional recipe is the only difference in a frozen link comparison pair. This establishes readiness for measurement, not a speedup. Separately, the already measured Git-observation optimization reduces paired real repository observation/receipt overhead by roughly 116–153 ms; that is host overhead, not model or full workflow latency.

The [follow-up record](performance/complex-workflows-followup-2026-09-12.json) identifies C2, the immutable comparison inputs, and the failed full CODE attempt. That attempt took 640.1 seconds, stopped at the FSM gate, and produced no linked artifact. Its raw and optimized GEARS are byte-identical and pass independent source review. The gate still expects raw nested prompt text although the current contract requires composed child text. Separately, the generated FSM invents REVIEW output fields and rejects the actual public success result; the isolated compiler inputs lacked those public interfaces. Both are compiler or environment defects, not reasons to question the source author. All performance claims require accepted matching artifacts and source-specific runtime checks. No baseline is accepted merely because its generation finished, and no failed attempt is discarded.
