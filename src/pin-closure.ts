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
import { isAbsolute, resolve } from 'node:path';
import { isAbsolute as isPosixAbsolute } from 'node:path/posix';

import { findSection } from './markdown.js';
import { resolvePinPath } from './pin-paths.js';
import type { PinRecord } from './pins.js';

const PIN_INPUT_FIELD = 'pin input path';
const INLINE_CODE = /`([^`]+)`/g;

/** A definition's declared readable closure for incremental-plan identity. */
export interface DeclaredClosure {
  /** Whether the authoritative definition explicitly declared `## Pin Inputs`. */
  closed: boolean;
  /** Exact resolved semantic inputs, excluding the definition itself. */
  inputs: Set<string>;
}

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
 * Derives the declared readable closure used by DR-021 planning.
 *
 * Unlike {@link deriveClosure}, this preserves the load-bearing distinction
 * between a missing `## Pin Inputs` section (open closure) and a present empty
 * section (closed empty closure). Explicit request references are always
 * included as readable semantic inputs, but do not turn an open definition
 * into a closed one. A pin boundary is applied when supplied; an unpinned
 * definition may cite any portable relative read path because those paths are
 * identities, never write authority.
 */
export async function deriveDeclaredClosure(opts: {
  pipelineDir: string;
  definitionPath: string;
  boundary?: string;
  references?: readonly string[];
}): Promise<DeclaredClosure> {
  const definition = await readFile(opts.definitionPath, 'utf8');
  const declared = findSection(definition, 'Pin Inputs');
  const references = (opts.references ?? []).map((path) => resolve(path));
  const inputs = new Set<string>(references);
  const seen = new Set<string>();
  const queue = declared === null ? [] : parsePinInputs(definition);

  for (const reference of references) {
    if (!isMarkdown(reference)) continue;
    const content = await readIfPresent(reference);
    if (content === null) continue;
    for (const cited of parsePinInputs(content)) queue.push(cited);
  }

  while (queue.length > 0) {
    const cited = queue.shift() as string;
    if (seen.has(cited)) continue;
    seen.add(cited);
    const resolved =
      opts.boundary === undefined
        ? resolveDeclaredPath(opts.pipelineDir, cited)
        : resolvePinPath(
            opts.pipelineDir,
            opts.boundary,
            cited,
            PIN_INPUT_FIELD,
          );
    inputs.add(resolved);
    if (!isMarkdown(cited)) continue;
    const content = await readIfPresent(resolved);
    if (content === null) continue;
    for (const nested of parsePinInputs(content)) {
      if (!seen.has(nested)) queue.push(nested);
    }
  }

  return { closed: declared !== null, inputs };
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

function resolveDeclaredPath(pipelineDir: string, path: string): string {
  if (
    path.length === 0 ||
    path.includes('\\') ||
    path.includes('\0') ||
    isAbsolute(path) ||
    isPosixAbsolute(path) ||
    /^[A-Za-z]:/.test(path)
  ) {
    throw new Error(`pin input path must be a portable relative path: ${path}`);
  }
  return resolve(pipelineDir, ...path.split('/'));
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
