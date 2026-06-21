// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashBytes, hashFile, isHash } from '../src/hash.js';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('hashBytes / isHash (PIN-2, PIN-3)', () => {
  it('is deterministic and formats as sha256:<64 lowercase hex>', () => {
    expect(hashBytes(enc('hello'))).toBe(hashBytes(enc('hello')));
    expect(hashBytes(enc('hello'))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes with any byte difference, including added whitespace', () => {
    expect(hashBytes(enc('hello'))).not.toBe(hashBytes(enc('hellO')));
    expect(hashBytes(enc('a'))).not.toBe(hashBytes(enc('a\n')));
  });

  it('recognizes only well-formed hashes', () => {
    expect(isHash(hashBytes(enc('x')))).toBe(true);
    expect(isHash(`sha256:${'a'.repeat(64)}`)).toBe(true);
    expect(isHash(`sha256:${'A'.repeat(64)}`)).toBe(false); // uppercase
    expect(isHash(`sha256:${'a'.repeat(63)}`)).toBe(false); // too short
    expect(isHash(`sha1:${'a'.repeat(64)}`)).toBe(false); // wrong algorithm
    expect(isHash('a'.repeat(64))).toBe(false); // no prefix
  });
});

describe('hashFile (PIN-3)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-hash-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('hashes exact file bytes with no line-ending normalization', async () => {
    const lf = join(dir, 'lf.txt');
    const crlf = join(dir, 'crlf.txt');
    await writeFile(lf, 'a\nb\n');
    await writeFile(crlf, 'a\r\nb\r\n');

    expect(await hashFile(lf)).toBe(hashBytes(enc('a\nb\n')));
    expect(await hashFile(lf)).not.toBe(await hashFile(crlf));
  });
});
