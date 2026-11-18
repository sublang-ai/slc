// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  createRequire,
  registerHooks,
  syncBuiltinESMExports,
} from 'node:module';
import { pathToFileURL } from 'node:url';
import { messageOf } from './errors.js';
import type { CoverageBudget } from './verify-coverage.js';

const observations: Record<string, unknown>[] = [];
const observe = (operation: string, status: string, detail?: unknown) =>
  observations.push({
    operation,
    status,
    at: new Date().toISOString(),
    monotonicMs: performance.now(),
    detail,
  });

async function check(job: string, args: unknown[]): Promise<readonly string[]> {
  const target =
    args[job === 'fsm' || job === 'linked' || job === 'lifecycle' ? 1 : 0];
  if (typeof target === 'string' && job !== 'types') {
    try {
      const selected = pathToFileURL(
        createRequire(target).resolve('xstate'),
      ).href;
      registerHooks({
        resolve(specifier, context, nextResolve) {
          return specifier === 'xstate'
            ? { url: selected, shortCircuit: true }
            : nextResolve(specifier, context);
        },
      });
    } catch (error) {
      return [
        `environment: cannot bind the artifact's selected XState for checking: ${messageOf(error)}`,
      ];
    }
  }
  const { checkFsmTypeScript } = await import('./verify-typescript.js');
  const { checkLinkedModuleContract, loadFsmModule } =
    await import('./verify.js');
  const { checkEntryOptions } = await import('./entry-options.js');
  const { fsmConformanceFindings, fsmContinuationFindings } =
    await import('./runner.js');

  if (job === 'fsm') {
    const [source, target, linkTarget, coverage] = args as [
      string,
      string,
      string | undefined,
      CoverageBudget,
    ];
    const types = await checkFsmTypeScript(target);
    return types.length
      ? types
      : fsmConformanceFindings(
          source,
          target,
          typeof linkTarget === 'string' ? linkTarget : undefined,
          undefined,
          coverage,
        );
  }
  if (job === 'continuation') {
    const [source, target, coverage] = args as [
      string,
      string | undefined,
      CoverageBudget,
    ];
    return fsmContinuationFindings(source, target, undefined, coverage);
  }
  if (job === 'linked') {
    const [linkedPath, fsmPath, entryRequired] = args as [
      string,
      string,
      boolean,
    ];
    const { linkObjectEdges } = await import('./emitted-imports.js');
    const edges = await linkObjectEdges(linkedPath, fsmPath);
    if (edges.javascript.length)
      return [
        `artifact: linked runtime imports an unchecked JavaScript FSM sibling (${edges.javascript.join(', ')}); import the actual checked TypeScript FSM ${fsmPath}`,
      ];
    return [
      ...(await checkFsmTypeScript(linkedPath, undefined, [fsmPath])),
      ...(await checkLinkedModuleContract({ linkedPath, fsmPath })),
      ...(entryRequired
        ? await checkEntryOptions({ linkedPath, fsmPath })
        : []),
    ];
  }
  if (job === 'types') return checkFsmTypeScript(args[0] as string);
  if (job === 'lifecycle') {
    try {
      const denyNetwork = () => {
        throw new Error(
          'initialization attempted forbidden external-service mutation',
        );
      };
      for (const [module, names] of [
        ['node:http', ['request', 'get']],
        ['node:https', ['request', 'get']],
        ['node:net', ['connect', 'createConnection']],
        ['node:tls', ['connect']],
        ['node:dgram', ['createSocket']],
      ] as const) {
        const builtin = (await import(module)).default as Record<
          string,
          unknown
        >;
        for (const name of names) builtin[name] = denyNetwork;
      }
      globalThis.fetch = denyNetwork;
      syncBuiltinESMExports();
      const [entryPath, fsmPath, supplied] = args as [string, string, unknown];
      const types = await checkFsmTypeScript(entryPath);
      if (types.length) return types;
      const entry = (await import(pathToFileURL(entryPath).href)).default;
      if (
        !entry ||
        typeof entry.createRuntime !== 'function' ||
        typeof entry.validateOptions !== 'function'
      )
        return ['artifact: entry lacks validateOptions/createRuntime'];
      let options: unknown;
      try {
        observe('validateOptions', 'started', {
          supplied:
            supplied === undefined
              ? 'absent empty-slice probe'
              : 'explicit fixture',
        });
        options = entry.validateOptions(supplied);
        observe('validateOptions', 'passed', options);
      } catch (error) {
        return [
          `unverified: safe initialization needs a source-permitted startup option fixture: ${messageOf(error)}`,
        ];
      }
      const req = createRequire(fsmPath);
      const engine = await import(
        pathToFileURL(req.resolve('@sublang/playbook/xstate-runtime')).href
      );
      const effects: string[] = [];
      const forbid = (name: string) => () => {
        effects.push(name);
        throw new Error(
          `initialization attempted forbidden business effect: ${name}`,
        );
      };
      const hostCapabilities = {
        authority: { concurrentRoleSets: entry.concurrentRoleSets ?? [] },
        repository: {
          runExclusive: forbid('repository.runExclusive'),
          runDeferred: forbid('repository.runDeferred'),
          runCohort: forbid('repository.runCohort'),
        },
        effectLedger: {
          snapshot: engine.emptyPlaybookEffectLedger,
          writeAhead: forbid('effectLedger.writeAhead'),
        },
      };
      observe('construct', 'started');
      const runtime = entry.createRuntime(options, hostCapabilities);
      observe('construct', 'passed');
      if (
        typeof runtime?.init !== 'function' ||
        typeof runtime?.dispose !== 'function'
      )
        return ['artifact: entry factory lacks init/dispose'];
      const sessionId = 'slc-verification';
      try {
        observe('initialize', 'started', {
          sessionId,
          requiredRoleIds: entry.requiredRoleIds,
        });
        await runtime.init({
          sessionId,
          playbookId: entry.id,
          rootSessionId: sessionId,
          depth: 0,
          roleBindings: Object.fromEntries(
            entry.requiredRoleIds.map((role: string) => [
              role,
              { playerId: `slc.${role}`, promptIdentity: `SLC ${role}` },
            ]),
          ),
          ports: {
            callPlayer: forbid('callPlayer'),
            callCaptain: forbid('callCaptain'),
            callJudge: forbid('callJudge'),
            callPlaybook: forbid('callPlaybook'),
            emitStatus: async () => {},
            emitTelemetry: async () => {},
          },
        });
        observe('initialize', 'passed');
      } finally {
        observe('dispose', 'started');
        await runtime.dispose();
        observe('dispose', 'passed');
      }
      if (effects.length)
        return [
          `artifact: initialization performed business work: ${effects.join(', ')}`,
        ];
      // Ensure native import of the actual FSM is possible, not a staged substitute.
      await loadFsmModule(fsmPath);
      return [];
    } catch (error) {
      observe('lifecycle', 'failed', messageOf(error));
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : '';
      return [
        `${/MODULE_NOT_FOUND|ENOENT/.test(code) ? 'environment' : 'artifact'}: entry lifecycle failed: ${messageOf(error)}`,
      ];
    }
  }
  throw new Error(`unknown isolated check ${job}`);
}

// Capture the reporting capability before importing any candidate artifact.
const sendReport = process.send?.bind(process);
if (sendReport) {
  Object.defineProperty(process, 'send', {
    value: undefined,
    writable: false,
    configurable: false,
  });
  process.once(
    'message',
    (message: { job: string; args: unknown[]; token: string }) => {
      const { job, args, token } = message;
      delete (message as Partial<typeof message>).token;
      const complete = (findings: readonly string[]) =>
        sendReport({
          schema: 'sublang.slc.check-report.v1',
          job,
          token,
          status: 'completed',
          findings,
          observations,
        });
      void (async () => {
        try {
          if (!process.permission || process.permission.has('net')) {
            complete([
              'environment: checker requires native denied-network permissions',
            ]);
            return;
          }
          complete(await check(job, args));
        } catch (error) {
          complete([
            error instanceof Error && error.name === 'FsmCoverageDeadlineError'
              ? `unverified: bounded coverage duration exhausted: ${messageOf(error)}`
              : `checker-failed: ${messageOf(error)}`,
          ]);
        }
      })();
    },
  );
}
