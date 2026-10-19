// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  capturePromptContract,
  checkLinkedModuleContract,
  emitPromptContractTest,
  loadFsmModule,
  loadLinkedModuleForVerification,
} from '../src/verify.js';
import { emitVerifierSupport } from '../src/verify-support.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const roots: string[] = [];
const kinds = ['emptyArray', 'populatedArray', 'plainRecord'] as const;
type Kind = (typeof kinds)[number];
type FixtureModule = {
  machine: { config: Parameters<typeof capturePromptContract>[0] };
  facts: Record<Kind, unknown>;
  context: Record<string, unknown>;
  inputFor: (
    kind: Kind,
    context: Record<string, unknown>,
  ) => Record<string, unknown>;
  unusedReads: () => number;
  accessorReads: () => number;
  initialProbeTypes: () => readonly string[];
};
type LinkedModule = {
  _internal: {
    composePlayerPrompt: (
      input: Record<string, unknown>,
      lookup: (role: string) => string,
      resuming?: boolean,
    ) => string;
  };
};

// Independent expected bytes, not obtained from the encoder or checker.
const goldens: Record<Kind, string> = {
  emptyArray: '[]',
  populatedArray: String.raw`[{"a":"first","z":"last"},["quote\"",7]]`,
  plainRecord: String.raw`{"2":"two","10":"ten","a":{"b":true,"q":"line\n\"\\"},"z":[3,1]}`,
};
const body = (encoded: string) =>
  `Identity: Analyst identity\nFirst:\n> ${encoded}\nAgain:\n> ${encoded}\nNote:\n> line $& <facts>\n> last\nEnd.`;
const preamble = 'Continue the same task using Boss’s reply below.';

const fsmSource = String.raw`
import { createMachine } from 'xstate';
export const facts = Object.freeze({
  emptyArray: Object.freeze([]),
  populatedArray: Object.freeze([
    Object.freeze({ a: 'first', z: 'last' }), Object.freeze(['quote"', 7]),
  ]),
  plainRecord: Object.freeze({
    '2': 'two', '10': 'ten',
    a: Object.freeze({ b: true, q: 'line\n"\\' }), z: Object.freeze([3, 1]),
  }),
});
let reads = 0;
let accesses = 0;
const inputFault = '';
export const accessorReads = () => accesses;
const initialTypes = [];
export const initialProbeTypes = () => [...initialTypes];
const unused = Object.freeze(Object.defineProperty({}, 'toJSON', {
  enumerable: true, get() { reads++; throw Error('Unused JSON hook executed'); },
}));
export const unusedReads = () => reads;
const initialShape = {
  ...facts,
  emptyArrayAlias: facts.emptyArray,
  populatedArrayAlias: facts.populatedArray,
  plainRecordAlias: facts.plainRecord,
  rawNote: 'line $& <facts>\nlast', unused,
};
if (inputFault.startsWith('initial-')) {
  const required = inputFault.endsWith('-required');
  Object.defineProperty(initialShape, required ? 'emptyArray' : 'ignoredInitial', {
    enumerable: true, configurable: false, get() { accesses++; return required ? facts.emptyArray : 'Must not be read'; },
  });
}
export const context = Object.freeze(initialShape);
const prompt = 'Identity: <identity>\nFirst:\n> <facts>\nAgain:\n> <facts>\nNote:\n> <raw-note>\nEnd.';
export function inputFor(stateId, current) {
  const payload = current[stateId];
  if (inputFault.startsWith('initial-') && stateId === 'emptyArray') initialTypes.push(typeof payload);
  if (stateId === 'plainRecord') {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)
        || Object.getPrototypeOf(payload) !== Object.prototype) throw Error('Record shape changed');
  } else if (!Array.isArray(payload)) throw Error('Array shape changed');
  if (payload !== current[stateId + 'Alias']) throw Error('Context alias changed');
  const input = {
    stateId, sourceItem: 'FACTS-' + stateId, role: 'analyst', prompt,
    result: { done: 'Finished.', needsBossReply: 'Output shall include question: ...' },
    payload, payloadAlias: current[stateId + 'Alias'], rawNote: current.rawNote,
    unused: current.unused,
    ...(current.pendingBossQuestion && current.bossReply
      ? { pendingBossQuestion: current.pendingBossQuestion, bossReply: current.bossReply } : {}),
  };
  if (inputFault === 'unused-accessor') Object.defineProperty(input, 'ignored', { enumerable: true, get() { accesses++; return 'Ignored'; } });
  if (inputFault === 'required-accessor') Object.defineProperty(input, 'payload', { enumerable: true, get() { accesses++; return payload; } });
  return input;
}
export const machine = createMachine({
  id: 'typed-json', initial: 'ready',
  context: inputFault.startsWith('initial-factory-') ? () => context : context,
  states: {
    ready: { id: 'ready', meta: { playbook: { stateId: 'ready' } }, tags: 'playbook.parked' },
    ...Object.fromEntries(Object.keys(facts).map(stateId => [stateId, {
      id: stateId, meta: { playbook: { stateId, role: 'analyst' } }, tags: 'playbook.busy',
      invoke: { src: 'player', input: ({ context }) => inputFor(stateId, context),
        onDone: 'done', onError: 'failed' },
    }])),
    done: { id: 'done', meta: { playbook: { stateId: 'done' } }, type: 'final' },
    failed: { id: 'failed', meta: { playbook: { stateId: 'failed' } }, tags: 'playbook.parked' },
  },
});
`;

