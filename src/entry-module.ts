// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Deterministic entry-module emission (DR-014, DR-017, DR-024,
 * self-hosting-15).
 *
 * After a successful full-link of the `playbook` pipeline, {@link
 * emitEntryModule} writes `<cwd>/<basename>.ts`: an erasable-TypeScript module
 * default-exporting a Playbook registry entry derived entirely from the
 * compiled bundle — `id`/`command` from the basename, `requiredRoleIds` from
 * the gears `Roles:`/`Players:` declaration, `intent` from the normalized
 * source's title and lead line, an option allowlist carrying `cwd` exactly
 * when the source compiled a script item, and `createRuntime` wiring the
 * linked default factory. A current `Roles:` source declares the canonical
 * lowercase local role ids its compiled machine's delegated states name, so
 * the host binds exactly those ids and the session's `callPlayer` port needs
 * no translation (DR-024); a historical `Players:` source keeps its verbatim
 * declared names behind the DR-017 role-binding boundary, which maps the
 * linked runtime's lowercased player ids back to them. Its generation's host
 * consumes the module unchanged (self-hosting-14). See
 * specs/packages/self-hosting.md.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { inspectGearsRoleContract, parseGearsItems } from './verify.js';

/** Options for {@link emitEntryModule}. */
export interface EmitEntryModuleOptions {
  /** Invocation working directory the module is written into (DR-014). */
  cwd: string;
  /** The DR-001 basename naming the entry module and the bundle. */
  basename: string;
  /** Pipeline reference forming the bundle directory leaf `<basename>.<pipeline>`. */
  pipeline: string;
  /** The optimized gears artifact: players and script items. */
  gearsPath: string;
  /** The normalized (or entry-form) text source: title and lead line. */
  textPath: string;
}

/** Emits the entry module and returns its path. */
export async function emitEntryModule(
  opts: EmitEntryModuleOptions,
): Promise<string> {
  const gears = await readFile(opts.gearsPath, 'utf8');
  const text = await readFile(opts.textPath, 'utf8');
  // One derivation serves both generations: the declared names, verbatim in
  // source order, and the canonical lowercase local role ids the compiled
  // machine's delegated states carry. A `Roles:` source compiles to a schema-3
  // artifact whose linked factory takes configured options plus live host
  // capabilities; a `Players:` source keeps the schema-1 entry contract
  // (DR-024).
  const roleContract = inspectGearsRoleContract(gears);
  const schema3 = roleContract.generation === 'schema-3';
  // Two declared names differing only by case derive one canonical role id, so
  // neither the schema-3 host binding nor the schema-1 role-binding boundary
  // could tell them apart (DR-017, DR-024).
  const byRoleId = new Map<string, string>();
  roleContract.names.forEach((name, index) => {
    const roleId = roleContract.roleIds[index];
    const existing = byRoleId.get(roleId);
    if (existing !== undefined && existing !== name) {
      throw new Error(
        `entry emission failed: declared players "${existing}" and "${name}" collide case-insensitively`,
      );
    }
    byRoleId.set(roleId, name);
  });
  const hasScript = parseGearsItems(gears).some(
    (item) => item.actor === 'script',
  );
  const intent = deriveIntent(text) ?? opts.basename;
  const path = join(opts.cwd, `${opts.basename}.ts`);
  await writeFile(
    path,
    renderEntryModule({
      basename: opts.basename,
      bundleLeaf: `${opts.basename}.${opts.pipeline}`,
      roleIds: schema3 ? roleContract.roleIds : roleContract.names,
      hasScript,
      intent,
      schema3,
      concurrentRoleSets: schema3 ? roleContract.concurrentRoleSets : [],
    }),
    'utf8',
  );
  return path;
}

/** Title and lead line of the normalized source, joined as the intent. */
function deriveIntent(text: string): string | undefined {
  let title: string | undefined;
  let lead: string | undefined;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('<!--')) continue;
    if (title === undefined) {
      const heading = /^#\s+(.*)$/.exec(trimmed);
      if (heading !== null) {
        title = heading[1].trim();
        continue;
      }
    }
    if (
      trimmed.startsWith('#') ||
      trimmed.startsWith('-') ||
      /^Players:\s*$/.test(trimmed)
    ) {
      continue;
    }
    lead = trimmed;
    break;
  }
  if (title !== undefined && lead !== undefined) return `${title} — ${lead}`;
  return title ?? lead;
}

