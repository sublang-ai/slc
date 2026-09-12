<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# clarification: Source Clarification

## Intent

This package defines stateless source clarification across all compiler phases under [DR-032](../decisions/032-noninteractive-source-clarification.md).
The user resolves reported questions by editing the original source and repeating the command.

## External Behavior

### clarification-1

Where producing a complete artifact would require choosing missing, contradictory, or materially ambiguous domain behavior, when a transformation-performing agent finishes, the agent shall stop producing the artifact and request clarification with concrete questions instead of inventing the choice:

| Question field | Value |
| --- | --- |
| `id` | Nonblank string, unique within the report. |
| `question` | Nonblank question that the source author can answer. |
| `reason` | Nonblank explanation of the behavior the unresolved choice affects. |
| `evidence` | Nonblank source excerpt or description locating the missing information. |
| `choices` | Optional array of at least two distinct nonblank strings; alternatives never imply an answer. |

### clarification-2

When an interpreted or compiled performing-agent report is decoded, the clarification decoder shall recognize exactly one line beginning `CLARIFICATION:` followed by a JSON object occupying the remainder of the report and containing exactly one `questions` array of one or more exact question objects [[clarification-1](#clarification-1)], permit preceding narration, and reject a marker with malformed JSON, duplicate markers, unknown fields, invalid questions, or trailing prose as an execution error.

### clarification-3

When the host prompts a transformation-performing agent, the host shall provide the same clarification contract [[clarification-1](#clarification-1)], [[clarification-2](#clarification-2)] for interpreted phases, normalization, compiled player work, and compiled direct Captain work, while leaving routing and judge prompts unchanged.

### clarification-4

When a valid clarification request survives the phase's protected-input and chain checks [[phase-execution-5](phase-execution.md#phase-execution-5)] and physical target-safety checks [[phase-execution-39](phase-execution.md#phase-execution-39)], the compiler shall stop before subsequent phases and deterministic completion, expose outcome `clarification-required` with schema `sublang.slc.clarification.v1`, phase, target, original invocation source paths (`sources`), and questions, and instruct the user to edit those inputs and repeat the same command.

### clarification-5

When a clarification stops a run, the compiler shall retain success-only history publication [[incremental-compilation-6](incremental-compilation.md#incremental-compilation-6)] without publishing a build, creating clarification state, reading answers, or emitting a continuation command from an intermediate.

### clarification-6

When a successful performing-agent response contains a clarification marker, reviewed execution shall return that response without invoking further review or mechanical checks, recognizing a correction's marker only after its private review envelope is decoded [[phase-execution-46](phase-execution.md#phase-execution-46)].

### clarification-7

When a compiled performing call reports clarification, the compiled executor shall stop further agent calls, dispose the runtime, and return the decoded clarification or malformed-report error [[clarification-2](#clarification-2)], with cancellation, unrelated runtime exceptions, or disposal failure taking precedence.

### clarification-8

When the CLI receives outcome `clarification-required` [[clarification-4](#clarification-4)], the CLI shall write the actionable report to standard error including one `SLC_CLARIFICATION: ` line followed by the complete single-line JSON report, write nothing to standard output, and exit `2` without requesting terminal input.

## Verification

### clarification-9

Where fixture pipelines exercise normalization, an entry phase, a later compile phase, and linking, when each emits a clarification report and the user subsequently edits the original source and repeats the invocation, the integration suite shall verify the questions and original-source rerun guidance [[clarification-1](#clarification-1)], [[clarification-4](#clarification-4)], absence of later execution or new history/state on clarification [[clarification-5](#clarification-5)], preserved source bytes and unaccepted staged targets [[clarification-1](#clarification-1)], ordinary successful compilation after the edit [[clarification-4](#clarification-4)], and standard-error JSON with exit `2` and empty standard output [[clarification-8](#clarification-8)].

### clarification-10

Where real interpreted, reviewed, and compiled executors use fixture agent transports, when the fixtures return valid, malformed, narrated, duplicate, and correction-encoded clarification reports, the integration suite shall verify strict decoding [[clarification-2](#clarification-2)], performing-only prompt coverage [[clarification-3](#clarification-3)], review bypass including after correction decoding [[clarification-6](#clarification-6)], and compiled stop/disposal with cancellation, unrelated runtime-error, and disposal-error precedence [[clarification-7](#clarification-7)].
