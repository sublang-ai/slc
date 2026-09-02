// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Reference-equivalence comparator (verification-9, verification-10; DR-009,
 * DR-024).
 *
 * Two faithful compilations of the same workflow need not be byte-identical —
 * item partitions and state names are judgment — but they must agree on the
 * observable contract: the players bound, the verbatim per-player prompt-line
 * sets, the machine's Boss surfaces, conformance of each `fsm` to its own
 * `gears`, and the linked `createPlaybookRuntime` runtime contract. The
 * comparator returns findings (empty when equivalent); the acceptance test
 * wires it to `slc playbook` output and the manual reference package.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  declaresComposedV3,
  type PlaybookRuntimeDeclaration,
} from '../src/runtime-contract.js';
import {
  AWAIT_BOSS_REPLY_STATE,
  BOSS_REPLY_EVENT,
  artifactSchemaForPlaybookProvenance,
  checkGearsFsmConformance,
  canonicalRoleId,
  findConcurrentRoleSets,
  findMachineConfig,
  hasControllerDecisionNearMiss,
  inspectGearsRoleContract,
  isControllerMachine,
  parseGearsItems,
  pinIntrospection,
  resolveArtifactSchemaForVerification,
  type MachineConfigLike,
} from '../src/verify.js';
import { checkFsmCoverage } from '../src/verify-coverage.js';
import {
  isPlaybookRunResult,
  type RuntimeContractProfile,
} from '../src/playbook-contract.js';

/** One compilation's artifacts, loaded by the acceptance test. */
export interface CompiledPlaybook {
  /** The `gears` intermediate text. */
  gears: string;
  /** The imported `fsm` module. */
  fsm: unknown;
  /** The imported linked `playbook` module. */
  playbook: unknown;
  /** The `fsm` artifact source text, for coverage probing. */
  fsmSource?: string;
  /** Exact link-target provenance supplied by the comparison fixture. */
  linkTargetProvenance?: string;
  /** The link target's installed engine declaration, when the fixture read it (DR-028). */
  runtimeDeclaration?: PlaybookRuntimeDeclaration;
  /** Schema-3 Captain-hosted registry entry, when the closure has one. */
  registry?: unknown;
}

export type RuntimeCapabilityProfile = RuntimeContractProfile;

/** Immutable linked-module export used where callable shape is ambiguous. */
export const RUNTIME_CONTRACT_PROFILE_EXPORT = 'runtimeContractProfile';

interface RuntimeProfileInspection {
  profile: RuntimeCapabilityProfile | null;
  implementation?: 'shared-factory' | 'bespoke';
  validatedOptions?: unknown;
  findings: string[];
}

/** Comparison-supplied configured-option slice for schema-3 registries. */
export interface RuntimeProfileOptions {
  provenance?: string;
  /** Engine declaration read from the link target's installed package (DR-028). */
  runtimeDeclaration?: PlaybookRuntimeDeclaration;
  artifactSchema?: 1 | 3;
  config?: MachineConfigLike;
  registry?: unknown;
  configuredOptions?: unknown;
}

interface Schema3LinkedFactoryCall {
  readonly argumentCount: number;
  readonly construction: Schema3ConstructionArgumentObservation;
  readonly configuredOptions: Schema3BoundaryValueObservation;
  readonly hostCapabilities: Schema3BoundaryValueObservation;
  completed: boolean;
  result?: unknown;
  error?: unknown;
}

type Schema3ConstructionArgumentObservation =
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'record';
      readonly prototype: unknown;
      readonly properties: readonly {
        readonly key: PropertyKey;
        readonly descriptor: Readonly<PropertyDescriptor>;
      }[];
    };

type Schema3BoundaryValueObservation =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'atom'; readonly value: unknown }
  | { readonly kind: 'cycle'; readonly reference: object }
  | {
      readonly kind: 'object';
      readonly reference: object;
      readonly prototype: unknown;
      readonly properties: readonly {
        readonly key: PropertyKey;
        readonly descriptor:
          | {
              readonly kind: 'data';
              readonly value: Schema3BoundaryValueObservation;
              readonly writable: boolean | undefined;
              readonly enumerable: boolean | undefined;
              readonly configurable: boolean | undefined;
            }
          | {
              readonly kind: 'accessor';
              readonly get: (() => unknown) | undefined;
              readonly set: ((value: unknown) => void) | undefined;
              readonly enumerable: boolean | undefined;
              readonly configurable: boolean | undefined;
            };
      }[];
    };

/** Comparator-owned linked module and the factory a registry must import. */
export interface InterposedSchema3LinkedModule {
  readonly playbook: unknown;
  readonly factory: (...args: unknown[]) => unknown;
}

/** Reported when a schema-3 registry lacks schema-3 link-target evidence. */
export const COMPOSED_V3_EVIDENCE_FINDING =
  'composed-v3 requires schema-3 link-target evidence: an exact reviewed schema-3 provenance or an installed engine declaring RUNTIME_ABI 1 with artifact schema 3';
const execFileAsync = promisify(execFile);
const linkedFactoryCalls = new WeakMap<
  (...args: unknown[]) => unknown,
  Schema3LinkedFactoryCall[]
>();

/**
 * Wraps a linked default factory at the comparison boundary.
 *
 * The call log stays private to this module: registry code receives only the
 * wrapper and therefore cannot manufacture evidence about whether or how it
 * called the linked factory.
 */
export function interposeSchema3LinkedModule(
  playbook: unknown,
): InterposedSchema3LinkedModule {
  if (typeof playbook !== 'object' || playbook === null) {
    throw new Error('linked schema-3 module is not an object');
  }
  const linked = playbook as Record<string, unknown>;
  const target = linked.default;
  if (typeof target !== 'function') {
    throw new Error('linked schema-3 module has no callable default export');
  }
  const calls: Schema3LinkedFactoryCall[] = [];
  const factory = function (this: unknown, ...args: unknown[]): unknown {
    const call: Schema3LinkedFactoryCall = {
      argumentCount: args.length,
      construction: observeSchema3ConstructionArgument(args[0]),
      configuredOptions: observeSchema3ConstructionMember(
        args[0],
        'configuredOptions',
      ),
      hostCapabilities: observeSchema3ConstructionMember(
        args[0],
        'hostCapabilities',
      ),
      completed: false,
    };
    calls.push(call);
    try {
      const result = Reflect.apply(target, this, args);
      call.result = result;
      call.completed = true;
      return result;
    } catch (error) {
      call.error = error;
      throw error;
    }
  };
  const compat = Object.getOwnPropertyDescriptor(target, 'compat');
  if (compat !== undefined) Object.defineProperty(factory, 'compat', compat);
  linkedFactoryCalls.set(factory, calls);
  return {
    playbook: { ...linked, default: factory },
    factory,
  };
}

function observeSchema3ConstructionMember(
  construction: unknown,
  key: string,
): Schema3BoundaryValueObservation {
  try {
    if (typeof construction !== 'object' || construction === null) {
      return Object.freeze({ kind: 'invalid' });
    }
    const descriptor = Object.getOwnPropertyDescriptor(construction, key);
    if (
      descriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      return Object.freeze({ kind: 'invalid' });
    }
    return observeSchema3BoundaryValue(descriptor.value);
  } catch {
    return Object.freeze({ kind: 'invalid' });
  }
}

