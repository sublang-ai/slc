// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Deterministic derivative layout shared by canonical and staged builds.
 *
 * This module describes eventual logical products separately from their
 * physical candidate locations. It does not create an overlay, write lineage,
 * or promote anything; later lineage orchestration binds these products to a
 * candidate workspace.
 */

import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

import type {
  BuildIdentityContext,
  DeterministicProduct,
  FullBuildTopology,
} from './build-plan.js';
import { deterministicIdentityComponents } from './deterministic-identity.js';
import type { EmittedFileBinding } from './emitted-imports.js';
import { emitEntryModuleAtPaths } from './entry-module.js';
import {
  emitFsmCoverageTest,
  type FsmCoverageEmissionLayout,
} from './verify-coverage.js';
import {
  emitFsmIntrospectionTest,
  emitGearsFsmConformanceTest,
  emitPromptContractTest,
} from './verify.js';
import {
  VERIFIER_SUPPORT_DIR,
  VERIFIER_SUPPORT_FILES,
  VerifierSupportEmissionError,
  emitVerifierSupport,
} from './verify-support.js';

export const ENTRY_GENERATOR_ID = 'generator:entry';
export const VERIFICATION_GENERATOR_ID = 'generator:verification';
export const LOAD_INTEGRITY_CHECKER_ID = 'checker:load-integrity';
export const VERIFICATION_CHECKER_ID = 'checker:verification';

export const VERIFICATION_TEST_FILES = Object.freeze([
  'gears-fsm.test.ts',
  'fsm.introspect.test.ts',
  'prompt-contract.test.ts',
  'fsm.coverage.test.ts',
] as const);

export interface DeterministicDerivativeDescription {
  readonly products: readonly DeterministicProduct[];
  readonly entry?: {
    readonly productId: string;
    readonly logicalPath: string;
    readonly logicalBundlePath: string;
    readonly logicalTextPath: string;
  };
  readonly verification?: {
    readonly artifactDir: string;
    readonly gearsPath: string;
    readonly fsmPath: string;
    readonly linkedPath?: string;
    readonly support: readonly {
      readonly productId: string;
      readonly file: (typeof VERIFIER_SUPPORT_FILES)[number];
      readonly logicalPath: string;
    }[];
    readonly tests: readonly {
      readonly productId: string;
      readonly file: (typeof VERIFICATION_TEST_FILES)[number];
      readonly logicalPath: string;
    }[];
  };
}

/** Describes the deterministic products applicable to one canonical topology. */
export function describeDeterministicDerivatives(
  topology: FullBuildTopology,
): DeterministicDerivativeDescription {
  const products: DeterministicProduct[] = [];
  let entry: DeterministicDerivativeDescription['entry'];
  let verification: DeterministicDerivativeDescription['verification'];

  const hasFsm = topology.artifacts.some(
    (artifact) => artifact.phase.target.format === 'fsm',
  );
  const hasGears = topology.artifacts.some(
    (artifact) => artifact.phase.target.format === 'gears',
  );
  const fsm = topology.artifacts.find(
    (artifact) => artifact.phase.target.format === 'fsm',
  );
  const canonicalFsm = join(
    topology.artifactDir,
    `${topology.basename}.fsm${fsm?.phase.target.ext ?? ''}`,
  );
  if (
    (topology.pipelineName === 'playbook' || topology.pipelineName === 'slc') &&
    hasFsm &&
    hasGears &&
    fsm?.path === canonicalFsm
  ) {
    const support = VERIFIER_SUPPORT_FILES.map((file) => {
      const productId = `verification:support.${file}`;
      const logicalPath = join(
        topology.artifactDir,
        VERIFIER_SUPPORT_DIR,
        file,
      );
      products.push({
        id: productId,
        kind: 'verification',
        path: logicalPath,
        inputs: [VERIFICATION_CHECKER_ID, VERIFICATION_GENERATOR_ID],
      });
      return { productId, file, logicalPath };
    });
    const tests = VERIFICATION_TEST_FILES.map((file) => {
      const productId = `verification:test.${file}`;
      const logicalPath = join(
        topology.artifactDir,
        `${topology.basename}.${file}`,
      );
      products.push({
        id: productId,
        kind: 'verification',
        path: logicalPath,
        inputs: [
          LOAD_INTEGRITY_CHECKER_ID,
          VERIFICATION_CHECKER_ID,
          VERIFICATION_GENERATOR_ID,
        ],
      });
      return { productId, file, logicalPath };
    });
    const gears = topology.artifacts.find(
      (artifact) => artifact.phase.target.format === 'gears',
    );
    if (gears === undefined || fsm === undefined) {
      throw new Error('reserved verification topology is incomplete');
    }
    const link = topology.steps.find((step) => step.kind === 'link');
    const logicalLinkedPath =
      link?.request.kind === 'link' ? link.request.linked : undefined;
    verification = {
      artifactDir: topology.artifactDir,
      gearsPath: gears.path,
      fsmPath: fsm.path,
      ...(logicalLinkedPath === undefined
        ? {}
        : { linkedPath: logicalLinkedPath }),
      support,
      tests,
    };

    if (
      topology.pipelineName === 'playbook' &&
      topology.invocation.kind === 'full-link' &&
      logicalLinkedPath ===
        join(topology.artifactDir, `${topology.basename}.playbook.ts`)
    ) {
      const logicalPath = resolve(
        topology.artifactDir,
        '..',
        `${topology.basename}.ts`,
      );
      const productId = `entry:${topology.basename}`;
      products.push({
        id: productId,
        kind: 'entry',
        path: logicalPath,
        inputs: [LOAD_INTEGRITY_CHECKER_ID, ENTRY_GENERATOR_ID],
      });
      entry = {
        productId,
        logicalPath,
        logicalBundlePath: topology.artifactDir,
        logicalTextPath: topology.invocation.normalize
          ? join(
              topology.artifactDir,
              `${topology.basename}.${topology.pipeline.phases[0].source.format}${topology.pipeline.phases[0].source.ext}`,
            )
          : topology.sourcePath,
      };
    }
  }

  return Object.freeze({
    products: Object.freeze(products.map((product) => Object.freeze(product))),
    ...(entry === undefined ? {} : { entry: Object.freeze(entry) }),
    ...(verification === undefined
      ? {}
      : {
          verification: Object.freeze({
            ...verification,
            support: Object.freeze(
              verification.support.map((item) => Object.freeze(item)),
            ),
            tests: Object.freeze(
              verification.tests.map((item) => Object.freeze(item)),
            ),
          }),
        }),
  });
}

