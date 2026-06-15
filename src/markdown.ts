// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Minimal markdown helpers shared by the phase and link loaders: locating a
 * named section and reading GitHub-flavored table rows. Not a general parser;
 * just enough to read the `## Formats` and `## Link Targets` blocks DR-001 and
 * DR-002 define.
 */

const HEADING = /^#{1,6}\s/;
const SEPARATOR_CELL = /^:?-+:?$/;

/**
 * Returns the lines beneath a heading named `heading` (case-insensitive, any
 * level), up to the next heading, or `null` when the heading is absent.
 */
export function findSection(content: string, heading: string): string[] | null {
  const lines = content.split(/\r?\n/);
  const wanted = heading.trim().toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      HEADING.test(line) &&
      line
        .replace(/^#{1,6}\s+/, '')
        .trim()
        .toLowerCase() === wanted
    ) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING.test(lines[i].trim())) break;
    body.push(lines[i]);
  }
  return body;
}

/**
 * Parses pipe-delimited table rows from `lines` into trimmed cell arrays,
 * dropping the separator row. The header row is returned and left for callers to
 * recognize and skip.
 */
export function parseTable(lines: readonly string[]): string[][] {
  const rows: string[][] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length === 0) continue;
    if (cells.every((cell) => SEPARATOR_CELL.test(cell))) continue;
    rows.push(cells);
  }
  return rows;
}
