// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emitEntryModule } from '../src/entry-module.js';
import { checkEntryOptions } from '../src/entry-options.js';
import { loadFsmModule } from '../src/verify.js';
import { checkFsmTypeScript } from '../src/verify-typescript.js';

const linked = `
export interface Options { readonly catalog: readonly {readonly id: string}[]; readonly enabled?: boolean; readonly count?: number; readonly cwd?: string; }
export function validateOptions(value: unknown): Options {
  if (value === undefined) value = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('object required');
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some(key => !['catalog','enabled','count','cwd'].includes(key))) throw new TypeError('unknown option');
  if (!Array.isArray(fields.catalog) || !fields.catalog.every(member => member !== null && typeof member === 'object' && Object.keys(member).length === 1 && typeof member.id === 'string')) throw new TypeError('catalog required');
  if (fields.enabled !== undefined && typeof fields.enabled !== 'boolean') throw new TypeError('enabled');
  if (fields.count !== undefined && (typeof fields.count !== 'number' || !Number.isFinite(fields.count))) throw new TypeError('count');
  if (fields.cwd !== undefined && typeof fields.cwd !== 'string') throw new TypeError('cwd');
  return Object.freeze({catalog: Object.freeze(fields.catalog.map(({id}) => Object.freeze({id}))), ...(fields.enabled === undefined ? {} : {enabled: fields.enabled}), ...(fields.count === undefined ? {} : {count: fields.count}), ...(fields.cwd === undefined ? {} : {cwd: fields.cwd})});
}
export const calls: unknown[] = [];
const spec = { snapshotOptions: validateOptions };
const factory = Object.assign((input: {configuredOptions: Options; hostCapabilities: {readonly token: object}}) => { calls.push(input); return {input, spec}; }, {compat: Object.freeze({artifactSchema: 3, runtimeAbi: 1})});
export default factory;
`;

describe('artifact-owned entry option integration (self-hosting-19)', () => {
  let dir: string;
  let linkedPath: string;
  let fsmPath: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-option-integration-'));
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await mkdir(join(dir, 'flow.playbook'));
    linkedPath = join(dir, 'flow.playbook', 'flow.playbook.ts');
    fsmPath = join(dir, 'flow.playbook', 'flow.fsm.ts');
    await writeFile(linkedPath, linked);
    await writeFile(
      join(dir, 'flow.gears.md'),
      'Roles:\n\n- Worker\n\n## Behaviors\n\n### FLOW-1\n\nCaptain shall run:\n> true\n',
    );
    await writeFile(join(dir, 'flow.text.md'), '# Flow\n\nPerform work.\n');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('strictly delegates required structured and optional primitive options without construction or host seams', async () => {
    expect(await checkEntryOptions({ linkedPath, fsmPath })).toEqual([]);
    const path = await emitEntryModule({
      cwd: dir,
      basename: 'flow',
      pipeline: 'playbook',
      gearsPath: join(dir, 'flow.gears.md'),
      textPath: join(dir, 'flow.text.md'),
    });
    expect(await checkFsmTypeScript(path)).toEqual([]);
    const module = (await loadFsmModule(linkedPath)) as {
      calls: unknown[];
      validateOptions: (value: unknown) => unknown;
    };
    const { default: entry } = (await loadFsmModule(path)) as {
      default: {
        validateOptions: typeof module.validateOptions;
        createRuntime: (
          input: { captainOptions: unknown },
          host: { token: object },
        ) => {
          input: { configuredOptions: unknown; hostCapabilities: unknown };
          spec: { snapshotOptions: unknown };
        };
      };
    };
    const original = { catalog: [{ id: 'review' }], enabled: false, count: 0 };
    const snapshot = entry.validateOptions(original) as typeof original;
    expect(module.calls).toEqual([]);
    expect(snapshot).toEqual(original);
    expect(snapshot).not.toBe(original);
    expect(Object.isFrozen(snapshot.catalog[0])).toBe(true);
    for (const invalid of [
      undefined,
      {},
      null,
      [],
      'x',
      { catalog: [], extra: 1 },
      { catalog: [], count: Infinity },
    ])
      expect(() => entry.validateOptions(invalid)).toThrow();
    const host = { token: {} };
    const runtime = entry.createRuntime({ captainOptions: original }, host);
    expect(runtime.input.configuredOptions).toEqual(original);
    expect(runtime.input.configuredOptions).not.toHaveProperty('cwd');
    expect(runtime.input.hostCapabilities).toBe(host);
    expect(runtime.spec.snapshotOptions).toBe(entry.validateOptions);
    expect(await readFile(path, 'utf8')).not.toContain(' as RuntimeOptions');
  });

  it('checks a package-less linked/FSM pair without changing either source or relative type resolution', async () => {
    await rm(join(dir, 'package.json'));
    const declaration = linked.match(/export interface Options[^\n]+/)![0];
    await writeFile(fsmPath, declaration + '\n');
    const source = linked.replace(
      declaration,
      "import type {Options} from './flow.fsm.ts';",
    );
    await writeFile(linkedPath, source);
    expect(await checkEntryOptions({ linkedPath, fsmPath })).toEqual([]);
    expect(await readFile(linkedPath, 'utf8')).toBe(source);
    expect(await readFile(fsmPath, 'utf8')).toBe(declaration + '\n');
  });

  it.each([
    [
      'missing',
      linked.replace(
        'export function validateOptions',
        'function validateOptions',
      ),
      'export public validateOptions',
    ],
    [
      'non-callable',
      linked
        .replace('export function validateOptions', 'function snapshotOptions')
        .replace('snapshotOptions: validateOptions', 'snapshotOptions')
        .concat('\nexport const validateOptions = 1;'),
      'must be a function',
    ],
    [
      'sparse array with named replacement',
      linked
        .replace('export function validateOptions', 'function snapshotOptions')
        .replace('snapshotOptions: validateOptions', 'snapshotOptions')
        .concat(
          "\nexport function validateOptions(_value: unknown): Options { const array: unknown[] = []; array.length = 1; Object.defineProperty(array, 'extra', {value: 1, enumerable: true}); return {catalog: array} as unknown as Options; }",
        ),
      'plain JSON option record',
    ],
    [
      'asynchronous',
      linked.replace(
        'export function validateOptions(value: unknown): Options',
        'export async function validateOptions(value: unknown): Promise<Options>',
      ),
      'synchronously return',
    ],
    [
      'invalid result',
      linked
        .replace('export function validateOptions', 'function snapshotOptions')
        .replace('snapshotOptions: validateOptions', 'snapshotOptions')
        .concat(
          '\nexport function validateOptions(_value: unknown) { return "wrong"; }',
        ),
      'plain JSON option record',
    ],
  ])(
    'rejects %s surfaces without constructing a runtime',
    async (_name, source, diagnostic) => {
      await writeFile(linkedPath, source);
      const findings = await checkEntryOptions({ linkedPath, fsmPath });
      expect(findings.join('\n')).toContain(diagnostic);
    },
  );
});