/** Exact plan-identity descriptor for the derivatives applicable to a topology. */
export async function identifyDeterministicDerivatives(
  topology: FullBuildTopology,
): Promise<NonNullable<BuildIdentityContext['deterministic']> | undefined> {
  const description = describeDeterministicDerivatives(topology);
  if (description.products.length === 0) return undefined;
  const used = new Set(
    description.products.flatMap((product) => product.inputs),
  );
  const xstatePackagePath = createRequire(
    join(topology.artifactDir, '__slc_derivative_identity__.js'),
  ).resolve('xstate/package.json');
  const components = (
    await deterministicIdentityComponents({ xstatePackagePath })
  ).filter((component) => used.has(component.id));
  if (components.length !== used.size) {
    throw new Error('deterministic product references an unknown component');
  }
  return {
    components,
    products: description.products,
  };
}

export interface BoundDeterministicProduct {
  readonly id: string;
  readonly logicalPath: string;
  readonly physicalPath: string;
}

export interface DeterministicSemanticBindings {
  readonly text?: EmittedFileBinding;
  readonly gears: EmittedFileBinding;
  readonly fsm: EmittedFileBinding;
  readonly linked?: EmittedFileBinding;
}

export interface DeterministicEmissionFailure {
  readonly productId: string;
  readonly message: string;
}

export interface DeterministicEmissionResult {
  readonly written: readonly BoundDeterministicProduct[];
  readonly diagnostics: readonly string[];
  readonly failures: readonly DeterministicEmissionFailure[];
}

/** Binds every described product to exactly one caller-authorized path. */
export function bindDeterministicDerivatives(
  description: DeterministicDerivativeDescription,
  physicalPath: (productId: string, logicalPath: string) => string,
): readonly BoundDeterministicProduct[] {
  const seen = new Set<string>();
  return Object.freeze(
    description.products.map((product) => {
      const bound = resolve(physicalPath(product.id, product.path));
      if (seen.has(bound)) {
        throw new Error(`deterministic products share physical path: ${bound}`);
      }
      seen.add(bound);
      return Object.freeze({
        id: product.id,
        logicalPath: resolve(product.path),
        physicalPath: bound,
      });
    }),
  );
}

/**
 * Generates the complete applicable derivative inventory at explicit paths.
 *
 * Failures are product-scoped so a later candidate transaction can discard the
 * whole private result. This function never writes a canonical path unless the
 * caller explicitly binds that path.
 */
