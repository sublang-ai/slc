<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-006: SLC Configuration Sources and Precedence

## Status

Accepted

## Context

`slc` reaches coding agents through Cligent (npm `@sublang/cligent` [[1]]); agent, model, and pipeline-path selection is `slc` configuration, not phase semantics ([DR-004](004-slc-interpreted-phase-execution.md#interpreter)).
Today that configuration is environment-only — `SLC_AGENT`, `SLC_MODEL`, and `SLC_PIPELINE_PATH` ([CLI-6](../dev/cli.md#cli-6), [CLI-7](../dev/cli.md#cli-7), [CLI-12](../dev/cli.md#cli-12)) — which is awkward for a persistent per-project or per-user setup.
Cligent's sibling `tmux-play` reference app already establishes a config-file ergonomic: a YAML file discovered cwd-first then under `${XDG_CONFIG_HOME:-~/.config}`, with a `--config` override.
`slc` should offer that same shape with a smaller surface, without disturbing existing env-only runs.
This DR settles the sources and their precedence, discovery, the schema (including the `pipelinePath` value shape and relative base), validation, and what stays out of scope.

## Decision

### Sources and precedence

- Configuration is drawn from three sources, resolved independently per key, highest precedence first:
  1. the matching environment variable;
  2. the config file;
  3. the built-in default.
- Environment overrides file so every current env-only run is unchanged and the unset-agent refusal ([CLI-12](../dev/cli.md#cli-12)) still fires only when neither environment nor file supplies an agent.
- Each key maps one-to-one to an existing environment variable, so the two sources are interchangeable per key.

| Key | Type | Meaning | Environment equivalent |
| --- | --- | --- | --- |
| `agent` | string | supported agent CLI id | `SLC_AGENT` |
| `model` | string (optional) | model for the agent CLI | `SLC_MODEL` |
| `pipelinePath` | sequence of strings | pipeline search roots | `SLC_PIPELINE_PATH` |

### File format and discovery

- The config file is a single flat YAML document.
- Absent an explicit `--config`, discovery reads `slc.config.yaml` in the cwd, then `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml`; the first file found wins and cwd takes precedence over home.
- `--config <path>` names a specific file and disables discovery.
- An explicit `--config` path that does not exist is an error, whereas a discovery miss is not — it falls through to environment and defaults, so an optional config may be absent but a mistyped `--config` fails loudly rather than silently degrading.
- `slc` does not auto-create a default config in this iteration; unlike `tmux-play`, a missing config is never written.

### `pipelinePath` shape and base

- `pipelinePath` is a YAML sequence of path strings, not an OS path-list string: a sequence is idiomatic in YAML and avoids embedding OS-dependent `:`/`;` separators.
  The environment form `SLC_PIPELINE_PATH` stays an OS path-list string; because precedence is per-key and wholesale, the two forms need not match.
- Relative `pipelinePath` entries resolve against the cwd, consistent with `SLC_PIPELINE_PATH` ([CLI-6](../dev/cli.md#cli-6)) and independent of which file supplied them; absolute entries are used verbatim.
  Rejected: resolving against the config-file directory — `tmux-play` does this for `captain.from`, a module reference bound to the config's location, but pipeline search roots describe the user's workspace, so a cwd base is the predictable reading, especially for the shared home config.

### Validation

- Malformed YAML, an unknown top-level key, a wrong-typed value, an `agent` outside the supported set, or an absent explicit `--config` path each refuse the run with a diagnostic naming the offending source and execute no phase.
- Unknown-key rejection is strict so a typo surfaces at load time instead of falling through to a default.

## Consequences

- Users can persist agent, model, and pipeline settings per project (cwd) or per user (home) without exporting environment variables; environment remains the per-invocation override.
- Existing env-only behavior and the [CLI-12](../dev/cli.md#cli-12) refusal are preserved; the file is purely additive.
- A `--config` typo fails loudly, while an absent discovered config is benign.
- A cwd-relative `pipelinePath` sequence reads the same regardless of which source supplied it, so a home default such as `[./pipelines]` means the same thing wherever `slc` runs.
- A YAML parse dependency and a config-loading surface are added.
- A `permissions` block (the [DR-003](003-slc-phase-execution.md) write-scope sandbox), `maxTurns`, first-run auto-create, legacy-file handling, and config snapshotting are out of scope and may extend this DR later.

## References

[1]: https://www.npmjs.com/package/@sublang/cligent "Cligent: Unified TypeScript SDK for AI Coding Agent CLIs"
