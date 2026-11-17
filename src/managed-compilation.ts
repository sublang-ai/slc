// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
  inspectArtifactEnvironment,
  inspectArtifactFiles,
  prepareArtifactEnvironment,
  validateArtifactManifest,
  type WorkflowBuildManifest,
} from '@sublang/playbook/artifact-environment';
import { artifactDir, parseSource } from './artifacts.js';
import { parseInvocation } from './invocation.js';
import { loadPipeline, resolvePipeline } from './pipeline.js';
import { defaultPlaybookLinkTarget } from './resolver.js';
import { isolatedCheck } from './isolated-check.js';
import { compilationAudit, auditEvent } from './compilation-audit.js';
import { watchProtectedPaths } from './execution.js';
import { messageOf } from './errors.js';
import { compilerIdentity } from './compiler-identity.js';
import { checkFailureCategory } from './check-report.js';
import type { PhaseExecutor } from './execution.js';
import type { SlcDeps, SlcResult } from './runner.js';

const sha = (s: Uint8Array | string): string =>
  createHash('sha256').update(s).digest('hex');
const slash = (s: string): string => s.split(sep).join('/');
const absent = (error: unknown) =>
  !!error &&
  typeof error === 'object' &&
  'code' in error &&
  error.code === 'ENOENT';
async function bytes(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (e) {
    if (absent(e)) return undefined;
    throw e;
  }
}

