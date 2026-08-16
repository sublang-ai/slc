// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFileSync } from 'node:child_process';
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ExecuteRequest } from '../src/execution.js';
import { buildPhasePrompt } from '../src/interpreter.js';
import {
  appendWorkspaceContract,
  createWorkspaceRecord,
  encodeWorkspaceContract,
  validateWorkspaceRecord,
  WORKSPACE_BEGIN,
  WORKSPACE_END,
  WorkspaceError,
  type WorkspaceRecord,
} from '../src/workspace.js';

describe('physical workspace binding (PHEXEC-11, PHEXEC-34)', () => {
  let root: string;
  let request: Extract<ExecuteRequest, { kind: 'compile' }>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-workspace-'));
    await mkdir(join(root, 'declared'));
    await writeFile(join(root, 'phase.md'), '# phase');
    await writeFile(join(root, 'source.md'), 'source');
    await writeFile(join(root, 'reference.md'), 'reference');
    await writeFile(join(root, 'declared', 'grammar.md'), 'grammar');
    request = {
      kind: 'compile',
      definitionPath: join(root, 'phase.md'),
      source: join(root, 'source.md'),
      references: [join(root, 'reference.md')],
      target: join(root, 'target.md'),
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('refuses to bind or certify an update-bearing request (INCR-39)', async () => {
    // These helpers are exported, so a caller can obtain and certify the
    // withheld workspace without entering a guarded executor. While the
    // feature is withheld, no public consumer may act on or attest one.
    const updating = { ...request, update: {} } as unknown as ExecuteRequest;
    const ordinary = await createWorkspaceRecord(request);

    await expect(createWorkspaceRecord(updating)).rejects.toThrow(
      /withheld from this release/,
    );
    await expect(validateWorkspaceRecord(ordinary, updating)).rejects.toThrow(
      /withheld from this release/,
    );
    expect(() =>
      buildPhasePrompt({
        request: updating,
        definition: '## Formats',
        workspace: ordinary,
      }),
    ).toThrow(/withheld from this release/);
  });

  it('builds the exact ordered compile record and canonical final suffix', async () => {
    const semanticInputs = [
      { logicalPath: join(root, 'declared', 'grammar.md') },
    ];
    const record = await createWorkspaceRecord(request, { semanticInputs });

    expect(record.reads.map((read) => read.role)).toEqual([
      'definition',
      'source',
      'reference:0',
      'semantic-input:0',
    ]);
    expect(
      record.reads.every((read) => read.identity.startsWith('sha256:')),
    ).toBe(true);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.reads)).toBe(true);
    const suffix = encodeWorkspaceContract(record);
    expect(suffix.split('\n')).toHaveLength(3);
    expect(suffix.startsWith(`${WORKSPACE_BEGIN}\n{`)).toBe(true);
    expect(suffix.endsWith(`\n${WORKSPACE_END}`)).toBe(true);
    expect(JSON.parse(suffix.split('\n')[1])).toEqual(record);
    const prompt = appendWorkspaceContract('perform it', record);
    expect(prompt.endsWith(suffix)).toBe(true);
    expect(prompt.match(/SLC_WORKSPACE_BEGIN/g)).toHaveLength(1);
    expect(prompt).toContain('logical paths as semantic identifiers only');

    await validateWorkspaceRecord(record, request, { semanticInputs });
  });

  it('cross-binds alternate physical link reads and the sole sink', async () => {
    const logicalDefinition = join(root, 'logical-link.md');
    const logicalObject = join(root, 'logical-object.ts');
    const logicalTarget = join(root, 'logical-runtime');
    const physicalDefinition = join(root, 'phase.md');
    const physicalObject = join(root, 'object.ts');
    const physicalTarget = join(root, 'runtime');
    const physicalSink = join(root, 'candidate.ts');
    await writeFile(physicalObject, 'object');
    await mkdir(physicalTarget);
    await writeFile(join(physicalTarget, 'index.js'), 'runtime');
    const linkRequest: ExecuteRequest = {
      kind: 'link',
      definitionPath: logicalDefinition,
      objects: [logicalObject],
      linkTarget: logicalTarget,
      options: [],
      linked: join(root, 'logical-output.ts'),
    };
    const record = await createWorkspaceRecord(linkRequest, {
      physicalReads: {
        definition: physicalDefinition,
        'object:0': physicalObject,
        'link-target': physicalTarget,
      },
      physicalWrite: physicalSink,
    });

    expect(record.reads.map((read) => [read.role, read.kind])).toEqual([
      ['definition', 'file'],
      ['object:0', 'file'],
      ['link-target', 'directory'],
    ]);
    expect(record.write).toEqual({
      role: 'linked',
      logicalPath: join(root, 'logical-output.ts'),
      physicalPath: physicalSink,
      kind: 'file',
    });
  });

  it('rejects reordered roles, undeclared semantic inputs, and changed bytes', async () => {
    const record = await createWorkspaceRecord(request);
    const reordered: WorkspaceRecord = {
      ...record,
      reads: [record.reads[1], record.reads[0], ...record.reads.slice(2)],
    };
    await expect(validateWorkspaceRecord(reordered, request)).rejects.toThrow(
      /does not match the request/,
    );

    const extra: WorkspaceRecord = {
      ...record,
      reads: [
        ...record.reads,
        { ...record.reads[0], role: 'semantic-input:0' },
      ],
    };
    await expect(validateWorkspaceRecord(extra, request)).rejects.toThrow(
      /exact required read roles/,
    );

    await writeFile(request.source, 'changed');
    await expect(validateWorkspaceRecord(record, request)).rejects.toThrow(
      /does not match physical bytes/,
    );
  });

  it('rejects a sink that aliases, hard-links, or symbolically redirects a read', async () => {
    await expect(
      createWorkspaceRecord(request, { physicalWrite: request.source }),
    ).rejects.toThrow(/aliases a physical read path/);

    const hardLink = join(root, 'hard-link.md');
    await link(request.source, hardLink);
    await expect(
      createWorkspaceRecord(request, { physicalWrite: hardLink }),
    ).rejects.toThrow(/independent regular file/);

    const symbolic = join(root, 'symbolic.md');
    await symlink(request.target, symbolic);
    await expect(
      createWorkspaceRecord(request, { physicalWrite: symbolic }),
    ).rejects.toThrow(WorkspaceError);
  });

  it('permits read-side symbolic aliases while binding their followed bytes', async () => {
    const alias = join(root, 'source-alias.md');
    await symlink(request.source, alias);
    const record = await createWorkspaceRecord(request, {
      physicalReads: { source: alias },
    });
    const source = record.reads.find((read) => read.role === 'source');
    expect(source?.physicalPath).toBe(alias);
    expect(source?.kind).toBe('file');
    await expect(readFile(source?.physicalPath ?? '', 'utf8')).resolves.toBe(
      'source',
    );
  });

  // Each case below isolates one sink guard: the shared fixture at
  // "rejects a sink that aliases, hard-links, or symbolically redirects a read"
  // is caught by an earlier guard than the one it names, so without these the
  // inode, link-count, file-type, and component-walk terms are each removable
  // with the whole suite still green.
  it('rejects a sink reached as one inode under two different paths', async () => {
    const alias = join(root, 'source-alias.md');
    await symlink(request.source, alias);
    // The read binds the alias, so the sink's path string matches no read and
    // its link count is 1: only the resolved identity exposes the collision.
    await expect(
      createWorkspaceRecord(request, {
        physicalReads: { source: alias },
        physicalWrite: request.source,
      }),
    ).rejects.toThrow(/hard link to a readable input/);
  });

  it('rejects a sink hard-linked to a file outside the binding', async () => {
    const unrelated = join(root, 'unrelated.md');
    await writeFile(unrelated, 'unrelated');
    const sink = join(root, 'sink.md');
    await link(unrelated, sink);
    // Writing this sink would silently rewrite a file no read declared.
    await expect(
      createWorkspaceRecord(request, { physicalWrite: sink }),
    ).rejects.toThrow(/independent regular file/);
  });

  it('rejects a sink that is not a regular file', async () => {
    const fifo = join(root, 'fifo.md');
    execFileSync('mkfifo', [fifo]);
    // A fifo keeps a link count of 1, so only the file-type term refuses it.
    await expect(
      createWorkspaceRecord(request, { physicalWrite: fifo }),
    ).rejects.toThrow(/independent regular file/);
  });

  it('rejects a sink whose parent directory is a writable symbolic link', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    const redirected = join(root, 'staged');
    await symlink(outside, redirected);
    // The leaf is absent and every other guard passes; the component walk is
    // the only one that sees the escape.
    await expect(
      createWorkspaceRecord(request, {
        physicalWrite: join(redirected, 'out.md'),
      }),
    ).rejects.toThrow(/writable symbolic-link component/);
  });

  it('rejects an ambiguous prompt that already contains a workspace marker', async () => {
    const record = await createWorkspaceRecord(request);
    expect(() => appendWorkspaceContract(WORKSPACE_BEGIN, record)).toThrow(
      /already contains/,
    );
  });
});
