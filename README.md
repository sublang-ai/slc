# SubLang Compiler

`slc` runs phase pipelines, interpreting each phase with a coding agent reached
through [Cligent](https://www.npmjs.com/package/@sublang/cligent).

```bash
slc <pipeline>[.<phase>] <source> [-o <target>]
```

## Configuration

`slc` reads its cligent-invocation settings from an optional YAML config file,
overridden per key by environment variables. A blank or unset environment value
falls through to the file, then to the built-in default.

```yaml
# slc.config.yaml
agent: claude-code # claude-code | codex | gemini | opencode
model: claude-opus-4-8 # optional; omit to use the agent CLI's default
pipelinePath: # search roots for <pipeline> references; defaults to the cwd
  - ./pipelines
```

Discovery order (first match wins):

1. `slc.config.yaml` in the working directory.
2. `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml`.

`slc --config <path>` loads a specific file and disables discovery; a `--config`
path that does not exist is an error, whereas a discovery miss simply falls
through to the environment and defaults. Unknown keys, malformed YAML, and
wrong-typed values are rejected.

The matching environment variables, which override the file per key, are:

| Variable | Overrides | Meaning |
| --- | --- | --- |
| `SLC_AGENT` | `agent` | agent CLI: `claude-code`, `codex`, `gemini`, `opencode` |
| `SLC_MODEL` | `model` | optional model for the agent CLI |
| `SLC_PIPELINE_PATH` | `pipelinePath` | OS path-list of search roots (default: cwd) |

Credentials are read by the agent CLI from the inherited process environment.
Run `slc --help` for the full invocation and configuration summary.
