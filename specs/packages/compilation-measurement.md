<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# compilation-measurement: Compilation Measurement

## Intent

This package specifies opt-in local compilation experiments with reproducible inputs, bounded execution, and durable timing evidence, per [DR-031](../decisions/031-measured-compilation-performance.md).
It does not change ordinary compiler execution or define a production latency guarantee.

## External Behavior

### compilation-measurement-1

When explicitly invoked with a model, the compilation benchmark shall compile the minimal three-line acceptance workflow or an explicitly supplied source through the ordinary compiler [[compiler-1](compiler.md#compiler-1)] in a newly created output directory without prior build history, preserving the supplied source bytes and accepting explicit agent, effort, configuration, pipeline roots, optimization, and independent-review selections, with independent review disabled by default.

### compilation-measurement-2

When the benchmark records an experiment, the compilation benchmark shall retain a machine-readable summary containing source and pipeline-definition byte identities, requested model and effective agent settings, dependency and provider SDK versions, compiled JavaScript runtime byte identities, invocation settings, phase durations, individual adapter-call durations and completion statuses, prompt byte counts and hashes, event and tool-call counts, and usage where the adapter reports it, with unreported accounting absent rather than fabricated.

### compilation-measurement-3

While an experiment is running, when its configurable deadline expires, the compilation benchmark shall cancel the in-flight execution [[cli-5](cli.md#cli-5)] and retain the incomplete or failed experiment as failure, using twenty minutes when no deadline is supplied.

### compilation-measurement-4

Where full compilation is selected, when a compilation completes successfully, the compilation benchmark shall separately time loading the emitted entry and executing its emitted verification suite [[verification-2](verification.md#verification-2)], recording experiment success only after those checks succeed before cancellation.

### compilation-measurement-5

When writing experiment evidence, the compilation benchmark shall preserve raw diagnostics in a local log while omitting prompt, response, and diagnostic text from its machine-readable summary and metric records, updating partial evidence as phases and calls progress and retaining every experiment directory after settlement.

### compilation-measurement-6

Where the benchmark's fresh-phase-session experiment is explicitly enabled, when an adapter receives a phase's first call, the compilation benchmark shall omit that call's inherited continuation token while preserving later continuations within that phase and recording both requested and actual continuation presence, without changing the ordinary compiler's defaults.

### compilation-measurement-11

Where the benchmark uses its default minimal workflow or an explicitly selected minimal runtime-check profile, when emitted artifact checks pass, the compilation benchmark shall additionally drive the emitted entry with real installed Playbook host capabilities in a fresh nested directory inside an ancestor repository, requiring that directory to become its own repository before exactly one synthetic delegated agent receives the exact Boss task and commits one change, followed by a successful terminal outcome and an unchanged ancestor repository, with setup executed either by the emitted script or one preceding synthetic Captain whose prompt carries the Git initialization and own-working-directory scope, optional initial classification selected from one offered non-control event, and adjudication selected from the offered sole normal guard without judge-authored payloads, failing with an unsupported-profile diagnostic for other prompt contracts, with the runtime check covered by the experiment deadline and recorded separately; an explicitly supplied source receives no minimal-specific check unless selected.

### compilation-measurement-13

Where an explicit link target and explicit `.fsm.ts` source are supplied, when a link-only benchmark runs, the compilation benchmark shall invoke the ordinary single link phase [[pipeline-18](pipeline.md#pipeline-18)] against an unchanged fresh copy of that FSM, record scope `link` instead of the default `full` together with the link-target byte identity and ordinary phase and adapter accounting [[compilation-measurement-2](#compilation-measurement-2)], reject optimization and minimal-runtime selections in this scope, and accept only one linked output whose existing linked-module contract check [[verification-27](verification.md#verification-27)] passes through the measured compiler with an importable unchanged FSM before the experiment deadline; this success shall remain a link-only measurement and shall not replace full-compilation validation [[compilation-measurement-4](#compilation-measurement-4)], [[compilation-measurement-11](#compilation-measurement-11)] or count toward the cold full-compilation target.

## Verification

### compilation-measurement-7

Where a fixture pipeline runs through the ordinary compiler with a measured fixture adapter, when the integration suite invokes the benchmark twice over identical source bytes, the suite shall verify distinct fresh output directories and effective one-agent settings [[compilation-measurement-1](#compilation-measurement-1)], recorded source and compiled-runtime identities, SDK versions, and actual phase and call measurements with authentic reported usage [[compilation-measurement-2](#compilation-measurement-2)], separately recorded validation success [[compilation-measurement-4](#compilation-measurement-4)], and retained evidence that excludes fixture prompt and response text from summaries and metrics [[compilation-measurement-5](#compilation-measurement-5)].

### compilation-measurement-8

Where a fixture adapter waits for cancellation, when the benchmark's configured deadline expires during an ordinary pipeline run, the integration suite shall verify cancellation reaches that adapter and the retained experiment reports failure rather than a successful duration [[compilation-measurement-3](#compilation-measurement-3)], [[compilation-measurement-5](#compilation-measurement-5)].

### compilation-measurement-9

Where a fixture pipeline has two phases and its adapter supplies a continuation token after each successful call, when the integration suite compares ordinary and fresh-phase-session experiments, the suite shall verify the second phase receives the token ordinarily and receives none with the experiment enabled, while measurements distinguish requested from actual continuation [[compilation-measurement-6](#compilation-measurement-6)].

### compilation-measurement-10

Where a fixture bundle supplies an entry and all four emitted verification-suite kinds, when the integration suite executes benchmark artifact validation before and after injecting an assertion failure into one suite, the suite shall verify successful entry loading and validation of the intact bundle followed by failed validation of the changed bundle [[compilation-measurement-4](#compilation-measurement-4)].

### compilation-measurement-12

Where a minimal entry uses the installed shared runtime and real host capabilities, when the integration suite runs the benchmark runtime check across faithful script setup, faithful Captain setup with initial classification and an authored normal guard, ancestor-repository reuse, omitted Boss text, repeated delegated calls, and a failure terminal, the suite shall verify that only the faithful behavior passes and that arbitrary supplied sources omit the minimal check unless selected [[compilation-measurement-11](#compilation-measurement-11)].

### compilation-measurement-14

Where a fixture link phase receives a fixed FSM and a supplied link target, when the integration suite runs the link-only benchmark, the suite shall verify a fresh single link invocation, unchanged input bytes, explicit scope and target identity, preserved adapter metrics, accepted faithful linking, rejected linked prompt drift, and refusal of a missing FSM source or irrelevant options before adapter work [[compilation-measurement-13](#compilation-measurement-13)].