function observeSchema3BoundaryValue(
  value: unknown,
  ancestors = new Set<object>(),
): Schema3BoundaryValueObservation {
  if (
    (typeof value !== 'object' || value === null) &&
    typeof value !== 'function'
  ) {
    return Object.freeze({ kind: 'atom', value });
  }
  if (typeof value === 'function') {
    return Object.freeze({ kind: 'atom', value });
  }
  if (ancestors.has(value)) {
    return Object.freeze({ kind: 'cycle', reference: value });
  }
  try {
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const properties = Reflect.ownKeys(descriptors).map((key) => {
      const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
      const snapshot = Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? Object.freeze({
            kind: 'data' as const,
            value: observeSchema3BoundaryValue(descriptor.value, nextAncestors),
            writable: descriptor.writable,
            enumerable: descriptor.enumerable,
            configurable: descriptor.configurable,
          })
        : Object.freeze({
            kind: 'accessor' as const,
            get: descriptor.get,
            set: descriptor.set,
            enumerable: descriptor.enumerable,
            configurable: descriptor.configurable,
          });
      return Object.freeze({ key, descriptor: snapshot });
    });
    return Object.freeze({
      kind: 'object',
      reference: value,
      prototype: Object.getPrototypeOf(value),
      properties: Object.freeze(properties),
    });
  } catch {
    return Object.freeze({ kind: 'invalid' });
  }
}

function sameSchema3BoundaryValue(
  left: Schema3BoundaryValueObservation,
  right: Schema3BoundaryValueObservation,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'invalid' || right.kind === 'invalid') return false;
  if (left.kind === 'atom' && right.kind === 'atom') {
    return Object.is(left.value, right.value);
  }
  if (left.kind === 'cycle' && right.kind === 'cycle') {
    return left.reference === right.reference;
  }
  if (left.kind !== 'object' || right.kind !== 'object') return false;
  if (
    left.reference !== right.reference ||
    left.prototype !== right.prototype ||
    left.properties.length !== right.properties.length
  ) {
    return false;
  }
  return left.properties.every((property, index) => {
    const counterpart = right.properties[index];
    if (
      counterpart === undefined ||
      property.key !== counterpart.key ||
      property.descriptor.kind !== counterpart.descriptor.kind ||
      property.descriptor.enumerable !== counterpart.descriptor.enumerable ||
      property.descriptor.configurable !== counterpart.descriptor.configurable
    ) {
      return false;
    }
    if (
      property.descriptor.kind === 'data' &&
      counterpart.descriptor.kind === 'data'
    ) {
      return (
        property.descriptor.writable === counterpart.descriptor.writable &&
        sameSchema3BoundaryValue(
          property.descriptor.value,
          counterpart.descriptor.value,
        )
      );
    }
    return (
      property.descriptor.kind === 'accessor' &&
      counterpart.descriptor.kind === 'accessor' &&
      property.descriptor.get === counterpart.descriptor.get &&
      property.descriptor.set === counterpart.descriptor.set
    );
  });
}

