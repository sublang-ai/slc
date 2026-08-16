// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Unified line diff for update-mode prompts (DR-021, INCR-14).
 *
 * The diff is context for an agent, not a patch for a machine: classic
 * `@@ -a,b +c,d @@` hunks with three lines of context, computed by exact-line
 * LCS after trimming the common prefix and suffix. Inputs beyond the budget
 * return `null` — the caller then supplies the prior-input path without a
 * rendered diff rather than failing the run.
 */

/** Cap on LCS table cells after prefix/suffix trimming (~16 MB backtrack). */
const CELL_BUDGET = 4_000_000;

/**
 * Cap on total changed-middle lines. The cell budget alone never trips for a
 * one-sided change (one side of the product is zero), so a pure mass
 * insertion or deletion must hit its own line bound rather than render an
 * unbounded diff into an agent prompt.
 */
const CHANGED_LINE_BUDGET = 10_000;

const CONTEXT = 3;

/**
 * Renders a unified diff of `prior` to `current`, or `null` when the inputs
 * exceed the budget. Returns the empty string when the texts are identical.
 */
export function unifiedLineDiff(prior: string, current: string): string | null {
  if (prior === current) return '';
  const before = splitLines(prior);
  const after = splitLines(current);

  // Trim the common prefix and suffix so the LCS table covers only the
  // changed middle; typical edits leave it tiny.
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start++;
  }
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }

  const n = endBefore - start;
  const m = endAfter - start;
  if (n * m > CELL_BUDGET || n + m > CHANGED_LINE_BUDGET) return null;

  const ops = middleOps(
    before.slice(start, endBefore),
    after.slice(start, endAfter),
  );

  // Rebuild the full op list: common prefix, changed middle, common suffix.
  const all: Op[] = [
    ...before.slice(0, start).map((line): Op => ({ tag: ' ', line })),
    ...ops,
    ...before.slice(endBefore).map((line): Op => ({ tag: ' ', line })),
  ];
  return renderHunks(all);
}

interface Op {
  tag: ' ' | '-' | '+';
  line: string;
}

/** Exact-line LCS over the trimmed middle, emitted as diff operations. */
function middleOps(before: readonly string[], after: readonly string[]): Op[] {
  const n = before.length;
  const m = after.length;
  // lengths[i][j] = LCS length of before[i..] and after[j..].
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] =
        before[i] === after[j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ tag: ' ', line: before[i] });
      i++;
      j++;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
      ops.push({ tag: '-', line: before[i] });
      i++;
    } else {
      ops.push({ tag: '+', line: after[j] });
      j++;
    }
  }
  while (i < n) ops.push({ tag: '-', line: before[i++] });
  while (j < m) ops.push({ tag: '+', line: after[j++] });
  return ops;
}

function splitLines(text: string): string[] {
  const lines = text.split('\n');
  // A trailing newline produces one empty trailing element; drop it so the
  // last real line diffs as itself.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function renderHunks(ops: readonly Op[]): string {
  // Change blocks [start, end), merging blocks whose common-line gap fits
  // within the shared context of two adjacent hunks.
  const blocks: [number, number][] = [];
  let index = 0;
  while (index < ops.length) {
    if (ops[index].tag === ' ') {
      index++;
      continue;
    }
    const start = index;
    let end = index + 1;
    let cursor = end;
    while (cursor < ops.length) {
      if (ops[cursor].tag !== ' ') {
        end = cursor + 1;
        cursor++;
        continue;
      }
      let gap = 0;
      while (cursor + gap < ops.length && ops[cursor + gap].tag === ' ') gap++;
      if (cursor + gap >= ops.length || gap > 2 * CONTEXT) break;
      cursor += gap;
    }
    blocks.push([start, end]);
    index = end;
  }

  // Old/new line numbers before each op (0-based counts, so +1 when printed).
  const oldBefore = new Uint32Array(ops.length + 1);
  const newBefore = new Uint32Array(ops.length + 1);
  for (let k = 0; k < ops.length; k++) {
    oldBefore[k + 1] = oldBefore[k] + (ops[k].tag !== '+' ? 1 : 0);
    newBefore[k + 1] = newBefore[k] + (ops[k].tag !== '-' ? 1 : 0);
  }

  const output: string[] = [];
  for (const [start, end] of blocks) {
    const from = Math.max(0, start - CONTEXT);
    const to = Math.min(ops.length, end + CONTEXT);
    const oldCount = oldBefore[to] - oldBefore[from];
    const newCount = newBefore[to] - newBefore[from];
    // Unified convention: an empty range names the line before it.
    const oldStart = oldCount === 0 ? oldBefore[from] : oldBefore[from] + 1;
    const newStart = newCount === 0 ? newBefore[from] : newBefore[from] + 1;
    output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (let k = from; k < to; k++) {
      output.push(`${ops[k].tag}${ops[k].line}`);
    }
  }
  return output.join('\n');
}
