// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Optional two-agent review orchestration for transformation calls (DR-022).
 *
 * The decorator leaves the first Coder call byte-for-byte unchanged. Calls
 * carrying an explicit `allowedTools` property are control/routing calls and
 * bypass review. A successful transformation is reviewed in an independent,
 * read-only agent session; material findings return to the Coder for disposition
 * and repair until the Reviewer reports no unsettled findings or the bounded
 * review limit is reached. Only the latest Coder result crosses the decorated
 * transport boundary.
 */

import { messageOf } from './errors.js';
import type { AgentClient, AgentRunResult } from './interpreter.js';

const MAX_REVIEWER_CALLS = 3;

/** Options for {@link createReviewingAgent}. */
export interface ReviewingAgentOptions {
  /** The transformation-performing client whose result remains authoritative. */
  coder: AgentClient;
  /** Constructs a fresh Reviewer client for each performing call. */
  reviewer: () => AgentClient;
  /** Optional Reviewer model; omitted to use that adapter's default. */
  reviewerModel?: string;
}

/**
 * Decorates a Coder client with the DR-022 review/fix/re-review protocol.
 *
 * Reviewer failures and malformed verdicts fail closed with a stable error
 * diagnostic that retains the latest Coder text and resume token.
 */
export function createReviewingAgent(
  options: ReviewingAgentOptions,
): AgentClient {
  return {
    async run(request): Promise<AgentRunResult> {
      // Presence, not value, is the source-owned routing/control marker. Do
      // not unwrap inherited properties into a transformation call.
      if ('allowedTools' in request) {
        return options.coder.run(request);
      }

      let coderResult = await options.coder.run(request);
      if (!isReviewable(coderResult)) return coderResult;

      let reviewer: AgentClient;
      try {
        reviewer = options.reviewer();
      } catch (error) {
        return failClosed(
          coderResult,
          `Reviewer could not start: ${messageOf(error)}`,
        );
      }
      let reviewerResume: string | false | undefined = false;
      const transcript: string[] = [];
      let reviewerCalls = 0;

      for (;;) {
        let review: AgentRunResult;
        try {
          reviewerCalls++;
          review = await reviewer.run({
            prompt: buildReviewerPrompt({
              originalPrompt: request.prompt,
              coderOutput: coderResult.text,
              transcript,
            }),
            cwd: request.cwd,
            model: options.reviewerModel,
            ...(reviewerResume === undefined ? {} : { resume: reviewerResume }),
            signal: request.signal,
          });
        } catch (error) {
          return failClosed(
            coderResult,
            `Reviewer call threw: ${messageOf(error)}`,
          );
        }
        if (review.status !== 'success') {
          return failClosed(
            coderResult,
            `Reviewer returned ${review.status}${review.text ? `: ${review.text}` : ''}`,
          );
        }
        reviewerResume = review.resumeToken;

        const verdict = parseReviewerVerdict(review.text);
        if (verdict.kind === 'clean') return coderResult;
        if (verdict.kind === 'malformed') {
          return failClosed(
            coderResult,
            `Reviewer returned a malformed verdict: ${review.text}`,
          );
        }
        const findings = review.text.trim();
        if (reviewerCalls === MAX_REVIEWER_CALLS) {
          return failClosed(
            coderResult,
            `Reviewer reached the third and final review call; unresolved Reviewer findings:\n${findings}`,
          );
        }

        const priorTranscript = [...transcript];
        transcript.push(`Reviewer verdict:\n${findings}`);
        const coderResume = coderResult.resumeToken;
        const priorCoderResult = coderResult;
        const correction = await options.coder.run({
          prompt: buildCoderFollowupPrompt({
            originalPrompt: request.prompt,
            previousOutput: coderResult.text,
            findings,
            transcript: priorTranscript,
          }),
          cwd: request.cwd,
          model: request.model,
          ...(coderResume !== undefined ? { resume: coderResume } : {}),
          signal: request.signal,
        });
        if (correction.status !== 'success') return correction;

        const envelope = parseCorrectionEnvelope(
          correction.text,
          verdict.findingCount,
        );
        if (envelope.kind === 'malformed') {
          return failClosed(
            priorCoderResult,
            `Coder correction returned a malformed private review envelope: ${envelope.reason}`,
          );
        }
        coderResult = { ...correction, text: envelope.result };
        transcript.push(
          [
            'Coder dispositions:',
            ...envelope.dispositions.map(
              (disposition) =>
                `${disposition.finding}. ${disposition.decision.toUpperCase()}: ${disposition.reason}`,
            ),
            'Coder replacement result:',
            envelope.result,
          ].join('\n'),
        );
        if (!isReviewable(coderResult)) return coderResult;
      }
    },
  };
}

