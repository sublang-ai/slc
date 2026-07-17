// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Phase model and `## Formats` parsing (DR-001).
 *
 * Implements PIPE-1 (read the authoritative `## Formats` table), PIPE-2 (refuse
 * a phase whose `<source-format>2<target-format>.md` filename does not match its
 * table), and PIPE-3 (refuse phases declaring conflicting extensions for the
 * same format token). The `## Formats` reader is shared with the link loader.
 * See specs/dev/pipeline.md.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { findSection, parseTable } from './markdown.js';

/** A format token bound to its canonical file extension. */
export interface FormatDecl {
  /** Short kebab-case language identifier, e.g. `text`, `gears`, `fsm`. */
  format: string;
  /** Canonical extension including the leading dot, e.g. `.md`, `.ts`. */
  ext: string;
}

/** A loaded ordinary compile phase or format-preserving pass phase. */
export interface Phase {
  /** Phase basename without the `.md` suffix, e.g. `text2gears` or `optimize`. */
  name: string;
  /** Declared source role. */
  source: FormatDecl;
  /** Declared target role. */
  target: FormatDecl;
  /**
   * True for a format-preserving pass phase (source format equals target
   * format), which sits outside the linear chain and runs only when a compile
   * opts in (DR-013).
   */
  pass: boolean;
}

/** Machine-readable reason a `## Formats` table was refused. */
export type FormatsErrorCode =
  | 'missing-formats'
  | 'malformed-formats'
  | 'missing-role';

/** Machine-readable reason a phase was refused. */
export type PhaseErrorCode =
  | FormatsErrorCode
  | 'filename-mismatch'
  | 'extension-conflict';

/** Raised when a phase definition is refused under DR-001. */
export class PhaseError extends Error {
  readonly code: PhaseErrorCode;

  constructor(code: PhaseErrorCode, message: string) {
    super(message);
    this.name = 'PhaseError';
    this.code = code;
  }
}

const FORMAT_TOKEN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EXTENSION = /^\.[A-Za-z0-9]+$/;

/**
 * Reads the authoritative `## Formats` table into its source and target
 * declarations (PIPE-1), shared by the phase and link loaders.
 *
 * Refusals are reported through `fail` so each loader can raise its own error
 * type; `fail` must not return.
 */
export function readFormats(
  content: string,
  fail: (code: FormatsErrorCode, message: string) => never,
): { source: FormatDecl; target: FormatDecl } {
  const section = findSection(content, 'Formats');
  if (section === null) {
    fail('missing-formats', 'missing a ## Formats section');
  }

  const decls = new Map<'source' | 'target', FormatDecl>();
  for (const cells of parseTable(section)) {
    if (cells.length < 3) continue;
    const role = cells[0].toLowerCase();
    if (role !== 'source' && role !== 'target') continue;

    const [, format, ext] = cells;
    if (!FORMAT_TOKEN.test(format)) {
      fail(
        'malformed-formats',
        `${role} format token "${format}" is not a kebab-case identifier`,
      );
    }
    if (!EXTENSION.test(ext)) {
      fail(
        'malformed-formats',
        `${role} extension "${ext}" is not a canonical extension (e.g. ".md")`,
      );
    }
    if (decls.has(role)) {
      fail('malformed-formats', `## Formats declares ${role} more than once`);
    }
    decls.set(role, { format, ext });
  }

  const source = decls.get('source');
  const target = decls.get('target');
  if (source === undefined || target === undefined) {
    fail(
      'missing-role',
      `## Formats is missing a ${source === undefined ? 'source' : 'target'} row`,
    );
  }
  return { source, target };
}

/**
 * Parses and validates a phase definition from its filename and content.
 *
 * @throws {PhaseError} when the `## Formats` table is missing or malformed, or
 *   when the filename does not match the declared tokens (PIPE-1, PIPE-2).
 */
export function parsePhase(file: { name: string; content: string }): Phase {
  const { source, target } = readFormats(file.content, (code, message) => {
    throw new PhaseError(code, message);
  });

  // A format-preserving pass phase is named freely — its filename is the pass
  // name (DR-013); the `<source>2<target>.md` rule identifies transform phases.
  const pass = source.format === target.format;
  if (!pass) {
    const expected = `${source.format}2${target.format}.md`;
    if (file.name !== expected) {
      throw new PhaseError(
        'filename-mismatch',
        `phase filename "${file.name}" does not match its ## Formats tokens (expected "${expected}")`,
      );
    }
  }

  return { name: file.name.slice(0, -'.md'.length), source, target, pass };
}

/** Reads a phase definition file from disk and parses it (PIPE-1, PIPE-2). */
export async function loadPhaseFile(path: string): Promise<Phase> {
  const content = await readFile(path, 'utf8');
  return parsePhase({ name: basename(path), content });
}

/**
 * Refuses a set of phases that declare conflicting extensions for the same
 * format token (PIPE-3).
 *
 * @throws {PhaseError} with code `extension-conflict` on the first conflict.
 */
export function checkExtensionConsistency(phases: readonly Phase[]): void {
  const seen = new Map<string, { ext: string; phase: string }>();
  for (const phase of phases) {
    for (const decl of [phase.source, phase.target]) {
      const prior = seen.get(decl.format);
      if (prior === undefined) {
        seen.set(decl.format, { ext: decl.ext, phase: phase.name });
      } else if (prior.ext !== decl.ext) {
        throw new PhaseError(
          'extension-conflict',
          `format "${decl.format}" declares conflicting extensions: ` +
            `"${prior.ext}" (in ${prior.phase}) vs "${decl.ext}" (in ${phase.name})`,
        );
      }
    }
  }
}
