<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-010: Playbook Runtime Contract Evolution

## Status

Accepted

## Context

[DR-005](005-slc-self-hosting-meta-pipeline.md) binds compiled phase execution to Playbook's source-owned runtime contract.
The committed SLC meta-phase artifacts and their pins currently bind the published Playbook 0.9.0 four-port runtime, whose `init` receives ports and whose `handleBossInput` resolves with no structured result.
Playbook's accepted session and composition decisions evolve that pre-1.0 contract to causal `PlaybookSession` initialization, explicit player continuation, structured run results, a fifth nested-playbook port, and resumable child calls.
The complete composed implementation is not yet available as an immutable published dependency, so replacing SLC's reviewed definitions and artifacts from a dirty sibling checkout would violate [DR-007](007-slc-phase-artifact-pinning.md)'s reproducibility and review model.

SLC still needs to understand the new host boundary before the release arrives, without misrepresenting old artifacts as compiled against it or exposing the new runtime trace through ordinary diagnostics.

## Decision

### Reproducible contract boundary

Committed phase definitions, compiled artifacts, and pins shall be built only against an immutable Playbook dependency resolved by the lockfile.
SLC shall not refresh those reviewed assets from an uncommitted sibling checkout or merely rehash an old-contract artifact against a new runtime target.
When Playbook publishes the composed contract, SLC shall update the dependency, merge the authored definitions while retaining SLC's explicit pin inputs, rebuild and review every affected artifact bundle, record all out-of-bundle executable dependencies, and regenerate the pins atomically.

### Root phase sessions

SLC is a non-interactive root host for one compiled phase run, not a general Playbook Captain shell.
For a session-contract runtime, SLC shall create one globally unique session id, use the selected phase identity as the stable playbook id, set the root session id to the session id and depth to zero, omit parent identity, and supply only the source-owned ports through the session.
For a legacy runtime selected by a current pin whose producing target records the earlier contract, SLC may initialize with the four legacy ports and derive the result from the output change and host-observable failure signals.
Compatibility is bounded by the pinned producing contract; it shall not silently retry a failed session initialization as legacy initialization.

### Phase-result mapping

The structured run result is authoritative when a runtime returns one.
SLC shall map it together with the declared-output postcondition as follows:

| Runtime outcome | SLC phase result |
| --- | --- |
| `quiescent` or `terminal`, with a newly created or changed declared output | `ok` |
| `quiescent` without a newly produced output, or `no-action` | `blocked` |
| `failed`, `aborted`, a thrown control-plane error, or an invalid result | `error` |
| `suspended` | `error`, because SLC does not host a nested child stack |

The legacy void result retains the output-change mapping: produced output is `ok`, no produced output after a clean turn is `blocked`, and a throw, abort, or observed failed quiescent state is `error`.
Disposal failures shall be reported unless a prior turn failure already determines the result; teardown shall not silently turn an incomplete trace or cleanup into success.

### Port policy and diagnostic privacy

SLC's player port shall pass Playbook's explicit `resume: false | string` selection through Cligent and return any opaque resume token on successful, aborted, or failed player results.
SLC's judge port shall serialize concurrent calls through one abort-aware FIFO because the backing judge transport is single-flight.
SLC shall expose the required nested-playbook port, but shall reject every call deterministically because adding a child registry and live call stack is outside the compiled phase host.

Human status and non-trace operational telemetry may become phase diagnostics.
`playbook.trace` payloads shall not become ordinary diagnostics because they contain exact prompts, replies, errors, and continuation tokens; a separate protected trace sink would require its own decision.

## Consequences

- Current reviewed 0.9.0 artifacts remain reproducible and runnable during the transition.
- Newly shaped runtimes can be exercised through the SLC host boundary before their definitions and artifacts are adopted.
- Nested composition fails closed instead of hanging a non-interactive phase or silently omitting the required port.
- Player continuity survives the adapter boundary, while trace contents do not leak through CLI diagnostics.
- The eventual dependency and artifact migration remains a review-gated atomic change rather than a compatibility shortcut.