/** One workflow environment and durable invocation evidence around the generic runner. */
export async function managedCompilation(
  argv: readonly string[],
  deps: SlcDeps,
  run: (argv: readonly string[], deps: SlcDeps) => Promise<SlcResult>,
): Promise<SlcResult> {
  let invocation;
  try {
    invocation = parseInvocation(argv);
  } catch {
    return run(argv, deps);
  }
  if (invocation.pipeline !== 'playbook') return run(argv, deps);
  const cwd = resolve(deps.cwd ?? process.cwd());
  let dir: string;
  let stem: string;
  const semanticInputs = new Set<string>();
  try {
    const pipeline = await loadPipeline(
      await resolvePipeline(invocation.pipeline, deps.resolver),
    );
    for (const phase of [...pipeline.phases, ...pipeline.passes])
      semanticInputs.add(join(pipeline.dir, phase.name + '.md'));
    if (pipeline.linkFile) semanticInputs.add(pipeline.linkFile);
    const installedGrammar = createRequire(import.meta.url);
    for (const grammar of [
      'scaffold/specs/meta.md',
      'scaffold/i18n/zh/specs/meta.md',
    ])
      semanticInputs.add(installedGrammar.resolve('@sublang/spex/' + grammar));
    const sidecar = join(pipeline.dir, 'slc.pin-inputs.json');
    const sidecarBytes = await bytes(sidecar);
    if (sidecarBytes) {
      semanticInputs.add(sidecar);
      const declared = JSON.parse(sidecarBytes.toString('utf8')) as {
        closures?: Record<string, string[]>;
      };
      for (const paths of Object.values(declared.closures ?? {}))
        for (const path of paths)
          semanticInputs.add(resolve(pipeline.dir, path));
    }
    const phase =
      invocation.kind === 'phase'
        ? [...pipeline.phases, ...pipeline.passes].find(
            (phase) => phase.name === invocation.phase,
          )
        : pipeline.phases[0];
    const source =
      invocation.kind === 'link' ? invocation.objects[0] : invocation.source;
    const sourcePhase = phase ?? pipeline.phases[0];
    stem = parseSource({
      path: resolve(cwd, source),
      sourceFormat:
        invocation.kind === 'link' ? 'fsm' : sourcePhase.source.format,
      ext: invocation.kind === 'link' ? '.ts' : sourcePhase.source.ext,
      entry:
        invocation.kind !== 'link' &&
        (invocation.kind !== 'phase' || sourcePhase === pipeline.phases[0]),
      staged: true,
    }).basename;
    dir = artifactDir(cwd, stem, 'playbook');
  } catch {
    return run(argv, deps);
  }
  const entry = join(cwd, stem + '.mjs');
  const manifestPath = join(dir, 'build-manifest.json');
  const saved = new Map<string, Buffer>();
  const priorLinks: { path: string; target?: string }[] = [];
  const attempt = join(
    dir,
    '.slc',
    'attempts',
    new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID(),
  );
  let prepared = false;
  let result: SlcResult = { ok: false, outputs: [], diagnostics: [] };
  try {
    // Only a previously validated managed bundle can be restored as accepted.
    if ((await bytes(manifestPath)) && (await bytes(entry))) {
      try {
        const old = await validateArtifactManifest(entry);
        if (old) {
          for (const file of old.files.filter((file) =>
            ['entry', 'fsm', 'linked', 'runtime-support'].includes(file.kind),
          ))
            saved.set(
              resolve(dir, file.path),
              await readFile(resolve(dir, file.path)),
            );
          saved.set(manifestPath, await readFile(manifestPath));
          const latest = await bytes(join(dir, '.slc', 'latest'));
          if (latest) saved.set(join(dir, '.slc', 'latest'), latest);
        }
      } catch {
        /* A changed retained bundle must be revalidated, never silently reused. */
      }
    }
    const metadata = await bytes(join(dir, 'package.json'));
    if (metadata) saved.set(join(dir, 'package.json'), metadata);
    for (const path of [
      join(dir, 'node_modules', 'xstate'),
      join(dir, 'node_modules', '@sublang', 'playbook'),
    ]) {
      let target: string | undefined;
      try {
        if ((await lstat(path)).isSymbolicLink()) target = await readlink(path);
      } catch (e) {
        if (!absent(e)) throw e;
      }
      priorLinks.push({ path, target });
    }
    const environment = await inspectArtifactEnvironment();
    const compiler = await compilerIdentity();
    if ('linkTarget' in invocation && invocation.linkTarget) {
      if (
        sha(await readFile(resolve(cwd, invocation.linkTarget))) !==
        sha(await readFile(defaultPlaybookLinkTarget()))
      )
        throw new Error(
          'environment: custom link target does not establish the selected runtime identity; use the installed Playbook runtime contract',
        );
    }
    await prepareArtifactEnvironment({
      artifactDir: dir,
      environment,
      authority: 'compiler',
    });
    prepared = true;
    await mkdir(attempt, { recursive: true, mode: 0o700 });
    return await compilationAudit.run(
      { path: join(attempt, 'events.jsonl') },
      async () => {
        const inputs: WorkflowBuildManifest['inputs'] = [];
        let serial = 0;
        const capture = async (path: string, label: string) => {
          const data = await bytes(path);
          if (!data) return;
          const snapshot = join(
            attempt,
            `${String(++serial).padStart(4, '0')}-${label}-${basename(path)}`,
          );
          await writeFile(snapshot, data, { mode: 0o600 });
          await auditEvent('file-snapshot', {
            path,
            snapshot: slash(relative(dir, snapshot)),
            sha256: sha(data),
            size: data.length,
          });
          return {
            path,
            sha256: sha(data),
            snapshot: slash(relative(dir, snapshot)),
          };
        };
        const sources =
          invocation.kind === 'link' ? invocation.objects : [invocation.source];
        for (const path of sources) {
          const item = await capture(resolve(cwd, path), 'input');
          if (item) inputs.push(item);
        }
        for (const path of semanticInputs) {
          const item = await capture(path, 'semantic-input');
          if (item) inputs.push(item);
        }
        await auditEvent('invocation-start', {
          argv,
          cwd,
          compiler,
          configuration: deps.auditConfiguration,
          coverage: deps.coverage,
          environment,
          platform: process.platform,
          node: process.version,
        });
        const decorate = (executor: PhaseExecutor): PhaseExecutor => ({
          run: async (request, signal) => {
            const target =
              request.kind === 'compile' ? request.target : request.linked;
            const installed = createRequire(import.meta.url);
            for (const dependency of [
              'typescript',
              '@types/node/package.json',
            ]) {
              try {
                installed.resolve(dependency);
              } catch {
                throw new Error(
                  `environment: missing compiler-owned ${dependency}; reinstall SLC with production dependencies`,
                );
              }
            }
            if (
              !(process.features as { typescript?: unknown }).typescript ||
              !process.allowedNodeEnvironmentFlags.has('--allow-net')
            )
              throw new Error(
                'environment: SLC compilation requires native TypeScript and network-permission support; use Node >=25.5.0',
              );
            await auditEvent('phase-start', request);
            const definition = await capture(
              request.definitionPath,
              'definition',
            );
            if (definition) inputs.push(definition);
            const auditContext = compilationAudit.getStore();
            const targetParent = await realpath(dirname(target)).catch(
              () => undefined,
            );
            if (auditContext && targetParent)
              auditContext.target = { path: target, parent: targetParent };
            await capture(target, 'before');
            const started = performance.now();
            try {
              const value = await executor.run(request, signal);
              await auditEvent('phase-return', {
                target,
                elapsedMs: Math.round(performance.now() - started),
                value,
              });
              return value;
            } finally {
              await capture(target, 'after');
              if (auditContext) delete auditContext.target;
            }
          },
        });
        let invalidReuse: boolean;
        if (await bytes(manifestPath)) {
          try {
            const recorded = await validateArtifactManifest(entry);
            invalidReuse =
              !recorded ||
              recorded.compiler.version !== compiler.version ||
              recorded.compiler.buildIdentity !== compiler.buildIdentity;
          } catch {
            invalidReuse = true;
          }
        } else invalidReuse = true;
        const args = argv;
        const finalize = async (candidate: SlcResult): Promise<SlcResult> => {
          let checked = candidate;
          if (checked.ok && checked.outputs.includes(entry)) {
            const fsm = join(dir, stem + '.fsm.ts');
            const linked = join(dir, stem + '.playbook.ts');
            const protectedUnchanged = await watchProtectedPaths([
              ...new Set(inputs.map((input) => input.path)),
            ]);
            const findings = [
              ...(await isolatedCheck(
                'lifecycle',
                [entry, fsm, undefined],
                deps.signal,
              )),
              ...(await protectedUnchanged()),
            ];
            await auditEvent('entry-lifecycle', {
              findings,
              businessExecution: false,
            });
            if (findings.length)
              checked = {
                ok: false,
                outputs: checked.outputs,
                diagnostics: [...checked.diagnostics, ...findings],
              };
            else {
              const files = await inspectArtifactFiles({
                artifactDir: dir,
                entry,
                fsm,
                linked,
              });
              const build: WorkflowBuildManifest = {
                schema: 'sublang.slc.build.v1',
                entry: {
                  path: slash(relative(dir, entry)),
                  format: 'esm-javascript',
                },
                compiler,
                runtime: {
                  playbook: environment.playbook,
                  xstate: environment.xstate,
                  runtimeAbi: environment.runtimeAbi,
                  artifactSchema: 3,
                },
                inputs,
                files,
                verification: {
                  checks: [
                    'phase-contracts',
                    'strict-typescript',
                    'entry-initialize-dispose',
                  ].map((name) => ({
                    name,
                    status: 'passed',
                    evidence: slash(
                      relative(dir, join(attempt, 'events.jsonl')),
                    ),
                  })),
                  attemptRecord: slash(relative(dir, attempt)),
                },
              };
              const pending = manifestPath + '.' + randomUUID() + '.tmp';
              await writeFile(pending, JSON.stringify(build, null, 2) + '\n', {
                flag: 'wx',
              });
              await rename(pending, manifestPath);
              await validateArtifactManifest(entry);
              checked.outputs.push(manifestPath);
            }
          }
          return checked;
        };
        result = await run(args, {
          ...deps,
          finalize,
          revalidateReuse: invalidReuse,
          executor: decorate(deps.executor),
          ...(deps.compiled
            ? {
                compiled: async (selection) =>
                  decorate(await deps.compiled!(selection)),
              }
            : {}),
          progress: (event) => {
            void auditEvent('progress', event);
            deps.progress?.(event);
          },
        });
        if (!result.ok && !result.clarification)
          result.cause = {
            category: deps.signal?.aborted
              ? 'canceled'
              : checkFailureCategory(result.diagnostics),
            source: 'compiler-diagnostic',
          };
        await auditEvent('invocation-finish', result);
        await writeFile(
          join(attempt, 'result.json'),
          JSON.stringify(result, null, 2) + '\n',
          { mode: 0o600 },
        );
        return result;
      },
    );
  } catch (error) {
    const diagnostic = messageOf(error);
    const declaredEnvironment =
      error !== null &&
      typeof error === 'object' &&
      'category' in error &&
      error.category === 'environment';
    const filesystemEnvironment =
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      ['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EIO'].includes(
        String(error.code),
      );
    const classified = checkFailureCategory([diagnostic]);
    const category =
      deps.signal?.aborted || classified === 'canceled'
        ? 'canceled'
        : declaredEnvironment || filesystemEnvironment || !prepared
          ? 'environment'
          : classified === 'artifact' && !/\bartifact:/i.test(diagnostic)
            ? 'checker-failed'
            : classified;
    result = {
      ok: false,
      outputs: [],
      diagnostics: [`${category}: ${diagnostic}`],
    };
    result.cause = {
      category,
      source: 'compiler-diagnostic',
    };
    if (prepared)
      await writeFile(
        join(attempt, 'result.json'),
        JSON.stringify(result, null, 2) + '\n',
        { mode: 0o600 },
      ).catch(() => {});
    return result;
  } finally {
    if (prepared && !result.ok && saved.has(manifestPath)) {
      for (const [path, data] of saved) await writeFile(path, data);
      for (const item of priorLinks) {
        await rm(item.path, { force: true });
        if (item.target)
          await symlink(
            item.target,
            item.path,
            process.platform === 'win32' ? 'junction' : 'dir',
          );
      }
    }
  }
}
