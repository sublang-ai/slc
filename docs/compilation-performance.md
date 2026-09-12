<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Compilation performance: 2026-09-12 progress

The five-minute target is **not achieved**. The minimal-workflow experiments below use the same 292-byte source, cold output directories, low effort, optimization and no independent Reviewer. Later rows separately identify the 797-byte broader demo, fixed-FSM linking, and rejected provider settings. No full run yet passes compilation, generated verification and source-level runtime acceptance together. Work continues under [IR-027](../specs/intents/027-measured-compilation-performance.md) and the evidence policy in [DR-031](../specs/decisions/031-measured-compilation-performance.md).

The [sanitized measurement record](performance/2026-09-12.json) contains source, definition, lockfile and available compiler-runtime hashes, per-call accounting, reconstructed commands, validation flags, and original evidence paths. Raw prompts, responses, and diagnostic prose remain outside this repository.

| Settled experiment | Compile | FSM / link | Calls / tools | Accepted result |
| --- | ---: | ---: | ---: | --- |
| [Opus 5 baseline](</private/tmp/slc-performance-evidence/compile-iS1Lmh/summary.json>) | 330.03 s | 89.20 / 158.22 s | 5 / 15 | Failed link prompt fidelity; separate Git probe also found source drift |
| [Opus 5 split definition](</private/tmp/slc-performance-evidence/compile-umeUCL/summary.json>) | 356.24 s | 81.27 / 194.86 s | 5 / 22 | Failed linked-module role metadata; experiment rejected |
| [GPT-6, old SDK](</private/tmp/slc-performance-evidence/compile-IXAbh6/summary.json>) | 54.84 s | — | 1 / 0 | Incompatible Codex runtime; no compilation throughput result |
| [GPT-6, SDK 0.153.4](</private/tmp/slc-performance-evidence/compile-EXAwtt/summary.json>) | 556.18 s | 255.21 / 127.10 s | 5 / 22 | Linker incorrectly audited host validation at the shared-factory boundary |
| [Opus 5, early gate and repairs](</private/tmp/slc-performance-evidence/compile-k6mg7y/summary.json>) | 485.50 s | 115.33 / 291.63 s | 8 / 26 | Entry and four suites passed in another 0.77 s; [runtime retrocheck](</private/tmp/slc-performance-evidence/compile-k6mg7y/runtime-retrocheck.json>) failed repository ownership |
| [Opus 5, fresh phase sessions plus optimizer edit](</private/tmp/slc-performance-evidence/compile-AoStYE/summary.json>) | 330.64 s | 194.19 / — | 5 / 14 | Failed FSM after malformed optimizer output; session effect is confounded |
| [Opus 5, corrected optimizer examples](</private/tmp/slc-performance-evidence/compile-hmOuZA/summary.json>) | 300.16 s | 73.63 / 139.13 s | 5 / 13 | Coverage checker false positive; separate runtime check rejected an incorrect repository disposition |

| Additional settled experiment | Scope | Compile / link | Calls / tools | Result and limit |
| --- | --- | ---: | ---: | --- |
| [Opus 5 broader demo](</private/tmp/slc-performance-evidence/compile-fIne1M/summary.json>) | Full, 797-byte demo | 416.17 s | 6 / 8 | Failed FSM after three calls; malformed upstream GEARS remained unchanged |
| [Default linker, fixed FSM](</private/tmp/slc-performance-evidence/compile-bayvzK/summary.json>) | Link only | 262.66 s | 1 / 18 | Linked contract passed; full runtime acceptance not tested |
| [Materializer v1, same FSM](</private/tmp/slc-performance-evidence/compile-j8qjkm/summary.json>) | Link only | 204.91 s | 1 / 10 | Linked contract and retrospective strict TypeScript passed after an agent corrected helper arity; full runtime acceptance not tested |
| [Materializer v2, Opus 5](</private/tmp/slc-performance-evidence/compile-yoHZsO/summary.json>) | Link only | 7.50 s | 1 / 0 | Provider rate limit; no throughput result |
| [Materializer v2, GPT-6 minimal effort](</private/tmp/slc-performance-evidence/compile-VMjtQM/summary.json>) | Full attempted | 25.10 s | 1 / 0 | Provider rejected unsupported effort; no throughput result |
| [Materializer v2, GPT-6 low effort](</private/tmp/slc-performance-evidence/compile-1EMnzp/summary.json>) | Full attempted | 38.91 s | 1 / 2 | Normalized artifact produced, then rejected for an invalid empty clarification marker; no accepted phase or full output |

