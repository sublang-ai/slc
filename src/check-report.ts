// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

export type CheckFailureCategory =
  'environment' | 'artifact' | 'unverified' | 'canceled' | 'checker-failed';
/** Prefer concrete checker evidence to transport-message heuristics. */
export function checkFailureCategory(
  findings: readonly string[],
): CheckFailureCategory {
  const text = findings.join('\n');
  const messages = text
    .split('\n')
    .map((line) => line.replace(/^[ \t]*-[ \t]*/, '').trim());
  if (/artifact: forbidden verification side effect/i.test(text))
    return 'artifact';
  for (const [prefix, category] of [
    ['cancell?ed', 'canceled'],
    ['environment', 'environment'],
    ['checker-failed', 'checker-failed'],
    ['unverified', 'unverified'],
    ['artifact', 'artifact'],
  ] as const)
    if (
      messages.some((message) =>
        new RegExp('^' + prefix + ':', 'i').test(message),
      )
    )
      return category;
  if (/\bTS\d{4,5}:/.test(text)) return 'artifact';
  if (
    /remains unverified|remains unproved|exhausted.*(?:budget|depth|attempt)|no reachable entry/i.test(
      text,
    )
  )
    return 'unverified';
  if (
    messages.some((message) =>
      /^(?:cancell?ed\b|aborted\b|interrupted\b|caller cancell?ed\b|agent call stalled:.*aborted by the stall watchdog)/i.test(
        message,
      ),
    )
  )
    return 'canceled';
  if (
    messages.some(
      (message) =>
        /^(?:[^\n]*Adapter requires @|requires @|missing (?:compiler-owned|included SDK|native component))/i.test(
          message,
        ) ||
        /^(?:API(?: Error)?|HTTP(?: Error)?|Anthropic(?: Error)?|OpenAI(?: Error)?|Codex(?: Error)?|Claude(?: Error)?|Error):.*(?:\b(?:401|403|429)\b|authentication|unauthorized|invalid.*(?:api|auth).*key|quota|usage limit|ERR_PROXY_TUNNEL)/i.test(
          message,
        ) ||
        /^(?:authentication failed|unauthorized\b|invalid.*(?:api|auth).*key|quota.*exhausted|usage limit|workspace routing discovery timed out)/i.test(
          message,
        ) ||
        /^(?:You've hit your usage limit\b|unexpected status (?:401|403|429)\b)/i.test(
          message,
        ) ||
        /^(?:401|403|429)\b.*(?:auth|access|quota|rate)/i.test(message) ||
        /^Reconnecting\.\.\..*\(workspace routing discovery timed out\)/i.test(
          message,
        ),
    )
  )
    return 'environment';
  return 'artifact';
}
