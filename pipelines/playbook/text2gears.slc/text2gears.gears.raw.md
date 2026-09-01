<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Text-to-GEARS Transformation

## Intent

First phase of a playbook (a state-machine agent orchestrating other agents).
Transforms a user's procedure description into normative GEARS [[1]] spec items.
The Source is a free-form natural-language description in the `text` format with extension `.md`; the Target is a package of GEARS spec items in the `gears` format with extension `.md`.
The second phase (spec items to state machine) is out of scope.

The Source of this package is itself the normative specification of a transformation, so it declares no roles and prompts none: its implied procedure is that Captain performs the specified transformation on request.

## Behaviors

### T2G-1

When a transformation request names a `text` Source (`.md`) and a `gears` Target (`.md`), Captain shall carry out the text-to-GEARS transformation as specified:

> Transform the named Source into the named Target: read the Source procedure description and compose a package of normative GEARS spec items.
> Follow the GEARS definition shipped by the installed `@sublang/spex` package: `@sublang/spex/scaffold/specs/meta.md` (English) and `@sublang/spex/scaffold/i18n/zh/specs/meta.md` (Chinese).
> The second phase, spec items to state machine, is out of scope.
> Roles name playbook-local delegated work functions.
> Boss, the human user, and Captain, the coordinating agent, are fixed actors that remain outside the role list.
> Take delegated roles from Source's opening `Roles:` section when Source declares one.
> Each role shall be unique and shall not alias another role; concrete player selection and sharing belong to explicit host configuration.
> Role names shall also be unique after canonical lowercase-id derivation, so declarations such as `Coder` and `coder` reject rather than collapse to one manifest role.
> Capitalize English role names, for example `Writer`, and quote non-English names, for example `作者`, when needed to distinguish them from prose.
> Each spec item names a condition, one behavior kind, and the complete prompt for that behavior.
> Every emitted item shall use the exact Markdown heading form `### <ITEM-ID>`.
> An item heading at `##`, `####`, or another level is not GEARS item syntax and will not be visible to downstream compilers or verification.
> The behavior kind shall be one of: direct Captain work, delegated-role work, or a literal or dynamic nested playbook call.
> Direct Captain work is written `Captain shall <behavior>:` without naming a delegated role.
> Delegated-role work is written `Captain shall prompt <Role>:` or the existing `Captain shall relay ... to <Role> ...:` form.
> Direct Captain work means the coordinating Captain performs the behavior itself, and shall not be rewritten as `Captain shall prompt Captain`, because Captain is a distinct runtime actor rather than a role binding.
> Delegated work shall name the declared role that receives the prompt.
> Prompts shall be blockquoted, one point per line.
> When Source already supplies the complete blockquoted acting prompt for a behavior, preserve those prompt lines exactly, apart from the documented Markdown unescaping.
> Do not promote surrounding conditions, invariants, result fields, or continuation mechanics into that blockquote; those requirements remain in the item's condition or `Results:` metadata.
> Adding control-oriented prompt lines merely to restate them changes the Boss-visible contract and is nonconformant.
> Source may compose one acting prompt from authored Markdown instruction blocks and runtime context that it explicitly says to relay in quotes (`>`).
> A fenced `markdown` block introduced as an instruction or prompt is an authored static prompt fragment: its fence delimiters are Source syntax, while every interior line and blank line is prompt content preserved after documented Markdown unescaping.
> An instruction fence and a relayed-context fragment that apply to one behavior shall appear in the target blockquote in their Source order.
> Distinct non-empty fragments shall be separated by one blank prompt line unless Source explicitly supplies a different boundary.
> Do not move a shared instruction ahead of behavior-specific context, do not move quoted evidence after an instruction that Source says follows the evidence, and do not otherwise regroup fragments for convenience.
> Where Source says that a runtime value is relayed in quotes, the leading `>` is prompt content rather than Source-only blockquote syntax.
> If Source supplies a blockquoted template for that relay, keep one literal leading `>` on every quoted line, so the target GEARS line uses its outer blockquote marker followed by the literal marker, such as `> > Coder output: <coder-output>`.
> If Source names the relayed value but supplies no template, emit its canonical typed placeholder on a line beginning with literal `> `, and do not summarize, paraphrase, or invent a value in its place.
> An ordinary Source blockquote that specifies a complete acting prompt without requiring quoted relay retains the preservation rule above: its one leading marker is Source syntax and is not prompt content.
> Source statements that assign active-leaf routing, call identity, suspension, or return matching to the host describe execution preconditions rather than behaviors for Captain to perform.
> Use such a statement only as a condition on an actual behavior when needed, and do not emit a standalone direct-Captain item that asks Captain to implement host stack bookkeeping.
> Retain a host-owned input catalog's immutability as a condition or invariant on the behaviors that consume the catalog, never as an LLM action that can replace or mutate host configuration.
> Opening source invariants consumed by later behaviors shall remain explicit in the emitted conditions or prompts rather than being summarized away.
> In particular, preserve the declared exact entry shape of a structured host catalog and any progress invariant that makes a decide-call-observe plan finite, such as `remainingPlan` containing only calls after the selected call and strictly shrinking on continuation.
> A source invariant that restricts a nested-call target to a non-empty member of an input catalog is a condition on that call item, not a separate Captain rejection behavior, unless Source requires an observable response distinct from taking or skipping the call.
> When Source gives an acting behavior more than one possible outcome, emit its machine-facing result contract immediately after the complete blockquote, outside the acting prompt, as a `Results:` label followed by one bullet per result.
> `Results:` shall be a plain label rather than a heading.
> Every result shall occupy one bullet with exactly a backtick-delimited guard name, a colon, and a non-empty description.
> The guard name shall match the ASCII identifier pattern `[A-Za-z_$][A-Za-z0-9_$]*`.
> The bullet order is authoritative, guard names are unique within the item, and the description shall name every required output property with its exact case-sensitive identifier.
> A produced value consumed later shall have a declared producer: where any later item's blockquote reads a value through a `<placeholder>`, the item whose behavior produces that value shall declare the `Results:` contract whose relevant description names the produced output property, using the placeholder's exact identifier, which is what lets the FSM thread the value through typed context.
> A single-outcome producer then declares exactly one bullet naming the property; this consumed-output case is the sole one in which a single-outcome behavior carries a `Results:` label.
> Where a later prompt relays a delegated player's whole final response as quoted context, the producer shall declare that property in the exact annotated form `` `<field>: <verbatim final text>` ``.
> The annotation makes the field runtime-owned: the adjudicator selects the result guard, while the linked runtime carries the player's canonical final text into that field instead of asking a judge to reproduce it.
> A distinct typed field extracted from that response remains judge-authored even when a later prompt quotes its exact value; quoting a field does not turn it into the player's whole final response.
> One property name shall not be annotated as verbatim in one result contract and judge-authored in another; choose distinct properties or report that the Source cannot be represented by the current contract.
> Result metadata is compiler control data, not part of the acting agent's prompt.
> Do not put guard names, result-property schema, JSON control instructions, or adjudicator instructions inside the blockquote unless Source explicitly requires the acting agent to show that machine syntax to the user.
> Move Source's outcome contract into `Results:` while preserving the human domain instructions in the blockquote.
> Do not emit the framework-owned `needsBossReply` result; gears2fsm adds that universal result for every Captain- or player-invoking state.
> Where Source restricts an initial Captain to routing, preserve only the authored question and delegation outcomes, and do not infer a direct-answer or terminal result merely because Captain is the acting agent.
> A single-outcome behavior whose output no later item consumes carries no `Results:` label, because gears2fsm gives its state the default single-outcome contract, so do not invent a one-bullet `Results:` block for it.
> When a later item does consume its output, apply the produced-value rule above instead.
> Where a direct-Captain or delegated-player behavior may ask Boss a question and wait, Boss's answer resumes that same behavior with continuation context; it is not a distinct behavior item.
> Keep the question result, the wait, and the answer-dependent continuation on the originating item even when the answer changes its complete runtime prompt.
> Do not emit a second item solely for "Boss answers," "after the question," or clearing the consumed question or reply; the FSM and linker own the same-leaf suspension, continuation blocks, and consumed-context cleanup.
> This rule is an exception to splitting by accumulated prompt content: split only when Source requires a genuinely different acting behavior after the reply, not when the same decision or task continues with Boss's answer.
> Apply the same consolidation when Source says a fresh directive interrupts parked work and restarts the same behavior with cleared context.
> When the acting prompt and result contract are identical, retain the interrupt as an entry condition on the originating item, and do not duplicate that item solely to describe the restart.
> Split only when the fresh directive invokes genuinely different acting work or a different prompt or result contract.
> Where two or more delegated-player items share one trigger and Source requires them to run independently before later work uses all results, place `Parallel group: <stable-kebab-case-id>` immediately below each item heading.
> Every item in one parallel group shall receive the same completed-prior-group inputs; no item prompt may depend on another member's result from the current group.
> Every member shall delegate to a distinct named role; a group that repeats one canonical role is malformed because one role resolves to one player.
> Direct-Captain work shares one Captain session and nested calls share one pending-child stack slot, so neither kind may receive parallel-group metadata.
> If Source explicitly requires either unsupported kind to run concurrently, report that the source cannot be represented rather than silently serializing it or emitting metadata the next phase cannot compile.
> Where Source requires one playbook to call a statically known playbook, emit an item whose behavior uses `Captain shall call playbook <playbook-id>:` and whose blockquote is the complete JSON-safe input-text template for that call.
> The literal target id shall be a stable configured playbook id, not a slash command or module specifier.
> Where Source selects the target at runtime, emit instead the first-class dynamic form ``Captain shall call playbook selected by `<playbook-id-context>`:``.
> The backtick-delimited name identifies a typed FSM context field whose runtime value is the target playbook id; it is not itself a target id.
> For the dynamic form, the blockquote shall be exactly one placeholder naming the typed context field whose runtime string is the complete child input text.
> The dynamic form shall not use a slash command, module specifier, opaque expression, or prose from which a downstream compiler would have to infer either field.
> A GEARS package may also contain deterministic script behaviors, written `Captain shall run:` followed by a blockquote whose lines are the exact POSIX shell script to execute.
> Never emit this script kind: script items enter a GEARS package only through the separate optimize pass, which rewrites eligible compiled items.
> A script item's blockquote is static shell text: it shall contain no `<placeholder>`, and Markdown escapes resolve exactly as in acting prompts.
> A script item shall carry a `Results:` label with exactly two bullets in this fixed interpretation: the first guard reports the script exiting with status zero, the second reports a nonzero exit status.
> No other result, and no `needsBossReply`, applies to a script item, because a script has no agent to surface questions.
> Write Target in the same language as Source: an item's condition prose, acting prompts, and result descriptions follow the Source language, read per the matching localization of the GEARS definition.
> The four `Captain shall` acting-clause forms above, namely direct, delegated, nested playbook call, and script, along with guard names and the `Roles:` and `Results:` labels, are fixed machine syntax and stay in this exact English form regardless of Source language.
> A Source may itself be the normative specification of a transformation, for example a compiler phase definition, as when a meta pipeline compiles such a file.
> Such a Source declares no roles and prompts none; its implied procedure is that Captain performs the specified transformation on request.
> Compose Captain-acting spec items for it: when a transformation request names the specification's source and target, Captain shall carry out the transformation as specified.
> Its prompts shall carry the specification's normative requirements as instructions to Captain, deduplicated, one point per line, without inventing roles, triggers, or requirements the specification does not state.
> Source snippets may overlap or duplicate; when composing them into a spec item, deduplicate identical prompt lines.
> Do not deduplicate across distinct authored fragments when doing so would erase a fragment boundary or change the Source-ordered prompt.
> Each spec item addresses one state behavior and carries its full final prompt, that is, the static part.
> Cross-item duplication is acceptable: spec items are compiled artifacts, and Source is what users maintain.
> A human shall be able to simulate a run by copying any single item's prompt verbatim, with no cross-item composition needed.
> Use `<placeholder>` for dynamic values in blockquoted prompts.
> Everything else inside a blockquote is static text, not an example; examples belong in surrounding prose.
> Markdown escaping is Source syntax, not content: resolve escapes during extraction, so that `\<placeholder\>` becomes `<placeholder>` and compiled artifacts carry plain text.
> Partition items by every variable that determines prompt content, including accumulated state when the trigger alone does not.
> Drop disjunctive branches incompatible with the rest of an item's condition or prompt, because dead branches mislead readers and downstream phases.

Results:
- `transformed`: Captain composed the Target package of GEARS spec items from the Source as specified.
- `unrepresentable`: Captain reported that the Source cannot be represented, rather than silently serializing a concurrency requirement the parallel-group metadata cannot carry, emitting metadata the next phase cannot compile, or annotating one property name as both verbatim and judge-authored.

## References

[1]: GEARS definition shipped by the installed `@sublang/spex` package: `@sublang/spex/scaffold/specs/meta.md` (English) and `@sublang/spex/scaffold/i18n/zh/specs/meta.md` (Chinese); canonical renditions [GEARS: AI-Ready Spec Syntax](https://sublang.ai/ref/gears-ai-ready-spec-syntax) (en) and [GEARS：面向 AI 的规约语法](https://sublang.ai/zh/ref/gears-ai-ready-spec-syntax) (zh)
