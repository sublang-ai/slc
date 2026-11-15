<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-064: Empty Labelled Relay Omission

## Status

Accepted
Amends [DR-050](050-required-child-relay-substitution.md) and [DR-041](041-composed-child-input-fidelity.md) in one scope: in reached-case proof, an invocation may omit a labelled quoted relay line whose value is empty or absent.

## Context

A child-input template can carry a relay its Source supplies only in some runs: Playbook's `code` Source inputs `> IR number: <ir-number>` "for an IR" and nothing for a direct intent.
Playbook's gears2fsm definition tells a composer that a relayed value that is empty contributes no line, and the maintained `code` machine composes that way, dropping the labelled line and the blank line before it.
The reached-case proof omits only a complete standalone `> <token>` line; it expects a labelled line to stay with its label and an empty value, so that machine is reported although it renders what its Source asks.
A label with nothing after it tells the child nothing, and a reader takes it for a missing value.

Considered and declined:

- requiring the omission: machines that keep the label, which the proof accepts today, would be reported;
- a choice per token: one composer treats its lines alike, and a per-token choice multiplies the renderings the proof must try;
- omitting any quoted line that holds an empty inline token: a sentence with a hole is not a relay, and the template gives no rule for it.

## Decision

- In reached-case proof, an invocation renders every complete labelled relay line, `> Label: <token>`, whose mapped value is empty or absent in one of two ways: the label kept with an empty value, or the line omitted with its separator, as a standalone relay is.
- One invocation uses one of the two for every such line, in every reached case and under every probe; a mixture is a finding.
- Blank lines that an omission leaves at the end of the composed text are dropped with it; no other line changes.
- A labelled line whose mapped value is not empty is never omitted, an omitted line is no mapping evidence, and a relay missing in every reached case stays unproved.
- The static proof and the synchronous conformance API are unchanged.

## Consequences

The gate accepts two renderings of an empty labelled relay and says which one a machine uses only by holding it to that one.
Playbook's `code` reference, with [DR-063](063-string-list-child-input-relay.md), passes the artifact gate unchanged.
A composer that drops a labelled line whose value is present is still reported.
