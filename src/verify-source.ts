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
 * An item Playbook's prefix pass lists under `## Prefixed prompts` carries its
 * relayed values after its instructions; for it the order rule accepts exactly
 * that layout, mirroring Playbook's checker rule for rule (DR-052).
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
// A listed item's alternative tilings are kept as the fragment texts they
// carry; an item admitting more than this many is reported, never guessed.
const TILING_LIMIT = 4096;
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
 * The block a prefix pass moves or keeps: a quoted relay fragment whole; in an
 * instruction or prompt fragment, each blank-separated paragraph of only quoted
 * lines a relay unit, and the lines between relay units, without their bounding
 * blank lines, one instruction unit keeping its interior blank lines.
 */
interface PromptUnit {
  kind: 'instruction' | 'relay';
  /** Source position for ordering: the fragment's start plus the line offset. */
  start: number;
  lines: string[];
}

/** One reachable position while whole fragments tile a prefixed item's prompt. */
interface TilingState {
  /** Static prompt lines consumed so far. */
  line: number;
  /** Trailing prompt lines consumed so far. */
  tail: number;
  /** Whether some relay unit reached the tail. */
  moved: boolean;
  /** Whether an instruction unit followed a relay unit that reached the tail. */
  rewrite: boolean;
  /** Whether the unit matched last reached the tail. */
  lastMoved: boolean;
  /** Every multiset of fragment texts some path here carries, as sorted ids. */
  lists: Set<string>;
}

/** A prefixed item's findings and the fragment-text multisets that tile it. */
interface PrefixedItemVerdict {
  findings: string[];
  tilings: number[][];
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

/**
 * The items every `## Prefixed prompts` section lists, with a finding for each
 * malformed entry and for each section after the first.
 */
export function prefixedItems(gearsText: string): {
  ids: string[];
  findings: string[];
} {
  const ids: string[] = [];
  const findings: string[] = [];
  const lines = gearsText.split(LINE_BOUNDARY);
  let sections = 0;
  for (let start = 0; start < lines.length; start++) {
    if (!PREFIXED_SECTION.test(lines[start])) continue;
    if (++sections > 1) {
      findings.push(`Prefixed prompts: duplicate section at line ${start + 1}`);
    }
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
  }
  return { ids, findings };
}

/** A fragment's units, in Source order. */
function fragmentUnits(fragment: SourceFragment): PromptUnit[] {
  if (fragment.kind === 'relay') {
    return [{ kind: 'relay', start: fragment.start, lines: fragment.lines }];
  }
  const units: PromptUnit[] = [];
  let from = -1;
  let to = -1;
  const flush = (): void => {
    if (from === -1) return;
    units.push({
      kind: 'instruction',
      start: fragment.start + from,
      lines: fragment.lines.slice(from, to),
    });
    from = -1;
  };
  for (let index = 0; index < fragment.lines.length;) {
    let end = index;
    while (end < fragment.lines.length && fragment.lines[end] !== '') end++;
    const paragraph = fragment.lines.slice(index, end);
    if (
      paragraph.length > 0 &&
      paragraph.every((line) => RELAY_LINE.test(line))
    ) {
      flush();
      units.push({
        kind: 'relay',
        start: fragment.start + index,
        lines: paragraph,
      });
    } else if (paragraph.length > 0) {
      if (from === -1) from = index;
      to = end;
    }
    index = end + 1;
  }
  flush();
  return units;
}

/** Whether two line arrays are equal. */
function sameLines(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((line, index) => line === right[index])
  );
}

/**
 * The verdict for an item the prefix pass lists as rewritten. Its prompt must
 * be tiled by whole fragments taken in Source order: their instruction units in
 * the region before the trailing relay blocks and their relay units among the
 * trailing blocks, or in place where the raw layout kept a relay beside
 * instruction text, each unit occurrence used once, with blank lines and bare
 * quoted placeholder lines free among the trailing blocks. Before a unit stand
 * exactly the one blank line the pass leaves where a moved relay unit stood,
 * exactly the authored blank lines between it and a unit of its fragment that
 * kept its place, or the boundary Source composed before a fragment. Every
 * tiling is kept as the multiset of fragment texts it carries: a rewrite is
 * recognized whenever one tiling shows a relay that moved past an instruction,
 * and the multisets are returned for conservation.
 */
