<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# GEARS-to-Finite-State-Machine Transformation

This is the second phase in defining a playbook — a state-machine-powered AI agent that coordinates multiple AI agents to carry out a defined procedure.
This phase transforms normative spec items into state machines.

- Source: the spec items transformed from the user's input in the first phase.
- Target: the state machine definitions to run on XState v5 [[1]].

A procedure is essentially a sequence of AI agent calls, modeled as a state machine.

## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | gears | .md |
| target | fsm | .ts |

## States

Each state shall have an intuitive name and a clear description.

A state can invoke [Captain](text2gears.md#roles) with instructions stored in `invoke.input` [[2]][[3]].
Captain follows the instructions and finally returns the required result as `event.output` on `onDone` [[4]], which shall determine the next transition.

E.g.:

```typescript
input: {
    role: 'Reviewer',
    prompt: "Flag any issues or improvements (numbered; no duplication). Think thoroughly — don't just approve or reject. If the change is ready to commit or push, don't raise nitpicks.",
    result: {
        hasFindings: 'Reviewer replies issues or suggestions.',
        noFindings: 'Reviewer has no findings.',
    },
}
```

The instructions in `invoke.input` tell Captain what to do (typically, invoke a specified [role](text2gears.md#roles) with a given prompt) and what valid values to return (the keys in `input.result`).
Captain returns a discriminated result with a `guard` field set to one of the `input.result` keys (e.g., `{ guard: 'hasFindings', ... }`).
By convention, guard names shall match `input.result` keys so that guards can be auto-generated from the result specification.
Guards [[5]] on `onDone` transitions inspect `event.output.guard` to choose the correct path.

Captain may return extra details in `event.output`; the machine persists them to `context.lastResult` via `assign` [[6]].

## Transitions

A transition fires on an event — typically `onDone` (the current state's actor completed).
When multiple transitions are possible, a synchronous guard [[5]] inspects event data (typically `event.output` for `onDone`, or custom fields for other events) to choose the correct path.
A transition saves `event.output` to `context.lastResult` via `assign` [[6]], making the prior result available to the next state's `invoke.input`.

[Boss](text2gears.md#roles) may interrupt any state at any time.
Every jumpable state shall have a stable `id` [[9]].
The runtime sends a structured event (e.g., `{ type: 'BOSS_INTERRUPT', targetId: 'reviewCode' }`) to the machine.
The root machine handles this event with a generated list of guarded transitions [[7]][[8]][[9]] that target by `#id` (e.g., `target: '#reviewCode'`), one per jumpable state.
XState automatically stops the current state's invoked actor on transition [[2]].
Use `reenter: true` [[7]] when a jump targets the current state, so that invoked actors and entry actions restart cleanly.

## Composition

A single state in Target may correspond to multiple Source spec items.
All prompts from those spec items shall be composed into the state's `invoke.input`.
This reverses the [abstraction](text2gears.md#abstraction) from the first phase, for runtime efficiency.

## References

[1]: https://stately.ai/docs/xstate "XState Official Documentation"
[2]: https://stately.ai/docs/invoke "Invoke — invoking actors from states"
[3]: https://stately.ai/docs/input "Input — passing data to invoked actors"
[4]: https://stately.ai/docs/output "Output — receiving actor results via onDone"
[5]: https://stately.ai/docs/guards "Guards — synchronous transition conditions"
[6]: https://stately.ai/docs/context "Context — persistent state and assign"
[7]: https://stately.ai/docs/transitions "Transitions — reenter, root-level routing"
[8]: https://stately.ai/docs/parent-states "Parent states — root-level event handling"
[9]: https://stately.ai/docs/finite-states "Finite states — state IDs"
