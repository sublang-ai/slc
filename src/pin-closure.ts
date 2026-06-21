// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Semantic-input closure derivation for the pin-currency validator (PIN-2, PIN-4;
 * DR-007).
 *
 * A pinned phase's semantic-input closure is the definition file plus every local
 * file transitively cited by a `## Pin Inputs` section. A `## Pin Inputs` section
 * cites each input as an inline-code path (for example `` `reference/gears.md` ``)
 * expressed relative to the pipeline directory — the same coordinate system as
 * the recorded pin paths. Derivation recurses only into Markdown inputs that
 * declare their own `## Pin Inputs`; a non-Markdown input, or a Markdown input
 * without the section, is a closure member but terminates the transitive walk.
 * The derived closure is compared — as a set of resolved paths — to the recorded
 * definition plus semanticInputs; any difference is a stale verdict (PIN-4). See
 * specs/dev/pinning.md.
 */

import { readFile } from 'node:fs/promises';

import { findSection } from './markdown.js';
import { resolvePinPath } from './pin-paths.js';
import type { PinRecord } from './pins.js';

const PIN_INPUT_FIELD = 'pin input path';
const INLINE_CODE = /`([^`]+)`/g;

/** Extracts the inline-code paths cited by a `## Pin Inputs` section (DR-007). */
export function parsePinInputs(content: string): string[] {
  const lines = findSection(content, 'Pin Inputs');
  if (lines === null) {
    return [];
  }
  const paths: string[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(INLINE_CODE)) {
      paths.push(match[1].trim());
    }
  }
  return paths;
}

/**
 * Derives the semantic-input closure of `definitionPath` as a set of resolved
 * absolute paths: the definition plus every transitively cited local file
 * (PIN-2, PIN-4).
 *
 * @throws {import('./pins.js').PinError} when a cited path is absolute or escapes
 *   the recorded boundary (PIN-5).
 */
export async function deriveClosure(
  pipelineDir: string,
  boundary: string,
  definitionPath: string,
): Promise<Set<string>> {
  const closure = new Set<string>();
  const seen = new Set<string>();
  const queue: string[] = [definitionPath];

  while (queue.length > 0) {
    const rel = queue.shift() as string;
    if (seen.has(rel)) {
      continue;
    }
    seen.add(rel);

    const resolved = resolvePinPath(
      pipelineDir,
      boundary,
      rel,
      PIN_INPUT_FIELD,
    );
    closure.add(resolved);

    // Recurse only into Markdown inputs that declare their own ## Pin Inputs;
    // non-Markdown and sectionless inputs are members but terminate the walk.
    if (!isMarkdown(rel)) {
      continue;
    }
    const content = await readIfPresent(resolved);
    if (content === null) {
      continue;
    }
    for (const cited of parsePinInputs(content)) {
      if (!seen.has(cited)) {
        queue.push(cited);
      }
    }
  }
  return closure;
}

/**
 * Reports whether the closure derived from `record.definition` matches the
 * recorded definition plus semanticInputs, compared as sets of resolved paths
 * (PIN-4).
 */
export async function closureMatchesRecord(
  pipelineDir: string,
  boundary: string,
  record: PinRecord,
): Promise<boolean> {
  const derived = await deriveClosure(
    pipelineDir,
    boundary,
    record.definition.path,
  );
  const recorded = new Set<string>();
  recorded.add(
    resolvePinPath(
      pipelineDir,
      boundary,
      record.definition.path,
      'definition.path',
    ),
  );
  for (const input of record.semanticInputs) {
    recorded.add(
      resolvePinPath(pipelineDir, boundary, input.path, 'semanticInputs.path'),
    );
  }
  return setsEqual(derived, recorded);
}

function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

async function readIfPresent(absolutePath: string): Promise<string | null> {
  try {
    return await readFile(absolutePath, 'utf8');
  } catch {
    return null;
  }
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}
