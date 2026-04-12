<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Text-to-GEARS Transformation

This is the first phase in defining a playbook — a state-machine AI agent that coordinates multiple AI agents to carry out a defined procedure.
This phase transforms user input into normative spec items.

- Source: the user's description of the procedure in free-form natural language.
- Target: a package of spec items in the GEARS format [[1]] that define the procedure.

The second phase transforms spec items into state machines, which is outside the scope of this transformation.

## Roles

Both Source and Target use role names to refer to AI agents and the user.

The playbook has two default roles:

- Boss: the human user who provides input
- Captain: the coordinating agent that drives the procedure

Source may define additional roles in an opening `## Roles` section. E.g.:

- Coder
- Reviewer

The playbook runtime maps these roles to AI agents and invokes them.

For accurate mapping, capitalize English role names (e.g., `Writer`).
In other languages, quote role names such as `作者` if necessary to
distinguish them from ordinary text.

## Behaviors

Target specifies which prompt to give to which role under which conditions.
All prompts shall be blockquoted.
A prompt consists of concise, clearly organized points, one per line.

E.g.:

```markdown
### CODE-10

When Reviewer is about to review any change, Captain shall prompt Reviewer:
> Flag any issues or improvements (numbered; no duplication).
> Think thoroughly — don't just approve or reject.
> If the change is ready to commit or push, don't raise nitpicks.
```

Target should be written in the same language as Source.

## References

[1]: [GEARS syntax](/specs/meta.md#item-syntax)