function observeSchema3ConstructionArgument(
  value: unknown,
): Schema3ConstructionArgumentObservation {
  try {
    if (typeof value !== 'object' || value === null) {
      return Object.freeze({ kind: 'invalid' });
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const properties = Reflect.ownKeys(descriptors).map((key) => {
      const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
      const snapshot = Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ? {
            value: descriptor.value,
            writable: descriptor.writable,
            enumerable: descriptor.enumerable,
            configurable: descriptor.configurable,
          }
        : {
            get: descriptor.get,
            set: descriptor.set,
            enumerable: descriptor.enumerable,
            configurable: descriptor.configurable,
          };
      return Object.freeze({ key, descriptor: Object.freeze(snapshot) });
    });
    return Object.freeze({
      kind: 'record',
      prototype: Object.getPrototypeOf(value),
      properties: Object.freeze(properties),
    });
  } catch {
    return Object.freeze({ kind: 'invalid' });
  }
}

/**
 * Loads a source registry after replacing its linked-factory import with a
 * comparator-owned interposition. The original entry remains byte-untouched.
 */
export async function loadInterposedSchema3Registry(
  entryPath: string,
  linkedPath: string,
  playbook: unknown,
): Promise<{ playbook: unknown; registry: unknown }> {
  const source = await readFile(entryPath, 'utf8');
  const imports = [
    ...source.matchAll(/\bfrom\s+(['"])(\.\/[^'"]+\.playbook\.(?:ts|js))\1/g),
  ];
  if (imports.length !== 1 || imports[0][2] === undefined) {
    throw new Error(
      'schema-3 registry must have exactly one relative linked-factory import',
    );
  }
  const specifier = imports[0][2];
  if (resolve(dirname(entryPath), specifier) !== resolve(linkedPath)) {
    throw new Error(
      `schema-3 registry linked-factory import ${specifier} does not resolve to ${linkedPath}`,
    );
  }

  const interposed = interposeSchema3LinkedModule(playbook);
  const root = await mkdtemp(join(tmpdir(), 'slc-equivalence-registry-'));
  const globalKey = `__slc_equivalence_factory_${randomUUID().replaceAll('-', '_')}`;
  const extension = extname(entryPath) === '.ts' ? '.ts' : '.mjs';
  const registryPath = join(root, `registry${extension}`);
  const factoryPath = join(root, 'linked-factory.mjs');
  Object.defineProperty(globalThis, globalKey, {
    value: interposed.factory,
    configurable: true,
  });
  try {
    await writeFile(
      factoryPath,
      `const factory = globalThis[${JSON.stringify(globalKey)}];\nif (typeof factory !== 'function') throw new Error('comparison factory unavailable');\nexport default factory;\n`,
    );
    const rewritten = source.replace(
      imports[0][0],
      imports[0][0].replace(specifier, './linked-factory.mjs'),
    );
    await writeFile(registryPath, rewritten);
    const loaded = (await import(
      `${pathToFileURL(registryPath).href}?comparison=${randomUUID()}`
    )) as Record<string, unknown>;
    return { playbook: interposed.playbook, registry: loaded.default };
  } finally {
    Reflect.deleteProperty(globalThis, globalKey);
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Constructs one registry runtime through comparison-owned interposition and
 * rejects any call-time drift before returning the directly linked runtime.
 */
export function constructInterposedSchema3Runtime(opts: {
  playbook: unknown;
  registry: {
    createRuntime(options: unknown, hostCapabilities: unknown): unknown;
  };
  configuredOptions: unknown;
  hostCapabilities: unknown;
}): unknown {
  if (typeof opts.playbook !== 'object' || opts.playbook === null) {
    throw new Error('linked schema-3 module is not an object');
  }
  const factory = (opts.playbook as Record<string, unknown>).default;
  if (typeof factory !== 'function') {
    throw new Error('linked schema-3 module has no callable default export');
  }
  const calls = linkedFactoryCalls.get(factory);
  if (calls === undefined) {
    throw new Error(
      'shared-factory schema-3 construction lacks comparison-owned linked-factory interposition',
    );
  }
  const expectedOptions = observeSchema3BoundaryValue(opts.configuredOptions);
  const expectedCapabilities = observeSchema3BoundaryValue(
    opts.hostCapabilities,
  );
  const callOffset = calls.length;
  let created: unknown;
  let creationFailed = false;
  let creationError: unknown;
  try {
    created = opts.registry.createRuntime(
      opts.configuredOptions,
      opts.hostCapabilities,
    );
  } catch (error) {
    creationFailed = true;
    creationError = error;
  }
  const problem = linkedFactoryConstructionProblem(
    calls.slice(callOffset),
    opts.configuredOptions,
    opts.hostCapabilities,
    expectedOptions,
    expectedCapabilities,
    created,
    creationFailed,
  );
  if (problem !== '') throw new Error(problem);
  if (creationFailed) throw creationError;
  return created;
}

/**
 * Returns the linked runtime's exact observable contract profile.
 *
 * `legacy` and `session-v1` have the same three methods, so callable shape is
 * insufficient. The harness initializes fresh runtimes through each candidate
 * boundary and drives one inert, non-empty turn. An optional immutable marker
 * resolves a deliberately permissive fixture, but never overrides a boundary
 * or method-surface conflict.
 */
export async function runtimeCapabilityProfile(
  playbook: unknown,
  options: RuntimeProfileOptions = {},
): Promise<RuntimeCapabilityProfile | null> {
  return (await inspectRuntimeProfile(playbook, options)).profile;
}

async function inspectRuntimeProfile(
  playbook: unknown,
  options: RuntimeProfileOptions = {},
): Promise<RuntimeProfileInspection> {
  const findings: string[] = [];
  if (typeof playbook !== 'object' || playbook === null) {
    return { profile: null, findings };
  }
  const linked = playbook as Record<string, unknown>;
  const rawMarker = linked[RUNTIME_CONTRACT_PROFILE_EXPORT];
  const marker = isRuntimeContractProfile(rawMarker) ? rawMarker : undefined;
  if (rawMarker !== undefined && marker === undefined) {
    findings.push(
      `linked module declares unsupported ${RUNTIME_CONTRACT_PROFILE_EXPORT} ${JSON.stringify(rawMarker)}`,
    );
    return { profile: null, findings };
  }

  const factory = linked.default;
  const schemaResolution = resolveArtifactSchemaForVerification({
    ...(options.artifactSchema === undefined
      ? {}
      : { artifactSchema: options.artifactSchema }),
    ...(options.provenance === undefined
      ? {}
      : { provenance: options.provenance }),
    ...(options.runtimeDeclaration === undefined
      ? {}
      : { runtimeDeclaration: options.runtimeDeclaration }),
    ...(options.config === undefined ? {} : { config: options.config }),
    linked,
  });
  findings.push(...schemaResolution.findings);
  if (schemaResolution.findings.length > 0) {
    return { profile: null, findings };
  }
  if (marker === 'composed-v3' && schemaResolution.artifactSchema !== 3) {
    findings.push(
      `composed-v3 runtime marker conflicts with selected artifact schema ${schemaResolution.artifactSchema ?? 'unclassified'}`,
    );
    return { profile: null, findings };
  }
  if (options.registry !== undefined && schemaResolution.artifactSchema !== 3) {
    findings.push(
      `schema-3 registry conflicts with selected artifact schema ${schemaResolution.artifactSchema ?? 'unclassified'}`,
    );
    return { profile: null, findings };
  }
  if (schemaResolution.artifactSchema === 3) {
    return inspectComposedV3Profile(linked, marker, options, findings);
  }

  if (typeof factory !== 'function') {
    findings.push('linked module has no callable default export');
    return { profile: null, findings };
  }
  const create = factory as (options: unknown) => unknown;
  const surface = inspectFactorySurface(create);
  findings.push(...surface.findings);
  if (!surface.valid) return { profile: null, findings };

  if (marker === 'composed-v2' && !surface.resumable) {
    findings.push('composed-v2 runtime lacks resumePlaybookCall()');
    return { profile: null, findings };
  }
  if ((marker === 'legacy' || marker === 'session-v1') && surface.resumable) {
    findings.push(
      `${marker} runtime unexpectedly exposes resumePlaybookCall()`,
    );
    return { profile: null, findings };
  }

  const candidates: readonly RuntimeContractProfile[] =
    marker !== undefined
      ? [marker]
      : surface.resumable
        ? ['composed-v2']
        : ['legacy', 'session-v1'];
  const probes = await Promise.all(
    candidates.map(async (profile) => ({
      profile,
      ...(await probeRuntimeProfile(create, profile)),
    })),
  );
  const accepted = probes.filter((probe) => probe.accepted);
  if (accepted.length === 1) {
    return { profile: accepted[0].profile, findings };
  }
  if (accepted.length > 1) {
    findings.push(
      `runtime accepts ambiguous contract profiles: ${accepted
        .map(({ profile }) => profile)
        .join(', ')}`,
    );
    return { profile: null, findings };
  }
  findings.push(
    `runtime matches no exact contract profile (${probes
      .map(({ profile, reason }) => `${profile}: ${reason}`)
      .join('; ')})`,
  );
  return { profile: null, findings };
}

async function inspectComposedV3Profile(
  linked: Record<string, unknown>,
  marker: RuntimeContractProfile | undefined,
  options: RuntimeProfileOptions,
  findings: string[],
): Promise<RuntimeProfileInspection> {
  // Schema-3 link-target evidence under the verification-only decision: the
  // exact reviewed provenance as recorded, or an installed engine declaring
  // RUNTIME_ABI 1 with artifact schema 3 whatever its release (DR-028).
  const declared =
    options.runtimeDeclaration !== undefined &&
    declaresComposedV3(options.runtimeDeclaration);
  if (
    artifactSchemaForPlaybookProvenance(options.provenance) !== 3 &&
    !declared
  ) {
    findings.push(COMPOSED_V3_EVIDENCE_FINDING);
    return { profile: null, findings };
  }
  if (marker !== undefined && marker !== 'composed-v3') {
    findings.push(
      `${marker} runtime marker conflicts with schema-3 registry construction`,
    );
    return { profile: null, findings };
  }

  const factory = linked.default;
  if (typeof factory !== 'function') {
    findings.push('linked schema-3 module has no callable default export');
    return { profile: null, findings };
  }
  const registry = inspectSchema3Registry(
    options.registry,
    factory as (options: unknown) => unknown,
  );
  findings.push(...registry.findings);
  if (registry.entry === undefined || registry.implementation === undefined) {
    return { profile: null, findings };
  }

  let validatedOptions: unknown;
  try {
    const hasConfiguredOptions = Object.prototype.hasOwnProperty.call(
      options,
      'configuredOptions',
    );
    if (hasConfiguredOptions && !isPlainJsonValue(options.configuredOptions)) {
      findings.push('schema-3 configured option slice is not plain JSON');
      return {
        profile: null,
        implementation: registry.implementation,
        findings,
      };
    }
    validatedOptions = Object.prototype.hasOwnProperty.call(
      options,
      'configuredOptions',
    )
      ? registry.entry.validateOptions(
          cloneJsonValue(options.configuredOptions),
        )
      : registry.entry.validateOptions();
  } catch (error) {
    findings.push(`schema-3 option validation failed: ${messageOf(error)}`);
    return {
      profile: null,
      implementation: registry.implementation,
      findings,
    };
  }
  if (!isPlainJsonValue(validatedOptions)) {
    findings.push('schema-3 option validator returned non-plain JSON');
    return {
      profile: null,
      implementation: registry.implementation,
      findings,
    };
  }
  if (
    !Object.prototype.hasOwnProperty.call(options, 'configuredOptions') &&
    canonicalJson(validatedOptions) !== '{}'
  ) {
    findings.push(
      'schema-3 optionless registry must validate an absent slice to exact empty options',
    );
    return {
      profile: null,
      implementation: registry.implementation,
      findings,
    };
  }

  const reason = await probeComposedV3Runtime(
    registry.entry,
    registry.implementation,
    validatedOptions,
    linkedFactoryCalls.get(factory as (...args: unknown[]) => unknown),
  );
  if (reason !== '') {
    findings.push(`composed-v3 runtime probe failed: ${reason}`);
    return {
      profile: null,
      implementation: registry.implementation,
      validatedOptions,
      findings,
    };
  }
  return {
    profile: 'composed-v3',
    implementation: registry.implementation,
    validatedOptions,
    findings,
  };
}

interface Schema3Registry {
  id: string;
  artifactSchema: 3;
  requiredRoleIds: readonly string[];
  concurrentRoleSets: readonly (readonly string[])[];
  validateOptions(value?: unknown): unknown;
  createRuntime(options: unknown, hostCapabilities: unknown): unknown;
}

function inspectSchema3Registry(
  value: unknown,
  factory: (options: unknown) => unknown,
): {
  entry?: Schema3Registry;
  implementation?: 'shared-factory' | 'bespoke';
  findings: string[];
} {
  const findings: string[] = [];
  const entry = ownDataRecord(value);
  const required = [
    'id',
    'command',
    'intent',
    'artifactSchema',
    'runtimeProfile',
    'requiredRoleIds',
    'concurrentRoleSets',
    'validateOptions',
    'createRuntime',
  ] as const;
  const allowed = new Set<string>([...required, 'summaryPolicy']);
  if (
    entry === undefined ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(entry, key)) ||
    Object.keys(entry).some((key) => !allowed.has(key))
  ) {
    findings.push('linked module exposes no exact schema-3 registry entry');
    return { findings };
  }
  if (
    typeof entry.id !== 'string' ||
    entry.id.length === 0 ||
    typeof entry.command !== 'string' ||
    entry.command !== entry.id ||
    typeof entry.intent !== 'string' ||
    entry.artifactSchema !== 3 ||
    typeof entry.validateOptions !== 'function' ||
    typeof entry.createRuntime !== 'function'
  ) {
    findings.push('schema-3 registry entry has malformed required fields');
    return { findings };
  }
  if (
    Object.prototype.hasOwnProperty.call(entry, 'summaryPolicy') &&
    !isSchema3SummaryPolicy(entry.summaryPolicy)
  ) {
    findings.push('schema-3 registry summaryPolicy is malformed');
    return { findings };
  }
  const roles = schema3RoleIds(entry.requiredRoleIds);
  const concurrent = schema3ConcurrentRoleSets(entry.concurrentRoleSets, roles);
  if (roles === undefined || concurrent === undefined) {
    findings.push('schema-3 registry has invalid canonical role declarations');
    return { findings };
  }

  const profile = ownDataRecord(entry.runtimeProfile);
  if (profile === undefined) {
    findings.push('schema-3 runtime profile must be an own-data declaration');
    return { findings };
  }
  const profileKeys = Object.keys(profile).sort();
  let implementation: 'shared-factory' | 'bespoke' | undefined;
  if (
    profile.kind === 'shared-factory' &&
    profileKeys.join(',') === 'compat,kind'
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(factory, 'compat');
    const compat = profile.compat;
    const compatFields = ownDataRecord(compat, [
      'artifactSchema',
      'runtimeAbi',
    ]);
    if (
      descriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
      descriptor.enumerable !== true ||
      descriptor.writable !== false ||
      descriptor.configurable !== false ||
      descriptor.value !== compat ||
      compatFields === undefined ||
      !Object.isFrozen(compat) ||
      compatFields.artifactSchema !== 3 ||
      compatFields.runtimeAbi !== 1
    ) {
      findings.push(
        'shared-factory schema-3 profile lacks the exact immutable factory compatibility',
      );
      return { findings };
    }
    implementation = 'shared-factory';
  } else if (
    profile.kind === 'bespoke' &&
    profileKeys.join(',') === 'artifactSchema,kind' &&
    profile.artifactSchema === 3
  ) {
    if (Object.prototype.hasOwnProperty.call(factory, 'compat')) {
      findings.push(
        'bespoke schema-3 profile must not carry a factory compatibility claim',
      );
      return { findings };
    }
    implementation = 'bespoke';
  } else {
    findings.push('schema-3 runtime profile declaration is not exact');
    return { findings };
  }

  return {
    entry: {
      id: entry.id,
      artifactSchema: 3,
      requiredRoleIds: roles,
      concurrentRoleSets: concurrent,
      validateOptions:
        entry.validateOptions as Schema3Registry['validateOptions'],
      createRuntime: entry.createRuntime as Schema3Registry['createRuntime'],
    },
    implementation,
    findings,
  };
}

function isSchema3SummaryPolicy(value: unknown): boolean {
  const policy = ownDataRecord(value, [
    'stateCountLabels',
    'copyPasteGuardNames',
    'savedCountsLine',
  ]);
  const labels = ownDataRecord(policy?.stateCountLabels);
  return (
    policy !== undefined &&
    labels !== undefined &&
    Object.values(labels).every((label) => typeof label === 'string') &&
    isExactArray(policy.copyPasteGuardNames) &&
    policy.copyPasteGuardNames.every((guard) => typeof guard === 'string') &&
    typeof policy.savedCountsLine === 'function'
  );
}

function schema3RoleIds(value: unknown): readonly string[] | undefined {
  if (!isExactArray(value)) return undefined;
  if (
    value.some(
      (role) =>
        typeof role !== 'string' ||
        !/^[a-z][a-z0-9_-]*$/.test(role) ||
        role === 'captain',
    ) ||
    new Set(value).size !== value.length
  ) {
    return undefined;
  }
  return [...value] as string[];
}

function schema3ConcurrentRoleSets(
  value: unknown,
  roles: readonly string[] | undefined,
): readonly (readonly string[])[] | undefined {
  if (roles === undefined || !isExactArray(value)) return undefined;
  const declared = new Set(roles);
  const sets: string[][] = [];
  for (const candidate of value) {
    if (
      !isExactArray(candidate) ||
      candidate.length < 2 ||
      candidate.some(
        (role) => typeof role !== 'string' || !declared.has(role),
      ) ||
      new Set(candidate).size !== candidate.length
    ) {
      return undefined;
    }
    sets.push([...candidate] as string[]);
  }
  if (
    new Set(sets.map((set) => JSON.stringify([...set].sort()))).size !==
    sets.length
  ) {
    return undefined;
  }
  return sets;
}

async function probeComposedV3Runtime(
  entry: Schema3Registry,
  implementation: 'shared-factory' | 'bespoke',
  validatedOptions: unknown,
  factoryCalls: Schema3LinkedFactoryCall[] | undefined,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'slc-equivalence-v3-'));
  try {
    await execFileAsync('git', ['init', '--quiet', root]);
    const worktree = await realpath(root);
    const gitDir = await realpath(join(root, '.git'));
    return await driveComposedV3Runtime(
      entry,
      implementation,
      validatedOptions,
      factoryCalls,
      worktree,
      gitDir,
    );
  } catch (error) {
    return messageOf(error);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function driveComposedV3Runtime(
  entry: Schema3Registry,
  implementation: 'shared-factory' | 'bespoke',
  validatedOptions: unknown,
  factoryCalls: Schema3LinkedFactoryCall[] | undefined,
  worktree: string,
  gitDir: string,
): Promise<string> {
  const repositoryOperations: string[] = [];
  let effectWrites = 0;
  let playerCalls = 0;
  const recordRepository = (operation: string) => async () => {
    repositoryOperations.push(operation);
    return undefined;
  };
  const canonicalWorktree = { worktree, gitDir };
  const hostCapabilities = {
    authority: {
      playbookId: entry.id,
      artifactSchema: 3,
      cwd: worktree,
      sessionId: 'slc-profile-probe',
      leaseOwnerToken: 'slc-equivalence-lease-owner',
      canonicalWorktree,
      requiredRoleIds: [...entry.requiredRoleIds],
      concurrentRoleSets: entry.concurrentRoleSets.map((roles) => [...roles]),
    },
    repository: {
      identity: { ...canonicalWorktree },
      observe: recordRepository('observe'),
      acquire: recordRepository('acquire'),
      runExclusive: recordRepository('runExclusive'),
      runCohort: recordRepository('runCohort'),
      runDeferred: recordRepository('runDeferred'),
    },
    effectLedger: {
      snapshot: () => emptyEffectLedger(),
      writeAhead: async () => {
        effectWrites += 1;
        return emptyEffectLedger();
      },
    },
  };
  if (!isExactHostCapabilities(hostCapabilities)) {
    return 'equivalence harness constructed malformed host capabilities';
  }
  const expectedOptions = observeSchema3BoundaryValue(validatedOptions);
  const expectedCapabilities = observeSchema3BoundaryValue(hostCapabilities);

  let runtime: Record<string, unknown> | undefined;
  let initAttempted = false;
  let reason = '';
  try {
    let callOffset: number | undefined;
    if (implementation === 'shared-factory') {
      if (factoryCalls === undefined) {
        return 'shared-factory schema-3 comparison lacks comparison-owned linked-factory interposition';
      }
      callOffset = factoryCalls.length;
    }
    let created: unknown;
    let creationFailed = false;
    let creationError: unknown;
    try {
      created = entry.createRuntime(validatedOptions, hostCapabilities);
    } catch (error) {
      creationFailed = true;
      creationError = error;
    }
    if (callOffset !== undefined && factoryCalls !== undefined) {
      const constructionProblem = linkedFactoryConstructionProblem(
        factoryCalls.slice(callOffset),
        validatedOptions,
        hostCapabilities,
        expectedOptions,
        expectedCapabilities,
        created,
        creationFailed,
      );
      if (constructionProblem !== '') return constructionProblem;
    }
    if (creationFailed) return messageOf(creationError);
    if (typeof created !== 'object' || created === null) {
      return 'registry createRuntime returned a non-object';
    }
    runtime = created as Record<string, unknown>;
    const init = callable(runtime.init, 'init');
    const handle = callable(runtime.handleBossInput, 'handleBossInput');
    callable(runtime.resumePlaybookCall, 'resumePlaybookCall');
    callable(runtime.dispose, 'dispose');
    reason = inspectComposedV3OptionalSurface(runtime);
    if (reason !== '') return reason;

    const ports = probePorts(true, () => {
      playerCalls += 1;
    });
    initAttempted = true;
    await init.call(runtime, {
      sessionId: 'slc-profile-probe',
      playbookId: entry.id,
      rootSessionId: 'slc-profile-probe',
      depth: 0,
      ports,
    });
    if (entry.requiredRoleIds.length === 0) {
      const result = await handle.call(runtime, {
        text: 'SLC runtime contract profile probe',
        signal: new AbortController().signal,
      });
      if (!isPlaybookRunResult(result, 'composed-v3')) {
        reason = 'turn did not return a valid schema-3 structured result';
      }
    }
    if (
      reason === '' &&
      typeof runtime.unresolvedEffectEnvelopes === 'function'
    ) {
      const envelopes = (
        runtime.unresolvedEffectEnvelopes as () => unknown
      ).call(runtime);
      if (!isUnresolvedEffectEnvelopeList(envelopes)) {
        reason = 'unresolvedEffectEnvelopes() returned malformed data';
      }
    }
  } catch (error) {
    reason = messageOf(error);
  } finally {
    if (
      initAttempted &&
      runtime !== undefined &&
      typeof runtime.dispose === 'function'
    ) {
      try {
        await (runtime.dispose as () => Promise<void>).call(runtime);
      } catch (error) {
        if (reason === '') reason = `dispose failed: ${messageOf(error)}`;
      }
    }
  }
  if (
    reason === '' &&
    entry.requiredRoleIds.length === 0 &&
    (playerCalls > 0 || repositoryOperations.length > 0 || effectWrites > 0)
  ) {
    reason = `roleless probe invoked governed host effects (players ${playerCalls}, repository ${repositoryOperations.join(', ') || 'none'}, ledger writes ${effectWrites})`;
  }
  return reason;
}

function linkedFactoryConstructionProblem(
  calls: readonly Schema3LinkedFactoryCall[],
  validatedOptions: unknown,
  hostCapabilities: unknown,
  expectedOptions: Schema3BoundaryValueObservation,
  expectedCapabilities: Schema3BoundaryValueObservation,
  registryRuntime: unknown,
  creationFailed: boolean,
): string {
  if (calls.length !== 1) {
    return `registry createRuntime invoked the linked factory ${calls.length} times, expected exactly once`;
  }
  const call = calls[0];
  if (call.argumentCount !== 1) {
    return 'linked factory was not called with exactly one construction argument';
  }
  const construction = observedOwnDataRecord(call.construction, [
    'configuredOptions',
    'hostCapabilities',
  ]);
  if (construction === undefined) {
    return 'linked factory construction is not exact own-data { configuredOptions, hostCapabilities }';
  }
  if (construction.configuredOptions !== validatedOptions) {
    return 'linked factory did not receive validated options by exact identity';
  }
  if (construction.hostCapabilities !== hostCapabilities) {
    return 'linked factory did not receive live host capabilities by exact identity';
  }
  if (!sameSchema3BoundaryValue(call.configuredOptions, expectedOptions)) {
    return 'linked factory received configured options that drifted at call time';
  }
  if (!sameSchema3BoundaryValue(call.hostCapabilities, expectedCapabilities)) {
    return 'linked factory received host capabilities that drifted at call time';
  }
  if (!call.completed) {
    return creationFailed
      ? ''
      : 'registry createRuntime suppressed a linked-factory construction failure';
  }
  if (call.result !== registryRuntime) {
    return 'registry createRuntime did not return the linked factory runtime directly';
  }
  return '';
}

function observedOwnDataRecord(
  observation: Schema3ConstructionArgumentObservation,
  exactKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (
    observation.kind !== 'record' ||
    (observation.prototype !== Object.prototype &&
      observation.prototype !== null) ||
    observation.properties.length !== exactKeys.length ||
    observation.properties.some(({ key }) => typeof key !== 'string')
  ) {
    return undefined;
  }
  const descriptors = new Map(
    observation.properties.map(({ key, descriptor }) => [key, descriptor]),
  );
  if (exactKeys.some((key) => !descriptors.has(key))) return undefined;
  const record: Record<string, unknown> = {};
  for (const key of exactKeys) {
    const descriptor = descriptors.get(key);
    if (
      descriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
      descriptor.enumerable !== true
    ) {
      return undefined;
    }
    record[key] = descriptor.value;
  }
  return record;
}

function inspectComposedV3OptionalSurface(
  runtime: Record<string, unknown>,
): string {
  const paired = (first: string, second: string): string => {
    const left = runtime[first];
    const right = runtime[second];
    if (left === undefined && right === undefined) return '';
    return typeof left === 'function' && typeof right === 'function'
      ? ''
      : `${first} and ${second} must be callable together`;
  };
  let reason = paired('exportSnapshot', 'restore');
  if (reason !== '') return reason;
  reason = paired('describe', 'apply');
  if (reason !== '') return reason;
  if (runtime.adopt !== undefined && typeof runtime.adopt !== 'function') {
    return 'adopt must be callable when present';
  }
  if (
    runtime.unresolvedEffectEnvelopes !== undefined &&
    typeof runtime.unresolvedEffectEnvelopes !== 'function'
  ) {
    return 'unresolvedEffectEnvelopes must be callable when present';
  }
  if (runtime.retainedGenerationMetadata !== undefined) {
    const metadata = ownDataRecord(runtime.retainedGenerationMetadata, [
      'unfinishedFinalStateIds',
    ]);
    if (
      metadata === undefined ||
      !isExactArray(metadata.unfinishedFinalStateIds) ||
      metadata.unfinishedFinalStateIds.some(
        (stateId) => typeof stateId !== 'string',
      )
    ) {
      return 'retainedGenerationMetadata is malformed';
    }
  }
  return '';
}

function emptyEffectLedger(): {
  schemaVersion: 1;
  revision: 0;
  boundaries: [];
  logicalOperations: [];
} {
  return {
    schemaVersion: 1,
    revision: 0,
    boundaries: [],
    logicalOperations: [],
  };
}

function isExactHostCapabilities(value: unknown): boolean {
  const capability = ownDataRecord(value, [
    'authority',
    'repository',
    'effectLedger',
  ]);
  const authority = ownDataRecord(capability?.authority, [
    'playbookId',
    'artifactSchema',
    'cwd',
    'sessionId',
    'leaseOwnerToken',
    'canonicalWorktree',
    'requiredRoleIds',
    'concurrentRoleSets',
  ]);
  const canonicalWorktree = ownDataRecord(authority?.canonicalWorktree, [
    'worktree',
    'gitDir',
  ]);
  const repository = ownDataRecord(capability?.repository, [
    'identity',
    'observe',
    'acquire',
    'runExclusive',
    'runCohort',
    'runDeferred',
  ]);
  const identity = ownDataRecord(repository?.identity, ['worktree', 'gitDir']);
  const effectLedger = ownDataRecord(capability?.effectLedger, [
    'snapshot',
    'writeAhead',
  ]);
  return (
    authority !== undefined &&
    canonicalWorktree !== undefined &&
    repository !== undefined &&
    identity !== undefined &&
    effectLedger !== undefined &&
    identity.worktree === canonicalWorktree.worktree &&
    identity.gitDir === canonicalWorktree.gitDir &&
    [
      repository.observe,
      repository.acquire,
      repository.runExclusive,
      repository.runCohort,
      repository.runDeferred,
      effectLedger.snapshot,
      effectLedger.writeAhead,
    ].every((member) => typeof member === 'function')
  );
}

function isUnresolvedEffectEnvelopeList(value: unknown): boolean {
  if (!isExactArray(value)) return false;
  return value.every((envelope) => {
    const boundary = ownDataRecord(envelope, ['kind', 'boundaryId']);
    if (
      boundary?.kind === 'boundary' &&
      typeof boundary.boundaryId === 'string'
    ) {
      return true;
    }
    const logical = ownDataRecord(envelope, ['kind', 'operationId']);
    return (
      logical?.kind === 'logical-operation' &&
      typeof logical.operationId === 'string'
    );
  });
}

function ownDataRecord(
  value: unknown,
  exactKeys?: readonly string[],
): Record<string, unknown> | undefined {
  try {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null)
    ) {
      return undefined;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) return undefined;
    if (
      exactKeys !== undefined &&
      (keys.length !== exactKeys.length ||
        exactKeys.some(
          (key) => !Object.prototype.hasOwnProperty.call(descriptors, key),
        ))
    ) {
      return undefined;
    }
    const out: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
        descriptor.enumerable !== true
      ) {
        return undefined;
      }
      out[key] = descriptor.value;
    }
    return out;
  } catch {
    return undefined;
  }
}

function isExactArray(value: unknown): value is unknown[] {
  try {
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype
    ) {
      return false;
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) return false;
    const expected = [
      ...Array.from({ length: value.length }, (_, index) => String(index)),
      'length',
    ];
    if (
      keys.length !== expected.length ||
      expected.some(
        (key) => !Object.prototype.hasOwnProperty.call(descriptors, key),
      )
    ) {
      return false;
    }
    return expected.slice(0, -1).every((key) => {
      const descriptor = descriptors[key];
      return (
        descriptor !== undefined &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
        descriptor.enumerable === true
      );
    });
  } catch {
    return false;
  }
}

