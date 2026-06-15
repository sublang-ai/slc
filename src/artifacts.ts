// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Source-name validation and artifact-path computation (DR-001).
 *
 * Implements PIPE-6 (accept only the entry/non-entry source filename forms),
 * PIPE-7 (compute the artifact directory, reusing it without nesting), and
 * PIPE-8 (place intermediates and the output, honoring `-o`). See
 * specs/dev/pipeline.md.
 */

import { basename as pathBasename, dirname, join } from 'node:path';

import type { Phase } from './phase.js';

/** Machine-readable reason a source path was refused. */
export type SourceErrorCode = 'invalid-source-name';

/** Raised when a source filename matches no applicable form (PIPE-6). */
export class SourceError extends Error {
  readonly code: SourceErrorCode;

  constructor(code: SourceErrorCode, message: string) {
    super(message);
    this.name = 'SourceError';
    this.code = code;
  }
}

/** A source filename decomposed into its basename and containing directory. */
export interface ParsedSource {
  /** Basename with any trailing `.<source-format>` and extension stripped. */
  basename: string;
  /** Directory containing the source file. */
  dir: string;
}

/**
 * Validates a source path against the consuming phase's source format and
 * extension, returning its `<basename>` and directory (PIPE-6).
 *
 * The non-entry form requires `<basename>.<source-format>.<ext>`; the entry form
 * also accepts the plain `<basename>.<ext>`.
 *
 * @throws {SourceError} when the name matches no applicable form.
 */
export function parseSource(opts: {
  path: string;
  sourceFormat: string;
  ext: string;
  entry: boolean;
}): ParsedSource {
  const { path, sourceFormat, ext, entry } = opts;
  const name = pathBasename(path);
  const dir = dirname(path);

  if (!name.endsWith(ext)) {
    throw new SourceError(
      'invalid-source-name',
      `source "${name}" must end with "${ext}"`,
    );
  }

  const stem = name.slice(0, name.length - ext.length);
  const qualifier = `.${sourceFormat}`;
  let basename: string;
  if (stem.endsWith(qualifier)) {
    basename = stem.slice(0, stem.length - qualifier.length);
  } else if (entry) {
    basename = stem;
  } else {
    throw new SourceError(
      'invalid-source-name',
      `source "${name}" must be named "<basename>.${sourceFormat}${ext}"`,
    );
  }

  if (basename.length === 0) {
    throw new SourceError(
      'invalid-source-name',
      `source "${name}" has an empty basename`,
    );
  }
  return { basename, dir };
}

/**
 * Computes the artifact directory for a source, reusing the canonical directory
 * without nesting when the source already lives inside it (PIPE-7).
 */
export function artifactDir(
  srcDir: string,
  basename: string,
  pipeline: string,
): string {
  const canonicalLeaf = `${basename}.${pipeline}`;
  if (pathBasename(srcDir) === canonicalLeaf) {
    return srcDir;
  }
  return join(srcDir, canonicalLeaf);
}

/** Computes the canonical path of a `<basename>.<format>.<ext>` artifact (PIPE-8). */
export function artifactPath(
  artDir: string,
  basename: string,
  format: string,
  ext: string,
): string {
  return join(artDir, `${basename}.${format}${ext}`);
}

/** A planned artifact: the phase that writes it, its path, and its pipeline role. */
export interface ArtifactPlan {
  phase: Phase;
  path: string;
  role: 'intermediate' | 'output';
}

/**
 * Plans the target artifact each phase writes: every non-terminal phase writes a
 * canonical intermediate, and the terminal phase writes the output, overridden by
 * `output` (`-o`) when provided while intermediates stay canonical (PIPE-8).
 */
export function planArtifacts(opts: {
  phases: readonly Phase[];
  basename: string;
  artDir: string;
  output?: string;
}): ArtifactPlan[] {
  const { phases, basename, artDir, output } = opts;
  return phases.map((phase, index) => {
    const isTerminal = index === phases.length - 1;
    const canonical = artifactPath(
      artDir,
      basename,
      phase.target.format,
      phase.target.ext,
    );
    return {
      phase,
      role: isTerminal ? 'output' : 'intermediate',
      path: isTerminal && output !== undefined ? output : canonical,
    };
  });
}
