<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-059: Compiler Calls Turn Native Skills Off

## Status

Accepted (2026-10-20).

## Context

Coding agents discover skills by themselves in project and user skill folders and offer them to every run, beside any skills the caller supplies [[1]].
Environment managers now install persistent skills into exactly those folders [[2]].
A compile or link call that sees them follows instructions that are neither its definition, its inputs, nor their readable closure [[phase-execution-15](../packages/phase-execution.md#phase-execution-15)], so pins and build history cannot record them, and the same recorded inputs can compile differently on another machine.

Cligent 0.35.0 adds a per-run `nativeSkills` option: `false` turns off, as far as each adapter's levers reach, the skills a runtime discovers by itself [[1]].
Its published `NATIVE_SKILL_SUPPORT` metadata states per adapter whether `false` is accepted, and its notes say what still reaches the model [[3]]:

| Adapter | `nativeSkills: false` | What stays |
| --- | --- | --- |
| `claude-code` | accepted | marketplace plugin and managed policy skills in subagents, and, under an administrator policy tier that does not merge parent settings, project and user skills in subagents |
| `codex` | accepted; rejected where a native skill root cannot be read or the disabled paths exceed the process-argument bound | skills of plugins enabled in user configuration or the account |
| `gemini` | accepted; rejected where its per-run home cannot be built, its workspace skills cannot be read, its user settings cannot take the disabled names, or its settings expansion would change one | extension and built-in skills |
| `opencode` | accepted by the managed server; rejected in external server mode | configuration-directory skill folders and the built-in skill |
| `kimi` | rejected before backend invocation: no per-run lever exists | everything |

A resumed session keeps the skill listings and bodies already in its history [[1]].

## Decision

- Every agent call SLC's Cligent transport makes — interpreted Coder, Reviewer, compiled player, Captain, and judge — requests `nativeSkills: false` where Cligent's metadata reports the selected adapter accepts it.
- Where the metadata reports it does not — Kimi Code — or publishes nothing for the adapter, the transport omits the option and the call keeps the runtime's own skill discovery.
  The owner chose this documented reduction over refusing such an adapter; for Kimi Code it matches the prompt-only tool isolation SLC already accepts for known adapters without enforcement ([DR-012](012-playbook-routing-control-separation.md), [[phase-execution-31](../packages/phase-execution.md#phase-execution-31)]).
  Unlike that item's fail-closed handling of an unrecognized adapter's tool list, an adapter Cligent publishes no native-skill support for receives no request, because Cligent leaves that contract to the custom adapter and the owner chose to send `false` only where Cligent reports it is honored.
- A call Cligent still rejects under the switch fails like any other failed call; the transport never retries it without the switch.
- Resumption is unchanged: SLC resumes only conversations its own calls began under the same switch, and its control calls already start fresh.
- The switch is fixed host behavior: no configuration field, environment variable, or prompt change.
- The direct Cligent requirement rises to `^0.36.0`, the release Playbook's Captain control needs for the same switch [[4]], so one Cligent can serve both once Playbook requires it.

## Consequences

- On every agent the `slc` executable registers, persistently installed skills no longer reach compiler calls as far as the runtime allows, except in Claude Code subagents under an administrator policy tier that does not merge parent settings; the other skills each runtime keeps regardless stay outside SLC's reach.
- A call the runtime cannot isolate now fails rather than running with native skills: Codex with an unreadable skill root or more disabled skill paths than the process arguments hold, Gemini CLI when its per-run home or skill settings cannot be prepared, and every call of a library host's external-mode OpenCode adapter.
- On Claude Code the switch also drops, for these calls, any plugin placed in a project or user skill folder, with its agents, hooks, MCP servers, and commands; on Codex every disabled skill path appears in the process arguments [[3]].
- A library host passing a Kimi Code adapter keeps that runtime's native skills, so its compiler outputs can depend on inputs no pin records.
- Phase semantics, prompts, and artifacts are unchanged; pins change only where the lock's hash and Playbook's runtime-dependency identity record the new Cligent resolution.

## References

[1]: https://github.com/sublang-ai/cligent/blob/v0.35.0/specs/decisions/037-per-run-native-skill-switch.md "Cligent DR-037: Per-Run Native Skill Switch"
[2]: https://github.com/sublang-ai/spex/blob/main/specs/decisions/124-skills-reach-every-agent.md "Spex DR-124: Skills Reach Every Agent"
[3]: https://github.com/sublang-ai/cligent/blob/v0.35.0/specs/packages/skills.md#skills-11 "Cligent skills-11: native-skill support per adapter"
[4]: https://github.com/sublang-ai/cligent/blob/v0.36.0/specs/decisions/038-native-skills-in-tmux-play-call-settings.md "Cligent DR-038: Native Skills in tmux-play Call Settings"