function isPlainJsonValue(
  value: unknown,
  ancestors: Set<object> = new Set(),
): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  ancestors.add(value);
  let valid: boolean;
  if (Array.isArray(value)) {
    valid =
      isExactArray(value) &&
      value.every((member) => isPlainJsonValue(member, ancestors));
  } else {
    const record = ownDataRecord(value);
    valid =
      record !== undefined &&
      Object.values(record).every((member) =>
        isPlainJsonValue(member, ancestors),
      );
  }
  ancestors.delete(value);
  return valid;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((member) => canonicalJson(member)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((member) => cloneJsonValue(member));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, member]) => [
        key,
        cloneJsonValue(member),
      ]),
    );
  }
  return value;
}

function inspectFactorySurface(factory: (options: unknown) => unknown): {
  valid: boolean;
  resumable: boolean;
  findings: string[];
} {
  const findings: string[] = [];
  let runtime: unknown;
  try {
    runtime = factory({});
  } catch (error) {
    return {
      valid: false,
      resumable: false,
      findings: [`createPlaybookRuntime({}) threw: ${messageOf(error)}`],
    };
  }
  if (typeof runtime !== 'object' || runtime === null) {
    return {
      valid: false,
      resumable: false,
      findings: ['createPlaybookRuntime({}) returned a non-object'],
    };
  }
  const surface = runtime as Record<string, unknown>;
  for (const member of ['init', 'handleBossInput', 'dispose']) {
    if (typeof surface[member] !== 'function') {
      findings.push(`runtime lacks ${member}()`);
    }
  }
  if (
    surface.resumePlaybookCall !== undefined &&
    typeof surface.resumePlaybookCall !== 'function'
  ) {
    findings.push('runtime has non-callable resumePlaybookCall');
  }
  return {
    valid: findings.length === 0,
    resumable: typeof surface.resumePlaybookCall === 'function',
    findings,
  };
}

