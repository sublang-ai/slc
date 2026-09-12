<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Compilation performance: 2026-09-12 progress

The five-minute target is **not achieved**. These are single-run, cold-compilation experiments on the same 292-byte minimal workflow, using low effort, optimization enabled, and no independent Reviewer. None yet passes compilation, generated verification, and source-level runtime acceptance together. Work continues under [IR-027](../specs/intents/027-measured-compilation-performance.md) and the evidence policy in [DR-031](../specs/decisions/031-measured-compilation-performance.md).

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

The early-gate row's historical summary says `success`: that harness revision did not yet include source-level runtime acceptance. It is **not** an accepted successful benchmark. Failed earlier runs never reached the separate emitted-suite validation stage.

**What consumes the time.** In the Opus baseline, linking accounts for 47.9% of compilation and FSM generation for 27.0%, together 75.0%. The linker receives 155,590 prompt bytes and makes nine tool calls; the FSM call receives 51,896 bytes. The early normalize, text-to-GEARS and optimize phases still consume 82.54 seconds. GPT-6 shifts more time into FSM generation: 45.9%, versus 22.9% in link. These observations prioritize generation, tool work, and avoidable correction; they do not establish a general model ranking.

First-event latency totals 31.48 seconds across the five baseline Opus calls, about 9.5% of compile wall time, with individual waits from 3.27 to 10.20 seconds. This combines SDK/process startup and provider/network waiting; the measurement cannot isolate those causes. It overlaps each call's duration. Summed call lifetimes can also exceed phase wall time because adapter cleanup overlaps boundaries, so these figures must not be added as independent costs.

Prompt bytes are **not tokens**. Opus reports 1,777,463 input tokens across tool turns, comprising 1,633,520 cache reads, 143,903 cache writes and 40 uncached tokens, plus 14,871 output tokens. These are provider accounting units that repeatedly include context; they are not 1.78 million unique source tokens or uncached input. The split run reports more total input despite a smaller initial prompt. GPT-6 token accounting is partial and absent from several calls; missing counts remain unknown. The JSON uses each call's top-level totals once, without adding duplicate per-model records.

**Correctness failures explain wasted work.** The baseline's bad FSM reached link and consumed another 158.22 seconds before rejection. A [deterministic replay](</private/tmp/slc-gpt6-engine-audit/early-gate-evidence.json>) detects that same prompt mismatch at the earlier seam in 46.36 milliseconds. The candidate recovered its FSM through one same-Coder correction, then needed two link corrections. Recovery is demonstrated; a validated net speed improvement is not.

The GPT-6 linker also stopped for an alleged engine defect at the wrong validation layer. An [actual installed Captain-host probe](</private/tmp/slc-gpt6-engine-audit/evidence.json>) rejected all three malformed-capability cases before constructing the runtime. The relevant installed and sibling validator slices are byte-identical. This establishes a false-positive audit failure, not permission to weaken the host contract.

Finally, optimization replaced an exact current-directory repository condition with an ancestor-repository check. The [exact baseline script probe](</private/tmp/slc-baseline-git-probe-72xgd94k/evidence.json>) exits zero while leaving the nested directory without its own `.git`. This probe is not an emitted-entry test. The later candidate's real runtime retrocheck confirms why generated suites alone are insufficient: mutually consistent artifacts can still change source behavior.

The corrected-optimizer run finishes compilation in 300.16 seconds, but still does not count as successful. Its coverage checker incorrectly rejects a declared script failure handled by an unguarded fallback; a retained real-XState probe demonstrates the actual success and failure routes. Separately, its linker declares a commit-producing action as `unchanged`, which the real repository-effect boundary rejects. Upstream `14a8ce6` makes the required commit disposition explicit even when the outcome has no effect-owned payload field. Checker correction and live revalidation remain pending.

| Technique | Decision at this checkpoint |
| --- | --- |
| Bounded measurement and source-level runtime acceptance | Retained as verification infrastructure; no speed claim |
| Split the large link definition into referenced sections | Rejected: initial link prompt shrank 79.5%, but link time increased 23.2%, total time increased 7.9%, tools increased, and compilation still failed; upstream Playbook revert `de60d8e` |
| Isolated supported Codex SDK 0.153.4 | Retained as benchmark environment setup: removes the observed compatibility blocker while preserving the ordinary Cligent permission wrapper; no compiler speed claim |
| Early FSM conformance and bounded same-Coder repair | Recovery demonstrated; accepted performance evidence pending |
| Preserve exact repository-root predicates during optimization | Upstream fix `f0f032b`; follow-up `40d8538` corrects examples to actual GEARS blockquotes after the fenced-body failure; corrected live acceptance pending |
| Fresh session at each phase's first call | No demonstrated benefit and no adoption: the settled run failed after 194.19 s in FSM; a simultaneous optimizer-definition edit prevents isolating the session policy |
| Typed FSM construction helpers | Unimplemented, unmeasured and deferred until link materialization is evaluated; estimated 15–25% emitted-byte reduction, with no latency claim |
| Noninteractive source clarification | Retained feature: live Opus check returned structured questions and exit 2 in 19.16 s, with unchanged source, no accepted output and no build history; not a successful compile |

The [clarification evidence](</private/tmp/slc-live-clarification-27abde0w/evidence.json>) remains local because its questions quote source text. Only result flags, identities and timing are copied into the sanitized record.

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

Every run creates a fresh evidence directory. The deadline covers compilation and validation. The default minimal workflow now requires entry import, all four generated suite kinds, and a real installed-host-capability runtime check: its nested directory must acquire its own repository before exactly one synthetic performing agent receives the exact Boss task and makes one commit, then reaches a successful terminal. An arbitrary `--source` receives this specific acceptance check only with `--runtime-check minimal`.

The JSON records reconstructed historical commands, including the frozen compiler and split pipeline paths. For GPT-6, the preserved isolated tree at `/private/tmp/slc-gpt6-runtime-mlgyv8pk` was installed with ordinary offline `npm ci` followed by `npm install --offline --save-dev --save-exact @openai/codex-sdk@0.153.4`; no global configuration or root lockfile was changed. See its [runtime setup evidence](</private/tmp/slc-gpt6-runtime-mlgyv8pk/runtime-evidence.json>).

The frozen baseline and isolated compiler JavaScript directory digests match: `0b6d85a4a01fdab7a78d32699a398f7874e7ab5b6b0069252b41db1940e125aa`. They were hashed retrospectively from preserved copies. The baseline and isolated lock hashes differ and are recorded in full in the JSON. Exact executing-runtime hashes were not captured for the earlier live clarification and mutable early-gate candidate; those identities are explicitly unavailable. New measurements capture SDK versions and compiled JavaScript identities automatically.

Single observations and changing provider conditions do not prove causal speedups. The remaining acceptance work is to demonstrate correct output under five minutes, isolate each retained technique's contribution, and verify the broader two-agent demo. Ongoing runs are excluded from this settled-results checkpoint.
