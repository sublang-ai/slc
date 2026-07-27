# Text-to-GEARS Transformation

### TEXT2GEARS-1

When Boss requests a Text-to-GEARS transformation naming its free-form text source and its GEARS target, Captain shall transform the source into a package of GEARS spec items:

> Transform the free-form natural-language procedure description (source) into a package of normative GEARS spec items (target), written as GEARS-format Markdown.
> Do not produce the second phase (spec items to state machine); it is out of scope.
> Default players are Boss (the human user) and Captain (the coordinating agent).
> If the source opens with a `Players:` section, carry its additional players; a player may alias others with `=` and `|`, and Boss picks one at runtime.
> Capitalize English player names; quote non-English player names when needed to distinguish them from prose.
> Give each spec item a condition, exactly one behavior kind, and the complete static prompt for that behavior.
> Head every emitted item with the exact Markdown heading form `### <ITEM-ID>`; never use `##`, `####`, or any other level, which is not GEARS item syntax and stays invisible to downstream compilers and verification.
> Make each behavior kind one of: direct Captain work `Captain shall <behavior>:` with no delegated player; delegated player work `Captain shall prompt <Player>:` or `Captain shall relay ... to <Player> ...:`; or a literal or dynamic nested playbook call.
> For direct Captain work, keep Captain acting itself; never rewrite it as `Captain shall prompt Captain`, since Captain is a distinct runtime actor, not a player binding.
> For delegated work, name the declared player that receives the prompt.
> Blockquote every prompt, one point per line.
> When the source already supplies the complete blockquoted acting prompt, preserve those lines exactly apart from resolving Markdown escapes, and do not promote surrounding conditions, invariants, result fields, or continuation mechanics into the blockquote; keep those in the item's condition or `Results:` metadata.
> Do not add control-oriented prompt lines merely to restate conditions or results; doing so changes the Boss-visible contract and is nonconformant.
> Treat source statements that assign active-leaf routing, call identity, suspension, or return matching to the host as execution preconditions, not Captain behaviors; use them only as a condition on an actual behavior when needed, and never emit a standalone direct-Captain item that asks Captain to implement host stack bookkeeping.
> Keep a host-owned input catalog's immutability as a condition or invariant on the behaviors that consume the catalog, never as an LLM action that can replace or mutate host configuration.
> Keep opening source invariants consumed by later behaviors explicit in the emitted conditions or prompts rather than summarizing them away.
> Preserve the declared exact entry shape of a structured host catalog and any progress invariant that makes a decide-call-observe plan finite, such as `remainingPlan` containing only the calls after the selected call and strictly shrinking on continuation.
> Treat a source invariant that restricts a nested-call target to a non-empty member of an input catalog as a condition on that call item, not a separate Captain rejection behavior, unless the source requires an observable response distinct from taking or skipping the call.
> When a source acting behavior has more than one possible outcome, emit its machine-facing result contract immediately after the complete blockquote, outside the acting prompt, as a `Results:` block.
> Write `Results:` as a plain label, not a heading.
> Make every result one bullet with exactly a backtick-delimited guard name, a colon, and a non-empty description.
> Match each guard name to the ASCII identifier pattern `[A-Za-z_$][A-Za-z0-9_$]*`.
> Keep the bullet order authoritative, guard names unique within the item, and each description naming every required output property with its exact case-sensitive identifier.
> Where any later item's blockquote reads a produced value through a `<placeholder>`, have the producing item declare a `Results:` contract whose relevant description names that produced output property using the placeholder's exact identifier.
> For a single-outcome producer whose output a later item consumes, declare exactly one `Results:` bullet naming that property; this consumed-output case is the sole case in which a single-outcome behavior carries a `Results:` label.
> Treat result metadata as compiler control data, not part of the acting agent's prompt.
> Do not put guard names, result-property schema, JSON control instructions, or adjudicator instructions inside the blockquote unless the source explicitly requires the acting agent to show that machine syntax to the user.
> Move the source's outcome contract into `Results:` while preserving the human domain instructions in the blockquote.
> Never emit the framework-owned `needsBossReply` result; gears2fsm adds that universal result for every Captain- or player-invoking state.
> Where the source restricts an initial Captain to routing, preserve only the authored question and delegation outcomes, and do not infer a direct-answer or terminal result merely because Captain is the acting agent.
> For a single-outcome behavior whose output no later item consumes, emit no `Results:` label and do not invent a one-bullet `Results:` block, since gears2fsm gives its state the default single-outcome contract.
> Where a direct-Captain or delegated-player behavior may ask Boss a question and wait, keep the question result, the wait, and the answer-dependent continuation on that same originating item, even when the answer changes its complete runtime prompt.
> Do not emit a second item solely for "Boss answers," "after the question," or clearing the consumed question or reply; the FSM and linker own same-leaf suspension, continuation blocks, and consumed-context cleanup.
> Split after a reply only when the source requires a genuinely different acting behavior, not when the same decision or task continues with Boss's answer.
> When a fresh directive interrupts parked work and restarts the same behavior with cleared context under an identical acting prompt and result contract, keep the interrupt as an entry condition on the originating item; split only when the fresh directive invokes genuinely different acting work or a different prompt or result contract.
> Where two or more delegated-player items share one trigger and must run independently before later work uses all results, place `Parallel group: <stable-kebab-case-id>` immediately below each such item's heading.
> Give every item in one parallel group the same completed-prior-group inputs, and let no item prompt depend on another current-group member's result.
> Require every parallel-group member to delegate to a named player that the source permits to resolve to a distinct player; never give parallel-group metadata to direct-Captain work or nested calls, which share one Captain session and one pending-child stack slot respectively.
> If the source explicitly requires direct-Captain work or a nested call to run concurrently, report that the source cannot be represented rather than silently serializing it or emitting metadata the next phase cannot compile.
> Where the source requires calling a statically known playbook, emit an item whose behavior is `Captain shall call playbook <playbook-id>:` and whose blockquote is the complete JSON-safe input-text template for that call, using a stable configured playbook id as the literal target rather than a slash command or module specifier.
> Where the source selects the target at runtime, instead emit `Captain shall call playbook selected by <playbook-id-context>:`, where the backtick-delimited name identifies a typed FSM context field whose runtime value is the target playbook id, not itself a target id.
> Make that dynamic blockquote exactly one placeholder naming the typed context field whose runtime string is the complete child input text.
> Never let the dynamic call form use a slash command, module specifier, opaque expression, or prose from which a downstream compiler would have to infer either field.
> Never emit script behaviors (`Captain shall run:`); script items enter a GEARS package only through the separate optimize pass.
> Write the target in the same language as the source, with item condition prose, acting prompts, and result descriptions following the source language, read per the matching localization of the GEARS definition.
> Keep the four `Captain shall` acting-clause forms (direct, delegated, nested playbook call, and script), guard names, and the `Players:` and `Results:` labels in their fixed English form regardless of source language.
> If the source is itself the normative specification of a transformation, declaring no players and prompting none, compose Captain-acting spec items whose trigger is a request naming the specification's source and target and whose behavior is Captain carrying out the transformation as specified, carrying the specification's normative requirements into the prompt as deduplicated one-point-per-line instructions to Captain, without inventing players, triggers, or requirements the specification does not state.
> Deduplicate identical prompt lines when composing overlapping or duplicated source snippets.
> Give each item its full final static prompt so a human can simulate a run by copying any single item's prompt verbatim with no cross-item composition; cross-item duplication is acceptable because spec items are compiled artifacts.
> Use `<placeholder>` for dynamic values in blockquoted prompts, and treat everything else inside a blockquote as static text rather than an example, keeping examples in surrounding prose.
> Resolve Markdown escapes on extraction (e.g., `\<placeholder\>` becomes `<placeholder>`) so compiled artifacts carry plain text.
> Partition items by every variable that determines prompt content, including accumulated state when the trigger alone does not.
> Drop disjunctive branches incompatible with the rest of an item's condition or prompt.
