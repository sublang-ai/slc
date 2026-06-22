// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Link phase loading and linked-artifact paths (DR-002).
 *
 * Implements PIPE-11 (read `## Formats` and `## Link Targets`, target-form table
 * required and the rest optional), PIPE-19 (refuse a linked format token equal
 * to the object source token; object count/compatibility is the link phase's
 * job), PIPE-15 (full-pipeline linked-artifact path, honoring `-o`), and PIPE-18
 * (direct `.link` path: source-adjacent for one object, `-o`-required for many).
 * Discovery and exclusion from chain inference (PIPE-10) live in pipeline.ts.
 * See specs/dev/pipeline.md.
 */

import { readFile } from 'node:fs/promises';
import { basename as pathBasename, dirname } from 'node:path';

import { artifactDir, artifactPath } from './artifacts.js';
import { findSection, parseTable } from './markdown.js';
import { type FormatDecl, readFormats } from './phase.js';

/** A loaded `link.md` reserved link phase. */
export interface LinkPhase {
  /** Declared object source format. */
  source: FormatDecl;
  /** Declared linked target format (a distinct token from `source`). */
  target: FormatDecl;
  /** Accepted target forms (the `Target form` column); at least one, or empty for the reserved `slc` link. */
  targetForms: string[];
  /** Symbols a link target must export, or empty when unspecified. */
  requiredSymbols: string[];
  /** Supported `--link-option` names, or empty when unspecified. */
  options: string[];
  /** Opaque validation prose for the link phase, or `null` when unspecified. */
  validation: string | null;
}

/** Machine-readable reason a link phase or invocation was refused. */
export type LinkErrorCode =
  | 'missing-formats'
  | 'malformed-formats'
  | 'missing-role'
  | 'missing-link-targets'
  | 'linked-format-collision'
  | 'output-required';

/** Raised when a `link.md` is malformed or a link invocation is invalid (DR-002). */
export class LinkError extends Error {
  readonly code: LinkErrorCode;

  constructor(code: LinkErrorCode, message: string) {
    super(message);
    this.name = 'LinkError';
    this.code = code;
  }
}

/**
 * Parses a `link.md` definition (PIPE-11, PIPE-19).
 *
 * `## Link Targets` is required by default. The reserved `slc` link consumes
 * Playbook's authored `link.md`, which declares none — Playbook's link compiler
 * owns target validation (DR-002) — so its caller passes
 * `requireTargetForms: false` to accept a link phase with no declared forms.
 *
 * @throws {LinkError} when `## Formats` is missing or malformed, the linked
 *   format token equals the object source token, or `## Link Targets` is
 *   missing while required.
 */
export function parseLinkPhase(
  content: string,
  opts: { requireTargetForms?: boolean } = {},
): LinkPhase {
  const { source, target } = readFormats(content, (code, message) => {
    throw new LinkError(code, message);
  });

  if (source.format === target.format) {
    throw new LinkError(
      'linked-format-collision',
      `linked format token "${target.format}" must differ from the object source format token`,
    );
  }

  const relaxed = opts.requireTargetForms === false;
  const section = findSection(content, 'Link Targets');
  if (section === null) {
    if (relaxed) {
      return {
        source,
        target,
        targetForms: [],
        requiredSymbols: [],
        options: [],
        validation: null,
      };
    }
    throw new LinkError(
      'missing-link-targets',
      'missing a ## Link Targets section',
    );
  }

  const { targetForms, requiredSymbols, options, validation } =
    parseLinkTargets(section);
  if (targetForms.length === 0 && !relaxed) {
    throw new LinkError(
      'missing-link-targets',
      '## Link Targets has no target-form rows',
    );
  }

  return { source, target, targetForms, requiredSymbols, options, validation };
}

/** Reads and parses a `link.md` file from disk (PIPE-11). */
export async function loadLinkFile(
  path: string,
  opts: { requireTargetForms?: boolean } = {},
): Promise<LinkPhase> {
  return parseLinkPhase(await readFile(path, 'utf8'), opts);
}

