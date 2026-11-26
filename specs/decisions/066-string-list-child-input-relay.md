<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-066: String-list Child-input Relay

## Status

Accepted.
Amends [DR-041](041-composed-child-input-fidelity.md).

## Context

A literal child call composes its GEARS text with runtime values, and the reached-case proof admits two value shapes: a string, anywhere, and an array or plain record as canonical compact JSON on an explicit quoted relay line.
Playbook's maintained `code` machine relays every commit of a run inside a sentence — `namely <code-commits>, and its resulting repository state` — by joining the commit identities with `, `.
Neither shape covers it, so the artifact gate reports that composition as unproved, and the machine is verified and is not to be recompiled or edited for the gate's sake.
A list of identities inside a sentence is ordinary prose; JSON there would be the wrong rendering for the reader of the child input.

Considered and declined:

- keeping the finding: the one maintained machine that relays a list then never passes the gate;
- a separate string field holding the joined text: it changes the machine and stores one fact twice;
- accepting any separator the machine uses: the template gives no separator, so the gate could not say what an authored list looks like, and two machines would render the same template differently.

## Decision

- A reached own dense array whose every element is a string may map a child-input token through its elements joined in order by `, `, in an inline slot or an explicit quoted relay.
- Canonical compact JSON remains the only other structured form, and is tried first; a list is never both.
- The mapping is established only by perturbing an existing element, then verified with two distinct single-line literal values for every element, all other reached values unchanged, in every reached case.
- One reached element shows no separator, order or selection, so two distinct single-line literal values also verify one further element appended after the last.
- An empty list establishes no mapping and renders as the empty string, under the rules an empty string has in that slot.
- A case reached before the mapping waits for it only on tokens that then map to its empty list; any other token left empty keeps its finding.
- The descriptor, Proxy, alias, drift, traversal and size refusals of structured JSON relays apply to the list unchanged.
- The synchronous conformance API stays conservative: a list relay is proved only from reached cases.
- The composition diagnostic names the comma-joined list beside canonical compact JSON.

## Consequences

The gate fixes one rendering for a list of strings, so a compiled machine that joins with another separator is reported and repaired during compilation.
A list element that itself contains `, ` renders ambiguously for a reader; the proof concerns rendering, not parsing, and still holds.
Playbook's `code` reference has its commit list proved; it passes the artifact gate once an omitted empty labelled relay is admitted ([DR-067](067-empty-labelled-relay-omission.md)).