async function probeRuntimeProfile(
  factory: (options: unknown) => unknown,
  profile: RuntimeContractProfile,
): Promise<{ accepted: boolean; reason: string }> {
  let runtime: Record<string, unknown> | undefined;
  let reason = '';
  try {
    const created = factory({});
    if (typeof created !== 'object' || created === null) {
      return { accepted: false, reason: 'factory returned a non-object' };
    }
    runtime = created as Record<string, unknown>;
    const init = callable(runtime.init, 'init');
    const handle = callable(runtime.handleBossInput, 'handleBossInput');
    callable(runtime.dispose, 'dispose');
    const resumable = typeof runtime.resumePlaybookCall === 'function';
    if ((profile === 'composed-v2') !== resumable) {
      return {
        accepted: false,
        reason:
          profile === 'composed-v2'
            ? 'resumePlaybookCall is absent'
            : 'resumePlaybookCall is unexpectedly present',
      };
    }

    const signal = new AbortController().signal;
    await init.call(runtime, probeInitValue(profile));
    const result = await handle.call(runtime, {
      text: 'SLC runtime contract profile probe',
      signal,
    });
    if (profile === 'composed-v2') {
      if (!isPlaybookRunResult(result)) {
        reason = 'turn did not return a valid structured result';
      }
    } else if (result !== undefined) {
      reason = 'void-result profile returned a value';
    }
  } catch (error) {
    reason = messageOf(error);
  } finally {
    if (runtime !== undefined && typeof runtime.dispose === 'function') {
      try {
        await (runtime.dispose as () => Promise<void>).call(runtime);
      } catch (error) {
        if (reason === '') reason = `dispose failed: ${messageOf(error)}`;
      }
    }
  }
  return { accepted: reason === '', reason: reason || 'accepted' };
}