function linkedSource(fault: string) {
  return String.raw`
import { composePlayerContinuation, snapshotJsonValue } from '@sublang/playbook/xstate-runtime';
const fault = ${JSON.stringify(fault)};
export const _internal = {
  composePlayerPrompt(input, lookup, resuming) {
    if (fault === 'required-accessor') {
      const descriptor = Object.getOwnPropertyDescriptor(input, 'payload');
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('Required accessor unsupported');
    }
    if (input.payload !== input.payloadAlias) throw Error('Input alias changed');
    const identity = lookup(fault === 'identity' ? 'undeclared-role' : input.role);
    const payload = snapshotJsonValue(fault === 'unsafe-required' ? input.unused : input.payload);
    let encoded = JSON.stringify(payload, null, fault === 'noncanonical' ? 2 : undefined);
    if (fault === 'malformed-json') encoded += ']';
    if (fault === 'wrong-json') encoded = 'null';
    if (fault === 'empty-omission' && Array.isArray(input.payload) && input.payload.length === 0) encoded = '';
    let slot = 0;
    let text = input.prompt.replace(/<identity>|<facts>|<raw-note>/g, token => {
      if (token === '<identity>') return identity;
      if (token === '<raw-note>') return fault === 'quote' ? input.rawNote : input.rawNote.replace(/\n/g, '\n> ');
      return fault === 'repeated-json' && slot++ > 0 ? 'null' : encoded;
    });
    if (fault === 'body') text = text.replace('End.', 'Changed.');
    if (fault === 'order') text = text.replace('First:', 'Later:').replace('Again:', 'First:').replace('Later:', 'Again:');
    const carried = fault === 'continuation' ? { ...input, bossReply: undefined } : input;
    return composePlayerContinuation(carried, text, resuming);
  },
};
function factory() { throw Error('Contract inspection must not construct a runtime'); }
Object.defineProperty(factory, 'compat', {
  value: Object.freeze({ artifactSchema: 3, runtimeAbi: 1 }),
  enumerable: true, writable: false, configurable: false,
});
export default factory;
`;
}

async function materialize(fsmText: string, linkedText: string) {
  const root = await mkdtemp(join(tmpdir(), 'slc-typed-json-prompt-'));
  roots.push(root);
  await symlink(join(repo, 'node_modules'), join(root, 'node_modules'));
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'typed.fsm.ts'), fsmText);
  await writeFile(join(root, 'typed.playbook.ts'), linkedText);
  const paths = {
    linkedPath: join(root, 'typed.playbook.ts'),
    fsmPath: join(root, 'typed.fsm.ts'),
  };
  const fsm = await loadFsmModule(paths.fsmPath);
  const linked = await loadLinkedModuleForVerification(paths);
  return { root, paths, fsm, linked };
}

function fsmSourceFor(fault: string) {
  return fsmSource.replace(
    "const inputFault = '';",
    'const inputFault = ' + JSON.stringify(fault) + ';',
  );
}

async function fixture(fault = '') {
  const result = await materialize(fsmSourceFor(fault), linkedSource(fault));
  return {
    ...result,
    fsm: result.fsm as FixtureModule,
    linked: result.linked as LinkedModule,
  };
}