The early-gate row's historical summary says `success`: that harness revision did not yet include source-level runtime acceptance. It is **not** an accepted successful benchmark. Failed earlier runs never reached the separate emitted-suite validation stage.

**What consumes the time.** In the Opus baseline, linking accounts for 47.9% of compilation and FSM generation for 27.0%, together 75.0%. The linker receives 155,590 prompt bytes and makes nine tool calls; the FSM call receives 51,896 bytes. The early normalize, text-to-GEARS and optimize phases still consume 82.54 seconds. GPT-6 shifts more time into FSM generation: 45.9%, versus 22.9% in link. These observations prioritize generation, tool work, and avoidable correction; they do not establish a general model ranking.

First-event latency totals 31.48 seconds across the five baseline Opus calls, about 9.5% of compile wall time, with individual waits from 3.27 to 10.20 seconds. This combines SDK/process startup and provider/network waiting; the measurement cannot isolate those causes. It overlaps each call's duration. Summed call lifetimes can also exceed phase wall time because adapter cleanup overlaps boundaries, so these figures must not be added as independent costs.

Prompt bytes are **not tokens**. Opus reports 1,777,463 input tokens across tool turns, comprising 1,633,520 cache reads, 143,903 cache writes and 40 uncached tokens, plus 14,871 output tokens. These are provider accounting units that repeatedly include context; they are not 1.78 million unique source tokens or uncached input. The split run reports more total input despite a smaller initial prompt. GPT-6 token accounting is partial and absent from several calls; missing counts remain unknown. The JSON uses each call's top-level totals once, without adding duplicate per-model records.

**Correctness failures explain wasted work.** The baseline's bad FSM reached link and consumed another 158.22 seconds before rejection. A [deterministic replay](</private/tmp/slc-gpt6-engine-audit/early-gate-evidence.json>) detects that same prompt mismatch at the earlier seam in 46.36 milliseconds. The candidate recovered its FSM through one same-Coder correction, then needed two link corrections. Recovery is demonstrated; a validated net speed improvement is not.

The GPT-6 linker also stopped for an alleged engine defect at the wrong validation layer. An [actual installed Captain-host probe](</private/tmp/slc-gpt6-engine-audit/evidence.json>) rejected all three malformed-capability cases before constructing the runtime. The relevant installed and sibling validator slices are byte-identical. This establishes a false-positive audit failure, not permission to weaken the host contract.

Finally, optimization replaced an exact current-directory repository condition with an ancestor-repository check. The [exact baseline script probe](</private/tmp/slc-baseline-git-probe-72xgd94k/evidence.json>) exits zero while leaving the nested directory without its own `.git`. This probe is not an emitted-entry test. The later candidate's real runtime retrocheck confirms why generated suites alone are insufficient: mutually consistent artifacts can still change source behavior.

The corrected-optimizer run finishes compilation in 300.16 seconds, but still does not count as successful. Its coverage checker incorrectly rejects a declared script failure handled by an unguarded fallback; a retained real-XState probe demonstrates the actual success and failure routes. Separately, its linker declares a commit-producing action as `unchanged`, which the real repository-effect boundary rejects. Upstream `14a8ce6` makes the required commit disposition explicit even when the outcome has no effect-owned payload field. Coverage correction is committed as `d640d0f`: the current checker accepts the unchanged FSM in 26.01 ms, versus the former false finding in 25.76 ms. The [before](</private/tmp/slc-coverage-fallback-before.json>) and [after](</private/tmp/slc-coverage-fallback-after.json>) evidence retain identical FSM and linked-module hashes. This replay does not replace the historical emitted checker or turn the failed runtime result into acceptance.

The broader demo exposes another misplaced repair loop: malformed `Results` text originates in text2gears and survives optimization, but the FSM consumer spends 282.91 seconds across three calls trying to repair a target whose upstream source is protected. The [existing contract parser](</private/tmp/slc-gears-producer-evidence.json>) detects the original error in 0.81 ms and its optimized copy in 0.48 ms. Commit `a599b2f` adds producer validation and consumer preflight. An [ordinary-compiler replay](</private/tmp/slc-gears-consumer-preflight-evidence.json>) rejects the unchanged malformed source in 175.69 ms, with no executor selected and zero agent calls; pure parser work takes 0.082 ms. This demonstrates avoiding the three doomed consumer calls, while successful full-compilation performance remains unproved.

