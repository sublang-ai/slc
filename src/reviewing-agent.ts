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
 *
 * A request may carry a host-owned deterministic `mechanicalReview`. Its
 * findings are mechanical Reviewer findings (DR-029, phase-execution-51): the
 * round relays them to the Coder in place of its Reviewer call and spends one of
 * the permitted Reviewer calls, so the loop's bound is unchanged and no agent
 * judges an artifact a machine can already reject.
 */

import { messageOf } from './errors.js';
import type {
  AgentClient,
  AgentRunRequest,
  AgentRunResult,
} from './interpreter.js';

const MAX_REVIEWER_CALLS = 3;
const DEFAULT_REVIEW_RETRY_DELAY_MS = 15_000;

/** Options for {@link createReviewingAgent}. */
export interface ReviewingAgentOptions {
  /** The transformation-performing client whose result remains authoritative. */
  coder: AgentClient;
  /** Constructs a fresh Reviewer client for each performing call. */
  reviewer: () => AgentClient;
  /** Optional Reviewer model; omitted to use that adapter's default. */
  reviewerModel?: string;
  /** Pause before the single retry of an errored Reviewer call; tests pass 0. */
  reviewRetryDelayMs?: number;
}

/**
 * Decorates a Coder client with the DR-022 review/fix/re-review protocol.
 *
 * The verdict is read from the end of the Reviewer reply and narration before
 * it is ignored. A Reviewer call that returns an error rather than a verdict is
 * retried once after a short pause, because an adapter surfaces transient
 * overload as an error result and a finished Coder phase is too expensive to
 * discard for one. A repeated Reviewer error, an incompletion, and a malformed
 * verdict fail closed with a stable error diagnostic that retains the latest
 * Coder text and resume token.
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
        // The deterministic gate decides this round before any Reviewer sees
        // the artifact: its findings replace that Reviewer call and spend its
        // slot (phase-execution-51).
        let mechanical: readonly string[];
        try {
          mechanical =
            request.mechanicalReview === undefined
              ? []
              : await request.mechanicalReview();
        } catch (error) {
          return failClosed(
            coderResult,
            `mechanical review could not run: ${messageOf(error)}`,
          );
        }

        let findings: string;
        let findingCount: number;
        if (mechanical.length > 0) {
          reviewerCalls++;
          findings = formatMechanicalFindings(mechanical);
          findingCount = mechanical.length;
        } else {
          const reviewerRequest: AgentRunRequest = {
            prompt: buildReviewerPrompt({
              originalPrompt: request.prompt,
              coderOutput: coderResult.text,
              transcript,
            }),
            cwd: request.cwd,
            model: options.reviewerModel,
            ...(reviewerResume === undefined ? {} : { resume: reviewerResume }),
            signal: request.signal,
          };
          let review: AgentRunResult;
          try {
            reviewerCalls++;
            review = await reviewer.run(reviewerRequest);
            if (review.status === 'error' && review.stalled !== true) {
              // One bounded retry of the identical call: an adapter reports
              // transient overload as an error result, and the retry belongs to
              // the same review call, so it consumes no further review slot. A
              // stall abort is marked structurally and never retried: that call
              // is hung, and a second one would only wait another full stall
              // window (phase-execution-36).
              await pause(
                options.reviewRetryDelayMs ?? DEFAULT_REVIEW_RETRY_DELAY_MS,
              );
              review = await reviewer.run(reviewerRequest);
            }
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
          findings = review.text.trim();
          findingCount = verdict.findingCount;
        }

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

        const envelope = parseCorrectionEnvelope(correction.text, findingCount);
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

/**
 * Renders host-owned mechanical findings as the exact verdict block a Reviewer
 * would have produced, so the Coder's correction contract is one protocol
 * (phase-execution-51). Continuation lines stay indented, as the Reviewer's own
 * evidence lines do.
 */
function formatMechanicalFindings(findings: readonly string[]): string {
  return [
    'FINDINGS:',
    ...findings.flatMap((finding, index) => {
      const [first, ...rest] = finding.split('\n');
      return [`${index + 1}. ${first}`, ...rest.map((line) => `  ${line}`)];
    }),
  ].join('\n');
}