function prefixedItemFindings(
  item: GearsItem,
  fragments: readonly SourceFragment[],
  textIds: readonly number[],
): PrefixedItemVerdict {
  const { prompt } = item;
  // The relay blocks the pass moves: blank-bounded runs of quoted lines.
  const inBlock = prompt.map(() => false);
  for (let start = 0; start < prompt.length; start++) {
    let end = start;
    while (end < prompt.length && RELAY_LINE.test(prompt[end])) end++;
    if (
      end > start &&
      (start === 0 || prompt[start - 1] === '') &&
      (end === prompt.length || prompt[end] === '')
    ) {
      inBlock.fill(true, start, end);
    }
    start = Math.max(start, end);
  }
  let lastStatic = -1;
  prompt.forEach((line, index) => {
    if (line !== '' && !inBlock[index]) lastStatic = index;
  });
  if (inBlock.some((inside, index) => inside && index < lastStatic)) {
    return {
      findings: [
        `${item.id}: listed as prefixed but a relay precedes an instruction`,
      ],
      tilings: [],
    };
  }
  const statics = prompt.slice(0, lastStatic + 1);
  const tail = prompt.slice(lastStatic + 1);
  const free = (line: string): boolean =>
    line === '' || RELAY_PLACEHOLDER_LINE.test(line);
  // The static line after `unit` matched at the cursor across exactly `gap`
  // blank lines, or across any number where Source composed the boundary.
  const staticMatch = (
    line: number,
    unit: PromptUnit,
    gap: number | null,
  ): number => {
    let at = line;
    if (line > 0) {
      if (gap === null) {
        while (at < statics.length && statics[at] === '') at++;
      } else {
        for (let count = 0; count < gap; count++, at++) {
          if (statics[at] !== '') return -1;
        }
      }
    }
    return sameLines(statics.slice(at, at + unit.lines.length), unit.lines)
      ? at + unit.lines.length
      : -1;
  };
  // The tail line after `unit` matched at or after the cursor, past free lines.
  const tailMatch = (at: number, unit: PromptUnit): number => {
    for (let index = at; index + unit.lines.length <= tail.length; index++) {
      if (sameLines(tail.slice(index, index + unit.lines.length), unit.lines)) {
        return index + unit.lines.length;
      }
      if (!free(tail[index])) return -1;
    }
    return -1;
  };
  // Each reachable position — static line, tail line, whether a relay unit
  // reached the tail, whether an instruction unit followed one, whether the
  // last unit moved — with every multiset of fragment texts some path to it
  // carries, as sorted text ids.
  const keyOf = (state: TilingState): string =>
    `${state.line} ${state.tail} ${Number(state.moved)} ${Number(state.rewrite)} ${Number(state.lastMoved)}`;
  let overflow = false;
  const merge = (
    states: Map<string, TilingState>,
    state: TilingState,
  ): void => {
    const existing = states.get(keyOf(state));
    if (existing === undefined) {
      states.set(keyOf(state), state);
      return;
    }
    for (const list of state.lists) {
      if (existing.lists.size >= TILING_LIMIT && !existing.lists.has(list)) {
        overflow = true;
        break;
      }
      existing.lists.add(list);
    }
  };
  const withText = (list: string, id: number): string =>
    (list === '' ? [id] : [...list.split(',').map(Number), id])
      .sort((left, right) => left - right)
      .join(',');
  let reached = new Map<string, TilingState>();
  merge(reached, {
    line: 0,
    tail: 0,
    moved: false,
    rewrite: false,
    lastMoved: false,
    lists: new Set(['']),
  });
  fragments.forEach((fragment, index) => {
    const units = fragmentUnits(fragment);
    const next = new Map<string, TilingState>();
    for (const state of reached.values()) {
      merge(next, { ...state, lists: new Set(state.lists) });
    }
    let frontier = [...reached.values()];
    units.forEach((unit, position) => {
      const previous = units[position - 1];
      const advanced: TilingState[] = [];
      for (const state of frontier) {
        // The blank lines before this unit: the pass's one after a moved unit,
        // the authored count after a unit of this fragment that stayed, and
        // Source's own composition before a fragment's first unit.
        const gap = state.lastMoved
          ? 1
          : position === 0
            ? null
            : unit.start - (previous.start + previous.lines.length);
        const line = staticMatch(state.line, unit, gap);
        if (unit.kind === 'instruction') {
          if (line >= 0) {
            advanced.push({
              ...state,
              line,
              lastMoved: false,
              rewrite: state.rewrite || state.moved,
            });
          }
          continue;
        }
        const end = tailMatch(state.tail, unit);
        if (end >= 0) {
          advanced.push({ ...state, tail: end, moved: true, lastMoved: true });
        }
        if (line >= 0) advanced.push({ ...state, line, lastMoved: false });
      }
      frontier = advanced;
    });
    for (const state of frontier) {
      const lists = new Set(
        [...state.lists].map((list) => withText(list, textIds[index])),
      );
      merge(next, { ...state, lists });
    }
    reached = next;
  });
  const findings: string[] = [];
  if (overflow) {
    findings.push(
      `${item.id}: prompt admits more tilings than the checker verifies`,
    );
  }
  const ends = [...reached.values()].filter(
    (state) =>
      state.line === statics.length && tail.slice(state.tail).every(free),
  );
  if (ends.length === 0) {
    return {
      findings: [
        ...findings,
        `${item.id}: authored prompt fragments are out of Source order`,
      ],
      tilings: [],
    };
  }
  // A listing is a no-op only when no tiling shows a relay that moved past an
  // instruction and the tail holds no bare relay line, whose Source position
  // the prose leaves open.
  const noOp =
    !ends.some((state) => state.rewrite) &&
    !tail.some((line) => RELAY_PLACEHOLDER_LINE.test(line));
  if (noOp) {
    findings.push(
      `${item.id}: listed as prefixed but its prompt is in Source order`,
    );
  }
  return {
    findings,
    tilings: [...new Set(ends.flatMap((state) => [...state.lists]))].map(
      (list) => (list === '' ? [] : list.split(',').map(Number)),
    ),
  };
}

