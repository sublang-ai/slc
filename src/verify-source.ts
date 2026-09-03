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

const ITEM_HEADING = /^###\s+(\S+)\s*$/;
const MARKDOWN_FENCE = /^```markdown\s*$/i;
const FENCE_END = /^```\s*$/;
const BLOCKQUOTE = /^>\s?(.*)$/;
const PLACEHOLDER = /<([A-Za-z_$#][A-Za-z0-9_$#-]*)>/g;
const RELAY_PLACEHOLDER_LINE = /^>\s+<[A-Za-z_$#][A-Za-z0-9_$#-]*>$/;
const RESULT_BULLET = /^-\s+`([A-Za-z_$][A-Za-z0-9_$]*)`:\s+(.+)$/;
// A result-field entry names one output property, optionally annotating its
// ownership; the name is captured as authored so a non-identifier is reported
// rather than skipped (text2gears.md "Result contracts").
const ANNOTATED_FIELD = /^([^\s:]+)\s*:\s*<([^>]*)>$/;
const BARE_FIELD = /^\S+$/;
const FIELD_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
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
  const lines = sourceText.split('\n');
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
  const lines = gearsText.split('\n');
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

/** First exact contiguous occurrence of `needle` in `haystack`. */
function fragmentIndex(
  haystack: readonly string[],
  needle: readonly string[],
): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  outer: for (
    let index = 0;
    index <= haystack.length - needle.length;
    index++
  ) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
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
  const findings: string[] = [];
  const fragments = sourcePromptFragments(sourceText);
  const items = parseGearsContract(gearsText);
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
    if (
      !items.some((item) => fragmentIndex(item.prompt, fragment.lines) >= 0)
    ) {
      findings.push(
        `source ${fragment.kind} fragment at line ${fragment.start + 1} was dropped or changed`,
      );
    }
  }

  for (const item of items) {
    const matches = fragments
      .map((fragment) => ({
        fragment,
        promptIndex: fragmentIndex(item.prompt, fragment.lines),
      }))
      .filter((entry) => entry.promptIndex >= 0)
      .sort((left, right) => left.promptIndex - right.promptIndex);
    for (let index = 1; index < matches.length; index++) {
      if (matches[index - 1].fragment.start > matches[index].fragment.start) {
        findings.push(
          `${item.id}: authored prompt fragments are out of Source order`,
        );
        break;
      }
    }

    // A Source that authors no fragment leaves prompt wording to the compiler
    // (DR-029), so the invented-line rule applies only once one exists.
    if (fragments.length === 0) continue;
    for (const line of item.prompt) {
      if (line === '' || authoredLines.has(line)) continue;
      if (RELAY_PLACEHOLDER_LINE.test(line)) continue;
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
