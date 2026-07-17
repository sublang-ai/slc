<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Text-to-GEARS Transformation

### T2G-1

When a transformation request names a free-form natural-language procedure description as source and a package of GEARS spec items as target, Captain shall compile the source into the target as specified:

> Transform the source's free-form natural-language procedure description into a package of normative GEARS spec items.
> Produce only GEARS spec items; the second phase that turns spec items into a state machine is out of scope.
> Write the target in the same language as the source.
> Follow GEARS item syntax for every emitted item: build each condition from GEARS clauses (optional `Where` static preconditions, optional `While` stateful preconditions, at most one `When` trigger) preceding the `shall` behavior.
> Deduplicate identical prompt lines when composing overlapping or duplicated source snippets.
> Make each spec item address one state behavior and carry its full final static prompt, so a human can simulate a run by copying any single item's prompt verbatim with no cross-item composition; cross-item duplication is acceptable because spec items are compiled artifacts while the source is what users maintain.
> Recognize two default players: Boss, the human user; and Captain, the coordinating agent.
> Read any additional players the source declares in an opening `Players:` section.
> Allow a player to alias other players with `=` and `|`, where Boss picks one at runtime (e.g., `Committer = Coder | Reviewer`).
> Capitalize English player names (e.g., `Writer`), and quote non-English player names (e.g., `作者`) when needed to distinguish them from prose.
> Give each spec item a condition, exactly one behavior kind, and the complete prompt for that behavior.
> Write every emitted item's heading in the exact Markdown form `### <ITEM-ID>`; a heading at `##`, `####`, or any other level is not GEARS item syntax and stays invisible to downstream compilers and verification.
> Use exactly one of these behavior kinds per item: direct Captain work written `Captain shall <behavior>:` without naming a delegated player; delegated player work written `Captain shall prompt <Player>:` or the existing `Captain shall relay ... to <Player> ...:` form; or a literal or dynamic nested playbook call.
> Treat direct Captain work as the coordinating Captain performing the behavior itself, and never rewrite it as `Captain shall prompt Captain`, because Captain is a distinct runtime actor rather than a player binding.
> For delegated work, name the declared player that receives the prompt.
> Blockquote every prompt, one point per line.
> Where the source already supplies the complete blockquoted acting prompt for a behavior, preserve those prompt lines exactly apart from resolving Markdown escapes, and do not promote surrounding conditions, invariants, result fields, or continuation mechanics into that blockquote; keep those requirements in the item's condition or `Results:` metadata.
> Do not add control-oriented prompt lines merely to restate conditions, invariants, or results, because that changes the Boss-visible contract and is nonconformant.
> Treat source statements that assign active-leaf routing, call identity, suspension, or return matching to the host as execution preconditions rather than behaviors for Captain to perform; use such a statement only as a condition on an actual behavior when needed, and never emit a standalone direct-Captain item that asks Captain to implement host stack bookkeeping.
> Treat a host-owned input catalog's immutability as a condition or invariant on the behaviors that consume the catalog, never as an LLM action that replaces or mutates host configuration.
> Keep opening source invariants that later behaviors consume explicit in the emitted conditions or prompts rather than summarizing them away.
> Preserve a structured host catalog's declared exact entry shape, and preserve any progress invariant that makes a decide-call-observe plan finite, such as `remainingPlan` containing only the calls after the selected call and strictly shrinking on continuation.
> Treat a source invariant that restricts a nested-call target to a non-empty member of an input catalog as a condition on that call item, not a separate Captain rejection behavior, unless the source requires an observable response distinct from taking or skipping the call.
> When a source behavior has more than one possible outcome, emit its machine-facing result contract immediately after the complete blockquote and outside the acting prompt, as a plain `Results:` label — not a heading — followed by bullets.
> Give each result exactly one bullet containing a backtick-delimited guard name, a colon, and a non-empty description.
> Match every guard name to the ASCII identifier pattern `[A-Za-z_$][A-Za-z0-9_$]*`, keep guard names unique within the item, treat the bullet order as authoritative, and make each description name every required output property with its exact case-sensitive identifier.
> Where any later item's blockquote reads a produced value through a `<placeholder>`, make the item whose behavior produces that value declare a `Results:` contract whose relevant description names the produced output property using the placeholder's exact identifier, so the FSM can thread the value through typed context.
> For a single-outcome producer whose output a later item consumes, declare exactly one `Results:` bullet naming that property; this consumed-output case is the sole case in which a single-outcome behavior carries a `Results:` label.
> For a single-outcome behavior whose output no later item consumes, emit no `Results:` label and do not invent a one-bullet block, because gears2fsm gives its state the default single-outcome contract.
> Treat result metadata as compiler control data rather than part of the acting agent's prompt.
> Do not put guard names, result-property schema, JSON control instructions, or adjudicator instructions inside a blockquote unless the source explicitly requires the acting agent to show that machine syntax to the user; move the source's outcome contract into `Results:` while preserving the human domain instructions in the blockquote.
> Never emit the framework-owned `needsBossReply` result; gears2fsm adds that universal result for every Captain- or player-invoking state.
> Where the source restricts an initial Captain to routing, preserve only the authored question and delegation outcomes, and do not infer a direct-answer or terminal result merely because Captain is the acting agent.
> Where a direct-Captain or delegated-player behavior may ask Boss a question and wait, keep the question result, the wait, and the answer-dependent continuation on that same originating item even when Boss's answer changes its complete runtime prompt, because Boss's answer resumes that same behavior rather than starting a distinct one.
> Do not emit a second item solely for "Boss answers," "after the question," or clearing the consumed question or reply; the FSM and linker own the same-leaf suspension, continuation blocks, and consumed-context cleanup.
> Treat this Boss-reply consolidation as an exception to splitting by accumulated prompt content, and split only when the source requires a genuinely different acting behavior after the reply, not when the same decision or task continues with Boss's answer.
> Apply the same consolidation when a fresh directive interrupts parked work and restarts the same behavior with cleared context: when the acting prompt and result contract are identical, keep the interrupt as an entry condition on the originating item, and split only when the fresh directive invokes genuinely different acting work or a different prompt or result contract.
> Where two or more delegated-player items share one trigger and the source requires them to run independently before later work uses all their results, place `Parallel group: <stable-kebab-case-id>` immediately below each of those item headings.
> Give every item in one parallel group the same completed-prior-group inputs, and let no item's prompt depend on another current-group member's result.
> Require every parallel-group member to delegate to a named player, and require the source to permit those members to resolve to distinct players.
> Never give parallel-group metadata to direct-Captain work, which shares one Captain session, or to nested calls, which share one pending-child stack slot.
> If the source explicitly requires direct-Captain work or a nested call to run concurrently, report that the source cannot be represented rather than silently serializing it or emitting metadata the next phase cannot compile.
> Where the source requires calling a statically known playbook, emit an item whose behavior is `Captain shall call playbook <playbook-id>:` and whose blockquote is the complete JSON-safe input-text template for that call, using a stable configured playbook id rather than a slash command or module specifier.
> Where the source selects the target playbook at runtime, emit the dynamic form ``Captain shall call playbook selected by `<playbook-id-context>`:``, where the backtick-delimited name identifies a typed FSM context field whose runtime value is the target playbook id and is not itself a target id, and make the blockquote exactly one placeholder naming the typed context field whose runtime string is the complete child input text.
> Never let the dynamic call form use a slash command, module specifier, opaque expression, or prose from which a downstream compiler would have to infer either the target-id field or the input field.
> Never emit script behaviors written `Captain shall run:` with a POSIX-shell blockquote; such items enter a GEARS package only through the separate optimize pass, whose fixed item-syntax contract — a static shell blockquote containing no `<placeholder>`, and a two-bullet `Results:` label whose first guard reports the script exiting with status zero and whose second reports a nonzero exit status, with no other result and no `needsBossReply` — exists only so every GEARS consumer shares one item-syntax contract.
> Use `<placeholder>` only for dynamic values in blockquoted prompts, and treat everything else inside a blockquote as static text rather than an example; put examples in surrounding prose.
> Resolve Markdown escaping as source syntax rather than content, so `\<placeholder\>` becomes `<placeholder>` and compiled artifacts carry plain text.
> Partition items by every variable that determines prompt content, including accumulated state when the trigger alone does not.
> Drop disjunctive branches incompatible with the rest of an item's condition or prompt, because dead branches mislead readers and downstream phases.
> When the source is itself the normative specification of a transformation and declares no players and prompts none, treat its implied procedure as Captain performing the specified transformation on request, and compose Captain-acting spec items whose prompts carry the specification's normative requirements — deduplicated, one point per line — without inventing players, triggers, or requirements the specification does not state.

Results:
- `compiled`: Captain emitted the target package of GEARS spec items as specified.
- `unrepresentable`: Captain reported that the source cannot be represented rather than emitting a package or metadata the next phase cannot compile.
