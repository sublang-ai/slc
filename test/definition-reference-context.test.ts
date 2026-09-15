// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createCompiledExecutor } from '../src/compiled-executor.js';
import { runPhase, type ExecuteRequest } from '../src/execution.js';
import {
  createInterpretedExecutor,
  type AgentClient,
  type AgentRunRequest,
} from '../src/interpreter.js';
import type {
  CompatiblePlaybookRuntimeFactory,
  ComposedPlaybookPorts,
  ComposedV3FactoryInput,
  SessionPlaybookRuntime,
} from '../src/playbook-contract.js';

const cases = (['compile', 'link'] as const).flatMap((kind) =>
  (['interpreted', 'compiled-player', 'compiled-captain'] as const).map(
    (strategy) => ({ kind, strategy }),
  ),
);

describe('definition reference origin across execution strategies (phase-execution-63)', () => {
  it.each(cases)(
    '$strategy $kind work reads definition siblings outside its cwd without altering control calls',
    async ({ kind, strategy }) => {
      const root = await mkdtemp(join(tmpdir(), 'slc-definition-origin-'));
      try {
        const workspace = join(root, 'workspace');
        const cwd = join(workspace, 'agent working directory');
        const definitions = join(root, 'définitions "outside"');
        await mkdir(cwd, { recursive: true });
        await mkdir(join(definitions, 'references'), { recursive: true });
        const definitionPath = join(definitions, `${kind}.md`);
        const helperPath = join(definitions, 'materialize.mjs');
        const referencePath = join(definitions, 'references', 'contract.txt');
        const source = join(workspace, 'source.txt');
        const linkTarget = join(workspace, 'runtime.ts');
        const target = join(workspace, `${strategy}-${kind}.txt`);
        const definition =
          '# Définition\r\n\nRead [the helper](./materialize.mjs) and ' +
          '[the contract](./references/contract.txt).\n' +
          'Use the helper to combine the Source and contract into the Target.\n' +
          '> Preserve <definition> and $& literally.\n';
        const helper =
          "export const render = (source, contract) => [source, contract].join('\\n');\n";
        const reference = 'The cited contract is outside the compilation cwd.';
        const sourceText = 'Original source remains unchanged.';
        const runtimeText = 'export const runtime = true;\n';
        const protectedFiles = new Map([
          [definitionPath, definition],
          [helperPath, helper],
          [referencePath, reference],
          [source, sourceText],
          [linkTarget, runtimeText],
        ]);
        await Promise.all(
          [...protectedFiles].map(([path, content]) =>
            writeFile(path, content),
          ),
        );

        const request: ExecuteRequest =
          kind === 'compile'
            ? { kind, definitionPath, source, target }
            : {
                kind,
                definitionPath,
                objects: [source],
                linkTarget,
                options: [{ name: 'literal', value: 'définition=$&' }],
                linked: target,
              };
        const expectedSeed =
          request.kind === 'compile'
            ? { kind, source, target }
            : {
                kind,
                objects: [source],
                linkTarget,
                options: { literal: 'définition=$&' },
                linked: target,
              };
        const calls: AgentRunRequest[] = [];
        const routingPrompt = 'Choose the route without doing the work.';
        const judgePrompt = 'Judge whether the artifact was written.';
        const agent: AgentClient = {
          async run(transport) {
            calls.push(transport);
            expect(transport.cwd).toBe(cwd);
            expect(transport.model).toBe('fixture-model');
            if (
              transport.prompt === routingPrompt ||
              transport.prompt === judgePrompt
            ) {
              expect(transport.allowedTools).toEqual([]);
              expect(transport.resume).toBe(false);
              return { status: 'success', text: 'accepted' };
            }
            expect(transport.allowedTools).toBeUndefined();
            expect(transport.prompt).toContain(definition);
            const field = (name: string): string => {
              const prefix = `- ${name}: `;
              const lines = transport.prompt
                .split('\n')
                .filter((line) => line.startsWith(prefix));
              expect(lines).toHaveLength(1);
              const value: unknown = JSON.parse(lines[0].slice(prefix.length));
              expect(typeof value).toBe('string');
              return value as string;
            };
            const actualDefinition = field('definition file');
            const actualDirectory = field('definition directory');
            expect(isAbsolute(actualDefinition)).toBe(true);
            expect(actualDefinition).toBe(definitionPath);
            expect(actualDirectory).toBe(dirname(actualDefinition));
            expect(actualDirectory).not.toBe(cwd);
            expect(await readFile(actualDefinition, 'utf8')).toBe(definition);
            const contract = await readFile(
              join(actualDirectory, 'references/contract.txt'),
              'utf8',
            );
            const materializer = (await import(
              pathToFileURL(join(actualDirectory, 'materialize.mjs')).href
            )) as { render(source: string, contract: string): string };
            // Read the work paths from the actual transported request, not
            // from the definition directory or agent's different cwd.
            const seedLine = transport.prompt
              .split('\n')
              .find((line) => line.startsWith('Request: '));
            let inputPath: string;
            let outputPath: string;
            if (seedLine !== undefined) {
              const seed = JSON.parse(seedLine.slice('Request: '.length)) as {
                source?: string;
                objects?: string[];
                target?: string;
                linked?: string;
              };
              expect(seed).toEqual(expectedSeed);
              inputPath = seed.source ?? seed.objects![0];
              outputPath = seed.target ?? seed.linked!;
            } else {
              const inputLabel =
                kind === 'compile'
                  ? '- source to read: '
                  : '- object artifacts to read, in order: ';
              inputPath = transport.prompt
                .split('\n')
                .find((line) => line.startsWith(inputLabel))!
                .slice(inputLabel.length);
              const outputLabel = '- artifact to write: ';
              outputPath = transport.prompt
                .split('\n')
                .find((line) => line.startsWith(outputLabel))!
                .slice(outputLabel.length);
            }
            await writeFile(
              outputPath,
              materializer.render(await readFile(inputPath, 'utf8'), contract),
            );
            return { status: 'success', text: 'Wrote the declared target.' };
          },
        };
        const constructions: unknown[] = [];
        let disposals = 0;
        const factory: CompatiblePlaybookRuntimeFactory = (options) => {
          constructions.push(options);
          const configuredDefinition =
            strategy === 'compiled-captain'
              ? (options as ComposedV3FactoryInput).configuredOptions.definition
              : definition;
          if (strategy === 'compiled-captain') {
            expect(
              (options as ComposedV3FactoryInput).configuredOptions,
            ).toEqual({ definition });
          } else {
            expect(options).toEqual({});
          }
          let ports: ComposedPlaybookPorts;
          const runtime: SessionPlaybookRuntime = {
            async init(session) {
              ports = session.ports;
            },
            async handleBossInput({ text, signal }) {
              expect(text).not.toContain('definition file:');
              expect(text).not.toContain(definition);
              const seed = text
                .split('\n')
                .find((line) => line.startsWith('Request: '))!;
              const performingPrompt = `${configuredDefinition}\n\n${seed}`;
              await ports.callCaptain(routingPrompt, signal, {
                visibility: 'hidden',
                resume: false,
                allowedTools: [],
              });
              if (strategy === 'compiled-player') {
                await ports.callPlayer('writer', performingPrompt, signal, {
                  resume: false,
                });
              } else {
                await ports.callCaptain(performingPrompt, signal, {
                  visibility: 'visible',
                  resume: false,
                });
              }
              await ports.callJudge(judgePrompt, signal);
              return {
                outcome: 'terminal',
                state: {
                  value: 'done',
                  activeStateIds: ['done'],
                  tags: [],
                  status: 'done',
                  quiescent: true,
                  stateId: 'done',
                },
              };
            },
            async dispose() {
              disposals += 1;
            },
          };
          return runtime;
        };
        Object.defineProperty(factory, 'compat', {
          value: Object.freeze({ artifactSchema: 3, runtimeAbi: 1 }),
          enumerable: true,
          writable: false,
          configurable: false,
        });
        const executor =
          strategy === 'interpreted'
            ? createInterpretedExecutor({
                agent,
                config: { cwd, model: 'fixture-model' },
              })
            : createCompiledExecutor({
                artifactPath: join(root, 'fixture.playbook.mjs'),
                runRoot: workspace,
                runtimeContract:
                  strategy === 'compiled-player'
                    ? 'composed-v2'
                    : 'composed-v3',
                player: agent,
                judge: agent,
                cwd,
                defaultModel: 'fixture-model',
                loadFactory: async () => factory,
              });
        const result = await runPhase({
          request,
          phase: kind,
          targetExt: '.txt',
          executor,
          protectedInputs: [helperPath, referencePath],
        });
        expect(result, JSON.stringify(result)).toMatchObject({
          ok: true,
          target,
        });
        expect(await readFile(target, 'utf8')).toBe(
          `${sourceText}\n${reference}`,
        );
        for (const [path, content] of protectedFiles) {
          expect(await readFile(path, 'utf8')).toBe(content);
        }
        if (strategy === 'interpreted') {
          expect(calls).toHaveLength(1);
          expect(constructions).toEqual([]);
        } else {
          expect(calls).toHaveLength(3);
          expect(calls[0].prompt).toBe(routingPrompt);
          expect(calls[2].prompt).toBe(judgePrompt);
          expect(constructions).toHaveLength(1);
          expect(disposals).toBe(1);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
