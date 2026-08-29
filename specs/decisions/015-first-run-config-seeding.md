<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-015: First-Run Config Seeding

## Status

Accepted

## Context

`agent` is `slc`'s one required setting with no built-in default ([DR-006](006-slc-configuration-sources.md)): a run with no config file and no `SLC_AGENT` refuses with `agent-unset`.
So the first thing every new user meets is a refusal, and every walkthrough carries a "create `~/.config/slc/config.yaml` first" step.

[DR-006](006-slc-configuration-sources.md)'s consequences anticipated this: "`slc` does not auto-create a default config **in this iteration**".
Playbook set the ecosystem precedent — its launcher seeds `~/.config/playbook/playbook.config.yaml` from a bundled starter template on first run (its PBCLI-11 [[1]]), and its `run` defaults every agent to `claude` [[2]].

## Decision

- When config discovery misses both the working-directory file and the user config file, `slc` seeds `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml` from a starter template bundled with the host, then loads it — so a first bare run proceeds instead of refusing.
- The starter template sets `agent: claude-code`, matching Playbook's `claude` default [[2]], and carries Coder `model` and `effort` plus [DR-022](022-two-agent-reviewed-compilation.md) Reviewer selection as commented examples so agent CLI defaults apply and reviewed execution remains disabled until the user chooses.
- Seeding is reported on stderr with the created path; it never overwrites an existing file.
- No seeding occurs when a working-directory config exists (discovery never reaches the user file), when `--config` names an explicit file (discovery is disabled, per [DR-006](006-slc-configuration-sources.md)), or when the user file already exists.
- Environment overrides are unchanged: `SLC_AGENT` and friends still win per key over the seeded file.

This supersedes [DR-006](006-slc-configuration-sources.md)'s "a missing config is never written" consequence; every other rule in that decision (precedence, discovery order, strict schema, explicit `--config` semantics) is unchanged.

## Consequences

- A fresh machine runs `slc <pipeline> <source>` with zero setup: the first run seeds the user config and compiles with `claude-code` on the agent CLI's default model.
- The seeded file is the natural home for user-wide `model`/`effort` choices, and repo-local `slc.config.yaml` files remain what they were: carriers of repo-specific `pipelinePath` and reproducibility pins, not a requirement for end users.
- A misconfigured template would fail loudly at load time under [DR-006](006-slc-configuration-sources.md)'s strict schema, not silently degrade.

## References

[1]: https://github.com/sublang-ai/playbook/blob/v1.0.0/specs/dev/playbook-cli.md#pbcli-11 "Playbook starter-config contract (v1.0.0)"
[2]: https://github.com/sublang-ai/playbook/blob/v1.0.0/specs/user/playbook-cli.md#pbcli-19 "Playbook run agent defaults (v1.0.0)"