/** Non-overlapping contiguous occurrences of `needle` in `haystack`. */
function countFragment(
  haystack: readonly string[],
  needle: readonly string[],
): number {
  let count = 0;
  if (needle.length === 0) return count;
  outer: for (let index = 0; index + needle.length <= haystack.length;) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[index + offset] !== needle[offset]) {
        index++;
        continue outer;
      }
    }
    count++;
    index += needle.length;
  }
  return count;
}

/**
 * The deficit left by the best choice of one tiling per listed item: for each
 * fragment text, how many authored fragments no chosen tiling supplies. The
 * search is exact, memoized over the deficit still to cover.
 */
function residualDeficit(
  deficit: readonly number[],
  choices: readonly (readonly (readonly number[])[])[],
): number[] {
  const total = (vector: readonly number[]): number =>
    vector.reduce((sum, value) => sum + value, 0);
  const memo = new Map<string, number[]>();
  const search = (depth: number, vector: number[]): number[] => {
    if (depth === choices.length || total(vector) === 0) return vector;
    const key = `${depth}|${vector.join(',')}`;
    const seen = memo.get(key);
    if (seen !== undefined) return seen;
    let best = vector;
    for (const alternative of choices[depth]) {
      const result = search(
        depth + 1,
        vector.map((value, id) => Math.max(0, value - alternative[id])),
      );
      if (total(result) < total(best)) best = result;
      if (total(best) === 0) break;
    }
    memo.set(key, best);
    return best;
  };
  return search(0, [...deficit]);
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
  // A fragment's text id is the index of the first fragment authored with it.
  const texts = fragments.map((fragment) => JSON.stringify(fragment.lines));
  const textIds = texts.map((text) => texts.indexOf(text));
  const ids = [...new Set(textIds)];
  const listed = new Map(
    items
      .filter((item) => prefixedIds.has(item.id))
      .map((item) => [item.id, prefixedItemFindings(item, fragments, textIds)]),
  );
  // An unlisted item carries a fragment contiguously, as does a listed item
  // that admits no tiling and is already reported; a listed item that tiles
  // carries the fragments of one tiling of its prompt, chosen so that the
  // listed items together supply each authored text as many times as Source
  // authors it beyond what the other items carry — one occurrence never stands
  // for two authored fragments (DR-052).
  const contiguousCarriers = items.filter(
    (item) =>
      !prefixedIds.has(item.id) || listed.get(item.id)?.tilings.length === 0,
  );
  const deficit = ids.map((id) =>
    Math.max(
      0,
      textIds.filter((textId) => textId === id).length -
        contiguousCarriers.reduce(
          (sum, item) => sum + countFragment(item.prompt, fragments[id].lines),
          0,
        ),
    ),
  );
  const choices = [...listed.values()]
    .map((verdict) => verdict.tilings)
    .filter((tilings) => tilings.length > 0)
    .map((tilings) =>
      tilings.map((tiling) =>
        ids.map((id) => tiling.filter((textId) => textId === id).length),
      ),
    );
  const residual = residualDeficit(deficit, choices);
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

  ids.forEach((id, position) => {
    const missing = residual[position];
    if (missing === 0) return;
    const indexes = textIds.flatMap((textId, index) =>
      textId === id ? [index] : [],
    );
    for (const index of indexes.slice(-missing)) {
      const fragment = fragments[index];
      findings.push(
        `source ${fragment.kind} fragment at line ${fragment.start + 1} was dropped or changed`,
      );
    }
  });

  for (const item of items) {
    const verdict = listed.get(item.id);
    if (verdict !== undefined) {
      findings.push(...verdict.findings);
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