/**
 * Computes the linked-artifact path for a full-pipeline link (PIPE-15) or a
 * direct `.link` invocation (PIPE-18).
 *
 * @throws {LinkError} with code `output-required` for a multi-object `.link`
 *   without `-o`.
 */
export function linkedArtifactPath(
  spec:
    | {
        kind: 'full';
        artDir: string;
        basename: string;
        linked: FormatDecl;
        output: string | null;
      }
    | {
        kind: 'link';
        pipeline: string;
        objects: readonly string[];
        source: FormatDecl;
        linked: FormatDecl;
        output: string | null;
      },
): string {
  if (spec.kind === 'full') {
    return (
      spec.output ??
      artifactPath(
        spec.artDir,
        spec.basename,
        spec.linked.format,
        spec.linked.ext,
      )
    );
  }

  if (spec.objects.length === 1) {
    const { basename, dir } = deriveObjectBasename(
      spec.objects[0],
      spec.source,
    );
    const artDir = artifactDir(dir, basename, spec.pipeline);
    return (
      spec.output ??
      artifactPath(artDir, basename, spec.linked.format, spec.linked.ext)
    );
  }

  if (spec.output === null) {
    throw new LinkError(
      'output-required',
      `a .link with ${spec.objects.length} objects requires -o <linked-target>`,
    );
  }
  return spec.output;
}

/** Partitions the `## Link Targets` section into its labeled blocks. */
function parseLinkTargets(lines: readonly string[]): {
  targetForms: string[];
  requiredSymbols: string[];
  options: string[];
  validation: string | null;
} {
  const labels: { key: 'required' | 'options' | 'validation'; re: RegExp }[] = [
    { key: 'required', re: /^required symbols:?$/i },
    { key: 'options', re: /^options:?$/i },
    { key: 'validation', re: /^validation:?$/i },
  ];
  const segments = {
    targets: [] as string[],
    required: [] as string[],
    options: [] as string[],
    validation: [] as string[],
  };
  let current: keyof typeof segments = 'targets';
  for (const raw of lines) {
    const label = labels.find((entry) => entry.re.test(raw.trim()));
    if (label) {
      current = label.key;
      continue;
    }
    segments[current].push(raw);
  }

  const validation = segments.validation.join('\n').trim();
  return {
    targetForms: columnAfterHeader(segments.targets, 'target form'),
    requiredSymbols: listItems(segments.required),
    options: columnAfterHeader(segments.options, 'name'),
    validation: validation.length > 0 ? validation : null,
  };
}

/**
 * Returns the data-row first column of the table in `lines`, requiring its
 * header row's first cell to equal `header` (lowercase). Returns an empty array
 * when no such table is present, so a missing or mis-headed required table is
 * caught by the caller's emptiness check rather than leaking the header as data.
 */
function columnAfterHeader(lines: readonly string[], header: string): string[] {
  const rows = parseTable(lines);
  if (rows.length === 0 || rows[0][0].toLowerCase() !== header) {
    return [];
  }
  return rows
    .slice(1)
    .map((cells) => cells[0])
    .filter((cell) => cell.length > 0);
}

/** Returns the bullet-list item texts in `lines`. */
function listItems(lines: readonly string[]): string[] {
  const items: string[] = [];
  for (const raw of lines) {
    const match = /^[-*]\s+(.+)$/.exec(raw.trim());
    if (match) items.push(match[1].trim());
  }
  return items;
}

/** Derives a basename and directory from a single object, leniently (PIPE-18, PIPE-19). */
function deriveObjectBasename(
  objectPath: string,
  source: FormatDecl,
): { basename: string; dir: string } {
  const name = pathBasename(objectPath);
  const dir = dirname(objectPath);
  let stem = name.endsWith(source.ext)
    ? name.slice(0, name.length - source.ext.length)
    : name;
  const qualifier = `.${source.format}`;
  if (stem.endsWith(qualifier)) {
    stem = stem.slice(0, stem.length - qualifier.length);
  }
  return { basename: stem, dir };
}
