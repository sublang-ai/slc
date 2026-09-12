// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** Stateless source questions shared by every phase and host (DR-032). */
export interface ClarificationQuestion {
  id: string;
  question: string;
  reason: string;
  evidence: string;
  choices?: string[];
}

export interface ClarificationReport {
  schema: 'sublang.slc.clarification.v1';
  phase: string;
  target: string;
  /** Original invocation inputs, not a later phase's generated intermediate. */
  sources: string[];
  questions: ClarificationQuestion[];
}

export type DecodedClarification =
  | { kind: 'none' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'clarification'; questions: ClarificationQuestion[] };

const marker = /^\s*CLARIFICATION:/im;

export function hasClarificationMarker(text: string): boolean {
  return marker.test(text);
}

/** Only the marked final response is JSON; preceding progress prose is ignored. */
export function decodeClarification(text: string): DecodedClarification {
  const match = marker.exec(text);
  if (match === null) return { kind: 'none' };
  const invalid = (): DecodedClarification => ({
    kind: 'invalid',
    reason:
      'malformed CLARIFICATION report: expected one final JSON object with a nonempty questions array of unique id, question, reason, evidence, and optional choices',
  });
  const body = text.slice(match.index + match[0].length);
  if (marker.test(body)) return invalid();
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return invalid();
  }
  if (!record(value) || Object.keys(value).join() !== 'questions')
    return invalid();
  const questions = value.questions;
  if (!Array.isArray(questions) || questions.length === 0) return invalid();
  const ids = new Set<string>();
  for (const question of questions) {
    if (!record(question)) return invalid();
    if (
      Object.keys(question).some(
        (key) =>
          !['id', 'question', 'reason', 'evidence', 'choices'].includes(key),
      ) ||
      !nonblank(question.id) ||
      !nonblank(question.question) ||
      !nonblank(question.reason) ||
      !nonblank(question.evidence) ||
      ids.has(question.id)
    ) {
      return invalid();
    }
    ids.add(question.id);
    if (
      'choices' in question &&
      (!Array.isArray(question.choices) ||
        question.choices.length < 2 ||
        !question.choices.every(nonblank) ||
        new Set(question.choices).size !== question.choices.length)
    ) {
      return invalid();
    }
  }
  return {
    kind: 'clarification',
    questions: questions as ClarificationQuestion[],
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Output protocol only; semantic decisions remain with the phase definition. */
export function clarificationContract(): string {
  return [
    'Source clarification (noninteractive compiler protocol):',
    '- If a complete artifact would require choosing missing, contradictory, or materially ambiguous domain behavior, stop producing the artifact; do not invent the choice or ask through an interactive tool. Any work already written remains unaccepted.',
    '- Report concrete questions the user can resolve by editing the original source and rerunning the same command. Do not request clarification for benign ambiguity that does not change domain semantics.',
    '- Only when unresolved source behavior requires clarification, end your reply with CLARIFICATION: followed by one JSON object and no trailing prose or Markdown fence:',
    'CLARIFICATION: {"questions":[{"id":"q1","question":"What behavior should the source specify?","reason":"Why this choice is necessary to compile.","evidence":"Exact source excerpt or location of missing information."}]}',
    '- Use exactly the shown fields, with nonblank strings and unique question ids; each question may additionally include "choices", an array of at least two distinct nonblank alternatives. Never select an answer.',
    '- When the source is sufficient, complete the artifact normally and omit the CLARIFICATION marker entirely. Never emit an empty questions array or a no-clarification report.',
    '- This host report protocol also applies when the definition describes unresolved behavior as BLOCKED; use BLOCKED for other malformed or incompatible inputs.',
  ].join('\n');
}

export function formatClarificationReport(report: ClarificationReport): string {
  return [
    `slc: clarification required in phase "${report.phase}" at "${report.target}"`,
    ...report.questions.flatMap((question) => [
      `  [${question.id}] ${question.question}`,
      `    Reason: ${question.reason}`,
      `    Evidence: ${question.evidence}`,
      ...(question.choices === undefined
        ? []
        : [`    Choices: ${question.choices.join(' | ')}`]),
    ]),
    `Edit the original input${report.sources.length === 1 ? '' : 's'}: ${report.sources.join(', ')}`,
    'Then run the same command again.',
    `SLC_CLARIFICATION: ${JSON.stringify(report)}`,
  ].join('\n');
}
