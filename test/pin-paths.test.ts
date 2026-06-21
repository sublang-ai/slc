// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolvePinPath } from '../src/pin-paths.js';
import { PinError } from '../src/pins.js';

const DIR = resolve('/work/text2gears.slc');

describe('resolvePinPath (PIN-2, PIN-5)', () => {
  it('resolves a relative POSIX path against the pipeline directory', () => {
    expect(resolvePinPath(DIR, '.', 'reference/gears.md', 'f')).toBe(
      resolve(DIR, 'reference', 'gears.md'),
    );
  });

  it('resolves "." to the pipeline directory', () => {
    expect(resolvePinPath(DIR, '.', '.', 'f')).toBe(DIR);
  });

  it('rejects an absolute POSIX path, naming the field', () => {
    try {
      resolvePinPath(DIR, '.', '/etc/passwd', 'definition.path');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PinError);
      expect((error as PinError).code).toBe('pin-invalid');
      expect((error as PinError).message).toContain('definition.path');
    }
  });

  it('rejects a Windows-absolute path', () => {
    expect(() => resolvePinPath(DIR, '.', 'C:/x', 'f')).toThrow(PinError);
  });

  it('rejects an absolute recorded boundary, naming pathBoundary.path', () => {
    for (const badBoundary of ['/', '/abs', 'C:/x']) {
      try {
        resolvePinPath(DIR, badBoundary, 'a.ts', 'f');
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PinError);
        expect((error as PinError).code).toBe('pin-invalid');
        expect((error as PinError).message).toContain('pathBoundary.path');
      }
    }
  });

  it('rejects a path that escapes the default boundary', () => {
    try {
      resolvePinPath(DIR, '.', '../sibling', 'f');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PinError);
      expect((error as PinError).message).toContain('escapes');
    }
  });

  it('permits ".." only when the recorded boundary is wide enough', () => {
    // boundary ".." widens to the parent directory, which contains ../sibling.
    expect(resolvePinPath(DIR, '..', '../sibling', 'f')).toBe(
      resolve(DIR, '../sibling'),
    );
    // a path outside even the widened boundary stays rejected.
    expect(() => resolvePinPath(DIR, '..', '../../far', 'f')).toThrow(PinError);
  });
});
