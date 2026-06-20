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
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

import type { PipelineResolver } from './pipeline.js';

/**
 * Computes the ordered pipeline search roots from an `SLC_PIPELINE_PATH` value
 * (CLI-6): an OS path-list whose entries are made absolute against `cwd`,
 * defaulting to `[cwd]` when the value is unset, empty, or all blank. Duplicate
 * roots are collapsed while order is preserved.
 */
export function pipelineSearchRoots(
  pipelinePath: string | undefined,
  cwd: string,
): string[] {
  const entries = (pipelinePath ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const roots = entries.length > 0 ? entries : [cwd];
  const absolute = roots.map((root) =>
    isAbsolute(root) ? root : resolve(cwd, root),
  );
  return [...new Set(absolute)];
}

/**
 * Builds a {@link PipelineResolver} over the given search roots (CLI-6).
 *
 * A `<reference>` matches `join(root, reference)` only when that path exists, is
 * a directory, and sits directly under the root — so nested paths and `..`
 * traversal yield no match. Matches are returned in root order, deduplicated.
 */
export function createPipelineResolver(
  searchRoots: readonly string[],
): PipelineResolver {
  return async (reference) => {
    const matches: string[] = [];
    for (const root of searchRoots) {
      const candidate = join(root, reference);
      if (dirname(candidate) !== root) continue;
      if (await isDirectory(candidate)) matches.push(candidate);
    }
    return [...new Set(matches)];
  };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
