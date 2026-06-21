// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PIN_HASH_ALGORITHM,
  PIN_SCHEMA,
  PINS_FILE,
  PinError,
  loadPinFile,
  parsePinFile,
} from '../src/pins.js';

const H = `sha256:${'a'.repeat(64)}`;

/** A complete, valid pin file as a plain object. */
const validPinObject = (): Record<string, unknown> => ({
  schema: PIN_SCHEMA,
  hashAlgorithm: PIN_HASH_ALGORITHM,
  pins: {
    text2gears: {
      artifact: { path: 'text2gears.slc/text2gears.phase.ts', hash: H },
      definition: { path: 'text2gears.md', hash: H },
      semanticInputs: [
        { path: 'reference/gears.md', hash: H, role: 'reference' },
      ],
      externalInputs: [],
      linkTarget: {
        kind: 'file',
        locator: 'reference/code.ts',
        identity: H,
        provenance: 'code@1',
      },
      producer: { pipeline: 'slc' },
    },
  },
});

const json = (value: unknown): string => JSON.stringify(value);

describe('parsePinFile (PIN-5)', () => {
  it('parses a complete valid pin file', () => {
    const file = parsePinFile(json(validPinObject()));

    expect(file.schema).toBe(PIN_SCHEMA);
    expect(file.hashAlgorithm).toBe(PIN_HASH_ALGORITHM);
    expect(file.pathBoundary).toEqual({ path: '.' }); // default
    const pin = file.pins.text2gears;
    expect(pin.definition).toEqual({ path: 'text2gears.md', hash: H });
    expect(pin.semanticInputs[0].role).toBe('reference');
    expect(pin.linkTarget.kind).toBe('file');
    expect(pin.producer?.pipeline).toBe('slc');
  });

  it('defaults optional pathBoundary and arrays', () => {
    const obj = validPinObject();
    const pin = (obj.pins as Record<string, Record<string, unknown>>)
      .text2gears;
    delete pin.semanticInputs;
    delete pin.externalInputs;
    delete pin.producer;

    const file = parsePinFile(json(obj));

    expect(file.pathBoundary).toEqual({ path: '.' });
    expect(file.pins.text2gears.semanticInputs).toEqual([]);
    expect(file.pins.text2gears.externalInputs).toEqual([]);
    expect(file.pins.text2gears.producer).toBeUndefined();
  });

  it('accepts the reserved link phase key', () => {
    const obj = validPinObject();
    obj.pins = { link: (obj.pins as Record<string, unknown>).text2gears };

    expect(() => parsePinFile(json(obj))).not.toThrow();
  });

  it('rejects non-JSON', () => {
    try {
      parsePinFile('{not json');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PinError);
      expect((error as PinError).code).toBe('pin-parse');
    }
  });

  it('rejects an unsupported schema, naming the field', () => {
    const obj = { ...validPinObject(), schema: 'sublang.slc.pins.v0' };
    try {
      parsePinFile(json(obj));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PinError);
      expect((error as PinError).code).toBe('pin-invalid');
      expect((error as PinError).message).toContain('schema');
    }
  });

  it('rejects an unsupported hash algorithm, naming the field', () => {
    const obj = { ...validPinObject(), hashAlgorithm: 'md5' };
    expect(() => parsePinFile(json(obj))).toThrow(/hashAlgorithm/);
  });

  it('rejects an unknown top-level field', () => {
    const obj = { ...validPinObject(), extra: true };
    expect(() => parsePinFile(json(obj))).toThrow(/extra.*unknown/);
  });

  it('rejects an unknown field in a pin record', () => {
    const obj = validPinObject();
    (obj.pins as Record<string, Record<string, unknown>>).text2gears.bogus = 1;
    expect(() => parsePinFile(json(obj))).toThrow(/bogus.*unknown/);
  });

  it('rejects a wrong-typed field, naming it', () => {
    const obj = validPinObject();
    const pin = (obj.pins as Record<string, Record<string, unknown>>)
      .text2gears;
    (pin.artifact as Record<string, unknown>).path = 42;
    expect(() => parsePinFile(json(obj))).toThrow(/artifact\.path/);
  });

  it('rejects a record missing a required field', () => {
    const obj = validPinObject();
    delete (obj.pins as Record<string, Record<string, unknown>>).text2gears
      .definition;
    expect(() => parsePinFile(json(obj))).toThrow(/definition/);
  });

  it('rejects an unsupported link-target kind', () => {
    const obj = validPinObject();
    const pin = (obj.pins as Record<string, Record<string, unknown>>)
      .text2gears;
    (pin.linkTarget as Record<string, unknown>).kind = 'socket';
    expect(() => parsePinFile(json(obj))).toThrow(/linkTarget\.kind/);
  });

  it('rejects a non-object document', () => {
    try {
      parsePinFile('[]');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PinError);
      expect((error as PinError).code).toBe('pin-invalid');
    }
  });
});

describe('loadPinFile (PIN-1, PIN-5)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-pins-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty result when no pin file is present', async () => {
    const loaded = await loadPinFile(dir);

    expect(loaded.path).toBeUndefined();
    expect(loaded.file).toBeUndefined();
  });

  it('loads and parses a present pin file', async () => {
    const path = join(dir, PINS_FILE);
    await writeFile(path, json(validPinObject()));

    const loaded = await loadPinFile(dir);

    expect(loaded.path).toBe(path);
    expect(loaded.file?.pins.text2gears.artifact.hash).toBe(H);
  });

  it('rejects a present but malformed pin file', async () => {
    await writeFile(join(dir, PINS_FILE), '{not json');

    await expect(loadPinFile(dir)).rejects.toBeInstanceOf(PinError);
  });
});
