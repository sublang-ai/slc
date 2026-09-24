#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Deterministic realization of the prompt-prefix pass (slc/prefix.md): every
// standalone relay block of an eligible item moves after its last instruction
// line, byte-for-byte, and one `## Prefixed prompts` section at the end lists
// the items this and every earlier application rewrote. `--keep <ITEM-ID>`
// excludes an item the pass judged ineligible; the tool never modifies the
// source.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADING = /^#{1,3}\s/;
const ITEM_HEADING = /^###\s+([^\s]+)\s*$/;
const PROMPT_LINE = /^>\s?(.*)$/;
const SECTION = '## Prefixed prompts';
const SECTION_HEADING = /^##\s+Prefixed prompts\s*$/;
const LISTED = /^-\s+([^\s:]+):\s+relays → tail\s*$/;
const bullet = (id) => `- ${id}: relays → tail`;

/** Classify one prompt line by its content inside the outer blockquote marker. */
function classify(line) {
  const inner = PROMPT_LINE.exec(line)[1];
  if (inner === '') return 'blank';
  return inner.startsWith('>') ? 'relay' : 'instruction';
}

/**
 * Rewrite one blockquote (its raw `> …` file lines). Returns the new lines, or
 * null when no relay block precedes an instruction line.
 */
function prefixBlockquote(quote) {
  const kinds = quote.map(classify);
  // A relay block is a maximal run of relay lines bounded by blank lines or
  // the blockquote edges; a relay line adjacent to an instruction line is
  // authored content of that instruction and stays with it.
  const inBlock = new Array(quote.length).fill(false);
  for (let start = 0; start < quote.length; ) {
    if (kinds[start] !== 'relay') {
      start++;
      continue;
    }
    let end = start;
    while (end < quote.length && kinds[end] === 'relay') end++;
    const boundedBefore = start === 0 || kinds[start - 1] === 'blank';
    const boundedAfter = end === quote.length || kinds[end] === 'blank';
    if (boundedBefore && boundedAfter) inBlock.fill(true, start, end);
    start = end;
  }
  const firstBlock = inBlock.indexOf(true);
  if (firstBlock === -1) return null;
  const lastInstruction = Math.max(
    ...kinds.map((kind, index) =>
      kind === 'blank' || inBlock[index] ? -1 : index,
    ),
  );
  if (lastInstruction < firstBlock) return null; // relays already trail

  // Instruction lines keep their order and their authored blank lines; a
  // removed block takes the blank lines bounding it and leaves the first of
  // them where it separated two remaining lines, and none leads or trails the
  // region.
  const removed = [...inBlock];
  inBlock.forEach((inside, index) => {
    if (!inside) return;
    for (let at = index - 1; at >= 0 && kinds[at] === 'blank'; at--) removed[at] = true;
    for (let at = index + 1; at < quote.length && kinds[at] === 'blank'; at++) removed[at] = true;
  });
  const statics = [];
  let separator;
  for (let index = 0; index < quote.length; index++) {
    if (removed[index]) {
      separator ??= quote[index];
      continue;
    }
    if (statics.length === 0 && kinds[index] === 'blank') continue;
    if (separator !== undefined && statics.length > 0) statics.push(separator);
    separator = undefined;
    statics.push(quote[index]);
  }
  while (statics.length > 0 && classify(statics[statics.length - 1]) === 'blank') {
    statics.pop();
  }
  const blocks = [];
  for (let index = 0; index < quote.length; index++) {
    if (!inBlock[index]) continue;
    if (index === 0 || !inBlock[index - 1]) blocks.push([]);
    blocks[blocks.length - 1].push(quote[index]);
  }
  const relays = blocks.flatMap((block, index) =>
    index === 0 ? block : ['>', ...block],
  );
  return [...statics, '>', ...relays];
}

/**
 * Rewrite every eligible item of a GEARS package not named by `keep`.
 * Returns the rewritten text with its provenance section, or the source text
 * unchanged when no item was eligible, plus the rewritten item ids.
 */
export function prefixPrompts(text, { keep = [] } = {}) {
  // Keep the source's own line-ending convention so untouched lines stay bytes.
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const starts = [];
  lines.forEach((line, index) => {
    const match = ITEM_HEADING.exec(line);
    if (match !== null) starts.push({ index, id: match[1] });
  });
  const out = [];
  let cursor = 0;
  const rewritten = [];
  for (const start of starts) {
    let end = start.index + 1;
    while (end < lines.length && !HEADING.test(lines[end])) end++;
    let quoteStart = start.index + 1;
    while (quoteStart < end && !PROMPT_LINE.test(lines[quoteStart])) quoteStart++;
    if (quoteStart === end) continue;
    let quoteEnd = quoteStart;
    while (quoteEnd < end && PROMPT_LINE.test(lines[quoteEnd])) quoteEnd++;
    // A script item's blockquote is shell text, not a prompt (optimize.md).
    const acting = lines.slice(start.index + 1, quoteStart).join(' ');
    if (/\bCaptain shall run:/.test(acting) || keep.includes(start.id)) continue;
    const replaced = prefixBlockquote(lines.slice(quoteStart, quoteEnd));
    if (replaced === null) continue;
    out.push(...lines.slice(cursor, quoteStart), ...replaced);
    cursor = quoteEnd;
    rewritten.push(start.id);
  }
  if (rewritten.length === 0) return { text, rewritten };
  out.push(...lines.slice(cursor));
  // One provenance section follows every other section, ending in one newline;
  // it replaces every section an earlier application appended and lists, in
  // item order, each item this or that application rewrote.
  const listed = new Set(rewritten);
  for (let index = out.length - 1; index >= 0; index--) {
    if (!SECTION_HEADING.test(out[index])) continue;
    let end = index + 1;
    for (; end < out.length && !HEADING.test(out[end]); end++) {
      const entry = LISTED.exec(out[end]);
      if (entry !== null) listed.add(entry[1]);
    }
    out.splice(index, end - index);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  const ids = starts.map((start) => start.id).filter((id) => listed.has(id));
  out.push('', SECTION, '', ...ids.map(bullet), '');
  return { text: out.join(newline), rewritten };
}

async function main(argv) {
  let source;
  let target;
  const keep = [];
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    if (flag === '--source') source = value;
    else if (flag === '--target') target = value;
    else if (flag === '--keep') keep.push(value);
    else throw new Error(`unknown argument ${flag}`);
    index++;
  }
  if (source === undefined || target === undefined) {
    throw new Error(
      'usage: prefix-prompts.mjs --source <gears.md> --target <gears.md> [--keep <ITEM-ID>]...',
    );
  }
  const { text, rewritten } = prefixPrompts(await readFile(resolve(source), 'utf8'), { keep });
  await writeFile(resolve(target), text);
  process.stdout.write(
    rewritten.length === 0
      ? 'no eligible item; target equals source\n'
      : `${rewritten.join('\n')}\n`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
