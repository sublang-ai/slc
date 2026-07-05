<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Text-to-GEARS Transformation

### TEXT2GEARS-10

When a transformation request names a text source and a gears target, Captain shall transform the source into a package of GEARS spec items:
> Read the free-form natural-language source from <source>.
> Write the package of GEARS spec items to <target>.
> Treat the source format as text with extension .md.
> Treat the target format as gears with extension .md.
> Do not perform the second phase that transforms spec items into a state machine.
> Treat players as names for AI agents and the user.
> Treat Boss as the human user.
> Treat Captain as the coordinating agent.
> If the source declares additional players in an opening Players: section, include those players.
> Allow a declared player to alias other players with = and |.
> Treat Boss as choosing one aliased player at runtime.
> Capitalize English player names.
> Quote non-English player names when needed to distinguish them from prose.
> For each spec item, name a condition, the player to prompt, and the prompt itself.
> Write prompts as blockquotes with one point per line.
> Write the target in the same language as the source.
> If the source is itself the normative specification of a transformation, treat it as declaring no players and prompting none.
> If the source is itself the normative specification of a transformation, treat its implied procedure as Captain performing the specified transformation on request.
> For a transformation-spec source, compose Captain-acting spec items.
> For a transformation-spec source, when a transformation request names the specification's source and target, Captain shall carry out the transformation as specified.
> For a transformation-spec source, make prompts carry the specification's normative requirements as instructions to Captain.
> Deduplicate identical prompt lines when composing source snippets into a spec item.
> Do not invent players, triggers, or requirements for a transformation-spec source.
> Make each spec item address one state behavior.
> Give each spec item its full final prompt as the static part.
> Do not require cross-item composition to simulate a run.
> Ensure a human can simulate a run by copying any single item's prompt verbatim.
> Use <placeholder> for dynamic values in blockquoted prompts.
> Treat everything else inside a blockquote as static text.
> Put examples in surrounding prose, not inside blockquoted prompt content.
> Resolve Markdown escapes during extraction so compiled artifacts carry plain text.
> Partition items by every variable that determines prompt content, including accumulated state when the trigger alone does not.
> Drop disjunctive branches incompatible with the rest of an item's condition or prompt.
> Do not retain dead branches that would mislead readers or downstream phases.
