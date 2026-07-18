// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Source-name validation and artifact-path computation (DR-001, DR-014).
 *
 * Implements PIPE-6 (the entry/non-entry source filename forms, with a
 * foreign-extension entry source accepted as a raw input), PIPE-7 (compute the
 * artifact directory under the invocation working directory, reusing it without
 * nesting), and PIPE-8 (place intermediates and the output, honoring `-o`). See
 * specs/dev/pipeline.md.
 */

import { basename as pathBasename, extname, join } from 'node:path';

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

/** A source filename decomposed into its basename, plus the raw-input marker. */
export interface ParsedSource {
  /** Basename with any trailing `.<source-format>` and extension stripped. */
  basename: string;
  /**
   * True when an entry source carries a foreign extension: a raw input whose
   * compilation auto-schedules normalization (DR-014, PIPE-6, PIPE-34).
   */
  raw: boolean;
}

/**
 * Validates a source path against the consuming phase's source format and
 * extension, returning its `<basename>` (PIPE-6).
 *
 * The non-entry form requires `<basename>.<source-format>.<ext>`; the entry form
 * also accepts the plain `<basename>.<ext>`, and an entry source with any other
 * extension is a raw input whose `<basename>` is the name minus its actual
 * extension (DR-014).
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

  if (!name.endsWith(ext)) {
    if (entry) {
      const actualExt = extname(name);
      const basename =
        actualExt === '' ? name : name.slice(0, -actualExt.length);
      if (basename.length === 0) {
        throw new SourceError(
          'invalid-source-name',
          `source "${name}" has an empty basename`,
        );
      }
      return { basename, raw: true };
    }
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
  return { basename, raw: false };
}

/**
 * Computes the artifact directory under the invocation working directory,
 * reusing the working directory itself without nesting when its leaf is
 * already the canonical `<basename>.<pipeline>` (PIPE-7, DR-014).
 */
export function artifactDir(
  cwd: string,
  basename: string,
  pipeline: string,
): string {
  const canonicalLeaf = `${basename}.${pipeline}`;
  if (pathBasename(cwd) === canonicalLeaf) {
    return cwd;
  }
  return join(cwd, canonicalLeaf);
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
