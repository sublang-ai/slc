// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** A deliberately small, best-effort diff for agent update context. */

const CONTEXT_LINES = 3;
const MAX_RENDERED_BYTES = 64 * 1024;

/**
 * Renders one unified hunk around the changed middle. This is a hint, not a
 * machine patch: identical text returns `''`, and oversized context returns
 * `null` without changing Update-mode selection.
 */
export function unifiedLineDiff(prior: string, current: string): string | null {
  if (prior === current) return '';

  const before = prior.split('\n');
  const after = current.split('\n');
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  ) {
    prefix++;
  }

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > prefix &&
    afterEnd > prefix &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd--;
    afterEnd--;
  }

  const contextStart = Math.max(0, prefix - CONTEXT_LINES);
  const beforeContextEnd = Math.min(before.length, beforeEnd + CONTEXT_LINES);
  const afterContextEnd = Math.min(after.length, afterEnd + CONTEXT_LINES);
  const oldCount = beforeContextEnd - contextStart;
  const newCount = afterContextEnd - contextStart;

  const output: string[] = [];
  let size = 0;
  const append = (line: string): boolean => {
    size += Buffer.byteLength(line, 'utf8') + (output.length === 0 ? 0 : 1);
    if (size > MAX_RENDERED_BYTES) return false;
    output.push(line);
    return true;
  };

  if (
    !append(
      `@@ -${contextStart + 1},${oldCount} +${contextStart + 1},${newCount} @@`,
    )
  ) {
    return null;
  }
  for (let index = contextStart; index < prefix; index++) {
    if (!append(` ${before[index]}`)) return null;
  }
  for (let index = prefix; index < beforeEnd; index++) {
    if (!append(`-${before[index]}`)) return null;
  }
  for (let index = prefix; index < afterEnd; index++) {
    if (!append(`+${after[index]}`)) return null;
  }
  for (
    let offset = 0;
    beforeEnd + offset < beforeContextEnd &&
    afterEnd + offset < afterContextEnd;
    offset++
  ) {
    if (!append(` ${before[beforeEnd + offset]}`)) return null;
  }
  return output.join('\n');
}
