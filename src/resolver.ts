// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Concrete pipeline-reference resolver for the `slc` bin (CLI-6, DR-001).
 *
 * DR-001 leaves pipeline-to-directory resolution to the consumer; this is the
 * bin's host policy: a `<reference>` resolves to the directories named
 * `<reference>` directly under each search root from `SLC_PIPELINE_PATH` (an OS
 * path-list), defaulting to the working directory when unset. The resolver
 * returns every existing match so `runSlc`'s exactly-one rule (PIPE-16) refuses
 * zero or many; it does not check that a match is a well-formed pipeline, which
 * `loadPipeline` does. See specs/dev/cli.md.
 */

import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';

import type { PipelineResolver } from './pipeline.js';

const requireFrom = createRequire(import.meta.url);

/** The reserved meta-pipeline reference (DR-005, SELFHOST-2). */
export const RESERVED_SLC_PIPELINE = 'slc';

/**
 * The `playbook` domain pipeline, which shares the reserved `slc` pipeline's
 * Playbook-authored definitions (DR-009, SELFHOST-6).
 */
export const RESERVED_PLAYBOOK_PIPELINE = 'playbook';

/**
 * Whether a reference names a pipeline whose definitions `@sublang/playbook`
 * provides — the reserved `slc` meta-pipeline or the `playbook` domain pipeline,
 * which share one definition set and differ only by name (DR-009). Such a link
 * phase consumes Playbook's target-less `link.md` (PIPE-11).
 */
export function isReservedPipeline(reference: string): boolean {
  return (
    reference === RESERVED_SLC_PIPELINE ||
    reference === RESERVED_PLAYBOOK_PIPELINE
  );
}

/**
 * Computes the ordered pipeline search roots from a pipeline-path value (CLI-6):
 * either the `SLC_PIPELINE_PATH` OS path-list string or the config file's
 * `pipelinePath` sequence (DR-006). Entries are resolved to absolute, normalized
 * roots against `cwd`, defaulting to `[cwd]` when the value is unset, empty, or
 * all blank. Normalization (via `resolve`) strips trailing slashes and redundant
 * segments so duplicate roots collapse while order is preserved.
 */
export function pipelineSearchRoots(
  pipelinePath: string | string[] | undefined,
  cwd: string,
): string[] {
  const rawEntries = Array.isArray(pipelinePath)
    ? pipelinePath
    : (pipelinePath ?? '').split(delimiter);
  const entries = rawEntries
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const roots = entries.length > 0 ? entries : [cwd];
  const normalized = roots.map((root) => resolve(cwd, root));
  return [...new Set(normalized)];
}

/**
 * Builds a {@link PipelineResolver} over the given search roots (CLI-6).
 *
 * A `<reference>` matches `join(root, reference)` only when that path exists, is
 * a directory, and sits directly under the root — so nested paths and `..`
 * traversal yield no match. Matches are returned in root order, deduplicated.
 *
 * Roots are canonicalized once at construction (trailing slashes and redundant
 * segments dropped) so the direct-child check holds even when a caller supplies
 * a root like `/pipes/`.
 */
export function createPipelineResolver(
  searchRoots: readonly string[],
): PipelineResolver {
  // `join(root, '.')` drops a trailing slash and redundant segments without
  // forcing the root absolute, matching the form `dirname(join(root, ref))` yields.
  const roots = searchRoots.map((root) => join(root, '.'));
  return async (reference) => {
    const matches: string[] = [];
    for (const root of roots) {
      const candidate = join(root, reference);
      if (dirname(candidate) !== root) continue;
      if (await isDirectory(candidate)) matches.push(candidate);
    }
    return [...new Set(matches)];
  };
}

/**
 * Locates the meta-pipeline definitions that `@sublang/playbook` ships under
 * `slc/` (its `text2gears`, `gears2fsm`, and `link` phases), which back both the
 * reserved `slc` meta-pipeline and the `playbook` domain pipeline, so `slc`
 * self-hosts on Playbook's canonical source rather than a duplicate (DR-005,
 * DR-009, SELFHOST-2).
 *
 * @throws when `@sublang/playbook` does not provide the `slc/` definitions.
 */
export function reservedSlcPipelineDir(): string {
  return dirname(requireFrom.resolve('@sublang/playbook/slc/link.md'));
}

/**
 * Wraps a resolver so a Playbook-owned reference — the reserved `slc`
 * meta-pipeline or the `playbook` domain pipeline — resolves to the shared
 * definition set, leaving every other reference to `inner`. Both names share one
 * definition set and differ only by name, hence by their DR-001 artifact
 * directory (DR-009, SELFHOST-2, SELFHOST-6).
 *
 * The shared set is the first search-root directory named `playbook` when one
 * exists — a committed vendor of Playbook's definitions, whose `slc.pins.json`
 * can pin both pipelines to compiled artifacts — otherwise the definitions the
 * installed `@sublang/playbook` provides (SELFHOST-9).
 */
export function withReservedPipelines(
  inner: PipelineResolver,
): PipelineResolver {
  return async (reference) => {
    if (!isReservedPipeline(reference)) return inner(reference);
    const vendored = await inner(RESERVED_PLAYBOOK_PIPELINE);
    return vendored.length > 0 ? vendored : [reservedSlcPipelineDir()];
  };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