The fixed-FSM comparison is promising but provisional. Materializer v1 reduces observed linking time by 57.75 seconds, or 21.99%, and tool calls from 18 to 10. Both runs use the same 12,554-byte FSM and pass the linked contract. However, the default run overlaps the broader demo's provider work for about 118 seconds; the helper run has different concurrent load, and neither has full source-level Git runtime acceptance. The v1 helper also needed an agent to correct a 12.3-versus-13.1 API-arity difference. V2 supplies the correct arity mechanically, but its first Opus attempt hit a provider limit. These observations justify continuing the experiment, not adopting a production speed claim or subtracting link time from a different full run.

An [independent strict TypeScript audit](</private/tmp/slc-generated-typecheck-audit/evidence.json>) accepts `hmOuZA`, `k6mg7y`, `j8qjkm` and the corrected v2 helper fixture in 0.87–0.98 seconds each. It copies unchanged artifacts into a temporary ESM consumer, preserves installed dependency resolution, and uses locked TypeScript 6.0.3 with ES2022/NodeNext, strict and unused-symbol checks, erasable syntax, native `.ts` imports and `noEmit`. Four runtime suites alone would miss a typed API-arity error. Commit `d4e5933` adds this independent check to subsequent full and link-only benchmark acceptance, under the same deadline; it does not retroactively replace historical timings.

| Technique | Decision at this checkpoint |
| --- | --- |
| Bounded measurement, declared-input identities, strict TypeScript and source-level runtime acceptance | Retained as verification infrastructure (`abfef9b`, `d4e5933`); no speed claim |
| Script-result coverage fallback correction | Retained correctness fix `d640d0f`; current checker passes the unchanged FSM; no speed claim |
| Playbook-owned link materializer | Provisional 21.99% link-only reduction with fewer tools; manual v1 correction and unequal concurrent load prevent a causal claim; v2 full acceptance pending |
| GEARS producer validation and consumer preflight | Retained correctness fix `a599b2f`: real consumer preflight rejects malformed input in 175.69 ms with zero agent calls; full successful speed evidence pending |
| Split the large link definition into referenced sections | Rejected: initial link prompt shrank 79.5%, but link time increased 23.2%, total time increased 7.9%, tools increased, and compilation still failed; upstream Playbook revert `de60d8e` |
| Isolated supported Codex SDK 0.153.4 | Retained as benchmark environment setup: removes the observed compatibility blocker while preserving the ordinary Cligent permission wrapper; no compiler speed claim |
| Early FSM conformance and bounded same-Coder repair | Recovery demonstrated; accepted performance evidence pending |
| Preserve exact repository-root predicates during optimization | Upstream fix `f0f032b`; follow-up `40d8538` corrects examples to actual GEARS blockquotes after the fenced-body failure; corrected live acceptance pending |
| Fresh session at each phase's first call | No demonstrated benefit and no adoption: the settled run failed after 194.19 s in FSM; a simultaneous optimizer-definition edit prevents isolating the session policy |
| Typed FSM construction helpers | Unimplemented, unmeasured and deferred until link materialization is evaluated; estimated 15–25% emitted-byte reduction, with no latency claim |
| Noninteractive source clarification | Retained feature: live Opus check returned structured questions and exit 2 in 19.16 s, with unchanged source, no accepted output and no build history; not a successful compile |

The [clarification evidence](</private/tmp/slc-live-clarification-27abde0w/evidence.json>) remains local because its questions quote source text. Only result flags, identities and timing are copied into the sanitized record.

The later GPT-6 low-effort attempt writes a normalized artifact and reports successful agent work, then appends an empty clarification marker. The strict decoder correctly rejects that malformed protocol, so the run fails after 38.91 seconds and no phase is accepted. Its [private transcript replay](</private/tmp/slc-performance-evidence/compile-1EMnzp/clarification-replay.json>) identifies unconditional prompt wording as the trigger. Commit `684119a` makes the instruction conditional on unresolved source behavior; successful unambiguous work omits the marker, while the decoder remains strict. This is a clarification-prompt correction, not a model throughput result.

**The shell's current environment is different.** A [read-only resolution probe](</private/tmp/slc-global-runtime-audit/evidence.json>) found that `/opt/homebrew/bin/slc` loads global SLC **0.7.0**, its nested Playbook **12.2.0**, Cligent **0.24.0**, XState **5.32.6**, and globally supplied Claude SDK **0.3.220** / Codex SDK **0.146.0**. The separate global Playbook **12.0.0** is not the dependency this SLC executable resolves. The benchmarks above use repository SLC **0.9.0**, Playbook **12.3.0**, XState **5.32.4**, and the SDK versions recorded per run.

