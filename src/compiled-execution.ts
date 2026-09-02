// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Compiled-execution fidelity: whether a compiled bundle's GEARS preserves
 * the compiled-execution contract its definition declares (verification-23,
 * pinning-23; DR-028).
 *
 * A Playbook definition that declares a closing `## Compiled execution`
 * section states its complete compiled behavior there: one direct-Captain
 * acting blockquote — relaying the definition itself at run time through a
 * `<definition>` placeholder — followed by the `Results:` contract the
 * compiled phase reports (Playbook DR-047). Because the rest of the definition
 * is relayed rather than transcribed, the bundle is retained across adoptions
 * exactly when that section is preserved verbatim in its GEARS; only a drift
 * warrants a rebuild. {@link checkCompiledExecutionFidelity} is that
 * deterministic comparison: the section's prompt lines and ordered result
 * entries must equal those of one direct-Captain GEARS item. A definition
 * without the section makes the check inapplicable rather than failed.
 *
 * The section is Source, so its prompt lines are compared after the Markdown
 * unescaping text2gears documents ({@link unescapeMarkdown}): a definition
 * spells its placeholder `\<definition\>` to keep it literal in rendered
 * Markdown, while the compiled GEARS carries the plain `<definition>`.
 */

import { parseGearsItems, type GearsItem } from './verify.js';

/** The exact H2 title of the definition's compiled-execution section. */
export const COMPILED_EXECUTION_HEADING = 'Compiled execution';

const SECTION_HEADING = /^##\s+Compiled execution\s*$/;
const ANY_SECTION_HEADING = /^#{1,2}\s/;
const BLOCKQUOTE = /^>\s?(.*)$/;
const RESULTS_LABEL = /^Results:\s*$/;
const RESULT_BULLET = /^-\s+`([A-Za-z_$][A-Za-z0-9_$]*)`:\s+(\S(?:.*\S)?)\s*$/;
/** A Markdown backslash escape: a backslash before any ASCII punctuation character. */
const MARKDOWN_ESCAPE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;

/**
 * Resolves the Markdown backslash escapes a Source line carries — a backslash
 * before any ASCII punctuation character stands for that character — as
 * text2gears documents for prompt extraction ("Markdown escaping is Source
 * syntax, not content"), so `\<definition\>` becomes `<definition>` and `\\`
 * becomes `\`. Every other backslash is content and stays.
 */
export function unescapeMarkdown(line: string): string {
  return line.replace(MARKDOWN_ESCAPE, '$1');
}

/** The contract a definition's compiled-execution section declares. */
export interface CompiledExecutionContract {
  /** Acting prompt lines with the blockquote marker removed and Markdown escapes resolved. */
  prompt: string[];
  /** Ordered `[guard, description]` result entries. */
  results: [string, string][];
  /** Structural defects of the section itself. */
  findings: string[];
}

/**
 * Parses the `## Compiled execution` section of a definition: its first
 * blockquote is the acting prompt — each line Markdown-unescaped
 * ({@link unescapeMarkdown}) into the plain text the compiled artifact
 * carries — and the `Results:` bullets that follow are the result contract.
 * Returns `undefined` when the definition declares no such section.
 */
