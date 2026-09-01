// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Semantic-input closure derivation for the pin-currency validator (pinning-2, pinning-4;
 * DR-007).
 *
 * A pinned phase's semantic-input closure is its definition plus the complete
 * flattened paths in a matching `slc.pin-inputs.json` entry, when present.
 * Without that entry, the legacy declaration remains every local file
 * transitively cited by inline `## Pin Inputs` sections. Explicit Markdown
 * references select no phase entry and therefore always retain inline
 * transitive derivation (pinning-17). The derived closure is compared — as a set
 * of resolved paths — to the recorded definition plus semanticInputs; any
 * difference is a stale verdict (pinning-4). See specs/packages/pinning.md.
 */

import { readFile } from 'node:fs/promises';

import { findSection } from './markdown.js';
import { loadPinInputsFile, PIN_INPUTS_FILE } from './pin-inputs.js';
import { resolvePinPath } from './pin-paths.js';
import { PinError, type PinRecord } from './pins.js';

const PIN_INPUT_FIELD = 'pin input path';
const INLINE_CODE = /`([^`]+)`/g;

/** A derived closure together with the declaration form that supplied it. */
export interface DerivedClosure {
  paths: Set<string>;
  declaration: 'sidecar' | 'inline';
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
 * Derives the semantic-input closure of `definitionPath` as a set of resolved
 * absolute paths (pinning-2, pinning-4, pinning-17).
 *
 * `phase` selects that phase's authoritative flattened sidecar entry when one
 * exists. Omitting `phase` always selects inline transitive derivation, which is
 * required for explicit Markdown references that are not the phase definition.
 *
 * @throws {import('./pins.js').PinError} when a cited path is absolute or escapes
 *   the recorded boundary (pinning-5).
 */
export async function deriveClosure(
  pipelineDir: string,
  boundary: string,
  definitionPath: string,
  phase?: string,
  observePath?: (path: string) => void,
): Promise<Set<string>> {
  return (
    await deriveClosureWithDeclaration(
      pipelineDir,
      boundary,
      definitionPath,
      phase,
      observePath,
    )
  ).paths;
}

/** Derives a closure and reports whether a matching sidecar entry supplied it. */
export async function deriveClosureWithDeclaration(
  pipelineDir: string,
  boundary: string,
  definitionPath: string,
  phase?: string,
  observePath?: (path: string) => void,
): Promise<DerivedClosure> {
  if (phase !== undefined) {
    const loaded = await loadPinInputsFile(pipelineDir, boundary);
    if (
      loaded.file !== undefined &&
      Object.hasOwn(loaded.file.closures, phase)
    ) {
      if (loaded.path !== undefined) {
        observePath?.(loaded.path);
      }
      const closure = new Set<string>();
      addResolvedPath(
        closure,
        pipelineDir,
        boundary,
        definitionPath,
        'definition.path',
        observePath,
      );
      const declared = loaded.file.closures[phase];
      for (let index = 0; index < declared.length; index++) {
        const field = `${PIN_INPUTS_FILE}.closures.${phase}[${index}]`;
        const resolved = resolvePinPath(
          pipelineDir,
          boundary,
          declared[index],
          field,
        );
        if (closure.has(resolved)) {
          throw new PinError(
            'pin-invalid',
            `${field} resolves to the definition or another closure member`,
          );
        }
        closure.add(resolved);
        observePath?.(resolved);
      }
      return { paths: closure, declaration: 'sidecar' };
    }
  }

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
    observePath?.(resolved);

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
  return { paths: closure, declaration: 'inline' };
}

/**
 * Reports whether the closure derived from `record.definition` matches the
 * recorded definition plus semanticInputs, compared as sets of resolved paths
 * (pinning-4).
 */
export async function closureMatchesRecord(
  pipelineDir: string,
  boundary: string,
  record: PinRecord,
  phase?: string,
  observePath?: (path: string) => void,
): Promise<boolean> {
  const derived = await deriveClosure(
    pipelineDir,
    boundary,
    record.definition.path,
    phase,
    observePath,
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

function addResolvedPath(
  closure: Set<string>,
  pipelineDir: string,
  boundary: string,
  path: string,
  field: string,
  observePath?: (path: string) => void,
): void {
  const resolved = resolvePinPath(pipelineDir, boundary, path, field);
  closure.add(resolved);
  observePath?.(resolved);
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