export async function emitDeterministicDerivatives(options: {
  readonly description: DeterministicDerivativeDescription;
  readonly bindings: readonly BoundDeterministicProduct[];
  readonly semantic: DeterministicSemanticBindings;
}): Promise<DeterministicEmissionResult> {
  const bound = exactBindingMap(options.description, options.bindings);
  const written: BoundDeterministicProduct[] = [];
  const diagnostics: string[] = [];
  const failures: DeterministicEmissionFailure[] = [];
  const verification = options.description.verification;
  const entry = options.description.entry;
  const text = options.semantic.text;

  if (entry !== undefined) {
    if (text === undefined) {
      throw new Error('deterministic entry generation requires the text input');
    }
    requireSemanticBinding(text, entry.logicalTextPath, 'text');
  }

  if (verification !== undefined) {
    requireSemanticBinding(
      options.semantic.gears,
      verification.gearsPath,
      'gears',
    );
    requireSemanticBinding(options.semantic.fsm, verification.fsmPath, 'fsm');
    if (verification.linkedPath !== undefined) {
      if (options.semantic.linked === undefined) {
        throw new Error('deterministic verification requires the linked input');
      }
      requireSemanticBinding(
        options.semantic.linked,
        verification.linkedPath,
        'linked',
      );
    }

    const supportManifest = verification.support.map((product) => ({
      file: product.file,
      path: requireBound(bound, product.productId).physicalPath,
    }));
    try {
      const paths = await emitVerifierSupport({ manifest: supportManifest });
      for (const [index] of paths.entries()) {
        written.push(
          requireBound(bound, verification.support[index].productId),
        );
      }
    } catch (error) {
      if (error instanceof VerifierSupportEmissionError) {
        const writtenPaths = new Set(error.written);
        const failureByPath = new Map(
          error.failures.map(({ path, reason }) => [path, messageOf(reason)]),
        );
        for (const product of verification.support) {
          const binding = requireBound(bound, product.productId);
          if (writtenPaths.has(binding.physicalPath)) {
            written.push(binding);
          } else {
            failures.push({
              productId: product.productId,
              message:
                failureByPath.get(binding.physicalPath) ?? messageOf(error),
            });
          }
        }
      } else {
        failures.push(
          ...verification.support.map((product) => ({
            productId: product.productId,
            message: messageOf(error),
          })),
        );
      }
    }

    const fsmModule = moduleSpecifier(
      verification.tests[0].logicalPath,
      runtimeModulePath(verification.fsmPath),
    );
    const gearsFile = moduleSpecifier(
      verification.tests[0].logicalPath,
      verification.gearsPath,
    );
    const verifyModule = moduleSpecifier(
      verification.tests[0].logicalPath,
      join(verification.artifactDir, VERIFIER_SUPPORT_DIR, 'verify.js'),
    );
    const tests = new Map(
      verification.tests.map((product) => [product.file, product]),
    );

    await emitOne('gears-fsm.test.ts', async (product) =>
      emitGearsFsmConformanceTest({
        basename: basenameOf(verification),
        verifyModule,
        layout: {
          outputPath: requireBound(bound, product.productId).physicalPath,
          fsmModule,
          gearsFile,
        },
      }),
    );
    await emitOne('fsm.introspect.test.ts', async (product) =>
      emitFsmIntrospectionTest({
        basename: basenameOf(verification),
        verifyModule,
        layout: {
          fsmPath: options.semantic.fsm.physicalPath,
          outputPath: requireBound(bound, product.productId).physicalPath,
          fsmModule,
        },
      }),
    );
    await emitOne('prompt-contract.test.ts', async (product) => {
      const result = await emitPromptContractTest({
        basename: basenameOf(verification),
        verifyModule,
        layout: {
          fsmPath: options.semantic.fsm.physicalPath,
          outputPath: requireBound(bound, product.productId).physicalPath,
          fsmModule,
          ...(verification.linkedPath === undefined ||
          options.semantic.linked === undefined
            ? {}
            : {
                linked: {
                  physicalPath: options.semantic.linked.physicalPath,
                  moduleSpecifier: moduleSpecifier(
                    product.logicalPath,
                    runtimeModulePath(verification.linkedPath),
                  ),
                  fsmModuleSpecifier: moduleSpecifier(
                    verification.linkedPath,
                    runtimeModulePath(verification.fsmPath),
                  ),
                },
              }),
        },
      });
      diagnostics.push(...result.diagnostics);
      return result.path;
    });
    await emitOne('fsm.coverage.test.ts', async (product) => {
      const layout: FsmCoverageEmissionLayout = {
        fsmPath: options.semantic.fsm.physicalPath,
        outputPath: requireBound(bound, product.productId).physicalPath,
        fsmModule,
        fsmSourceFile: moduleSpecifier(
          product.logicalPath,
          verification.fsmPath,
        ),
      };
      const result = await emitFsmCoverageTest({
        basename: basenameOf(verification),
        verifyModule,
        layout,
      });
      diagnostics.push(...result.diagnostics);
      return result.path;
    });

    async function emitOne(
      file: (typeof VERIFICATION_TEST_FILES)[number],
      emit: (
        product: NonNullable<typeof verification>['tests'][number],
      ) => Promise<string>,
    ): Promise<void> {
      const product = tests.get(file);
      if (product === undefined) {
        throw new Error(
          `deterministic verification product is missing: ${file}`,
        );
      }
      try {
        await emit(product);
        written.push(requireBound(bound, product.productId));
      } catch (error) {
        failures.push({
          productId: product.productId,
          message: messageOf(error),
        });
      }
    }
  }

  if (entry !== undefined && text !== undefined) {
    const product = requireBound(bound, entry.productId);
    try {
      await emitEntryModuleAtPaths({
        basename: basenameFromEntry(entry.logicalPath),
        gearsPath: options.semantic.gears.physicalPath,
        textPath: text.physicalPath,
        outputPath: product.physicalPath,
        logicalEntryPath: entry.logicalPath,
        logicalBundlePath: entry.logicalBundlePath,
      });
      written.push(product);
    } catch (error) {
      failures.push({ productId: entry.productId, message: messageOf(error) });
    }
  }

  return {
    written: Object.freeze(written),
    diagnostics: Object.freeze(diagnostics),
    failures: Object.freeze(failures),
  };
}

