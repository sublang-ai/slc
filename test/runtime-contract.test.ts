// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  declaresComposedV3,
  describeRuntimeDeclaration,
  readPlaybookRuntimeDeclaration,
} from '../src/runtime-contract.js';

import { writePlaybookEngineFixture } from './playbook-engine-fixture.js';

// The engine declaration behind a link target is read from the installed
// package that owns the target, never inferred from a release number
// (phase-execution-30, verification-21; DR-028).
describe('readPlaybookRuntimeDeclaration (DR-028)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-runtime-contract-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads RUNTIME_ABI and SUPPORTED_ARTIFACT_SCHEMAS from the owning package engine', async () => {
    const fixture = await writePlaybookEngineFixture(join(root, 'twelve'), {
      version: '12.0.0',
    });

    const declaration = await readPlaybookRuntimeDeclaration(
      fixture.linkTarget,
    );
    expect(declaration).toEqual({
      provenance: '@sublang/playbook@12.0.0',
      packageRoot: fixture.packageRoot,
      runtimeAbi: 1,
      supportedArtifactSchemas: [3],
    });
    expect(declaresComposedV3(declaration!)).toBe(true);
    expect(describeRuntimeDeclaration(declaration!)).toBe(
      '@sublang/playbook@12.0.0 declares RUNTIME_ABI 1 and SUPPORTED_ARTIFACT_SCHEMAS [3]',
    );
    // A directory link target resolves through the package it names.
    expect(
      await readPlaybookRuntimeDeclaration(fixture.packageRoot),
    ).toMatchObject({ provenance: '@sublang/playbook@12.0.0' });
  });

  it('reports another ABI, a missing schema 3, or an absent declaration as non-composed-v3', async () => {
    const abi = await writePlaybookEngineFixture(join(root, 'abi'), {
      runtimeAbi: 2,
    });
    const schemas = await writePlaybookEngineFixture(join(root, 'schemas'), {
      supportedArtifactSchemas: [2],
    });
    const bare = await writePlaybookEngineFixture(join(root, 'bare'), {
      version: '1.3.0',
      omitRuntimeAbi: true,
      omitSchemas: true,
    });

    const abiDeclaration = await readPlaybookRuntimeDeclaration(abi.linkTarget);
    expect(declaresComposedV3(abiDeclaration!)).toBe(false);
    expect(describeRuntimeDeclaration(abiDeclaration!)).toContain(
      'RUNTIME_ABI 2 and SUPPORTED_ARTIFACT_SCHEMAS [3]',
    );
    expect(
      declaresComposedV3(
        (await readPlaybookRuntimeDeclaration(schemas.linkTarget))!,
      ),
    ).toBe(false);
    const bareDeclaration = await readPlaybookRuntimeDeclaration(
      bare.linkTarget,
    );
    expect(bareDeclaration).toMatchObject({
      provenance: '@sublang/playbook@1.3.0',
      runtimeAbi: undefined,
      supportedArtifactSchemas: undefined,
    });
    expect(describeRuntimeDeclaration(bareDeclaration!)).toBe(
      '@sublang/playbook@1.3.0 declares no RUNTIME_ABI and no SUPPORTED_ARTIFACT_SCHEMAS',
    );
  });

  it('returns no declaration outside an installed @sublang/playbook package', async () => {
    const local = await writePlaybookEngineFixture(join(root, 'local'), {
      name: 'local-runtime',
    });
    expect(await readPlaybookRuntimeDeclaration(local.linkTarget)).toBe(
      undefined,
    );

    // The first manifest above the target owns it; a parent playbook
    // manifest lends no identity to a nested local package.
    const nested = await writePlaybookEngineFixture(join(root, 'nested'));
    const inner = join(nested.packageRoot, 'vendor', 'inner');
    await mkdir(inner, { recursive: true });
    await writeFile(
      join(inner, 'package.json'),
      JSON.stringify({ name: 'inner', version: '1.0.0' }),
    );
    await writeFile(join(inner, 'runtime.ts'), 'export {};\n');
    expect(
      await readPlaybookRuntimeDeclaration(join(inner, 'runtime.ts')),
    ).toBe(undefined);

    await writeFile(join(root, 'plain.ts'), 'export {};\n');
    expect(await readPlaybookRuntimeDeclaration(join(root, 'plain.ts'))).toBe(
      undefined,
    );
  });

  it('fails when the owning package cannot resolve its engine subpath', async () => {
    const fixture = await writePlaybookEngineFixture(join(root, 'noexports'), {
      version: '3.0.0',
      omitExports: true,
    });
    await expect(
      readPlaybookRuntimeDeclaration(fixture.linkTarget),
    ).rejects.toThrow(
      /@sublang\/playbook@3\.0\.0 at .* does not resolve @sublang\/playbook\/xstate-runtime/,
    );
  });
});