function isReviewable(result: AgentRunResult): boolean {
  return result.status === 'success' && !/^\s*BLOCKED\b/im.test(result.text);
}

function failClosed(result: AgentRunResult, reason: string): AgentRunResult {
  return {
    ...result,
    status: 'error',
    text: `review failed closed: ${reason}; latest Coder output: ${result.text}`,
  };
}

type ReviewerVerdict =
  | { kind: 'clean' }
  | { kind: 'findings'; findingCount: number }
  | { kind: 'malformed' };

function parseReviewerVerdict(text: string): ReviewerVerdict {
  const verdict = text.trim().replaceAll('\r\n', '\n');
  if (verdict === 'NO_FINDINGS') return { kind: 'clean' };
  if (!verdict.startsWith('FINDINGS:\n')) return { kind: 'malformed' };
  const body = verdict.slice('FINDINGS:\n'.length);
  const lines = body.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return { kind: 'malformed' };
  let findingCount = 0;
  for (const line of lines) {
    const finding = line.match(/^(\d+)\.\s+\S.*$/);
    if (finding !== null) {
      findingCount++;
      if (finding[1] !== String(findingCount)) {
        return { kind: 'malformed' };
      }
      continue;
    }
    if (findingCount === 0 || !/^[ \t]+\S.*$/.test(line)) {
      return { kind: 'malformed' };
    }
  }
  return { kind: 'findings', findingCount };
}

interface CorrectionDisposition {
  finding: number;
  decision: 'accept' | 'reject';
  reason: string;
}

type CorrectionEnvelope =
  | {
      kind: 'valid';
      dispositions: CorrectionDisposition[];
      result: string;
    }
  | { kind: 'malformed'; reason: string };

function parseCorrectionEnvelope(
  text: string,
  findingCount: number,
): CorrectionEnvelope {
  const source = unwrapCorrectionJson(text);
  if (source === null) {
    return {
      kind: 'malformed',
      reason: 'response must be bare JSON or one lone json/unlabeled fence',
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return { kind: 'malformed', reason: 'response is not one JSON object' };
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return { kind: 'malformed', reason: 'top level must be one JSON object' };
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, 'dispositions') ||
    !Object.hasOwn(record, 'result')
  ) {
    return {
      kind: 'malformed',
      reason: 'object must contain exactly dispositions and result',
    };
  }
  if (!Array.isArray(record.dispositions)) {
    return { kind: 'malformed', reason: 'dispositions must be an array' };
  }
  if (record.dispositions.length !== findingCount) {
    return {
      kind: 'malformed',
      reason: `dispositions must cover exactly ${findingCount} findings`,
    };
  }
  const dispositions: CorrectionDisposition[] = [];
  for (let index = 0; index < record.dispositions.length; index++) {
    const disposition = record.dispositions[index];
    if (
      typeof disposition !== 'object' ||
      disposition === null ||
      Array.isArray(disposition) ||
      Object.getPrototypeOf(disposition) !== Object.prototype
    ) {
      return {
        kind: 'malformed',
        reason: `disposition ${index + 1} must be an object`,
      };
    }
    const item = disposition as Record<string, unknown>;
    if (
      Object.keys(item).length !== 3 ||
      !Object.hasOwn(item, 'finding') ||
      !Object.hasOwn(item, 'decision') ||
      !Object.hasOwn(item, 'reason') ||
      item.finding !== index + 1 ||
      (item.decision !== 'accept' && item.decision !== 'reject') ||
      typeof item.reason !== 'string' ||
      item.reason.trim() === ''
    ) {
      return {
        kind: 'malformed',
        reason: `disposition ${index + 1} must exactly cover finding ${index + 1} with a decision and nonblank reason`,
      };
    }
    dispositions.push({
      finding: item.finding,
      decision: item.decision,
      reason: item.reason,
    });
  }
  if (typeof record.result !== 'string') {
    return { kind: 'malformed', reason: 'result must be a string' };
  }
  return { kind: 'valid', dispositions, result: record.result };
}