export function parseCompiledExecutionContract(
  definition: string,
): CompiledExecutionContract | undefined {
  const lines = definition.split('\n');
  const headings = lines
    .map((line, index) => (SECTION_HEADING.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (headings.length === 0) return undefined;
  const findings: string[] = [];
  if (headings.length > 1) {
    findings.push(
      `definition declares ${headings.length} "## ${COMPILED_EXECUTION_HEADING}" sections (expected one)`,
    );
  }
  let end = headings[0] + 1;
  while (end < lines.length && !ANY_SECTION_HEADING.test(lines[end])) end++;
  const section = lines.slice(headings[0] + 1, end);

  const prompt: string[] = [];
  let cursor = 0;
  while (cursor < section.length && !BLOCKQUOTE.test(section[cursor])) {
    cursor++;
  }
  while (cursor < section.length) {
    const quote = BLOCKQUOTE.exec(section[cursor]);
    if (quote === null) break;
    prompt.push(unescapeMarkdown(quote[1]));
    cursor++;
  }
  if (prompt.length === 0) {
    findings.push('compiled-execution section declares no acting blockquote');
  }

  const results: [string, string][] = [];
  const label = section.findIndex(
    (line, index) => index >= cursor && RESULTS_LABEL.test(line),
  );
  if (label < 0) {
    findings.push('compiled-execution section declares no Results contract');
  } else {
    let index = label + 1;
    while (index < section.length && section[index].trim() === '') index++;
    for (; index < section.length; index++) {
      const entry = RESULT_BULLET.exec(section[index]);
      if (entry === null) break;
      const [, guard, description] = entry;
      if (results.some(([existing]) => existing === guard)) {
        findings.push(`compiled-execution Results repeat guard ${guard}`);
        continue;
      }
      results.push([guard, description]);
    }
    if (results.length === 0) {
      findings.push(
        'compiled-execution Results block declares no valid entries',
      );
    }
  }
  return { prompt, results, findings };
}

/** The verdict of one fidelity check. */
export type CompiledExecutionFidelity =
  | { applicable: false; reason: string }
  | { applicable: true; findings: string[]; item?: string };

/**
 * Checks that a bundle's GEARS preserves the definition's compiled-execution
 * contract: exactly the section's Markdown-unescaped prompt lines and ordered
 * result entries appear on one direct-Captain GEARS item (verification-23). A
 * definition without the section is not applicable.
 */
export function checkCompiledExecutionFidelity(
  definition: string,
  gears: string,
): CompiledExecutionFidelity {
  const contract = parseCompiledExecutionContract(definition);
  if (contract === undefined) {
    return {
      applicable: false,
      reason: `definition declares no "## ${COMPILED_EXECUTION_HEADING}" section`,
    };
  }
  if (contract.findings.length > 0) {
    return { applicable: true, findings: [...contract.findings] };
  }
  const expectedPrompt = contract.prompt.join('\n');
  const candidates = parseGearsItems(gears).filter(
    (item) => item.actor === 'captain',
  );
  const promptMatches = candidates.filter(
    (item) => item.prompt === expectedPrompt,
  );
  for (const item of promptMatches) {
    if (resultsEqual(item, contract.results)) {
      return { applicable: true, findings: [], item: item.id };
    }
  }
  if (promptMatches.length > 0) {
    return {
      applicable: true,
      findings: promptMatches.map(
        (item) =>
          `GEARS item ${item.id} preserves the compiled-execution acting prompt but its Results differ: expected ${renderResults(contract.results)}, found ${renderResults(itemResults(item))}${
            item.resultFindings === undefined
              ? ''
              : ` (${item.resultFindings.join('; ')})`
          }`,
      ),
    };
  }
  return {
    applicable: true,
    findings: [
      `no direct-Captain GEARS item preserves the compiled-execution acting prompt verbatim${nearestPrompt(candidates, contract.prompt)}`,
    ],
  };
}

function itemResults(item: GearsItem): [string, string][] {
  return Object.entries(item.result ?? {});
}

function resultsEqual(item: GearsItem, expected: [string, string][]): boolean {
  if (item.resultFindings !== undefined) return false;
  const actual = itemResults(item);
  return (
    actual.length === expected.length &&
    actual.every(
      ([guard, description], index) =>
        guard === expected[index][0] && description === expected[index][1],
    )
  );
}

function renderResults(results: [string, string][]): string {
  return results.length === 0
    ? '(none)'
    : results
        .map(([guard, description]) => `${guard}: ${description}`)
        .join(' | ');
}

/** Names the candidate whose prompt diverges latest, with its first differing line. */
function nearestPrompt(candidates: GearsItem[], expected: string[]): string {
  let best: { id: string; line: number; found: string | undefined } | undefined;
  for (const item of candidates) {
    const lines = item.prompt.split('\n');
    let line = 0;
    while (
      line < expected.length &&
      line < lines.length &&
      lines[line] === expected[line]
    ) {
      line++;
    }
    if (best === undefined || line > best.line) {
      best = { id: item.id, line, found: lines[line] };
    }
  }
  if (best === undefined) return ' (the GEARS declares no direct-Captain item)';
  return `; nearest item ${best.id} differs at prompt line ${best.line + 1}: expected ${JSON.stringify(expected[best.line] ?? '<end of prompt>')}, found ${JSON.stringify(best.found ?? '<end of prompt>')}`;
}
