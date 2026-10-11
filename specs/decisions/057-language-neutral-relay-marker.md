<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-057: Language-Neutral Relay Marker

## Status

Accepted. Amends [DR-029](029-source-fidelity-gate.md) in what marks a quoted relay.

## Context

[DR-029](029-source-fidelity-gate.md) keeps a Source blockquote's literal `>` markers when the prose introducing it says "in quotes (`>`)".
In a ten-team workshop simulation, three Chinese teams introduced their relays as "以引用（`>`）形式附上".
The compiler read those blockquotes as quoted relays, but the Source-fidelity gate did not, so each compile failed at text-to-GEARS with eighteen findings naming dropped fragments and foreign lines rather than the cause.
The authoring agent recovered only by writing the English phrase inside the Chinese prose.
The parenthesized backticked `>` already carries the meaning in every language; the words around it are prose.
The machine syntax the checks read literally — `Roles:`, `Results:`, `Captain shall prompt`, `Output shall include`, guard names — stays English, so text in another language can still miss it, and a finding that names only the symptom leaves a person without the fix.

## Decision

- The relay marker is a backticked `>` in parentheses, ASCII `` (`>`) `` or full-width `` （`>`） ``, in the prose introducing a blockquote; "in quotes", "以引用形式", and any other surrounding words are prose.
- When a plain Source blockquote reaches the GEARS only behind literal `>` markers — a relay whose prose lacks the marker — the gate reports that one fragment with the marker to write, instead of a dropped fragment plus a foreign line per relayed line.
- A malformed `Results` label or entry finding names the canonical English form to write; a `Results` label with a full-width colon is malformed.
- Structural markers stay English; no localized label or clause is accepted.
- Playbook's `text2gears` guide and its mirrored Source checker should state and apply the same marker; until that release is adopted, the vendored guide's "in quotes (`>`)" still contains the marker.

## Consequences

- A non-English Source marks its relays in its own words with one language-neutral symbol, and the English phrase keeps working.
- Prose that parenthesizes a backticked `>` before a blockquote for another reason now makes that blockquote a relay.
- A missing relay marker yields one actionable finding per blockquote.
