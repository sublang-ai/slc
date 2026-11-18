// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer, createConnection } from 'node:net';
import { join } from 'node:path';
import { prepareArtifactEnvironment } from '@sublang/playbook/artifact-environment';
import { isolatedCheck } from '../src/isolated-check.js';
import { compilationAudit } from '../src/compilation-audit.js';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
describe('compiler-owned native entry lifecycle', () => {
  it.each(['construct', 'init', 'dispose'] as const)(
    'refuses direct filesystem mutation during %s without changing Source',
    async (stage) => {
      const root = await mkdtemp(join(tmpdir(), 'slc-init-ERR_PROXY_TUNNEL-'));
      roots.push(root);
      await prepareArtifactEnvironment({
        artifactDir: root,
        authority: 'compiler',
      });
      const source = join(root, 'flow.md'),
        entry = join(root, 'flow.mjs'),
        fsm = join(root, 'flow.fsm.ts');
      await writeFile(source, 'original Source');
      await writeFile(fsm, 'export const machine = {};');
      const mutation = `writeFileSync(${JSON.stringify(source)},'CHANGED BY ENTRY')`;
      await writeFile(
        entry,
        `import {writeFileSync} from 'node:fs';
export default {id:'probe',requiredRoleIds:[],concurrentRoleSets:[],
/** @param {unknown} value */ validateOptions(value) {void value;return {};},
createRuntime() {${stage === 'construct' ? mutation + ';' : ''}return {async init(){${stage === 'init' ? mutation + ';' : ''}},async dispose(){${stage === 'dispose' ? mutation + ';' : ''}}};}};`,
      );
      const findings = await isolatedCheck('lifecycle', [
        entry,
        fsm,
        undefined,
      ]);
      expect(findings.join('\n')).toMatch(
        /artifact: entry lifecycle failed:.*restricted/,
      );
      expect(await readFile(source, 'utf8')).toBe('original Source');
      const cli = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('../dist/cli.js', import.meta.url)),
          'check',
          'entry',
          entry,
          fsm,
        ],
        { encoding: 'utf8' },
      );
      expect(cli.status).toBe(1);
      expect(JSON.parse(cli.stdout).category).toBe('artifact');
    },
    30000,
  );
  it('initializes and disposes an ordinary inert entry under the same native permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-init-'));
    roots.push(root);
    await prepareArtifactEnvironment({
      artifactDir: root,
      authority: 'compiler',
    });
    const entry = join(root, 'flow.mjs'),
      fsm = join(root, 'flow.fsm.ts');
    await writeFile(fsm, 'export const machine = {};');
    await writeFile(
      entry,
      `export default {id:'probe',requiredRoleIds:[],concurrentRoleSets:[],
/** @param {unknown} value */ validateOptions(value){void value;return {};},createRuntime(){return {async init(){},async dispose(){}};}};`,
    );
    expect(await isolatedCheck('lifecycle', [entry, fsm, undefined])).toEqual(
      [],
    );
  }, 30000);
  it.each(['telemetry', 'forged-report'])(
    'ignores artifact %s IPC and still reports the actual constructor failure',
    async (kind) => {
      const root = await mkdtemp(join(tmpdir(), 'slc-ipc-'));
      roots.push(root);
      await prepareArtifactEnvironment({
        artifactDir: root,
        authority: 'compiler',
      });
      const entry = join(root, 'flow.mjs'),
        fsm = join(root, 'flow.fsm.ts');
      await writeFile(fsm, 'export const machine = {};');
      const ipc =
        kind === 'telemetry'
          ? `process.send?.({kind:'runtime-loaded'});`
          : `const sender=Reflect.get(process,'_send'); if(typeof sender==='function') sender.call(process,{schema:'sublang.slc.check-report.v1',job:'lifecycle',token:'not-the-checker-capability',status:'completed',findings:[],observations:[]},undefined,{swallowErrors:true},()=>{});`;
      await writeFile(
        entry,
        `${ipc}\nexport default {id:'probe',requiredRoleIds:[],concurrentRoleSets:[],
/** @param {unknown} value */ validateOptions(value){void value;return {};},createRuntime(){throw Error('constructor must fail');}};`,
      );
      expect(
        (await isolatedCheck('lifecycle', [entry, fsm, undefined])).join('\n'),
      ).toContain('artifact: entry lifecycle failed: constructor must fail');
    },
    30000,
  );
  it('blocks native Socket network writes while an actual loopback service is available', async () => {
    const received: string[] = [];
    const server = createServer((socket) =>
      socket.on('data', (data) => {
        received.push(String(data));
        socket.end();
      }),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const port = (server.address() as { port: number }).port;
    try {
      await new Promise<void>((resolve, reject) => {
        const client = createConnection({ port, host: '127.0.0.1' }, () =>
          client.write('fixture-positive'),
        );
        client.once('close', () => resolve());
        client.once('error', reject);
      });
      const root = await mkdtemp(join(tmpdir(), 'slc-net-'));
      roots.push(root);
      await prepareArtifactEnvironment({
        artifactDir: root,
        authority: 'compiler',
      });
      const entry = join(root, 'flow.mjs'),
        fsm = join(root, 'flow.fsm.ts');
      await writeFile(fsm, 'export const machine = {};');
      await writeFile(
        entry,
        `import {Socket} from 'node:net';export default {id:'probe',requiredRoleIds:[],concurrentRoleSets:[],
/** @param {unknown} value */ validateOptions(value){void value;return {};},createRuntime(){return {async init(){await new Promise((resolve,reject)=>{const socket=new Socket();socket.on('error',reject);socket.connect(${port},'127.0.0.1',()=>{socket.write('BUSINESS_WRITE');socket.end();resolve(undefined);});});},async dispose(){}};}};`,
      );
      expect(
        (await isolatedCheck('lifecycle', [entry, fsm, undefined])).join('\n'),
      ).toMatch(
        /artifact: entry lifecycle failed:.*forbidden verification side effect/,
      );
      expect(received).toEqual(['fixture-positive']);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30000);
  it.each(['exit', 'cancel'])(
    'never accepts incomplete %s checking as a successful empty report',
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), 'slc-incomplete-'));
      roots.push(root);
      await prepareArtifactEnvironment({
        artifactDir: root,
        authority: 'compiler',
      });
      const entry = join(root, 'flow.mjs'),
        fsm = join(root, 'flow.fsm.ts');
      await writeFile(fsm, 'export const machine = {};');
      await writeFile(
        entry,
        `export default {id:'probe',requiredRoleIds:[],concurrentRoleSets:[],
/** @param {unknown} value */ validateOptions(value){void value;return {};},createRuntime(){return {async init(){${mode === 'exit' ? 'process.exit(0);' : 'await new Promise(()=>{});'}},async dispose(){}};}};`,
      );
      const controller = new AbortController();
      const timer =
        mode === 'cancel'
          ? setTimeout(
              () => controller.abort(Error('caller canceled check')),
              250,
            )
          : undefined;
      try {
        await expect(
          isolatedCheck(
            'lifecycle',
            [entry, fsm, undefined],
            controller.signal,
          ),
        ).rejects.toThrow(
          mode === 'exit'
            ? 'without a complete authenticated report'
            : 'caller canceled check',
        );
      } finally {
        clearTimeout(timer);
      }
    },
    30000,
  );
  it('retains a complete checker report while an existing evidence queue drains', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-audit-drain-'));
    roots.push(root);
    await prepareArtifactEnvironment({
      artifactDir: root,
      authority: 'compiler',
    });
    const entry = join(root, 'flow.mjs'),
      fsm = join(root, 'flow.fsm.ts');
    await writeFile(fsm, 'export const machine={};');
    await writeFile(
      entry,
      `export default {id:'probe',requiredRoleIds:[],concurrentRoleSets:[],
/** @param {unknown} value */ validateOptions(value){void value;return {};},createRuntime(){return {async init(){await new Promise(resolve=>setTimeout(resolve,250));},async dispose(){}};}};`,
    );
    const audit: { path: string; tail?: Promise<void> } = {
      path: join(root, 'events.jsonl'),
    };
    const timer = setTimeout(() => {
      audit.tail = new Promise((resolve) => setTimeout(resolve, 3000));
    }, 100);
    try {
      expect(
        await compilationAudit.run(audit, () =>
          isolatedCheck('lifecycle', [entry, fsm, undefined]),
        ),
      ).toEqual([]);
      const events = (await readFile(audit.path, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(
        events.find((e) => e.kind === 'checker-report').data.observations,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: 'initialize',
            status: 'passed',
          }),
          expect.objectContaining({ operation: 'dispose', status: 'passed' }),
        ]),
      );
      expect(
        events.find((e) => e.kind === 'checker-finish').data.findings,
      ).toEqual([]);
    } finally {
      clearTimeout(timer);
    }
  }, 30000);
  it('reports missing genuine startup data as unverified without inventing a domain value', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-required-options-'));
    roots.push(root);
    await prepareArtifactEnvironment({
      artifactDir: root,
      authority: 'compiler',
    });
    const entry = join(root, 'flow.mjs'),
      fsm = join(root, 'flow.fsm.ts');
    await writeFile(fsm, 'export const machine={};');
    await writeFile(
      entry,
      `export default {id:'required-source-input',requiredRoleIds:[],concurrentRoleSets:[],
/** @param {unknown} value */ validateOptions(value){if(!value||typeof value!=='object'||!('file' in value)||typeof value.file!=='string')throw Error('Source requires a task file');return {file:value.file};},createRuntime(){throw Error('construction must not run with invented options');}};`,
    );
    const findings = await isolatedCheck('lifecycle', [entry, fsm, undefined]);
    expect(findings.join('\n')).toContain(
      'unverified: safe initialization needs a source-permitted startup option fixture',
    );
    expect(findings.join('\n')).toContain('Source requires a task file');
    expect(findings.join('\n')).not.toContain('construction must not run');
  }, 30000);
});