function probeInitValue(profile: RuntimeContractProfile): unknown {
  const ports = probePorts(profile === 'composed-v2');
  if (profile === 'legacy') return ports;
  if (profile === 'session-v1') {
    return { sessionId: 'slc-profile-probe', playbookId: 'probe', ports };
  }
  return {
    sessionId: 'slc-profile-probe',
    playbookId: 'probe',
    rootSessionId: 'slc-profile-probe',
    depth: 0,
    ports,
  };
}

function probePorts(
  composed: boolean,
  onPlayerCall: () => void = () => {},
): Record<string, unknown> {
  return {
    callPlayer: async () => {
      onPlayerCall();
      return {
        status: 'error',
        error: 'profile probe does not invoke players',
      };
    },
    callJudge: async () => '{}',
    ...(composed
      ? {
          callCaptain: async () => ({
            status: 'error',
            error: 'profile probe does not invoke Captain',
          }),
          callPlaybook: async (request: { playbookId?: unknown }) => ({
            state: 'settled',
            result: {
              status: 'error',
              playbookId:
                typeof request.playbookId === 'string'
                  ? request.playbookId
                  : 'probe',
              error: {
                name: 'UnsupportedOperationError',
                message: 'profile probe does not invoke child playbooks',
              },
            },
          }),
        }
      : {}),
    emitStatus: async () => {},
    emitTelemetry: async () => {},
  };
}

