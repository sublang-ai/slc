<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-059: Topology-bound Boss questions

## Status

Accepted.
Amends [DR-040](040-early-continuation-input-contract.md)'s schema-3 continuation probes.

## Context

A flat schema-3 planning machine stored its question only in keyed context.
The continuation probe populated both representations, and transition coverage proved a wait without inspecting its question.
SLC therefore accepted an artifact whose shared runtime correctly refused exact durable question binding.
Historical schema-1 artifacts retain their complete dependency closures under [DR-024](024-playbook-10-schema-3-adoption.md): Playbook 4's single-active-task contract permits scalar storage, its parallel artifacts have their own linked runtimes, and its factory permits a custom Boss classifier; it does not impose the schema-3 root-child profile selector [[1]][[2]].

## Decision

For schema 3 selected by the existing authoritative schema decision, select question context by the actual shared-runtime topology: a direct root child with `type: 'parallel'` selects keyed records throughout the machine, including sequential leaves; otherwise select scalar fields.
Populate only that representation in continuation probes.
At a reached schema-3 `needsBossReply` wait, require the canonical record to match the actual invocation identity and scripted question before any reply.
Explore a question/reply prefix only for a scripted `needsBossReply` result whose `question` is a string, retaining the existing untrimmed string semantics.
Keep malformed result candidates in ordinary defensive-arm coverage; their rejection into a parked failure is not a question wait.
Continue validating an actual string question even if its target resembles a parked failure.
Preserve historical schema-1 probes that populate both representations, immutable player identity, controller exemption, exact durable binding, and runtime semantics.
Do not reject harmless empty fields belonging to the unused representation.

## Consequences

Wrong question storage fails deterministic producer and protected-consumer checks instead of first failing during a live deferred question.
No runtime fallback, context repair, or fabricated ledger binding is introduced.

## References

[1]: https://github.com/sublang-ai/playbook/blob/v4.0.0/slc/gears2fsm.md "Immutable Playbook 4 Boss-reply suspension contract"
[2]: https://github.com/sublang-ai/playbook/blob/v4.0.0/src/xstate-playbook-runtime.js "Immutable Playbook 4 shared factory and custom classifier option"
