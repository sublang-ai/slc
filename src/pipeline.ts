// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Pipeline resolution, phase discovery, and chain inference (DR-001).
 *
 * Implements PIPE-16 (refuse a reference that resolves to other than one
 * directory), PIPE-17 (discover phase files directly in a pipeline directory,
 * reserving `link.md`), PIPE-4 (infer the single linear phase order), and
 * PIPE-5 (refuse incomplete, branching, or cyclic chains). See
 * specs/dev/pipeline.md.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  checkExtensionConsistency,
  loadPhaseFile,
  type Phase,
} from './phase.js';

/**
 * Maps a pipeline reference to candidate directories. DR-001 leaves the actual
 * resolution to the consumer; `slc` only enforces that exactly one resolves.
 */
export type PipelineResolver = (
  reference: string,
) => string[] | Promise<string[]>;

/** A resolved pipeline: its directory, ordered phases, passes, and optional link phase. */
export interface Pipeline {
  /** The resolved pipeline directory. */
  dir: string;
  /** Ordinary compile phases in entry-to-exit order. */
  phases: Phase[];
  /**
   * Format-preserving pass phases, sorted by name. Passes sit outside the
   * linear chain; a compile schedules them only on request (DR-013).
   */
  passes: Phase[];
  /** Path to the reserved `link.md`, or `null` when absent. */
  linkFile: string | null;
}

/** Machine-readable reason a pipeline was refused. */
export type PipelineErrorCode =
  | 'unresolved-pipeline'
  | 'ambiguous-pipeline'
  | 'chain-incomplete'
  | 'chain-branch'
  | 'chain-cycle';

/** Raised when a pipeline cannot be resolved or its chain is invalid (DR-001). */
export class PipelineError extends Error {
  readonly code: PipelineErrorCode;

  constructor(code: PipelineErrorCode, message: string) {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
  }
}

/**
 * Resolves a pipeline reference to exactly one directory (PIPE-16).
 *
 * @throws {PipelineError} when the reference resolves to zero (`unresolved`) or
 *   more than one (`ambiguous`) directory.
 */
export async function resolvePipeline(
  reference: string,
  resolver: PipelineResolver,
): Promise<string> {
  const candidates = await resolver(reference);
  if (candidates.length === 0) {
    throw new PipelineError(
      'unresolved-pipeline',
      `pipeline reference "${reference}" did not resolve to a pipeline directory`,
    );
  }
  if (candidates.length > 1) {
    throw new PipelineError(
      'ambiguous-pipeline',
      `pipeline reference "${reference}" resolved to multiple directories: ${candidates.join(', ')}`,
    );
  }
  return candidates[0];
}

/**
 * Lists the `.md` files directly inside a resolved pipeline directory (PIPE-17).
 *
 * Subdirectories are not descended into, and `link.md` is returned separately as
 * the reserved link phase rather than as an ordinary phase file.
 */
export async function discoverPhaseFiles(
  dir: string,
): Promise<{ phaseFiles: string[]; linkFile: string | null }> {
  const entries = await readdir(dir, { withFileTypes: true });
  const phaseFiles: string[] = [];
  let linkFile: string | null = null;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const full = join(dir, entry.name);
    if (entry.name === 'link.md') {
      linkFile = full;
    } else {
      phaseFiles.push(full);
    }
  }
  phaseFiles.sort();
  return { phaseFiles, linkFile };
}

/**
 * Infers the single linear phase order by chaining each phase's target format to
 * the next phase's source format (PIPE-4).
 *
 * @throws {PipelineError} when the chain is incomplete, branches, or cycles
 *   (PIPE-5).
 */
export function inferChain(phases: readonly Phase[]): Phase[] {
  if (phases.length === 0) {
    throw new PipelineError('chain-incomplete', 'pipeline has no phases');
  }

  const producers = new Map<string, Phase[]>();
  const consumers = new Map<string, Phase[]>();
  for (const phase of phases) {
    push(producers, phase.target.format, phase);
    push(consumers, phase.source.format, phase);
  }

  branchGuard(producers, 'produced');
  branchGuard(consumers, 'consumed');

  const entries = phases.filter((phase) => !producers.has(phase.source.format));
  if (entries.length === 0) {
    throw new PipelineError('chain-cycle', 'pipeline chain has no entry phase');
  }
  if (entries.length > 1) {
    throw new PipelineError(
      'chain-branch',
      `multiple entry phases: ${names(entries)}`,
    );
  }

  const ordered: Phase[] = [];
  const visited = new Set<Phase>();
  let current: Phase | undefined = entries[0];
  while (current !== undefined) {
    if (visited.has(current)) {
      throw new PipelineError(
        'chain-cycle',
        `pipeline chain revisits phase "${current.name}"`,
      );
    }
    visited.add(current);
    ordered.push(current);
    current = consumers.get(current.target.format)?.[0];
  }

  if (visited.size !== phases.length) {
    const missing = phases.filter((phase) => !visited.has(phase));
    throw new PipelineError(
      'chain-incomplete',
      `phases not connected into a single chain: ${names(missing)}`,
    );
  }

  return ordered;
}

/**
 * Discovers, loads, and orders the ordinary phases of a pipeline directory,
 * validating extension consistency (PIPE-3) and chain shape (PIPE-4, PIPE-5).
 * Format-preserving pass phases are split out of chain inference (DR-013) and
 * returned sorted by name. Names cannot collide: every phase — chain or pass —
 * is named by its unique filename, and `link.md` is reserved before loading.
 */
export async function loadPipeline(dir: string): Promise<Pipeline> {
  const { phaseFiles, linkFile } = await discoverPhaseFiles(dir);
  const loaded = await Promise.all(
    phaseFiles.map((file) => loadPhaseFile(file)),
  );
  checkExtensionConsistency(loaded);
  const passes = loaded
    .filter((phase) => phase.pass)
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
  return {
    dir,
    phases: inferChain(loaded.filter((phase) => !phase.pass)),
    passes,
    linkFile,
  };
}

function branchGuard(
  byFormat: Map<string, Phase[]>,
  verb: 'produced' | 'consumed',
): void {
  for (const [format, phases] of byFormat) {
    if (phases.length > 1) {
      throw new PipelineError(
        'chain-branch',
        `format "${format}" is ${verb} by multiple phases: ${names(phases)}`,
      );
    }
  }
}

function push(map: Map<string, Phase[]>, key: string, value: Phase): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, [value]);
  } else {
    existing.push(value);
  }
}

function names(phases: readonly Phase[]): string {
  return phases.map((phase) => phase.name).join(', ');
}
