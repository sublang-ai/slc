<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-090: Legacy Predecessor Entry

## Status

Complete.

## Intent

A selected legacy child predecessor may lack the direct interrupt drive that its helper requires, while an actual public entry and predecessor chain reaches the acting state.
Use the existing bounded actual-prefix search for that case without changing valid legacy drives or weakening concrete acceptance.

## Deliverables

- [x] Specify fallback when the selected legacy predecessor cannot be driven.
- [x] Route that case through the existing bounded prefix search.
- [x] Verify real entry, question/reply and refusal controls.

## Tasks

1. Retain lawful public paths after an unavailable legacy predecessor drive.

## Verification

On an unchanged retained artifact, scripted real XState START, player, child and canonical question/reply actions reach both declared scope outcomes; malformed replies and missing catalog refuse.
An isolated helper trace finds a satisfiable target interrupt diagnostic but a selected literal-child predecessor with no matching interrupt and an undefined legacy probe.
The parent fails the new real-entry case while four refusal controls pass; the corrected dispatcher passes all five.
The first affected run passes all 246 coverage cases but two completion CLI cases hit their existing 20-second limits during concurrent heavy suites; its 238-second result is preserved.
After restoring the original cheap dispatch short-circuits before the new predecessor check and serializing heavy local tests, the five new cases and both timed-out cases pass together in 14 seconds without deadline changes.
The prior affected run took 54 seconds; concurrency may contribute, but that comparison does not isolate a single cause.
Build, lint and spec lint pass.
The retained artifact's timeout remains capped at 300,000 milliseconds; parent and corrected derivation each take about 16 seconds.
One initial test command is rejected before collection for an unsupported cache option, separately from the meaningful parent failure.
The unchanged retained artifact returns zero findings with the changed checker in 32 seconds, versus the preserved parent's three findings in 63 seconds; this is not compiler acceptance.
All eleven complete-checkout gates pass after the correction: formatting, lint, build, 1,731 tests with two existing skips, definitions, release audit, artifacts, pins, demo, installed package and spec lint.
The earlier failed run remains preserved; no timeout or acceptance gate was waived.
