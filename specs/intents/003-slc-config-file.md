<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-003: SLC Config File for the Cligent Invocation

## Status

Done

## Intent

Add an optional YAML configuration file for the `slc` agent, model, and pipeline search path while retaining environment variables as overrides.
The resulting discovery, source-order, schema, and validation rationale are owned by [DR-006](../decisions/006-slc-configuration-sources.md).
The additive host layer fed the existing selection paths while leaving `runSlc`, the interpreted executor, and `createCligentAgent` unchanged.
Configuration remained a selection concern that did not change phase semantics, as required by [[phase-execution-13](../packages/phase-execution.md#phase-execution-13)].
Automatic creation, permissions, `maxTurns`, legacy-file handling, and configuration snapshots were not part of this iteration.
The delivered behavior and its verification are now owned by the [`cli`](../packages/cli.md) package.

## Deliverables

- [x] A DR settling the slc configuration sources: YAML file format, discovery order, `--config` precedence, env-over-file precedence, schema, and validation, registered in `map.md`
- [x] Revised and extended `cli` behavior items so configuration is "config file overridden by environment," with the unset-agent refusal firing only when neither source supplies an agent ([[cli-7](../packages/cli.md#cli-7)], [[cli-12](../packages/cli.md#cli-12)], [[cli-2](../packages/cli.md#cli-2)])
- [x] A config-file loader: cwd/home discovery, `--config` override that errors on an absent explicit path, YAML parse, flat-schema validation with unknown-key rejection, and a partial selection result
- [x] The loader wired into `buildSlcDeps` with env-over-file precedence and a `--config <path>` flag, with `usageText` naming the config file
- [x] Integration tests covering file-only configuration, env override, `--config`, and the neither-source refusal, with the `runSlc` core and DRs unchanged
- [x] User-facing docs showing a minimal example config and the discovery order

## Tasks

1. **Author the configuration-sources DR.**
   Record [DR-006](../decisions/006-slc-configuration-sources.md) to settle the flat YAML format, discovery and explicit-path distinction, precedence, schema and path base, strict validation, no-auto-create boundary, and environment-compatibility rationale.
   Register the decision in `map.md` and add SPDX headers per [[licensing-1](../packages/licensing.md#licensing-1)]/[[licensing-2](../packages/licensing.md#licensing-2)].

2. **Revise and extend the `cli` behavior.**
   Reword [[cli-7](../packages/cli.md#cli-7)] and [[cli-12](../packages/cli.md#cli-12)] so the agent/model selection is drawn from the config file overridden by the environment, with the refusal firing only when neither the file nor `SLC_AGENT` supplies an agent; reword [[cli-6](../packages/cli.md#cli-6)] so the pipeline search roots may come from the file; and update [[cli-2](../packages/cli.md#cli-2)] so help names the config file and `--config`.
   Add new `cli` items using the lowest available identities under [[meta-11](../meta.md#meta-11)] while preserving released identities under [[meta-12](../meta.md#meta-12)] for config-file discovery and precedence, the `--config <path>` flag, and the config file as a configuration source named in help, citing the Task 1 DR.
   Update the `cli` summaries in `map.md`.

3. **Implement the config-file loader.**
   Add the `yaml` dependency; implement a loader that performs cwd/home discovery (or honors an explicit `--config` path), parses YAML, validates the flat schema, rejects unknown keys and malformed values with a clear diagnostic, and returns a partial `{ agent?, model?, pipelinePath? }` plus the resolved path; a discovery miss returns an empty result that falls through to environment and defaults, whereas an explicit `--config` path that is absent is an error so a typo never silently falls back.
   Unit-test discovery order, the `--config` override, unknown-key and parse-error rejection, the discovery-miss no-op, and the explicit-`--config`-miss error.

4. **Wire the loader into the bin.**
   Merge the loaded file with the environment under env-over-file precedence, feed the merged values into `resolveAgentSelection`/`pipelineSearchRoots`, add a `--config <path>` flag, and update `usageText()` to name the config file and its discovery order.
   Leave the `runSlc` core, `createInterpretedExecutor`, and `createCligentAgent` unchanged.

5. **Author the `cli` package verification.**
   Write integration and system verification items for the Task 2 behavior, binding every assertion inline to its same-package behavior under [[meta-20](../meta.md#meta-20)] and keeping unit tests outside the specs under [[meta-21](../meta.md#meta-21)]: file-only configuration runs; environment overrides the file; `--config` loads a specific file while an absent `--config` path is refused and a discovery miss falls through; an unknown key or malformed YAML is refused; and a run with neither source supplying an agent is refused.
   Register in `map.md`.

6. **Integration tests and docs.**
   Implement the Task 5 items against the bin with a fake resolver and faked agent transport, asserting the merged selection and the refusal/exit codes; add user docs (README or a docs note) with a minimal `slc.config.yaml` example and the cwd-then-home discovery order.

## Verification

- Bin-boundary configuration scenarios [[cli-18](../packages/cli.md#cli-18)] and [[cli-23](../packages/cli.md#cli-23)] through [[cli-27](../packages/cli.md#cli-27)] preserve the iteration's acceptance coverage.
- The task commits kept `runSlc`, the interpreted executor, and `createCligentAgent` unchanged, while automatic creation, permissions, and snapshots were not part of this iteration.