function unwrapCorrectionJson(text: string): string | null {
  const source = text.trim();
  if (!source.startsWith('```')) return source;
  const fenced = source.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/);
  return fenced?.[1] ?? null;
}

function buildReviewerPrompt(input: {
  originalPrompt: string;
  coderOutput: string;
  transcript: readonly string[];
}): string {
  return [
    'Review the current artifact and workspace state produced by the Coder.',
    'Use the host-exposed read-only file and search capabilities needed to inspect the workspace; shell and network capabilities may be unavailable.',
    'If a read-only shell is available, use it only for non-mutating inspection. Never edit, write, mutate, or commit.',
    'The original request and the Coder output follow.',
    '',
    '--- ORIGINAL REQUEST ---',
    input.originalPrompt,
    '--- END ORIGINAL REQUEST ---',
    '',
    '--- CODER OUTPUT ---',
    input.coderOutput,
    '--- END CODER OUTPUT ---',
    ...(input.transcript.length === 0
      ? []
      : [
          '',
          '--- COMPLETE PRIOR REVIEW TRANSCRIPT ---',
          ...input.transcript,
          '--- END COMPLETE PRIOR REVIEW TRANSCRIPT ---',
        ]),
    '',
    'Understand the full picture and reason systematically about the underlying design.',
    'Flag only material correctness, behavior, or specification-quality defects; include stale, missing, over-specified, or under-specified requirements when relevant.',
    'Do not flag style, equally valid alternatives, or theoretical threats. Avoid unnecessary complexity, but flag fundamental flaws whose later repair would cost more.',
    'For each defect class, report every instance worth fixing rather than revealing the class piecemeal. Do not duplicate findings.',
    'Accept or challenge each Coder rebuttal. Treat a finding rejected twice with evidence as settled and do not raise it again.',
    'Reply with exactly NO_FINDINGS when no unsettled material finding remains.',
    'Otherwise reply with FINDINGS: followed by top-level findings numbered consecutively from 1. Optional continuation or evidence lines must be indented. Add no preamble or epilogue.',
  ].join('\n');
}

function buildCoderFollowupPrompt(input: {
  originalPrompt: string;
  previousOutput: string;
  findings: string;
  transcript: readonly string[];
}): string {
  return [
    'Continue the original transformation in the current workspace.',
    'For every current review finding below, accept or reject it in the private response envelope.',
    'Before deciding, understand the full picture and reason systematically about the underlying design.',
    'Reject anything nonessential or not worth fixing now, giving reasoning and citing workspace evidence or test output.',
    'For each accepted item, fix its root cause minimally, including every worthwhile instance of the same defect class, without changing the original response contract.',
    'Do not commit. Preserve all original write-scope restrictions.',
    'Return exactly one JSON object, either bare or wholly enclosed by one unlabeled or json-labeled Markdown fence; add no preamble, epilogue, other fence label, or second fence.',
    'The object must have exactly two fields: "dispositions" and "result".',
    '"dispositions" must contain one item per current finding in consecutive order, each exactly {"finding": number, "decision": "accept" | "reject", "reason": nonblank string}.',
    '"result" must be the complete replacement text in exactly the response format required by the original request.',
    'The original response contract governs only the decoded "result" and takes precedence over disposition prose; never put review metadata inside "result" unless the original contract independently requires it.',
    '',
    '--- ORIGINAL REQUEST ---',
    input.originalPrompt,
    '--- END ORIGINAL REQUEST ---',
    '',
    '--- PREVIOUS CODER OUTPUT ---',
    input.previousOutput,
    '--- END PREVIOUS CODER OUTPUT ---',
    ...(input.transcript.length === 0
      ? []
      : [
          '',
          '--- COMPLETE PRIOR REVIEW TRANSCRIPT ---',
          ...input.transcript,
          '--- END COMPLETE PRIOR REVIEW TRANSCRIPT ---',
        ]),
    '',
    input.findings,
  ].join('\n');
}