function renderEntryModule(spec: {
  basename: string;
  bundleLeaf: string;
  roleIds: readonly string[];
  hasScript: boolean;
  intent: string;
  schema3: boolean;
  concurrentRoleSets: readonly (readonly string[])[];
}): string {
  const allowed = spec.hasScript ? `['cwd']` : `[]`;
  const cwdWiring = spec.hasScript
    ? `{\n      ...validated,\n      cwd: validated.cwd ?? process.cwd(),\n    }`
    : `validated`;
  // A schema-3 linked factory takes exactly `configuredOptions` and live
  // `hostCapabilities`; a schema-1 factory keeps its single options argument
  // under its own historical dependency closure (DR-024).
  // Both aliases come from the artifact's own factory signature, so the entry
  // imports no host-owned type: a schema-3 input carries `configuredOptions`
  // and `hostCapabilities`, a schema-1 input is the options object itself.
  const runtimeOptionsAlias = spec.schema3
    ? `type RuntimeOptions = FactoryInput['configuredOptions'];\ntype HostCapabilities = FactoryInput['hostCapabilities'];`
    : `type RuntimeOptions = FactoryInput;`;
  const schema3Param = spec.schema3
    ? `,\n    hostCapabilities: HostCapabilities`
    : '';
  const factoryArgument = spec.schema3
    ? `{\n      configuredOptions: ${cwdWiring},\n      hostCapabilities,\n    }`
    : cwdWiring;
  // The manifest's `runtimeProfile` is the host's implementation declaration,
  // not slc's internal contract marker: a shared-factory artifact declares
  // `{ kind: 'shared-factory', compat }` whose `compat` is the very immutable
  // record the linked factory captured from its validated `spec.compat` — the
  // artifact's own `{ artifactSchema, runtimeAbi }` declaration — so the host
  // reads the emitted module's compatibility rather than a marker string it
  // cannot interpret (DR-024, DR-028).
  const schemaMembers = spec.schema3
    ? `\n  artifactSchema: 3,\n  runtimeProfile: Object.freeze({\n    kind: 'shared-factory',\n    compat: createPlaybookRuntime.compat,\n  }),\n  concurrentRoleSets: ${JSON.stringify(
        spec.concurrentRoleSets,
      )} as readonly (readonly string[])[],`
    : '';
  // A schema-3 entry declares the very ids the machine's delegated states
  // name, so the host's `callPlayer` port needs no translation and the entry
  // returns the linked factory's runtime directly (DR-024). Only a historical
  // schema-1 entry keeps the DR-017 role-binding boundary, which maps the
  // runtime's lowercased player ids back to the verbatim declared names.
  const roleBinding = spec.schema3
    ? ''
    : `
const ROLE_ID_BY_RESOLVED: ReadonlyMap<string, string> = new Map(
  REQUIRED_ROLE_IDS.map((id): [string, string] => [id.toLowerCase(), id]),
);

function bindRoleIds(session: unknown): unknown {
  if (typeof session !== 'object' || session === null) return session;
  const ports = (session as { ports?: unknown }).ports;
  if (typeof ports !== 'object' || ports === null) return session;
  const callPlayer = (ports as Record<string, unknown>).callPlayer;
  if (typeof callPlayer !== 'function') return session;
  return {
    ...session,
    ports: {
      ...(ports as Record<string, unknown>),
      callPlayer: (playerId: unknown, ...rest: unknown[]) =>
        (callPlayer as (...args: unknown[]) => unknown).call(
          ports,
          typeof playerId === 'string'
            ? (ROLE_ID_BY_RESOLVED.get(playerId) ?? playerId)
            : playerId,
          ...rest,
        ),
    },
  };
}

function withRoleBinding<T extends object>(runtime: T): T {
  return new Proxy(runtime, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        (property === 'init' || property === 'restore') &&
        typeof value === 'function'
      ) {
        return (session: unknown, ...rest: unknown[]) =>
          (value as (...args: unknown[]) => unknown).call(
            target,
            bindRoleIds(session),
            ...rest,
          );
      }
      return value;
    },
  });
}
`;
  const runtimeExpression = spec.schema3
    ? `createPlaybookRuntime(${factoryArgument})`
    : `withRoleBinding(createPlaybookRuntime(${factoryArgument}))`;
  const roleNote = spec.schema3
    ? `// bundle; recompiling regenerates it. \`requiredRoleIds\` are the canonical
// lowercase local role ids the compiled machine's delegated states name
// (DR-024).`
    : `// bundle; recompiling regenerates it. The role-binding boundary (DR-017)
// hands the host's \`callPlayer\` port only declared role ids.`;
  return `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
//
// Generated by slc (DR-014): the registry entry exposing the compiled
// playbook to \`playbook run\`. Derived deterministically from the compiled
${roleNote}

import createPlaybookRuntime from './${spec.bundleLeaf}/${spec.basename}.playbook.ts';

type FactoryInput = NonNullable<Parameters<typeof createPlaybookRuntime>[0]>;
${runtimeOptionsAlias}

const ALLOWED_OPTION_KEYS: readonly string[] = ${allowed};

const REQUIRED_ROLE_IDS: readonly string[] = [${spec.roleIds.map(sourceString).join(', ')}];
${roleBinding}
function validateOptions(value: unknown): RuntimeOptions {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('playbook options must be an object');
  }
  const options: Record<string, string> = {};
  for (const [key, option] of Object.entries(value)) {
    if (!ALLOWED_OPTION_KEYS.includes(key)) {
      throw new Error(
        \`unknown option "\${key}" (allowed: \${ALLOWED_OPTION_KEYS.join(', ') || 'none'})\`,
      );
    }
    if (typeof option !== 'string' || option === '') {
      throw new Error(\`option "\${key}" must be a non-empty string\`);
    }
    options[key] = option;
  }
  return options as RuntimeOptions;
}

const entry = {
  id: ${sourceString(spec.basename)},
  command: ${sourceString(spec.basename)},
  intent: ${sourceString(spec.intent)},${schemaMembers}
  requiredRoleIds: [...REQUIRED_ROLE_IDS],
  validateOptions,
  createRuntime(options: { captainOptions?: unknown }${schema3Param}) {
    const validated = validateOptions(options.captainOptions);
    return ${runtimeExpression};
  },
};

export default entry;
`;
}

function sourceString(value: string): string {
  // Single-quoted source form (the repo's prettier style), derived from the
  // JSON escape so control characters stay escaped.
  const json = JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const inner = json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'");
  return `'${inner}'`;
}