async function pause(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
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

/**
 * Reads the verdict from the end of the Reviewer reply.
 *
 * A reply whose last non-blank line is exactly `NO_FINDINGS` is clean;
 * otherwise the findings block runs from the last line that is exactly
 * `FINDINGS:` to the end of the reply. Narration before the verdict is ignored,
 * because a Reviewer may preface its verdict with rationale and an adapter may
 * join progress commentary ahead of it. A reply with neither form, or a
 * malformed findings block, is malformed.
 */
function parseReviewerVerdict(text: string): ReviewerVerdict {
  const all = text.replaceAll('\r\n', '\n').split('\n');
  let lastNonBlank = -1;
  let opening = -1;
  for (let index = all.length - 1; index >= 0; index--) {
    const line = all[index].trim();
    if (line === '') continue;
    if (lastNonBlank === -1) lastNonBlank = index;
    if (opening === -1 && line === 'FINDINGS:') opening = index;
  }
  if (lastNonBlank !== -1 && all[lastNonBlank].trim() === 'NO_FINDINGS') {
    return { kind: 'clean' };
  }
  if (opening === -1) return { kind: 'malformed' };
  const lines = all.slice(opening + 1).filter((line) => line.trim() !== '');
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
  const unwrapped = unwrapCorrectionJson(text);
  if (unwrapped.kind === 'malformed') return unwrapped;
  let value: unknown;
  try {
    value = JSON.parse(unwrapped.source) as unknown;
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

type CorrectionSource =
  | { kind: 'source'; source: string }
  | { kind: 'malformed'; reason: string };

/**
 * Isolates the envelope: the last complete top-level JSON object in the reply,
 * bare or wholly enclosed by one lone `json`/unlabeled Markdown fence.
 *
 * An adapter may join an agent's progress commentary ahead of its final
 * message, so leading narration is ignored. Nothing but whitespace may follow
 * the object, and two objects separated by nothing but whitespace are
 * ambiguous rather than an envelope preceded by narration.
 */
function unwrapCorrectionJson(text: string): CorrectionSource {
  const trimmed = text.replaceAll('\r\n', '\n').trim();
  const region = fencedRegion(trimmed);
  if (typeof region !== 'string') return region;
  return lastTopLevelObject(region);
}

/**
 * Returns the content of the last fence when the reply ends with a closing
 * fence line, the whole reply when it does not, or a malformed reason when the
 * enclosing fence carries another label.
 */
function fencedRegion(trimmed: string): string | CorrectionSource {
  const lines = trimmed.split('\n');
  const close = lines.length - 1;
  if (!/^[ \t]*```[ \t]*$/.test(lines[close] ?? '')) return trimmed;
  for (let index = close - 1; index >= 0; index--) {
    const opening = /^[ \t]*```[ \t]*([A-Za-z0-9_+-]*)[ \t]*$/.exec(
      lines[index],
    );
    if (opening === null) continue;
    if (opening[1] !== '' && opening[1] !== 'json') {
      return {
        kind: 'malformed',
        reason: 'a fenced envelope must use one json or unlabeled fence',
      };
    }
    return lines.slice(index + 1, close).join('\n');
  }
  return trimmed;
}

function lastTopLevelObject(region: string): CorrectionSource {
  const objects = topLevelObjects(region);
  const last = objects.at(-1);
  if (last === undefined) {
    return {
      kind: 'malformed',
      reason: 'response contains no complete JSON object',
    };
  }
  if (region.slice(last.end).trim() !== '') {
    return { kind: 'malformed', reason: 'text follows the JSON object' };
  }
  const previous = objects.at(-2);
  if (
    previous !== undefined &&
    region.slice(previous.end, last.start).trim() === '' &&
    isJsonObject(region.slice(previous.start, previous.end))
  ) {
    return {
      kind: 'malformed',
      reason: 'response ends with two adjacent JSON objects',
    };
  }
  return { kind: 'source', source: region.slice(last.start, last.end) };
}

/**
 * Balanced-brace scan for complete brace groups outside every JSON string,
 * honoring backslash escapes. A quote at depth zero is narration, not a string
 * delimiter, and an unmatched narration brace is skipped so the groups after it
 * are still found.
 */
function topLevelObjects(
  region: string,
): Array<{ start: number; end: number }> {
  const objects: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from < region.length) {
    let depth = 0;
    let start = 0;
    let inString = false;
    let escaped = false;
    for (let index = from; index < region.length; index++) {
      const character = region[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        if (depth > 0) inString = true;
      } else if (character === '{') {
        if (depth === 0) start = index;
        depth++;
      } else if (character === '}' && depth > 0) {
        depth--;
        if (depth === 0) objects.push({ start, end: index + 1 });
      }
    }
    if (depth === 0) break;
    from = start + 1;
  }
  return objects;
}

function isJsonObject(text: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return false;
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    'Inspect only the workspace named by the request; do not consult artifacts outside it, including any prior or reference compilation.',
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
