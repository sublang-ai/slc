// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** Artifact-owned entry validation (DR-044, self-hosting-17/18). */
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { messageOf } from './errors.js';
import { checkFsmTypeScript } from './verify-typescript.js';
import { loadFsmModule, loadLinkedModuleForVerification } from './verify.js';

export const ENTRY_OPTIONS_CONTRACT = [
  'Required entry output contract:',
  '- export a public synchronous pure validateOptions(value: unknown): PlaybookRuntimeOptions function;',
  '- reuse that validator as the linked runtime spec snapshotOptions callback; normalize only absent undefined to an empty option slice, reject undeclared or invalid JSON options, and return the validated JSON snapshot;',
  '- preserve real source-required startup options; a required generated type alone does not establish that Boss-entry text is required before the first turn;',
  '- validation must not construct or initialize the runtime or require live host capabilities.',
].join('\n');

/** Capability detection, not a version, date, arity or option-schema inference. */
export async function linkedOptionsValidator(opts: {
  linkedPath: string;
  fsmPath: string;
}): Promise<unknown> {
  const module = (
    existsSync(opts.fsmPath)
      ? await loadLinkedModuleForVerification(opts)
      : await loadFsmModule(opts.linkedPath)
  ) as Record<string, unknown>;
  if (!Object.hasOwn(module, 'validateOptions')) return undefined;
  if (typeof module.validateOptions !== 'function') {
    throw new TypeError('linked validateOptions export must be a function');
  }
  return module.validateOptions;
}

function plainJson(value: unknown, active = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || active.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false;
  active.add(value);
  const keys = Reflect.ownKeys(value);
  const valid =
    keys.every((key) => {
      if (Array.isArray(value) && key === 'length') return true;
      const member = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === 'string' &&
        member !== undefined &&
        member.enumerable &&
        'value' in member &&
        plainJson(member.value, active)
      );
    }) &&
    (!Array.isArray(value) ||
      (keys.length === value.length + 1 &&
        keys.every(
          (key, index) =>
            key === (index === value.length ? 'length' : String(index)),
        )));
  active.delete(value);
  return valid;
}

/** No runtime instance is constructed and no valid required option is invented. */
export async function checkEntryOptions(opts: {
  linkedPath: string;
  fsmPath: string;
  signal?: AbortSignal;
}): Promise<string[]> {
  if (!existsSync(opts.linkedPath)) return []; // The generic target check owns absence.
  opts.signal?.throwIfAborted();
  let candidate: unknown;
  try {
    candidate = await linkedOptionsValidator(opts);
  } catch (error) {
    return [`entry options contract: ${messageOf(error)}`];
  }
  if (candidate === undefined)
    return [
      'entry options contract: export public validateOptions(value: unknown), reusing the runtime option-snapshot validator',
    ];
  const validate = candidate as (value: unknown) => unknown;
  const findings = new Set<string>();
  for (const value of [undefined, {}, null, [], true, 1, 'invalid']) {
    let returned: unknown;
    try {
      returned = validate(value);
    } catch {
      continue;
    } // A real required option may be absent from either empty probe.
    if (
      value !== undefined &&
      (value === null || typeof value !== 'object' || Array.isArray(value))
    ) {
      findings.add(
        'entry options contract: validateOptions must reject non-object option slices',
      );
    }
    if (
      returned === null ||
      typeof returned !== 'object' ||
      Array.isArray(returned) ||
      !plainJson(returned)
    ) {
      findings.add(
        'entry options contract: validateOptions must synchronously return a plain JSON option record',
      );
      // Drain an invalid asynchronous result without awaiting or accepting it.
      if (returned instanceof Promise) void returned.catch(() => {});
    }
  }
  const dir = await mkdtemp(join(tmpdir(), 'slc-entry-options-'));
  try {
    const witness = join(dir, 'entry-options.ts');
    await writeFile(
      witness,
      `import factory, { validateOptions } from ${JSON.stringify(resolve(opts.linkedPath))};\ntype Input = NonNullable<Parameters<typeof factory>[0]>;\nexport const validate: (value: unknown) => Input['configuredOptions'] = validateOptions;\n`,
    );
    const typed = await checkFsmTypeScript(witness, opts.signal, [
      opts.linkedPath,
      opts.fsmPath,
    ]);
    for (const finding of typed)
      findings.add(`entry options contract: ${finding}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  opts.signal?.throwIfAborted();
  return [...findings];
}
