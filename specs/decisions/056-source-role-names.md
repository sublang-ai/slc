<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-056: Source Role Names Refused Before Any Agent

## Status

Accepted.

## Context

A Source declares its delegated roles in an opening `Roles:` list, and every later artifact names a role by one word: the GEARS acting clause `Captain shall prompt <Role>` and the canonical local role id derived from it.
In a ten-team workshop simulation, two teams declared two-word roles ("Business Analyst", "Client Advocate", "Risk Officer").
The text-to-GEARS phase accepted them, and the run failed only at the machine phase, where the compiler had read "Business" as the role; each team lost a compile round of several minutes of agent time to a failure that named the wrong thing.
Playbook's and Spex's authoring guidance already say role names are single capitalized words, but nothing in `slc` enforces that before agents run.
A role name's shape is decidable from the Source text alone.

## Decision

- A Source `Roles:` entry is one capitalized word: an uppercase letter, or a letter of a script without case such as `编码者`, followed only by letters and digits; enclosing backticks or quotation marks are syntax.
- Before a text-to-GEARS phase outside the reserved meta-pipeline executes, and before input normalization ahead of such an entry phase, `slc` checks the Source that step reads and fails before selecting any executor when an entry breaks the rule, so no agent runs.
- Each finding names the entry, states the rule, and, where the entry's words are letters and digits, proposes them joined into one capitalized word, e.g. `RiskOfficer` for "Risk Officer".
- The check reads only the `Roles:` list; the rest of the Source and every later artifact keep their existing checks.

## Consequences

- A multi-word, lowercase, or punctuated role fails in seconds with a message a person can act on, instead of after text-to-GEARS and machine-generation calls.
- Non-English role names stay valid: a script without case counts as capitalized.
- A role list written under a Markdown heading rather than the `Roles:` label is not read by this check.
- The definition text that states role naming is Playbook's `text2gears` guide; it should state the same one-word rule, adopted through the routine definition re-synchronization.
