// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Deterministic entry-module emission (DR-014, DR-017, SELFHOST-15).
 *
 * After a successful full-link of the `playbook` pipeline, {@link
 * emitEntryModule} writes `<cwd>/<basename>.ts`: an erasable-TypeScript module
 * default-exporting a Playbook registry entry derived entirely from the
 * compiled bundle — `id`/`command` from the basename, `requiredRoleIds` from
 * the gears `Players:` declaration, `intent` from the normalized source's
 * title and lead line, an option allowlist carrying `cwd` exactly when the
 * source compiled a script item, and `createRuntime` wiring the linked default
 * factory behind the DR-017 role-binding boundary, which maps the linked
 * runtime's lowercased player ids back to the declared role ids at the
 * session's `callPlayer` port. `playbook run ./<basename>.ts "<task>"`
 * consumes it unchanged (SELFHOST-14). See specs/dev/self-hosting.md.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseGearsItems } from './verify.js';

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
  const players = declaredPlayers(gears);
  // The role-binding boundary keys declared ids by their lowercased form; a
  // case-insensitive collision would make the binding ambiguous (DR-017).
  const byLowered = new Map<string, string>();
  for (const player of players) {
    const existing = byLowered.get(player.toLowerCase());
    if (existing !== undefined && existing !== player) {
      throw new Error(
        `entry emission failed: declared players "${existing}" and "${player}" collide case-insensitively`,
      );
    }
    byLowered.set(player.toLowerCase(), player);
  }
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
      players,
      hasScript,
      intent,
    }),
    'utf8',
  );
  return path;
}

/**
 * The gears `Players:` declaration, verbatim in source order (SELFHOST-15).
 * Alias declarations (`` `A` = `B` | `C` ``) are launcher options, not
 * required roles, and are excluded.
 */
export function declaredPlayers(gears: string): string[] {
  const players: string[] = [];
  let inBlock = false;
  for (const line of gears.split('\n')) {
    if (/^Players:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    const bullet = /^-\s+(.*)$/.exec(line.trim());
    if (bullet === null) {
      if (line.trim() === '') continue;
      break;
    }
    const declaration = bullet[1];
    if (declaration.includes('=')) continue;
    const name = /^[`"“]?([^`"”]+?)[`"”]?\s*$/.exec(declaration.trim());
    if (name !== null && name[1].length > 0) players.push(name[1]);
  }
  return players;
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
  players: readonly string[];
  hasScript: boolean;
  intent: string;
}): string {
  const allowed = spec.hasScript ? `['cwd']` : `[]`;
  const cwdWiring = spec.hasScript
    ? `{\n      ...validated,\n      cwd: validated.cwd ?? process.cwd(),\n    }`
    : `validated`;
  return `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
//
// Generated by slc (DR-014): the registry entry exposing the compiled
// playbook to \`playbook run\`. Derived deterministically from the compiled
// bundle; recompiling regenerates it. The role-binding boundary (DR-017)
// hands the host's \`callPlayer\` port only declared role ids.

import createPlaybookRuntime from './${spec.bundleLeaf}/${spec.basename}.playbook.ts';

type RuntimeOptions = NonNullable<Parameters<typeof createPlaybookRuntime>[0]>;

const ALLOWED_OPTION_KEYS: readonly string[] = ${allowed};

const REQUIRED_ROLE_IDS: readonly string[] = [${spec.players.map(sourceString).join(', ')}];

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
  intent: ${sourceString(spec.intent)},
  requiredRoleIds: [...REQUIRED_ROLE_IDS],
  validateOptions,
  createRuntime(options: { captainOptions?: unknown }) {
    const validated = validateOptions(options.captainOptions);
    return withRoleBinding(createPlaybookRuntime(${cwdWiring}));
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