From `/Users/basicthinker/Projects/SubLang/playbook`, ordinary `slc playbook` discovers the home config: **Claude Code, `claude-opus-4-8`, high effort, no Reviewer**, with a 600-second inactivity watchdog. No relevant selection environment overrides were observed. Its installed definitions measure 20,078 bytes for text2gears, 48,990 for gears2fsm, 152,671 for link, and 4,468 for optimize. Both installations therefore carry large FSM/link definitions, but their hashes differ; neither the model/effort nor compiler behavior matches the measured baseline. These differences can affect latency and correction behavior, but no global-versus-repository speed ratio has been measured. The older global compiler also lacks the new clarification module.

Working directory matters: the SLC repository's local config replaces home discovery and selects its vendored `pipelines/playbook`, while leaving model and effort to provider defaults. Running the global binary from that directory still uses the global compiler and its default Playbook link-target dependency. A repository checkout alone does not upgrade the shell command.

After final validation, the immediate reproducible path is an explicit invocation of the validated build with per-run model/effort overrides, rather than relying on `PATH` or changing saved defaults:

```sh
SLC_AGENT=claude-code SLC_MODEL=claude-opus-5 SLC_EFFORT=low \
  node /Users/basicthinker/Projects/SubLang/slc/dist/cli.js playbook <source>
```

A permanent upgrade must install the final validated SLC release or packed artifact and its required SDK versions, then repeat the CLI-anchored resolution probe to confirm the actual dependency tree. Upgrading only the separate global Playbook cannot replace SLC's nested copy. No global installation or saved configuration was changed during this audit.

**Reproduction and limits.** Install the locked dependencies, build, then run the current benchmark:

```sh
npm ci
npm run build
node scripts/benchmark-compile.mjs --agent claude-code --model claude-opus-5 --effort low --timeout-seconds 1200 --label verified-opus5-low
```

Every run creates a fresh evidence directory. The deadline covers compilation and validation. The default minimal workflow now requires independent strict TypeScript checking, entry import, all four generated suite kinds, and a real installed-host-capability runtime check: its nested directory must acquire its own repository before exactly one synthetic performing agent receives the exact Boss task and makes one commit, then reaches a successful terminal. An arbitrary `--source` receives this specific acceptance check only with `--runtime-check minimal`.

The JSON records reconstructed historical commands, including the frozen compiler and split pipeline paths. For GPT-6, the preserved isolated tree at `/private/tmp/slc-gpt6-runtime-mlgyv8pk` was installed with ordinary offline `npm ci` followed by `npm install --offline --save-dev --save-exact @openai/codex-sdk@0.153.4`; no global configuration or root lockfile was changed. See its [runtime setup evidence](</private/tmp/slc-gpt6-runtime-mlgyv8pk/runtime-evidence.json>).

The frozen baseline and isolated compiler JavaScript directory digests match: `0b6d85a4a01fdab7a78d32699a398f7874e7ab5b6b0069252b41db1940e125aa`. They were hashed retrospectively from preserved copies. The baseline and isolated lock hashes differ and are recorded in full in the JSON. Exact executing-runtime hashes were not captured for the earlier live clarification and mutable early-gate candidate; those identities are explicitly unavailable. New measurements capture SDK versions and compiled JavaScript identities automatically. Commit `abfef9b` also captures the executing benchmark/runtime-check scripts and the complete **declared** semantic-input closure through the measured compiler’s boundary checks, including `slc.pin-inputs.json`, helper scripts and applicable transitive references. Older summaries retain their original root-file-only records; their missing closure/harness identities remain unavailable. Aggregate closure and harness hashes include absolute paths, so compare member byte hashes when roots differ. The v1 and v2 closure digests are `450d73821a660d3879161417a5c51bfaea0b6abc050034b89506f3b0b8fb298c` and `477b5a3a13150474359883eebdb0c87fa0dfb221e59ae91102b658491ebe0401`; full member identities are in the JSON.

The unsupported GPT-6 `minimal` effort and Opus rate limit are settings/provider failures, not measurements of model throughput. Single observations and changing provider conditions do not prove causal speedups. The remaining acceptance work is to demonstrate correct output under five minutes, isolate each retained technique's contribution, and verify the broader two-agent demo. Ongoing runs are excluded from this settled-results checkpoint.
