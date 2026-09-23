// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Deterministic Source→GEARS conservation checks (DR-029, verification-25).
 *
 * A text-to-GEARS compile must conserve every prompt fragment its Source
 * authors: fenced instruction blocks and blockquotes reach the GEARS items
 * verbatim and in Source order, and — once a Source authors any fragment — a
 * GEARS prompt line the Source never authored is an invention. That is
 * mechanically decidable, so it is decided here rather than left to a Reviewer's
 * judgment (phase-execution-51).
 *
 * Every function is pure over the two texts: no filesystem, no definition, no
 * installed engine, and no prior artifact. Semantic item partitioning, condition
 * wording, and result descriptions remain the Reviewer's concern.
 */

// JavaScript's `.` excludes `\r` and `$` anchors only at end of input, so a
// `\r` left on a split line defeats every anchored pattern below. Split on the
// full CRLF or LF boundary once, here, rather than tolerating `\r` in each.
const LINE_BOUNDARY = /\r?\n/;
const ITEM_HEADING = /^###\s+(\S+)\s*$/;
const MARKDOWN_FENCE = /^```markdown\s*$/i;
const FENCE_END = /^```\s*$/;
const BLOCKQUOTE = /^>\s?(.*)$/;
const PLACEHOLDER = /<([A-Za-z_$#][A-Za-z0-9_$#-]*)>/g;
const RELAY_PLACEHOLDER_LINE = /^>\s+<[A-Za-z_$#][A-Za-z0-9_$#-]*>$/;
const RAW_PLACEHOLDER_LINE = /^<[A-Za-z_$#][A-Za-z0-9_$#-]*>$/;
const RESULT_BULLET = /^-\s+`([A-Za-z_$][A-Za-z0-9_$]*)`:\s+(.+)$/;
// A result-field entry names one output property, optionally annotating its
// ownership; the name is captured as authored so a non-identifier is reported
// rather than skipped (text2gears.md "Result contracts").
const ANNOTATED_FIELD = /^([^\s:]+)\s*:\s*<([^>]*)>$/;
const BARE_FIELD = /^\S+$/;
const FIELD_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
// The prefix pass's provenance (Playbook's `slc/prefix.md`): each listed item
// carries its relayed values after its instructions, so the order rule accepts
// that layout for it and no other.
const PREFIXED_SECTION = /^##\s+Prefixed prompts\s*$/;
const PREFIXED_BULLET = /^-\s+([^\s:]+):\s+relays → tail\s*$/;
const RELAY_LINE = /^>/;
const ENGLISH_PLAYER = '[A-Z][A-Za-z0-9_-]*';

/** What a Source fragment contributes to the items compiled from it. */
export type SourceFragmentKind =
  /** A fenced `markdown` instruction block. */
  | 'instruction'
  /** A blockquote whose prose relays it in quotes, markers included. */
  | 'relay'
  /** A plain blockquote. */
  | 'prompt';

/** One prompt fragment the Source authors explicitly. */
export interface SourceFragment {
  kind: SourceFragmentKind;
  /** Zero-based Source line where the fragment starts. */
  start: number;
  /** The fragment's exact prompt lines, escapes resolved. */
  lines: string[];
}

/**
 * The block a prefix pass moves or keeps: a quoted relay fragment whole, or one
 * blank-separated paragraph of an instruction or prompt fragment, a paragraph
 * of only quoted lines being a relay unit and any other an instruction unit.
 */
interface PromptUnit {
  kind: 'instruction' | 'relay';
  /** Source position for ordering: the fragment's start plus the line offset. */
  start: number;
  lines: string[];
}

/** One required result field and its ownership annotation. */
export interface GearsResultField {
  name: string;
  /** True when the item's result contract makes the player's final text authoritative. */
  verbatim: boolean;
}

/** One declared `Results:` entry of a GEARS item. */
export interface GearsResult {
  guard: string;
  description: string;
  fields: GearsResultField[];
}

/** The minimal GEARS item surface the Source and relay checks read. */
export interface GearsItem {
  id: string;
  ordinal: number;
  /** True when the item's acting sentence delegates to a prompted or relayed player. */
  delegated: boolean;
  /** The delegated player's name, when the acting sentence names one. */
  player?: string;
  /** The item's contiguous acting prompt lines, escapes resolved. */
  prompt: string[];
  results: GearsResult[];
}

/** Resolves Markdown escaping that is Source syntax rather than prompt content. */
function normalizePromptLine(line: string): string {
  return line.replace(/\\([<>])/g, '$1');
}

/** Whether prose immediately introducing a Source blockquote makes `>` content. */
function introducesQuotedRelay(
  lines: readonly string[],
  start: number,
): boolean {
  const context: string[] = [];
  for (let index = start - 1; index >= 0 && context.length < 4; index--) {
    const line = lines[index].trim();
    if (line === '') continue;
    if (line.startsWith('#') || line.startsWith('```')) break;
    context.unshift(line);
  }
  return /\bin quotes\s*\(`>`\)/i.test(context.join(' '));
}

/**
 * The prompt fragments authored explicitly in one free-form Source: fenced
 * `markdown` instruction blocks and blockquotes, in Source order.
 *
 * @throws {Error} when an instruction fence is never closed.
 */
export function sourcePromptFragments(sourceText: string): SourceFragment[] {
  const lines = sourceText.split(LINE_BOUNDARY);
  const fragments: SourceFragment[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (MARKDOWN_FENCE.test(lines[index])) {
      const start = index;
      const content: string[] = [];
      for (
        index++;
        index < lines.length && !FENCE_END.test(lines[index]);
        index++
      ) {
        content.push(normalizePromptLine(lines[index]));
      }
      if (index >= lines.length) {
        throw new Error(
          `unclosed markdown instruction fence at line ${start + 1}`,
        );
      }
      fragments.push({ kind: 'instruction', start, lines: content });
      continue;
    }

    if (!BLOCKQUOTE.test(lines[index])) continue;
    const start = index;
    const quotedRelay = introducesQuotedRelay(lines, start);
    const content: string[] = [];
    while (index < lines.length) {
      const match = BLOCKQUOTE.exec(lines[index]);
      if (match === null) break;
      const line = normalizePromptLine(match[1]);
      content.push(quotedRelay ? (line === '' ? '>' : `> ${line}`) : line);
      index++;
    }
    index--;
    fragments.push({
      kind: quotedRelay ? 'relay' : 'prompt',
      start,
      lines: content,
    });
  }
  return fragments.filter((fragment) => fragment.lines.length > 0);
}

/** Required result fields and their ownership annotation. */
function resultFields(description: string): GearsResultField[] {
  const marker = description.indexOf('Output shall include');
  if (marker === -1) return [];
  const fields: GearsResultField[] = [];
  for (const match of description.slice(marker).matchAll(/`([^`]+)`/g)) {
    const span = match[1].trim();
    const annotated = ANNOTATED_FIELD.exec(span);
    if (annotated !== null) {
      fields.push({
        name: annotated[1],
        verbatim: annotated[2].trim().toLowerCase() === 'verbatim final text',
      });
      continue;
    }
    // A span carrying whitespace is prose, not a bare property name.
    if (BARE_FIELD.test(span)) fields.push({ name: span, verbatim: false });
  }
  return fields;
}

/** Player named by one delegated GEARS acting sentence. */
function actingPlayer(acting: string): string | undefined {
  const prompted = new RegExp(
    `\\bCaptain shall prompt\\s+(${ENGLISH_PLAYER})\\b`,
  ).exec(acting)?.[1];
  if (prompted !== undefined) return prompted;
  return new RegExp(
    `\\bCaptain shall relay\\b.*?\\bto\\s+(${ENGLISH_PLAYER})\\b`,
  ).exec(acting)?.[1];
}

/** Parses the minimal GEARS item surface the Source-fidelity rules read. */
export function parseGearsContract(gearsText: string): GearsItem[] {
  const lines = gearsText.split(LINE_BOUNDARY);
  const starts: Array<{ index: number; id: string }> = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = ITEM_HEADING.exec(lines[index]);
    if (heading !== null) starts.push({ index, id: heading[1] });
  }

  return starts.map((start, ordinal) => {
    const end = starts[ordinal + 1]?.index ?? lines.length;
    const section = lines.slice(start.index + 1, end);
    const firstQuote = section.findIndex((line) => BLOCKQUOTE.test(line));
    const prompt: string[] = [];
    let cursor = firstQuote;
    while (cursor >= 0 && cursor < section.length) {
      const quote = BLOCKQUOTE.exec(section[cursor]);
      if (quote === null) break;
      prompt.push(normalizePromptLine(quote[1]));
      cursor++;
    }
    const acting = section.slice(0, Math.max(firstQuote, 0)).join(' ');
    const delegated = /\bCaptain shall (?:prompt\b|relay\b)/.test(acting);
    const player = actingPlayer(acting);
    const results: GearsResult[] = [];
    for (const line of section.slice(Math.max(cursor, 0))) {
      const bullet = RESULT_BULLET.exec(line);
      if (bullet === null) continue;
      results.push({
        guard: bullet[1],
        description: bullet[2],
        fields: resultFields(bullet[2]),
      });
    }
    return {
      id: start.id,
      ordinal,
      delegated,
      ...(player === undefined ? {} : { player }),
      prompt,
      results,
    };
  });
}

/** Canonical kebab-token to camel-field mapping shared with the link phase. */
function placeholderField(token: string): string {
  if (token === '#') return 'irNumber';
  return token.replace(/-([A-Za-z0-9_$])/g, (_match, next: string) =>
    next.toUpperCase(),
  );
}

/** Every exact contiguous occurrence of `needle` in `haystack`. */
function fragmentIndices(
  haystack: readonly string[],
  needle: readonly string[],
): number[] {
  const indices: number[] = [];
  if (needle.length === 0 || needle.length > haystack.length) return indices;
  outer: for (
    let index = 0;
    index <= haystack.length - needle.length;
    index++
  ) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    indices.push(index);
  }
  return indices;
}

/** The items a `## Prefixed prompts` section lists, with malformed-entry findings. */
export function prefixedItems(gearsText: string): {
  ids: string[];
  findings: string[];
} {
  const ids: string[] = [];
  const findings: string[] = [];
  const lines = gearsText.split(LINE_BOUNDARY);
  const start = lines.findIndex((line) => PREFIXED_SECTION.test(line));
  if (start === -1) return { ids, findings };
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (/^#{1,3}\s/.test(line)) break;
    if (line.trim() === '') continue;
    const bullet = PREFIXED_BULLET.exec(line);
    if (bullet === null) {
      findings.push(
        `Prefixed prompts: malformed entry: ${JSON.stringify(line)}`,
      );
      continue;
    }
    ids.push(bullet[1]);
  }
  return { ids, findings };
}

/** A fragment's units, in Source order. */
function fragmentUnits(fragment: SourceFragment): PromptUnit[] {
  if (fragment.kind === 'relay') {
    return [{ kind: 'relay', start: fragment.start, lines: fragment.lines }];
  }
  const units: PromptUnit[] = [];
  let paragraph: string[] = [];
  let at = 0;
  const flush = (): void => {
    if (paragraph.length === 0) return;
    units.push({
      kind: paragraph.every((line) => RELAY_LINE.test(line))
        ? 'relay'
        : 'instruction',
      start: fragment.start + at,
      lines: paragraph,
    });
    paragraph = [];
  };
  fragment.lines.forEach((line, index) => {
    if (line === '') {
      flush();
      return;
    }
    if (paragraph.length === 0) at = index;
    paragraph.push(line);
  });
  flush();
  return units;
}

/** Whether matched units keep ascending Source positions. */
function unitsInSourceOrder(entries: readonly { unit: PromptUnit }[]): boolean {
  return entries.every(
    (entry, index) =>
      index === 0 || entries[index - 1].unit.start <= entry.unit.start,
  );
}

/**
 * The order findings for an item the prefix pass lists as rewritten: its
 * instruction units keep Source order, its relay units keep Source order, every
 * relay unit and bare relay line follows the last instruction unit, and the
 * listing is not a no-op.
 */
function prefixedItemFindings(
  item: GearsItem,
  units: readonly PromptUnit[],
): string[] {
  const findings: string[] = [];
  const instructions = units
    .filter((unit) => unit.kind === 'instruction')
    .flatMap((unit) => {
      const [index] = fragmentIndices(item.prompt, unit.lines);
      return index === undefined
        ? []
        : [{ unit, index, end: index + unit.lines.length }];
    });
  // A unit contained in a larger matched instruction unit is that unit's content.
  const independent = instructions
    .filter(
      (entry) =>
        !instructions.some(
          (other) =>
            other !== entry &&
            other.unit.lines.length > entry.unit.lines.length &&
            other.index <= entry.index &&
            entry.end <= other.end,
        ),
    )
    .sort((left, right) => left.index - right.index);
  const insideInstruction = (index: number, length: number): boolean =>
    independent.some(
      (entry) => entry.index <= index && index + length <= entry.end,
    );
  // A relay moved to the tail is its last free occurrence; an earlier copy
  // inside an instruction unit belongs to that instruction.
  const relays = units
    .filter((unit) => unit.kind === 'relay')
    .flatMap((unit) => {
      const index = fragmentIndices(item.prompt, unit.lines)
        .filter((candidate) => !insideInstruction(candidate, unit.lines.length))
        .at(-1);
      return index === undefined ? [] : [{ unit, index }];
    })
    .sort((left, right) => left.index - right.index);
  if (!unitsInSourceOrder(independent) || !unitsInSourceOrder(relays)) {
    findings.push(
      `${item.id}: authored prompt fragments are out of Source order`,
    );
  }
  const staticEnd = Math.max(0, ...independent.map((entry) => entry.end));
  const trailing =
    relays.every((entry) => entry.index >= staticEnd) &&
    item.prompt.every(
      (line, index) =>
        index >= staticEnd ||
        !RELAY_LINE.test(line) ||
        insideInstruction(index, 1),
    );
  if (!trailing) {
    findings.push(
      `${item.id}: listed as prefixed but a relay precedes an instruction`,
    );
  }
  const lastInstructionStart = Math.max(
    -1,
    ...independent.map((entry) => entry.unit.start),
  );
  if (relays.every((entry) => entry.unit.start > lastInstructionStart)) {
    findings.push(
      `${item.id}: listed as prefixed but its prompt is in Source order`,
    );
  }
  return findings;
}

/** Whether complete, nonoverlapping matches admit an ordered attribution. */
function fragmentsAreInSourceOrder(
  prompt: readonly string[],
  fragments: readonly SourceFragment[],
): boolean {
  const spans = new Map<
    string,
    { start: number; end: number; sourceStarts: number[] }
  >();
  for (const fragment of fragments) {
    for (const start of fragmentIndices(prompt, fragment.lines)) {
      const end = start + fragment.lines.length;
      const key = `${start}:${end}`;
      const span = spans.get(key) ?? { start, end, sourceStarts: [] };
      // Fragments arrive in Source order. Identical matches are alternatives,
      // not independent fragments competing for the same prompt position.
      span.sourceStarts.push(fragment.start);
      spans.set(key, span);
    }
  }

  const ordered = [...spans.values()].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  let furthestEnd = -1;
  let sourceFloor = -1;
  let completed = 0;
  const attributed: Array<{ end: number; sourceStart: number }> = [];
  for (const span of ordered) {
    // A shorter full match inside another full fragment is incidental content
    // of that larger fragment, not a second independently ordered occurrence.
    if (span.end <= furthestEnd) continue;
    furthestEnd = span.end;

    // Remaining ends increase strictly. Only disjoint prior spans establish
    // order; crossing overlaps do not invent an ordering of shared lines.
    while (
      completed < attributed.length &&
      attributed[completed].end <= span.start
    ) {
      sourceFloor = Math.max(sourceFloor, attributed[completed].sourceStart);
      completed++;
    }
    // The earliest compatible attribution leaves every later choice available,
    // so failure here means no order-preserving attribution exists.
    const sourceStart = span.sourceStarts.find((start) => start >= sourceFloor);
    if (sourceStart === undefined) return false;
    attributed.push({ end: span.end, sourceStart });
  }
  return true;
}

/**
 * The conservation findings at the Source→GEARS seam (verification-25).
 *
 * Returns one finding per violated rule, in rule order, and the empty array when
 * the GEARS conserves its Source. A Source authoring no fragment leaves the
 * invented-prompt-line rule inapplicable: plain prose deliberately leaves prompt
 * wording to the compiler's judgment.
 *
 * @throws {Error} when the Source's instruction fence is never closed.
 */
export function checkSourceGearsContract(
  sourceText: string,
  gearsText: string,
): string[] {
  const fragments = sourcePromptFragments(sourceText);
  const items = parseGearsContract(gearsText);
  const prefixed = prefixedItems(gearsText);
  const findings: string[] = [...prefixed.findings];
  const itemIds = new Set(items.map((item) => item.id));
  for (const id of prefixed.ids) {
    if (!itemIds.has(id)) {
      findings.push(`Prefixed prompts: ${id} is not an item`);
    }
  }
  const prefixedIds = new Set(prefixed.ids);
  const units = fragments.flatMap(fragmentUnits);
  const relayedFields = new Set(
    fragments
      .filter((fragment) => fragment.kind === 'relay')
      .flatMap((fragment) =>
        fragment.lines.flatMap((line) =>
          [...line.matchAll(PLACEHOLDER)].map((match) =>
            placeholderField(match[1]),
          ),
        ),
      ),
  );
  const authoredLines = new Set(
    fragments.flatMap((fragment) =>
      fragment.lines.filter((line) => line !== ''),
    ),
  );

  for (const fragment of fragments) {
    // A prefixed item keeps each of a fragment's units contiguous rather than
    // the whole fragment, since the pass moved its relay units to the tail.
    const present = items.some(
      (item) =>
        fragmentIndices(item.prompt, fragment.lines).length > 0 ||
        (prefixedIds.has(item.id) &&
          fragmentUnits(fragment).every(
            (unit) => fragmentIndices(item.prompt, unit.lines).length > 0,
          )),
    );
    if (!present) {
      findings.push(
        `source ${fragment.kind} fragment at line ${fragment.start + 1} was dropped or changed`,
      );
    }
  }

  for (const item of items) {
    if (prefixedIds.has(item.id)) {
      findings.push(...prefixedItemFindings(item, units));
    } else if (!fragmentsAreInSourceOrder(item.prompt, fragments)) {
      findings.push(
        `${item.id}: authored prompt fragments are out of Source order`,
      );
    }

    // A Source that authors no fragment leaves prompt wording to the compiler
    // (DR-029), so the invented-line rule applies only once one exists.
    if (fragments.length === 0) continue;
    for (const line of item.prompt) {
      if (line === '' || authoredLines.has(line)) continue;
      if (RELAY_PLACEHOLDER_LINE.test(line)) continue;
      if (RAW_PLACEHOLDER_LINE.test(line)) {
        findings.push(
          `${item.id}: additional placeholder line ${JSON.stringify(line)} lacks a literal quote marker in the prompt; use ${JSON.stringify(`> > ${line}`)} in GEARS to retain ${JSON.stringify(`> ${line}`)} as prompt content`,
        );
        continue;
      }
      findings.push(
        `${item.id}: prompt line is not an authored fragment: ${JSON.stringify(line)}`,
      );
    }
  }

  // Downstream artifacts and calling playbooks consume an output property by
  // name, so a quoted kebab-case key names nothing the verifier can synthesize
  // (DR-029; text2gears.md "Result contracts").
  for (const item of items) {
    for (const result of item.results) {
      for (const field of result.fields) {
        if (FIELD_IDENTIFIER.test(field.name)) continue;
        findings.push(
          `${item.id}: result \`${result.guard}\` names the non-identifier output property ${JSON.stringify(field.name)}`,
        );
      }
    }
  }

  const producers = new Map<string, GearsResultField[]>();
  for (const item of items) {
    for (const result of item.results) {
      for (const field of result.fields) {
        const entries = producers.get(field.name) ?? [];
        entries.push(field);
        producers.set(field.name, entries);
      }
    }
  }
  for (const [field, entries] of producers) {
    if (
      entries.some((entry) => entry.verbatim) &&
      entries.some((entry) => !entry.verbatim)
    ) {
      findings.push(
        `${field}: result field mixes verbatim and judge-authored ownership`,
      );
    }
  }

  const reported = new Set<string>();
  for (const item of items) {
    for (const line of item.prompt) {
      for (const match of line.matchAll(PLACEHOLDER)) {
        const field = placeholderField(match[1]);
        if (!relayedFields.has(field)) continue;
        const key = `${item.id}:${field}`;
        if (!line.startsWith('> ') && !reported.has(key)) {
          findings.push(
            `${item.id}: relayed player field ${field} lacks a literal quote marker`,
          );
          reported.add(key);
        }
      }
    }
  }

  return findings;
}