function numericSources(lowFirst: boolean) {
  const fields = lowFirst
    ? 'low: context.low, high: context.high'
    : 'high: context.high, low: context.low';
  return {
    fsm: `import { createMachine } from 'xstate';
      export const context = Object.freeze({ low: 1, high: 10 });
      export const machine = createMachine({ initial: 'ready', context, states: {
        ready: { id: 'ready', meta: { playbook: { stateId: 'ready' } } },
        numbers: { id: 'numbers', meta: { playbook: { stateId: 'numbers', role: 'analyst' } },
          invoke: { src: 'player', input: ({ context }) => ({
            stateId: 'numbers', sourceItem: 'NUMBERS-1', role: 'analyst',
            prompt: 'Values: <left><right>.',
            result: { done: 'Finished.', needsBossReply: 'Output shall include question: ...' },
            ${fields},
            ...(context.pendingBossQuestion && context.bossReply
              ? { pendingBossQuestion: context.pendingBossQuestion, bossReply: context.bossReply } : {}),
          }) },
        },
      }});`,
    linked: String.raw`
      import { composePlayerContinuation } from '@sublang/playbook/xstate-runtime';
      export const _internal = { composePlayerPrompt(input, _lookup, resuming) {
        if (typeof input.high !== 'number' || typeof input.low !== 'number') throw Error('Numeric shape changed');
        const text = input.prompt.replace(/<left>|<right>/g, token => JSON.stringify(token === '<left>' ? input.high : input.low));
        return composePlayerContinuation(input, text, resuming);
      }};
      function factory() { throw Error('Must not construct'); }
      Object.defineProperty(factory, 'compat', { value: Object.freeze({ artifactSchema: 3, runtimeAbi: 1 }), enumerable: true });
      export default factory;
    `,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('typed JSON prompt fidelity through public artifact boundaries', () => {
  it('accepts fixed JSON bytes without changing types, aliases, readonly inputs or unused hooks', async () => {
    const { paths, fsm, linked } = await fixture();
    const before = JSON.stringify(fsm.facts);
    for (const kind of kinds) {
      expect(JSON.parse(goldens[kind])).toEqual(fsm.facts[kind]);
      expect(Object.isFrozen(fsm.facts[kind])).toBe(true);
      const ordinary = fsm.inputFor(kind, fsm.context);
      for (const resuming of [undefined, false, true]) {
        expect(
          linked._internal.composePlayerPrompt(
            ordinary,
            () => 'Analyst identity',
            resuming,
          ),
        ).toBe(body(goldens[kind]));
        const continuation = fsm.inputFor(kind, {
          ...fsm.context,
          pendingBossQuestion: {
            questionId: 'question-1',
            resumeStateId: kind,
            sourceItem: 'FACTS-' + kind,
            asker: { kind: 'role', roleId: 'analyst' },
            question: 'Which evidence?',
          },
          bossReply: 'Use the retained evidence.',
        });
        const expected = [
          preamble,
          ...(resuming ? [] : ['Your previous question:\nWhich evidence?']),
          'Boss reply:\nUse the retained evidence.',
          body(goldens[kind]),
        ].join('\n\n');
        expect(
          linked._internal.composePlayerPrompt(
            continuation,
            () => 'Analyst identity',
            resuming,
          ),
        ).toBe(expected);
      }
    }
    expect(await checkLinkedModuleContract(paths)).toEqual([]);
    expect(JSON.stringify(fsm.facts)).toBe(before);
    for (const kind of kinds)
      expect(fsm.context[kind + 'Alias']).toBe(fsm.facts[kind]);
    expect(fsm.unusedReads()).toBe(0);
  });

  it.each([
    'malformed-json',
    'wrong-json',
    'repeated-json',
    'noncanonical',
    'unsafe-required',
    'body',
    'order',
    'quote',
    'continuation',
    'identity',
    'empty-omission',
  ])('refuses %s through the same public gate', async (fault) => {
    const { paths, fsm } = await fixture(fault);
    const before = JSON.stringify(fsm.facts);
    expect((await checkLinkedModuleContract(paths)).length).toBeGreaterThan(0);
    expect(JSON.stringify(fsm.facts)).toBe(before);
    expect(fsm.unusedReads()).toBe(0);
    expect(await readFile(paths.fsmPath, 'utf8')).toBe(fsmSourceFor(fault));
    expect(await readFile(paths.linkedPath, 'utf8')).toBe(linkedSource(fault));
  });

  it.each(['unused-accessor', 'required-accessor'])(
    'inspects %s descriptors before composition without invoking hooks',
    async (fault) => {
      const { paths, fsm } = await fixture(fault);
      const before = JSON.stringify(fsm.facts);
      expect(capturePromptContract(fsm.machine.config)).toHaveLength(3);
      expect(fsm.accessorReads()).toBe(0);
      const findings = await checkLinkedModuleContract(paths);
      expect(findings.length === 0).toBe(fault === 'unused-accessor');
      expect(fsm.accessorReads()).toBe(0);
      expect(fsm.unusedReads()).toBe(0);
      expect(JSON.stringify(fsm.facts)).toBe(before);
    },
  );

  it.each([
    'initial-literal-unused',
    'initial-literal-required',
    'initial-factory-unused',
    'initial-factory-required',
  ])(
    'preserves initial-context unavailability for %s without reading or sentinel promotion',
    async (fault) => {
      const { paths, fsm } = await fixture(fault);
      const required = fault.endsWith('-required');
      const key = required ? 'emptyArray' : 'ignoredInitial';
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        fsm.context,
        key,
      );
      const before = JSON.stringify(fsm.facts);
      expect(originalDescriptor?.get).toBeTypeOf('function');
      expect(fsm.accessorReads()).toBe(0);
      expect(capturePromptContract(fsm.machine.config)).toHaveLength(3);
      expect(fsm.accessorReads()).toBe(0);
      const findings = await checkLinkedModuleContract(paths);
      if (required) expect(findings.join('\n')).toContain('emptyArray');
      else expect(findings).toEqual([]);
      expect(fsm.accessorReads()).toBe(0);
      expect(fsm.unusedReads()).toBe(0);
      expect(fsm.initialProbeTypes().length).toBeGreaterThan(0);
      expect(fsm.initialProbeTypes()).not.toContain('string');
      expect(Object.getOwnPropertyDescriptor(fsm.context, key)).toEqual(
        originalDescriptor,
      );
      expect(Object.isFrozen(fsm.context)).toBe(true);
      expect(JSON.stringify(fsm.facts)).toBe(before);
      expect(await readFile(paths.fsmPath, 'utf8')).toBe(fsmSourceFor(fault));
    },
  );

  it.each([true, false])(
    'matches adjacent finite JSON values independently of candidate order (low first: %s)',
    async (lowFirst) => {
      const source = numericSources(lowFirst);
      const { paths, fsm, linked } = await materialize(
        source.fsm,
        source.linked,
      );
      const values = fsm as { context: { low: number; high: number } };
      const compose = (linked as LinkedModule)._internal.composePlayerPrompt;
      expect(
        compose(
          { prompt: 'Values: <left><right>.', ...values.context },
          () => '',
        ),
      ).toBe('Values: 101.');
      expect(await checkLinkedModuleContract(paths)).toEqual([]);
      expect(values.context).toEqual({ low: 1, high: 10 });
      expect(Object.isFrozen(values.context)).toBe(true);
    },
  );

  it.each(['', 'repeated-json', 'unused-accessor', 'required-accessor'])(
    'executes the emitted prompt suite for %s',
    async (fault) => {
      const { root, paths, fsm } = await fixture(fault);
      const before = JSON.stringify(fsm.facts);
      await writeFile(
        join(root, 'vitest.config.mjs'),
        `export default { cacheDir: ${JSON.stringify(join(root, '.vite'))}, test: { cache: false, maxWorkers: 1 } };`,
      );
      await emitVerifierSupport(root);
      const emitted = await emitPromptContractTest({
        artifactDir: root,
        basename: 'typed',
        verifyModule: './.slc-verify/verify.js',
      });
      const emittedSource = await readFile(emitted.path, 'utf8');
      expect(emittedSource).toContain('checkPromptComposition');
      expect(emittedSource).toContain('artifactSchema: 3');
      expect(emittedSource).toContain('composePlayerPrompt');
      const valid = fault === '' || fault === 'unused-accessor';
      if (valid) expect(emitted.diagnostics).toEqual([]);
      expect(fsm.accessorReads()).toBe(0);
      const result = await promisify(execFile)(
        process.execPath,
        [
          join(repo, 'node_modules/vitest/vitest.mjs'),
          'run',
          '--root',
          root,
          '--config',
          join(root, 'vitest.config.mjs'),
          'typed.prompt-contract.test.ts',
        ],
        { cwd: root, timeout: 15000 },
      ).then(
        ({ stdout, stderr }) => ({ ok: true, output: stdout + stderr }),
        (error: { stdout?: string; stderr?: string }) => ({
          ok: false,
          output: (error.stdout ?? '') + (error.stderr ?? ''),
        }),
      );
      expect(result.ok, result.output).toBe(valid);
      if (!valid) {
        expect(result.output).toContain(
          'composes player prompts per the link contract',
        );
        expect(result.output).toMatch(
          fault === 'repeated-json'
            ? /prompt body verbatim and in order/
            : /accessor|ordinary turn/,
        );
      }
      expect(fsm.accessorReads()).toBe(0);
      expect(JSON.stringify(fsm.facts)).toBe(before);
      expect(fsm.unusedReads()).toBe(0);
      expect(await readFile(paths.fsmPath, 'utf8')).toBe(fsmSourceFor(fault));
      expect(await readFile(paths.linkedPath, 'utf8')).toBe(
        linkedSource(fault),
      );
    },
    20000,
  );
});
