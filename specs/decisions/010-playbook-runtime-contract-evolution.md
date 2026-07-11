<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-010: Playbook Runtime Contract Evolution

## Status

Accepted

## Context

[DR-005](005-slc-self-hosting-meta-pipeline.md) binds compiled phase execution to Playbook's source-owned runtime contract.
The committed SLC meta-phase artifacts and their pins currently bind the published Playbook 0.9.0 four-port runtime, whose `init` receives ports and whose `handleBossInput` resolves with no structured result.
Playbook subsequently committed an unreleased traced-session contract whose `init` receives `{ sessionId, playbookId, ports }`, whose four-port player call requires explicit continuation, and whose turn still resolves with no structured result.
Playbook's accepted composition decision evolves that contract again to a causal root `PlaybookSession`, structured run results, a fifth nested-playbook port, and resumable child calls.
The complete composed implementation exists only as a dirty sibling checkout whose package still reports 0.9.0, so replacing SLC's reviewed definitions and artifacts from it would violate [DR-007](007-slc-phase-artifact-pinning.md)'s reproducibility and review model.

SLC still needs to understand the new host boundary before the release arrives, without misrepresenting old artifacts as compiled against it or exposing the new runtime trace through ordinary diagnostics.

## Decision

### Reproducible contract boundary

Committed phase definitions, compiled artifacts, and pins shall be built only against an immutable Playbook dependency resolved by the lockfile.
SLC shall not refresh those reviewed assets from an uncommitted sibling checkout or merely rehash an old-contract artifact against a new runtime target.
When Playbook publishes the composed contract, SLC shall update the dependency, merge the authored definitions while retaining SLC's explicit pin inputs, rebuild and review every affected artifact bundle, record all out-of-bundle executable dependencies, and regenerate the pins atomically.

### Runtime profiles and root phase sessions

SLC is a non-interactive root host for one compiled phase run, not a general Playbook Captain shell.
During the pre-release transition, its compatibility boundary shall distinguish these exact profiles:

| Profile | Initialization boundary | Turn boundary |
| --- | --- | --- |
| `legacy` | The four published 0.9.0 ports are passed directly to `init`. | `handleBossInput` shall resolve `void`; SLC derives the result from output change and host-observable failure signals. |
| `session-v1` | `init` receives `{ sessionId, playbookId, ports }` with a globally unique session id, the selected phase id, and exactly the four traced-session ports; it receives no root, parent, depth, or nested-call fields. | `handleBossInput` shall resolve `void`; SLC uses the same output-change and host-observable failure mapping as `legacy`. |
| `composed-v2` | `init` receives a causal root session with a globally unique session id, the selected phase id, `rootSessionId` equal to `sessionId`, depth zero, no parent identity, and exactly five ports including `callPlaybook`. | `handleBossInput` shall return a structured run result; the linked runtime's observable resumable surface additionally includes `resumePlaybookCall`. |

The configured executor shall select a profile only from the current pin's immutable link-target provenance.
Absent provenance and exact `@sublang/playbook@0.9.0` provenance select `legacy`; every other provenance shall fail closed until SLC explicitly maps an immutable release to `session-v1` or `composed-v2`.
The direct `session-v1` and `composed-v2` executor profiles are compatibility and test seams during this deferral, not permission to infer a production profile from a runtime object's shape.
SLC shall not retry a failed initialization under another profile.

Artifact equivalence has no pin selection and shall therefore distinguish the method-identical `legacy` and `session-v1` profiles by initializing fresh runtimes through each exact candidate boundary and driving one inert non-empty turn.
The probe shall require the profile's void or structured result boundary, a callable `resumePlaybookCall` only for `composed-v2`, and deterministic disposal; an optional immutable named export `runtimeContractProfile` may resolve a deliberately multi-shape runtime only when its callable and driven boundaries agree.
This equivalence probe and marker shall not participate in configured execution selection.

### Phase-result mapping

Only `composed-v2` shall accept a structured run result, and that result is authoritative together with the declared-output postcondition.
SLC shall map it as follows:

| Runtime outcome | SLC phase result |
| --- | --- |
| `quiescent` or `terminal`, with a newly created or changed declared output | `ok` |
| `quiescent` or `terminal` without a newly produced output, or `no-action` | `blocked` |
| `failed`, `aborted`, a thrown control-plane error, or an invalid result | `error` |
| `suspended` | `error`, because SLC does not host a nested child stack |

An absent result from `composed-v2`, or a non-void result from `legacy` or `session-v1`, shall be an error rather than trigger contract inference.
Structured validation shall accept only plain data with the fields permitted by the selected outcome variant, literal state-status values, recursively valid state values, and finite JSON output; cross-variant fields, accessors, proxies, cycles, sparse arrays, symbols, and other non-data values shall fail closed as an invalid result rather than escape the phase boundary.
The `legacy` and `session-v1` void result retains the output-change mapping: produced output is `ok`, no produced output after a clean turn is `blocked`, and a throw, abort, or observed failed quiescent state is `error`.
Disposal failures shall be reported unless a prior turn failure already determines the result; teardown shall not silently turn an incomplete trace or cleanup into success.

### Port policy and diagnostic privacy

SLC's player port shall pass Playbook's explicit `resume: false | string` selection through Cligent and return any opaque resume token on successful, aborted, or failed player results.
The `session-v1` and `composed-v2` boundaries shall reject an omitted or invalid selection before invoking Cligent; only the published `legacy` boundary may omit it.
SLC's judge port shall serialize concurrent calls through one abort-aware FIFO because the backing judge transport is single-flight.
SLC shall expose the `composed-v2` nested-playbook port, but shall settle every call deterministically with an unsupported-operation error because adding a child registry and live call stack is outside the compiled phase host.

Human status and non-trace operational telemetry may become phase diagnostics.
`playbook.trace` payloads shall not become ordinary diagnostics because they contain exact prompts, replies, errors, and continuation tokens; a separate protected trace sink would require its own decision.

### Continuous integration during deferral

The runtime transition requires no new CI workflow step before an immutable composed release exists.
The existing workflow already installs the registry lock with `npm ci`, runs source quality and the full suite containing the three-profile and structured-machine fixtures, independently reviews the committed flat 0.9.0 artifacts, regenerates their pins, and requires a byte-identical pin index.
CI shall not read a mutable sibling checkout or refresh reviewed assets from one.

## Consequences

- Current reviewed 0.9.0 artifacts remain reproducible and runnable during the transition.
- The unreleased `session-v1` and `composed-v2` boundaries can be exercised explicitly before their definitions and artifacts are adopted, while configured pin selection remains fail-closed.
- Nested composition fails closed instead of hanging a non-interactive phase or silently omitting the required port.
- Player continuity survives the adapter boundary, while trace contents do not leak through CLI diagnostics.
- The eventual dependency and artifact migration remains a review-gated atomic change rather than a compatibility shortcut.