function exactBindingMap(
  description: DeterministicDerivativeDescription,
  bindings: readonly BoundDeterministicProduct[],
): Map<string, BoundDeterministicProduct> {
  const expected = new Map(
    description.products.map((product) => [product.id, resolve(product.path)]),
  );
  if (bindings.length !== expected.size) {
    throw new Error('deterministic bindings do not match the exact inventory');
  }
  const result = new Map<string, BoundDeterministicProduct>();
  const physical = new Set<string>();
  for (const binding of bindings) {
    const physicalPath = resolve(binding.physicalPath);
    if (
      expected.get(binding.id) !== resolve(binding.logicalPath) ||
      binding.logicalPath !== resolve(binding.logicalPath) ||
      binding.physicalPath !== physicalPath ||
      result.has(binding.id) ||
      physical.has(physicalPath)
    ) {
      throw new Error(
        'deterministic binding is unknown, duplicate, or misbound',
      );
    }
    result.set(binding.id, binding);
    physical.add(physicalPath);
  }
  return result;
}

function requireBound(
  bindings: Map<string, BoundDeterministicProduct>,
  productId: string,
): BoundDeterministicProduct {
  const product = bindings.get(productId);
  if (product === undefined) {
    throw new Error(`deterministic product is unbound: ${productId}`);
  }
  return product;
}

function requireSemanticBinding(
  binding: EmittedFileBinding,
  logicalPath: string,
  role: string,
): void {
  if (resolve(binding.logicalPath) !== resolve(logicalPath)) {
    throw new Error(`deterministic ${role} input is logically misbound`);
  }
  requireNormalizedBinding(binding, role);
}

function requireNormalizedBinding(
  binding: EmittedFileBinding,
  role: string,
): void {
  if (
    binding.logicalPath !== resolve(binding.logicalPath) ||
    binding.physicalPath !== resolve(binding.physicalPath)
  ) {
    throw new Error(`deterministic ${role} input paths must be normalized`);
  }
}

function moduleSpecifier(fromModule: string, toModule: string): string {
  const path = relative(dirname(fromModule), toModule).split(sep).join('/');
  return path === '..' || path.startsWith('../') || path.startsWith('./')
    ? path
    : `./${path}`;
}

function runtimeModulePath(sourcePath: string): string {
  const extension = extname(sourcePath);
  return extension === '.ts' ? `${sourcePath.slice(0, -3)}.js` : sourcePath;
}

function basenameOf(
  verification: NonNullable<DeterministicDerivativeDescription['verification']>,
): string {
  const file = verification.tests[0]?.file;
  const logical = verification.tests[0]?.logicalPath;
  if (file === undefined || logical === undefined) {
    throw new Error('deterministic verification tests are missing');
  }
  return logical.slice(dirname(logical).length + 1, -`.${file}`.length);
}

function basenameFromEntry(path: string): string {
  const extension = extname(path);
  return path.slice(dirname(path).length + 1, -extension.length);
}

// Local copy: this module's bytes are hashed into a deterministic identity
// descriptor, so importing an unenumerated module would stop covering it.
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
