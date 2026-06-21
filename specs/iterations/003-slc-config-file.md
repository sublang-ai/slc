<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-003: SLC Config File for the Cligent Invocation

## Goal

Add a simple, optional YAML config file that supplies `slc`'s cligent-invocation
settings — agent, model, and pipeline search path — so a user can configure a run
without exporting environment variables, mirroring the discovery ergonomics of
cligent's `tmux-play` config ([../cligent `docs/tmux-play.md`], a sibling app on
the same `@sublang/cligent` SDK).
Environment variables remain overrides, so every current env-only run keeps its
exact behavior and the file is purely additive.

- Context: today the bin configures the cligent invocation only from `SLC_AGENT`, `SLC_MODEL`, and `SLC_PIPELINE_PATH`, resolved in `buildSlcDeps`/`resolveAgentSelection`/`pipelineSearchRoots` ([CLI-6](../dev/cli.md#cli-6), [CLI-7](../dev/cli.md#cli-7), [CLI-12](../dev/cli.md#cli-12)).
- Reference model: `tmux-play` discovers `tmux-play.config.yaml` in the cwd, then `${XDG_CONFIG_HOME:-~/.config}/tmux-play/config.yaml`, lets `--config <path>` disable discovery, parses YAML, and rejects unknown keys; `slc` adopts the same discovery shape with a much smaller flat schema.
- Strategy: an additive host layer — a config loader feeds the same agent/model/pipeline-path selection the bin already builds, leaving the `runSlc` core, the interpreter ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)), and the `createCligentAgent` transport untouched.
- Constraint: configuration stays a selection concern that does not change phase semantics ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#interpreter), [PHEXEC-13](../dev/phase-execution.md#phexec-13)).
- Out of scope: auto-creating a default config on first run, a `permissions` block (the DR-003 write-scope sandbox), `maxTurns`, legacy-file handling, and config snapshotting — each is a natural follow-up IR but is omitted here to keep the first iteration simple.

## Deliverables

- [ ] A DR settling the slc configuration sources: YAML file format, discovery order, `--config` precedence, env-over-file precedence, schema, and validation, registered in `map.md`
- [ ] Revised and extended `cli` user/dev spec items so configuration is "config file overridden by environment," with the unset-agent refusal firing only when neither source supplies an agent ([CLI-7](../dev/cli.md#cli-7), [CLI-12](../dev/cli.md#cli-12), [CLI-2](../user/cli.md#cli-2))
- [ ] A config-file loader: cwd/home discovery, `--config` override, YAML parse, flat-schema validation with unknown-key rejection, and a partial selection result
- [ ] The loader wired into `buildSlcDeps` with env-over-file precedence and a `--config <path>` flag, with `usageText` naming the config file
- [ ] Integration tests covering file-only configuration, env override, `--config`, and the neither-source refusal, with the `runSlc` core and DRs unchanged
- [ ] User-facing docs showing a minimal example config and the discovery order

## Tasks

1. **Author the configuration-sources DR.**
   Record the design decision for `slc` configuration: a flat YAML file; discovery of `slc.config.yaml` in the cwd, then `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml`; an explicit `--config <path>` that disables discovery; precedence of environment variable over file over built-in default; the schema (`agent`, `model`, `pipelinePath`); strict unknown-key rejection; and no auto-create in this iteration.
   State the rationale that env-over-file precedence keeps every current env-only run unchanged and preserves the [CLI-12](../dev/cli.md#cli-12) refusal when neither source supplies an agent.
   Register the DR in `map.md` and add SPDX headers per [LIC-1](../dev/licensing.md#lic-1)/[LIC-2](../dev/licensing.md#lic-2).

2. **Revise and extend the user and dev `cli` items.**
   Reword [CLI-7](../dev/cli.md#cli-7) and [CLI-12](../dev/cli.md#cli-12) so the agent/model selection is drawn from the config file overridden by the environment, with the refusal firing only when neither the file nor `SLC_AGENT` supplies an agent; reword [CLI-6](../dev/cli.md#cli-6) so the pipeline search roots may come from the file; and update [CLI-2](../user/cli.md#cli-2) so help names the config file and `--config`.
   Add new higher-numbered `cli` items (IDs above the current maximum, per [META-12](../meta.md#meta-12)) for config-file discovery and precedence (dev), the `--config <path>` flag and the config file as a configuration source named in help (user), citing the Task 1 DR.
   Update the `cli` summaries in `map.md`.

3. **Implement the config-file loader.**
   Add the `yaml` dependency; implement a loader that performs cwd/home discovery (or honors an explicit `--config` path), parses YAML, validates the flat schema, rejects unknown keys and malformed values with a clear diagnostic, and returns a partial `{ agent?, model?, pipelinePath? }` plus the resolved path, returning an empty result when no file is found.
   Unit-test discovery order, the `--config` override, unknown-key and parse-error rejection, and the missing-file no-op.

4. **Wire the loader into the bin.**
   Merge the loaded file with the environment under env-over-file precedence, feed the merged values into `resolveAgentSelection`/`pipelineSearchRoots`, add a `--config <path>` flag, and update `usageText()` to name the config file and its discovery order.
   Leave the `runSlc` core, `createInterpretedExecutor`, and `createCligentAgent` unchanged.

5. **Author the test `cli` items.**
   Write integration/system test items, each with a `Verifies:` line ([META-20](../meta.md#meta-20), [META-21](../meta.md#meta-21)) citing the Task 2 user/dev items: file-only configuration runs; environment overrides the file; `--config` loads a specific file; an unknown key or malformed YAML is refused; and a run with neither source supplying an agent is refused.
   Register in `map.md`.

6. **Integration tests and docs.**
   Implement the Task 5 items against the bin with a fake resolver and faked agent transport, asserting the merged selection and the refusal/exit codes; add user docs (README or a docs note) with a minimal `slc.config.yaml` example and the cwd-then-home discovery order.

## Acceptance criteria

- A run configured solely by `slc.config.yaml` (cwd) or `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml` resolves the agent, model, and pipeline search path and runs, with no `SLC_*` variables set.
- An environment variable overrides the corresponding file value; when neither the file nor `SLC_AGENT` supplies an agent, the run is refused with a diagnostic and no phase runs ([CLI-12](../dev/cli.md#cli-12) preserved).
- `--config <path>` loads that file and disables cwd/home discovery.
- An unknown key or malformed YAML is rejected with a clear diagnostic, no phase runs, and the exit code is non-zero.
- The `runSlc` core, the interpreter, and the `createCligentAgent` transport are unchanged; `map.md` and the `cli` specs reflect the new configuration source; auto-create, permissions, and snapshotting remain out of scope.
