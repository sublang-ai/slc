<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-010: Separate Playbook Routing and Control

## Goal

Compile routing-only Captain workflows whose acting prompts exclude control schemas, whose Boss text is preserved exactly, and whose declared result contracts are verified deterministically.

## Deliverables

- [x] [DR-012](../decisions/012-playbook-routing-control-separation.md), `PHEXEC`, `VERIFY`, and `map.md` record the result-metadata, exact-text, isolated-call, and presentation contracts.
- [x] Playbook's maintained `text2gears`, `gears2fsm`, and `link` definitions define the canonical metadata syntax and generated runtime behavior without changing SLC's release-vendored definitions, reviewed artifacts, or pins.
- [x] The conformance checker parses and compares explicit result contracts separately from acting prompts.
- [x] SLC's Captain adapter validates and forwards fresh-session and empty-tool options for visible Captain and hidden judge calls.
- [x] Focused and full source tests, build, lint, and formatting checks pass.

## Tasks

1. **Record routing/control separation.** _[done]_
   Add DR-012 and this iteration, then amend the affected item files and map before implementation.
2. **Define compiler semantics.** _[done]_
   Add canonical result metadata, exact Boss-text mapping, control-only adjudication, and isolated Captain calls to Playbook's shared phase definitions while leaving SLC's pinned vendor immutable.
3. **Verify result metadata.** _[done]_
   Parse ordered result bullets, keep them out of prompts, and compare them to each FSM state's domain result map.
4. **Enforce Captain isolation.** _[done]_
   Extend the compatibility call options and forward the required fresh-session and no-tools selections through Cligent.
5. **Validate without release mutation.** _[done]_
   Run focused and full checks while leaving versions, dependencies, reviewed artifacts, locks, and pins unchanged.

## Acceptance criteria

- Parsing a canonical `Results:` block returns its ordered guard map while the parsed prompt remains exactly the preceding blockquote.
- Conformance rejects malformed, missing, extra, reordered, or description-drifted source-declared results after excluding only compiler-owned `needsBossReply`.
- A generated runtime deterministically maps an unambiguous Boss intent and attaches exact raw Boss text after any necessary event-kind classification.
- Every direct Captain control call reaches Cligent with `resume: false` and an explicitly empty allowed-tool list.
- No reviewed bundle, pin, dependency version, lockfile, or release artifact changes in this iteration.
