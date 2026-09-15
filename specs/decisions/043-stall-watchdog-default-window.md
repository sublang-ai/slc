<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-043: The Stall Watchdog's Default Window

## Status

Accepted.

Amends the default stall timeout in [DR-019](019-compile-progress-stall-watchdog.md); every other rule of that watchdog stands.

## Context

[DR-019](019-compile-progress-stall-watchdog.md) set the agent-inactivity watchdog's default window at 600 seconds, on the reading that ten minutes of adapter silence is generous for one long tool execution or model turn.
That reading predates deep-thinking agents: a single `gears2fsm` or `link` call at high reasoning effort routinely produces no adapter event for far longer while it is genuinely working, so the watchdog's own premise — that inactivity separates a hang from work — now misfires at ten minutes.

Three independent observations, all on healthy runs, show the default failing work rather than catching hangs:

- The `@sublang/playbook` repository's delivery compiling its SDLC workflows through this compiler had to relaunch every compile with `SLC_STALL_TIMEOUT=2400` after four phases died at the 600-second bound.
- Two consecutive live compiles of a two-role playbook driven through the Spex app died at `agent call stalled: no agent activity for 10m00s` in `gears2fsm`; the third succeeded with no other change once the budget was raised to 2400 seconds.
- The Spex app's compile runner now sets `SLC_STALL_TIMEOUT=2400` by default for exactly this reason, recorded in its own specs — so the ecosystem's principal host already overrides this compiler's default on every run.

A default every serious caller overrides is the wrong default.
Nothing in the evidence implicates the watchdog itself: each failure was a live, working call cut short by the window, not a call that should have been allowed to hang.

## Decision

- The built-in default stall timeout is 2400 seconds (40 minutes).
- Every other rule of the watchdog is unchanged: a non-blank `SLC_STALL_TIMEOUT` wins, otherwise the config file's `stallTimeout`, otherwise the default, each in seconds; `0` disables the watchdog; a window too large to serve as a timer delay is refused at both configuration sources.
- The watchdog stays.
  A hung agent call must still end as a loud failure naming its phase, target, and inactivity duration rather than parking the pipeline forever, and a caller who wants a tighter bound — 600 seconds included — sets `stallTimeout` or `SLC_STALL_TIMEOUT`.

## Consequences

- A deep-thinking phase call that is genuinely working survives an event-silent stretch that used to kill it, and no host needs an environment override to compile normally.
- A real hang now costs up to 40 minutes of wall clock before it is reported, instead of ten; that cost is deliberate, because discarding a working phase is the expensive failure this watchdog was never meant to cause.
- [[cli-34](../packages/cli.md#cli-34)] and [[cli-35](../packages/cli.md#cli-35)] state the new default; no other behavior item changes.
