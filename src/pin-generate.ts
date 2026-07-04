// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Pin generation: the explicit build-and-review flow that writes `slc.pins.json`
 * (PIN-15; DR-007).
 *
 * This is the inverse of the currency validator: given a built and reviewed
 * compiled artifact, {@link generatePinRecord} records — over committed bytes —
 * the definition, the compiled artifact, the semantic-input closure derived from
 * the definition's `## Pin Inputs`, and the link-target identity, so the resulting
 * record validates as current. {@link writePinFile} writes the pin index for a
 * pipeline directory. Generation is invoked only by an explicit build-and-review
 * step, never during an ordinary pipeline run; `slc` does not regenerate or
 * rewrite pins per invocation (DR-007 lifecycle). See specs/dev/pinning.md.
 */

import { writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { hashFile } from './hash.js';
import { deriveClosure } from './pin-closure.js';
import { hashTree } from './pin-currency.js';
import { resolvePinPath } from './pin-paths.js';
import {
  PINS_FILE,
  PIN_HASH_ALGORITHM,
  PIN_SCHEMA,
  type PinExternalInput,
  type PinFile,
  type PinLinkTarget,
  type PinProducer,
  type PinRecord,
} from './pins.js';

/** The committed inputs that produced one compiled phase, to pin (DR-007). */
export interface PinSpec {
  /** Pipeline-dir-relative path to the phase definition. */
  definition: string;
  /** Pipeline-dir-relative path to the compiled `phase` artifact. */
  artifact: string;
  /** The link target the artifact was linked against. */
  linkTarget: {
    kind: PinLinkTarget['kind'];
    locator: string;
    provenance?: string;
  };
  /** Descriptive roles for semantic-input files, keyed by their pipeline-relative path. */
  roles?: Readonly<Record<string, string>>;
  /** Immutable content-addressed external inputs, if any. */
  externalInputs?: readonly PinExternalInput[];
  /** Provenance of the producing run; never a currency input. */
  producer?: PinProducer;
}

/** The default recorded path boundary (the pipeline directory). */
const BOUNDARY = '.';

/** Options for pin generation (PIN-15). */
export interface PinGenerateOptions {
  /**
   * The recorded path boundary, a relative POSIX path from the pipeline
   * directory; defaults to `.`. A wider boundary (e.g. `../..`) lets a pin
   * record a link target outside the pipeline directory, such as the installed
   * package module the artifacts were linked against.
   */
  boundary?: string;
}

/**
 * Generates a current {@link PinRecord} for one phase from its committed inputs
 * (PIN-15). The definition is recorded separately; the rest of its `## Pin Inputs`
 * closure becomes the enumerated `semanticInputs`.
 */
export async function generatePinRecord(
  pipelineDir: string,
  spec: PinSpec,
  opts: PinGenerateOptions = {},
): Promise<PinRecord> {
  const boundary = opts.boundary ?? BOUNDARY;
  const definitionResolved = resolvePinPath(
    pipelineDir,
    boundary,
    spec.definition,
    'definition',
  );
  const closure = await deriveClosure(pipelineDir, boundary, spec.definition);

  const semanticInputs = await Promise.all(
    [...closure]
      .filter((resolved) => resolved !== definitionResolved)
      .sort()
      .map(async (resolved) => {
        const path = toPosix(relative(pipelineDir, resolved));
        const hash = await hashFile(resolved);
        const role = spec.roles?.[path];
        return role === undefined ? { path, hash } : { path, hash, role };
      }),
  );

  const artifactResolved = resolvePinPath(
    pipelineDir,
    boundary,
    spec.artifact,
    'artifact',
  );
  const linkResolved = resolvePinPath(
    pipelineDir,
    boundary,
    spec.linkTarget.locator,
    'linkTarget.locator',
  );
  const identity =
    spec.linkTarget.kind === 'file'
      ? await hashFile(linkResolved)
      : await hashTree(linkResolved);

  const linkTarget: PinLinkTarget = {
    kind: spec.linkTarget.kind,
    locator: spec.linkTarget.locator,
    identity,
    ...(spec.linkTarget.provenance !== undefined
      ? { provenance: spec.linkTarget.provenance }
      : {}),
  };

  return {
    definition: {
      path: spec.definition,
      hash: await hashFile(definitionResolved),
    },
    artifact: { path: spec.artifact, hash: await hashFile(artifactResolved) },
    semanticInputs,
    externalInputs: [...(spec.externalInputs ?? [])],
    linkTarget,
    ...(spec.producer !== undefined ? { producer: spec.producer } : {}),
  };
}

/**
 * Writes the pin index `<pipelineDir>/slc.pins.json` for the given phase records
 * and returns its path (PIN-15).
 */
export async function writePinFile(
  pipelineDir: string,
  pins: Readonly<Record<string, PinRecord>>,
  opts: PinGenerateOptions = {},
): Promise<string> {
  const file: PinFile = {
    schema: PIN_SCHEMA,
    hashAlgorithm: PIN_HASH_ALGORITHM,
    pathBoundary: { path: opts.boundary ?? BOUNDARY },
    pins: { ...pins },
  };
  const path = join(pipelineDir, PINS_FILE);
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`);
  return path;
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}
