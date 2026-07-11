// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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
    expect(() => resolvePinPath(DIR, '.', 'C:relative', 'f')).toThrow(PinError);
  });

  it.each([
    ['artifact path', 'inside\\..\\outside.ts', '.'],
    ['path boundary', 'inside.ts', '..\\..'],
    ['empty artifact path', '', '.'],
  ])('rejects a non-portable %s', (_label, path, boundary) => {
    expect(() => resolvePinPath(DIR, boundary, path, 'artifact.path')).toThrow(
      PinError,
    );
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

  it('rejects an in-boundary symlink that resolves outside the boundary', () => {
    const root = mkdtempSync(join(tmpdir(), 'slc-pin-path-'));
    try {
      const pipeline = join(root, 'pipeline');
      const outside = join(root, 'outside.ts');
      mkdirSync(pipeline);
      writeFileSync(outside, 'outside\n');
      symlinkSync(outside, join(pipeline, 'artifact.ts'));

      expect(() =>
        resolvePinPath(pipeline, '.', 'artifact.ts', 'artifact.path'),
      ).toThrow(/resolves outside/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a missing descendant reached through an escaping symlink', () => {
    const root = mkdtempSync(join(tmpdir(), 'slc-pin-path-'));
    try {
      const pipeline = join(root, 'pipeline');
      const outside = join(root, 'outside');
      mkdirSync(pipeline);
      mkdirSync(outside);
      symlinkSync(outside, join(pipeline, 'bundle'));

      expect(() =>
        resolvePinPath(pipeline, '.', 'bundle/missing.ts', 'artifact.path'),
      ).toThrow(/resolves outside/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
