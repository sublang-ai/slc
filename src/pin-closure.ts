// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Semantic-input closure derivation for pin generation, currency, incremental
 * identity, and protected-input discovery (pinning-17, pinning-21; DR-026).
 *
 * A pinned phase's semantic-input closure is its definition plus the complete
 * flattened paths in a matching `slc.pin-inputs.json` entry, when present.
 * Without that entry, the legacy declaration remains every local file
 * transitively cited by inline `## Pin Inputs` sections. Explicit Markdown
 * references select no phase entry and therefore always retain inline
 * transitive derivation (pinning-17). Strict callers reject an incomplete
 * closure; protected-input discovery can retain its independently resolved
 * in-boundary members (phase-execution-50). See specs/packages/pinning.md.
 */

import { readFile } from 'node:fs/promises';

import { findSection } from './markdown.js';
import {
  inspectPinInputsFile,
  PIN_INPUTS_FILE,
  type InspectedPinInputs,
  type LoadedPinInputs,
} from './pin-inputs.js';
import { resolvePinPath } from './pin-paths.js';
import { PinError, type PinRecord } from './pins.js';

const PIN_INPUT_FIELD = 'pin input path';
const INLINE_CODE = /`([^`]+)`/g;

/** A derived closure together with the declaration form that supplied it. */
export interface DerivedClosure {
  paths: Set<string>;
  declaration: 'sidecar' | 'inline';
}

/** A complete closure or the safely resolved subset of an incomplete one. */
export interface InspectedClosure {
  paths: Set<string>;
  declaration?: 'sidecar' | 'inline';
  complete: boolean;
  issue?: PinError;
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
  pinInputs?: LoadedPinInputs,
): Promise<Set<string>> {
  return (
    await deriveClosureWithDeclaration(
      pipelineDir,
      boundary,
      definitionPath,
      phase,
      observePath,
      pinInputs,
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
  pinInputs?: LoadedPinInputs,
): Promise<DerivedClosure> {
  const inspected = await inspectClosureWithDeclaration(
    pipelineDir,
    boundary,
    definitionPath,
    phase,
    observePath,
    pinInputs,
  );
  if (inspected.issue !== undefined) {
    throw inspected.issue;
  }
  if (inspected.declaration === undefined) {
    throw new Error('complete closure inspection has no declaration');
  }
  return { paths: inspected.paths, declaration: inspected.declaration };
}

/**
 * Inspects closure derivation without discarding independently safe members.
 *
 * Strict generation and currency callers use {@link deriveClosureWithDeclaration},
 * which throws the first issue. Runtime protection consumes this structured
 * result even when `complete` is false, while incremental identity does not.
 */
export async function inspectClosureWithDeclaration(
  pipelineDir: string,
  boundary: string,
  definitionPath: string,
  phase?: string,
  observePath?: (path: string) => void,
  pinInputs?: LoadedPinInputs,
): Promise<InspectedClosure> {
  let inspectedPinInputs: InspectedPinInputs | undefined;
  let sidecarIssue: PinError | undefined;
  let loaded = pinInputs;
  if (phase !== undefined) {
    if (loaded === undefined) {
      try {
        inspectedPinInputs = await inspectPinInputsFile(pipelineDir, boundary);
        loaded = inspectedPinInputs;
      } catch (error) {
        if (!(error instanceof PinError)) throw error;
        // The sidecar structure cannot be trusted, but the definition's inline
        // tree remains independently discoverable for conservative protection.
        sidecarIssue = error;
        loaded = {};
      }
    }
    if (
      loaded.file !== undefined &&
      Object.hasOwn(loaded.file.closures, phase)
    ) {
      if (loaded.path !== undefined) {
        observePath?.(loaded.path);
      }
      const closure = new Set<string>();
      let issue = inspectedPinInputs?.issue;
      try {
        addResolvedPath(
          closure,
          pipelineDir,
          boundary,
          definitionPath,
          'definition.path',
          observePath,
        );
      } catch (error) {
        if (!(error instanceof PinError)) throw error;
        issue ??= error;
      }
      const declared = loaded.file.closures[phase];
      const inspectedMembers = inspectedPinInputs?.resolvedClosures[phase];
      for (let index = 0; index < declared.length; index++) {
        const field = `${PIN_INPUTS_FILE}.closures.${phase}[${index}]`;
        let resolved = inspectedMembers?.[index];
        if (inspectedMembers === undefined) {
          try {
            resolved = resolvePinPath(
              pipelineDir,
              boundary,
              declared[index],
              field,
            );
          } catch (error) {
            if (!(error instanceof PinError)) throw error;
            issue ??= error;
          }
        }
        if (resolved === undefined) continue;
        if (closure.has(resolved)) {
          issue ??= new PinError(
            'pin-invalid',
            `${field} resolves to the definition or another closure member`,
          );
        } else {
          closure.add(resolved);
        }
        observePath?.(resolved);
      }
      return {
        paths: closure,
        declaration: 'sidecar',
        complete: issue === undefined,
        ...(issue === undefined ? {} : { issue }),
      };
    }
  }

  const closure = new Set<string>();
  const seen = new Set<string>();
  const queue: string[] = [definitionPath];
  let issue = sidecarIssue ?? inspectedPinInputs?.issue;

  while (queue.length > 0) {
    const rel = queue.shift() as string;
    if (seen.has(rel)) {
      continue;
    }
    seen.add(rel);

    let resolved: string;
    try {
      resolved = resolvePinPath(pipelineDir, boundary, rel, PIN_INPUT_FIELD);
    } catch (error) {
      if (!(error instanceof PinError)) throw error;
      issue ??= error;
      continue;
    }
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
  return {
    paths: closure,
    declaration: 'inline',
    complete: issue === undefined,
    ...(issue === undefined ? {} : { issue }),
  };
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
  pinInputs?: LoadedPinInputs,
): Promise<boolean> {
  const derived = await deriveClosure(
    pipelineDir,
    boundary,
    record.definition.path,
    phase,
    observePath,
    pinInputs,
  );
  return derivedClosureMatchesRecord(pipelineDir, boundary, record, derived);
}

/** Compares one already-derived closure with the paths recorded by a pin. */
export function derivedClosureMatchesRecord(
  pipelineDir: string,
  boundary: string,
  record: PinRecord,
  derived: ReadonlySet<string>,
): boolean {
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

function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
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