function callable(
  value: unknown,
  name: string,
): (...args: unknown[]) => unknown {
  if (typeof value !== 'function') throw new Error(`runtime lacks ${name}()`);
  return value as (...args: unknown[]) => unknown;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRuntimeContractProfile(
  value: unknown,
): value is RuntimeContractProfile {
  return (
    value === 'legacy' ||
    value === 'session-v1' ||
    value === 'composed-v2' ||
    value === 'composed-v3'
  );
}

interface StateSurface {
  id?: string;
  tags?: string | readonly string[];
  on?: Record<string, unknown>;
  states?: Record<string, StateSurface>;
}

/** Accepts the legacy scalar wait or a structured branch-local parked wait. */
export function hasBossReplySurface(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false;
  const states = (config as { states?: unknown }).states;
  if (typeof states !== 'object' || states === null || Array.isArray(states)) {
    return false;
  }

  const visit = (entries: Record<string, StateSurface>): boolean =>
    Object.entries(entries).some(([key, state]) => {
      if (
        key === AWAIT_BOSS_REPLY_STATE ||
        state.id === AWAIT_BOSS_REPLY_STATE
      ) {
        return true;
      }
      const tags =
        typeof state.tags === 'string'
          ? [state.tags]
          : Array.isArray(state.tags)
            ? state.tags
            : [];
      if (
        tags.includes('playbook.parked') &&
        state.on?.[BOSS_REPLY_EVENT] !== undefined
      ) {
        return true;
      }
      return state.states === undefined ? false : visit(state.states);
    });

  return visit(states as Record<string, StateSurface>);
}

/**
 * Normalizes a prompt line for comparison: markdown escaping of angle brackets
 * (`\<coder-llm\>`) is source syntax, not content — a faithful compilation may
 * carry the token either escaped or plain.
 */
export function normalizePromptLine(line: string): string {
  return line.replace(/\\([<>])/g, '$1');
}

/**
 * The verbatim prompt-line sets per player bound in a `gears` artifact.
 *
 * Known limit: sets dedupe, so a compilation that drops one of two items with
 * identical prompts still compares equal here — cross-item duplication counts
 * are partition judgment, and comparing them would flag legitimate variance.
 * Structural completeness is covered by the conformance and coverage checks.
 */
export function playerLineSets(gears: string): Map<string, Set<string>> {
  const sets = new Map<string, Set<string>>();
  const roleContract = inspectGearsRoleContract(gears);
  for (const item of parseGearsItems(gears)) {
    // A nested call is an authored playbook dependency, not a Captain player
    // prompt. Key it by target so changing `code-review` to `security-review`
    // cannot compare equal merely because both behaviors say Captain calls it.
    const participant =
      item.playbookId !== undefined
        ? `playbook:${item.playbookId}`
        : item.playbookIdContext !== undefined
          ? `playbook-context:${item.playbookIdContext}:${item.textContext ?? ''}`
          : item.actor === 'captain'
            ? 'Captain'
            : roleContract.generation === 'schema-3'
              ? `role:${canonicalRoleId(item.player)}`
              : item.player;
    let lines = sets.get(participant);
    if (lines === undefined) {
      lines = new Set();
      sets.set(participant, lines);
    }
    for (const line of item.prompt.split('\n')) {
      if (line.trim() !== '') lines.add(normalizePromptLine(line));
    }
  }
  return sets;
}

/** The blockquoted lines of a free-form workflow source. */
export function sourceBlockquoteLines(sourceText: string): Set<string> {
  const lines = new Set<string>();
  for (const raw of sourceText.split('\n')) {
    const match = /^>\s?(.*)$/.exec(raw);
    if (match !== null && match[1].trim() !== '') {
      lines.add(normalizePromptLine(match[1]));
    }
  }
  return lines;
}

/**
 * Checks a compilation against its free-form source (text2gears faithfulness):
 * every `gears` prompt line is a source blockquote line verbatim, and every
 * source blockquote line survives into the `gears`.
 */
export function checkSourceFaithfulness(
  sourceText: string,
  gears: string,
): string[] {
  const findings: string[] = [];
  const source = sourceBlockquoteLines(sourceText);
  const compiled = new Set<string>();
  for (const lines of playerLineSets(gears).values()) {
    for (const line of lines) compiled.add(line);
  }
  for (const line of compiled) {
    if (!source.has(line)) {
      findings.push(`gears line is not a source blockquote line: "${line}"`);
    }
  }
  for (const line of source) {
    if (!compiled.has(line)) {
      findings.push(`source blockquote line was dropped: "${line}"`);
    }
  }
  return findings;
}

/** Checks one compilation's internal integrity (conformance, surfaces, contract). */
export async function checkPlaybookIntegrity(
  label: string,
  compiled: CompiledPlaybook,
  options: Pick<RuntimeProfileOptions, 'configuredOptions'> = {},
): Promise<string[]> {
  const findings: string[] = [];
  const config = findMachineConfig(compiled.fsm);
  const schemaResolution = compiledSchemaResolution(compiled, config);
  findings.push(
    ...schemaResolution.findings.map((finding) => `${label}: ${finding}`),
  );

  findings.push(
    ...checkGearsFsmConformance(compiled.gears, config, {
      concurrentRoleSets: findConcurrentRoleSets(compiled.fsm),
      artifactSchema: schemaResolution.artifactSchema,
    }).map((finding) => `${label}: ${finding}`),
  );
  findings.push(
    ...(
      await checkFsmCoverage(compiled.fsm, { sourceText: compiled.fsmSource })
    ).map((finding) => `${label}: ${finding}`),
  );

  const runtime =
    schemaResolution.findings.length === 0
      ? await inspectRuntimeProfile(
          compiled.playbook,
          compiledRuntimeOptions(compiled, config, options),
        )
      : { profile: null, findings: [] };
  findings.push(...runtime.findings.map((finding) => `${label}: ${finding}`));

  if (
    runtime.profile === 'composed-v3' &&
    typeof compiled.playbook === 'object' &&
    compiled.playbook !== null
  ) {
    const factory = (compiled.playbook as Record<string, unknown>).default;
    if (typeof factory === 'function') {
      const registry = inspectSchema3Registry(
        compiled.registry,
        factory as (options: unknown) => unknown,
      );
      if (registry.entry !== undefined) {
        findings.push(
          ...schema3ClosureFindings(compiled, registry.entry).map(
            (finding) => `${label}: ${finding}`,
          ),
        );
      }
    }
  }
  return findings;
}

function schema3ClosureFindings(
  compiled: CompiledPlaybook,
  registry: Schema3Registry,
): string[] {
  const findings: string[] = [];
  const source = inspectGearsRoleContract(compiled.gears);
  if (source.generation === 'schema-1') {
    findings.push(
      'composed-v3 registry cannot close over a historical schema-1 Players declaration',
    );
  } else if (
    source.generation === 'unspecified' &&
    (registry.requiredRoleIds.length > 0 ||
      registry.concurrentRoleSets.length > 0)
  ) {
    findings.push(
      'roleless schema-3 source requires empty registry roles and concurrent sets',
    );
  }
  if (
    canonicalJson(source.roleIds) !== canonicalJson(registry.requiredRoleIds)
  ) {
    findings.push(
      `schema-3 registry requiredRoleIds ${canonicalJson(registry.requiredRoleIds)} do not match GEARS roles ${canonicalJson(source.roleIds)}`,
    );
  }
  if (
    canonicalJson(source.concurrentRoleSets) !==
    canonicalJson(registry.concurrentRoleSets)
  ) {
    findings.push(
      `schema-3 registry concurrentRoleSets ${canonicalJson(registry.concurrentRoleSets)} do not match GEARS groups ${canonicalJson(source.concurrentRoleSets)}`,
    );
  }

  const moduleConcurrentRoleSets = schema3ConcurrentRoleSets(
    findConcurrentRoleSets(compiled.fsm),
    registry.requiredRoleIds,
  );
  if (moduleConcurrentRoleSets === undefined) {
    findings.push(
      'schema-3 FSM exports no valid registry-matching concurrentRoleSets array',
    );
  } else if (
    canonicalJson(moduleConcurrentRoleSets) !==
    canonicalJson(registry.concurrentRoleSets)
  ) {
    findings.push(
      `schema-3 registry concurrentRoleSets ${canonicalJson(registry.concurrentRoleSets)} do not match FSM export ${canonicalJson(moduleConcurrentRoleSets)}`,
    );
  }
  return findings;
}

function compiledRuntimeOptions(
  compiled: CompiledPlaybook,
  config: MachineConfigLike,
  options: Pick<RuntimeProfileOptions, 'configuredOptions'>,
): RuntimeProfileOptions {
  return {
    config,
    ...(compiled.linkTargetProvenance === undefined
      ? {}
      : { provenance: compiled.linkTargetProvenance }),
    ...(compiled.runtimeDeclaration === undefined
      ? {}
      : { runtimeDeclaration: compiled.runtimeDeclaration }),
    ...(compiled.registry === undefined ? {} : { registry: compiled.registry }),
    ...(Object.prototype.hasOwnProperty.call(options, 'configuredOptions')
      ? { configuredOptions: options.configuredOptions }
      : {}),
  };
}

function compiledSchemaResolution(
  compiled: CompiledPlaybook,
  config: MachineConfigLike,
): { artifactSchema?: 1 | 3; findings: string[] } {
  const linked =
    typeof compiled.playbook === 'object' && compiled.playbook !== null
      ? (compiled.playbook as { default?: unknown })
      : undefined;
  return resolveArtifactSchemaForVerification({
    ...(compiled.linkTargetProvenance === undefined
      ? {}
      : { provenance: compiled.linkTargetProvenance }),
    ...(compiled.runtimeDeclaration === undefined
      ? {}
      : { runtimeDeclaration: compiled.runtimeDeclaration }),
    config,
    ...(linked === undefined ? {} : { linked }),
  });
}

/**
 * Compares a produced compilation to the reference for equivalence (verification-9):
 * the same player set, the same verbatim per-player prompt-line sets, matching
 * source-item counts per player, and both sides internally sound. State names
 * and item partitions are free choices and are not compared.
 */
export async function checkReferenceEquivalence(opts: {
  produced: CompiledPlaybook;
  reference: CompiledPlaybook;
  configuredOptions?: unknown;
}): Promise<string[]> {
  const findings: string[] = [];
  const comparisonOptions = Object.prototype.hasOwnProperty.call(
    opts,
    'configuredOptions',
  )
    ? { configuredOptions: opts.configuredOptions }
    : {};

  findings.push(
    ...(await checkPlaybookIntegrity(
      'produced',
      opts.produced,
      comparisonOptions,
    )),
  );
  findings.push(
    ...(await checkPlaybookIntegrity(
      'reference',
      opts.reference,
      comparisonOptions,
    )),
  );

  const producedConfig = findMachineConfig(opts.produced.fsm);
  const referenceConfig = findMachineConfig(opts.reference.fsm);
  const [producedRuntime, referenceRuntime] = await Promise.all([
    inspectRuntimeProfile(
      opts.produced.playbook,
      compiledRuntimeOptions(opts.produced, producedConfig, comparisonOptions),
    ),
    inspectRuntimeProfile(
      opts.reference.playbook,
      compiledRuntimeOptions(
        opts.reference,
        referenceConfig,
        comparisonOptions,
      ),
    ),
  ]);
  const producedProfile = producedRuntime.profile;
  const referenceProfile = referenceRuntime.profile;
  if (producedProfile !== referenceProfile) {
    findings.push(
      `runtime contract profiles differ: produced ${producedProfile ?? 'unrecognized'} vs reference ${referenceProfile ?? 'unrecognized'}`,
    );
  }
  if (producedProfile === 'composed-v3' && referenceProfile === 'composed-v3') {
    if (producedRuntime.implementation !== referenceRuntime.implementation) {
      findings.push(
        `schema-3 runtime implementations differ: produced ${producedRuntime.implementation} vs reference ${referenceRuntime.implementation}`,
      );
    }
    if (
      canonicalJson(producedRuntime.validatedOptions) !==
      canonicalJson(referenceRuntime.validatedOptions)
    ) {
      findings.push(
        `schema-3 validated options differ: produced ${canonicalJson(producedRuntime.validatedOptions)} vs reference ${canonicalJson(referenceRuntime.validatedOptions)}`,
      );
    }
  }

  const produced = playerLineSets(opts.produced.gears);
  const reference = playerLineSets(opts.reference.gears);
  const producedRoles = inspectGearsRoleContract(opts.produced.gears);
  const referenceRoles = inspectGearsRoleContract(opts.reference.gears);
  if (producedRoles.generation !== referenceRoles.generation) {
    findings.push(
      `source contract generations differ: produced ${producedRoles.generation} vs reference ${referenceRoles.generation}`,
    );
  } else if (
    producedRoles.generation === 'schema-3' &&
    (canonicalJson(producedRoles.roleIds) !==
      canonicalJson(referenceRoles.roleIds) ||
      canonicalJson(producedRoles.concurrentRoleSets) !==
        canonicalJson(referenceRoles.concurrentRoleSets))
  ) {
    findings.push(
      `schema-3 role contracts differ: produced ${canonicalJson({ roles: producedRoles.roleIds, concurrentRoleSets: producedRoles.concurrentRoleSets })} vs reference ${canonicalJson({ roles: referenceRoles.roleIds, concurrentRoleSets: referenceRoles.concurrentRoleSets })}`,
    );
  }
  const producedPlayers = [...produced.keys()].sort();
  const referencePlayers = [...reference.keys()].sort();
  if (producedPlayers.join(',') !== referencePlayers.join(',')) {
    findings.push(
      `player sets differ: produced [${producedPlayers.join(', ')}] vs reference [${referencePlayers.join(', ')}]`,
    );
  }

  for (const player of referencePlayers) {
    const producedLines = produced.get(player) ?? new Set();
    const referenceLines = reference.get(player) ?? new Set();
    for (const line of referenceLines) {
      if (!producedLines.has(line)) {
        findings.push(`${player}: produced gears lacks the line "${line}"`);
      }
    }
    for (const line of producedLines) {
      if (!referenceLines.has(line)) {
        findings.push(`${player}: produced gears adds the line "${line}"`);
      }
    }
  }

  const producedController = isControllerMachine(producedConfig);
  const referenceController = isControllerMachine(referenceConfig);
  const producedControllerCandidate =
    producedController || hasControllerDecisionNearMiss(producedConfig);
  const referenceControllerCandidate =
    referenceController || hasControllerDecisionNearMiss(referenceConfig);
  if (producedController !== referenceController) {
    findings.push(
      `controller classifications differ: produced ${producedController ? 'controller' : 'ordinary'} vs reference ${referenceController ? 'controller' : 'ordinary'}`,
    );
  }

  // The Boss surfaces must exist on both machines (pinIntrospection reports
  // them); captain-state counts are reported only through conformance, since
  // partitions are judgment.
  for (const [label, config, controller, controllerCandidate] of [
    [
      'produced',
      producedConfig,
      producedController,
      producedControllerCandidate,
    ],
    [
      'reference',
      referenceConfig,
      referenceController,
      referenceControllerCandidate,
    ],
  ] as const) {
    const pins = pinIntrospection(config);
    if (!controllerCandidate && pins.interruptTargets.length === 0) {
      findings.push(`${label}: machine declares no BOSS_INTERRUPT targets`);
    }
    if (!pins.quiescent.some((state) => state.final)) {
      findings.push(`${label}: machine declares no final state`);
    }
    const hasBossWait = hasBossReplySurface(config);
    if (controller && hasBossWait) {
      findings.push(`${label}: controller machine declares a Boss-reply wait`);
    } else if (!controllerCandidate && !hasBossWait) {
      findings.push(`${label}: machine declares no Boss-reply wait state`);
    }
  }

  return findings;
}
