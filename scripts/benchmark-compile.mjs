// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** Opt-in, bounded live compilation measurement. Never imported by the CLI. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  delimiter,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const MINIMAL_WORKFLOW = `Before work begins, ensure the current directory is the root of its own Git repository; if .git is absent there, initialize a repository there.
Use one agent to carry out the input task.
The agent modifies the code in the current directory as the task requires and commits the result to Git.
`;

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const identity = (path) => {
  const bytes = readFileSync(path);
  return { path, bytes: bytes.length, sha256: hash(bytes) };
};
const elapsed = (start) => Math.round(performance.now() - start);

/** Use the measured compiler's private discovery modules, never our own resolver. */
export async function pipelineInputDiscovery(root) {
  try {
    const modules = await Promise.all(
      ['pins', 'pin-inputs', 'pin-closure', 'pipeline'].map(
        (name) => import(pathToFileURL(join(root, 'dist', `${name}.js`)).href),
      ),
    );
    const api = Object.assign({}, ...modules);
    if (
      [
        'loadPinFile',
        'loadPinInputsFile',
        'deriveClosureWithDeclaration',
        'discoverPhaseFiles',
      ].some((name) => typeof api[name] !== 'function')
    )
      return undefined;
    return api;
  } catch {
    return undefined;
  }
}

export async function pipelineInputIdentity(pipeline, discovery) {
  if (!discovery)
    return {
      status: 'unavailable',
      reason: 'measured-compiler-closure-api-unavailable',
    };
  try {
    const pins = await discovery.loadPinFile(pipeline);
    const boundary = pins.file?.pathBoundary.path ?? '.';
    const sidecar = await discovery.loadPinInputsFile(pipeline, boundary);
    const { phaseFiles, linkFile } =
      await discovery.discoverPhaseFiles(pipeline);
    const paths = new Set([pins.path, sidecar.path].filter(Boolean));
    const phases = [];
    for (const definition of [...phaseFiles, ...(linkFile ? [linkFile] : [])]) {
      const name = basename(definition, '.md');
      const closure = await discovery.deriveClosureWithDeclaration(
        pipeline,
        boundary,
        basename(definition),
        name,
        (path) => paths.add(path),
        sidecar,
      );
      for (const path of closure.paths) paths.add(path);
      phases.push({
        name,
        declaration: closure.declaration,
        paths: [...closure.paths].sort(),
      });
    }
    const files = [...paths].sort().map(identity);
    return {
      status: 'complete',
      boundary,
      phases,
      files,
      sha256: hash(JSON.stringify(files)),
    };
  } catch (error) {
    return {
      status: 'incomplete',
      reason: 'declared-input-discovery-failed',
      ...(typeof error.code === 'string' ? { code: error.code } : {}),
    };
  }
}

export function parseArguments(args) {
  const options = { pipelinePaths: [] };
  const values = {
    '--source': 'source',
    '--link-target': 'linkTarget',
    '--config': 'config',
    '--agent': 'agent',
    '--model': 'model',
    '--effort': 'effort',
    '--output': 'output',
    '--timeout-seconds': 'timeoutSeconds',
    '--pipeline': 'pipeline',
    '--label': 'label',
    '--runtime-check': 'runtimeCheck',
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') options.help = true;
    else if (arg === '--no-optimize') options.optimize = false;
    else if (arg === '--fresh-phase-sessions')
      options.freshPhaseSessions = true;
    else if (arg === '--review') options.review = true;
    else if (arg === '--pipeline-path') {
      const path = args[++index];
      if (!path || path.startsWith('--'))
        throw new Error(`${arg} needs a value`);
      options.pipelinePaths.push(resolve(path));
    } else if (Object.hasOwn(values, arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--'))
        throw new Error(`${arg} needs a value`);
      options[values[arg]] = value;
    } else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

/** Keep accounting fields, never arbitrary provider prose or opaque tokens. */
function accounting(value) {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map(accounting);
  if (value === null || typeof value !== 'object') return undefined;
  const numeric = new Set([
    'inputTokens',
    'outputTokens',
    'toolUses',
    'tokens',
    'totals',
    'records',
    'input',
    'output',
    'total',
    'uncached',
    'cacheRead',
    'cacheWrite',
    'visible',
    'reasoning',
    'requests',
    'cost',
    'amount',
    'pricedUnits',
    'quantity',
  ]);
  const strings = new Set([
    'coverage',
    'model',
    'provider',
    'currency',
    'source',
    'name',
  ]);
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (strings.has(key) && typeof item === 'string') return [[key, item]];
      if (!numeric.has(key)) return [];
      const captured = accounting(item);
      return captured === undefined ? [] : [[key, captured]];
    }),
  );
}

export function measureAdapter(
  adapter,
  { calls, currentPhase, record, checkpoint, freshPhaseSessions },
) {
  let previousPhase;
  return {
    agent: adapter.agent,
    isAvailable: () => adapter.isAvailable(),
    async *run(prompt, options = {}) {
      const phase = currentPhase();
      const requestedResume = typeof options.resume === 'string';
      if (freshPhaseSessions && phase !== previousPhase) {
        options = { ...options };
        delete options.resume;
      }
      previousPhase = phase;
      const started = performance.now();
      const call = {
        id: calls.length + 1,
        phase,
        agent: adapter.agent,
        model: options.model ?? null,
        effort: options.effort ?? null,
        fastMode: options.fastMode ?? null,
        resumed: typeof options.resume === 'string',
        requestedResume,
        toolRestriction:
          options.allowedTools === undefined ? 'native' : 'restricted',
        promptBytes: Buffer.byteLength(prompt),
        promptSha256: hash(prompt),
        startedAt: new Date().toISOString(),
        status: 'incomplete',
        events: {},
        toolCalls: 0,
      };
      calls.push(call);
      record({ kind: 'call-start', ...call });
      checkpoint();
      try {
        for await (const event of adapter.run(prompt, options)) {
          call.firstEventMs ??= elapsed(started);
          call.events[event.type] = (call.events[event.type] ?? 0) + 1;
          if (event.type === 'tool_use') call.toolCalls++;
          if (event.type === 'done') {
            call.status = event.payload.status;
            call.providerDurationMs = event.payload.durationMs;
            call.usage = accounting(event.payload.usage);
          }
          yield event;
        }
      } catch (error) {
        call.status = options.abortSignal?.aborted ? 'interrupted' : 'error';
        throw error;
      } finally {
        call.elapsedMs = elapsed(started);
        record({ kind: 'call-finish', ...call });
        checkpoint();
      }
    },
  };
}

/** Child validation inherits the experiment abort; its output stays in the log. */
function command(commandPath, args, cwd, signal, log) {
  return new Promise((resolveResult) => {
    if (signal.aborted)
      return resolveResult({ ok: false, status: 'interrupted' });
    const child = spawn(commandPath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let forceKill;
    const abort = () => {
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 5000);
    };
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => log(chunk.toString()));
    child.stderr.on('data', (chunk) => log(chunk.toString()));
    child.once('error', (error) => log(`${error.stack ?? error}\n`));
    child.once('close', (code, terminationSignal) => {
      clearTimeout(forceKill);
      signal.removeEventListener('abort', abort);
      resolveResult({
        ok: code === 0 && !signal.aborted,
        code,
        terminationSignal,
      });
    });
  });
}

/** Check an explicit source-only ESM consumer without changing emitted bytes. */
export async function typecheckArtifacts({ files, work, root, signal, log }) {
  const started = performance.now();
  if (signal.aborted) return { ok: false, status: 'interrupted', elapsedMs: 0 };
  const consumer = mkdtempSync(join(dirname(work), 'typecheck-'));
  cpSync(work, consumer, {
    recursive: true,
    filter: (path) => !relative(work, path).split(sep).includes('node_modules'),
  });
  symlinkSync(
    realpathSync(join(work, 'node_modules')),
    join(consumer, 'node_modules'),
    'dir',
  );
  writeFileSync(join(consumer, 'package.json'), '{"type":"module"}\n');
  const inputs = [...new Set(files)].map(identity);
  const sources = inputs.map(({ path }) => {
    const locator = relative(work, path);
    if (locator === '..' || locator.startsWith(`..${sep}`))
      throw new Error(
        'Type-check input is outside the isolated benchmark workspace',
      );
    return join(consumer, locator);
  });
  const compiler = join(root, 'node_modules/typescript/lib/tsc.js');
  const args = [
    '--ignoreConfig',
    '--noEmit',
    '--strict',
    '--noUnusedLocals',
    '--noUnusedParameters',
    '--noImplicitOverride',
    '--verbatimModuleSyntax',
    '--esModuleInterop',
    '--forceConsistentCasingInFileNames',
    '--skipLibCheck',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--lib',
    'ES2022',
    '--allowImportingTsExtensions',
    '--erasableSyntaxOnly',
    '--isolatedModules',
    '--moduleDetection',
    'force',
    '--noFallthroughCasesInSwitch',
    '--types',
    'node',
    '--typeRoots',
    join(root, 'node_modules/@types'),
    ...sources,
  ];
  const result = await command(
    process.execPath,
    [compiler, ...args],
    consumer,
    signal,
    log,
  );
  const unchanged = inputs.every(
    ({ path, sha256 }) => identity(path).sha256 === sha256,
  );
  return {
    ...result,
    ok: result.ok && unchanged,
    unchanged,
    inputs,
    compiler: identity(compiler),
    args,
    consumer,
    elapsedMs: elapsed(started),
  };
}

export async function validateArtifacts({
  result,
  work,
  root,
  signal,
  log,
  runtimeCheck,
}) {
  const entries = readdirSync(work).filter((name) => name.endsWith('.ts'));
  const tests = [];
  for (const name of readdirSync(work)) {
    if (!name.endsWith('.playbook')) continue;
    for (const member of readdirSync(join(work, name))) {
      if (member.endsWith('.test.ts')) tests.push(join(work, name, member));
    }
  }
  const requiredSuites = [
    '.gears-fsm.test.ts',
    '.fsm.introspect.test.ts',
    '.prompt-contract.test.ts',
    '.fsm.coverage.test.ts',
  ];
  const missingSuites = requiredSuites.filter(
    (suffix) => !tests.some((path) => path.endsWith(suffix)),
  );
  if (
    entries.length !== 1 ||
    missingSuites.length > 0 ||
    result.outputs.length === 0
  ) {
    log(
      'Validation requires one emitted entry and emitted verification tests.\n',
    );
    return {
      ok: false,
      entryCount: entries.length,
      testFiles: tests.length,
      missingSuites,
    };
  }
  const entry = join(work, entries[0]);
  const typecheck = await typecheckArtifacts({
    files: [entry, ...result.outputs.filter((path) => path.endsWith('.ts'))],
    work,
    root,
    signal,
    log,
  });
  if (!typecheck.ok) return { ok: false, typecheck, testFiles: tests.length };
  const imported = await command(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const entry = (await import(${JSON.stringify(pathToFileURL(entry).href)})).default;
if (typeof entry?.createRuntime !== 'function') throw new Error('Entry has no createRuntime');`,
    ],
    work,
    signal,
    log,
  );
  if (!imported.ok)
    return {
      ok: false,
      typecheck,
      entryImport: imported,
      testFiles: tests.length,
    };
  const config = join(work, 'benchmark.vitest.config.mjs');
  writeFileSync(
    config,
    `export default { test: { include: ['**/*.test.ts'], exclude: ['**/node_modules/**'] } };\n`,
  );
  const suite = await command(
    process.execPath,
    [
      join(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--root',
      work,
      '--config',
      config,
    ],
    work,
    signal,
    log,
  );
  let runtime;
  if (suite.ok && runtimeCheck === 'minimal') {
    const evidencePath = join(work, 'benchmark.runtime.json');
    const started = performance.now();
    const execution = await command(
      process.execPath,
      [join(ROOT, 'scripts/benchmark-runtime.mjs'), entry, evidencePath],
      work,
      signal,
      log,
    );
    const evidence = existsSync(evidencePath)
      ? JSON.parse(readFileSync(evidencePath, 'utf8'))
      : {};
    runtime = {
      ...evidence,
      ...execution,
      ok: execution.ok && evidence.ok === true,
      elapsedMs: elapsed(started),
    };
  }
  return {
    ok: suite.ok && (runtimeCheck !== 'minimal' || runtime?.ok === true),
    typecheck,
    ...(runtime ? { runtime } : {}),
    entryImport: imported,
    suite,
    testFiles: tests.length,
  };
}

/** Fixed-FSM experiments validate only linking, never claim full compilation. */
export async function validateLinkedArtifact({
  result,
  source,
  originalSource,
  sourceSha256,
  root,
  work,
  signal,
  log,
}) {
  const unchanged = [source, originalSource]
    .filter(Boolean)
    .every(
      (path) => existsSync(path) && identity(path).sha256 === sourceSha256,
    );
  if (
    !unchanged ||
    result.outputs.length !== 1 ||
    !existsSync(result.outputs[0])
  ) {
    log(
      'Link validation requires one linked output and unchanged FSM inputs.\n',
    );
    return {
      ok: false,
      sourceUnchanged: unchanged,
      linkedCount: result.outputs.length,
    };
  }
  const checked = await command(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const verify = await import(process.argv[1]);
     verify.findMachineConfig(await verify.loadFsmModule(process.argv[2]));
     const findings = await verify.checkLinkedModuleContract({ fsmPath: process.argv[2], linkedPath: process.argv[3] });
     for (const finding of findings) console.error(finding);
     if (findings.length) process.exitCode = 1;`,
      pathToFileURL(join(root, 'dist/verify.js')).href,
      source,
      result.outputs[0],
    ],
    work,
    signal,
    log,
  );
  const sourceUnchanged = [source, originalSource]
    .filter(Boolean)
    .every(
      (path) => existsSync(path) && identity(path).sha256 === sourceSha256,
    );
  if (!sourceUnchanged)
    log('FSM inputs changed during linked-module validation.\n');
  const typecheck =
    checked.ok && sourceUnchanged
      ? await typecheckArtifacts({
          files: [source, result.outputs[0]],
          root,
          work,
          signal,
          log,
        })
      : undefined;
  return {
    ok: checked.ok && sourceUnchanged && typecheck?.ok === true,
    ...(typecheck ? { typecheck } : {}),
    sourceUnchanged,
    linkedContract: checked,
  };
}

/** Injection is for fixture integration only; production uses the built compiler. */
export async function benchmarkCompile(options, injected = {}) {
  const timeoutSeconds = Number(options.timeoutSeconds ?? 1200);
  if (
    !Number.isFinite(timeoutSeconds) ||
    timeoutSeconds <= 0 ||
    timeoutSeconds > 2147483
  ) {
    throw new Error('--timeout-seconds must be positive and at most 2147483');
  }
  if (!options.model?.trim())
    throw new Error('--model is required for attributable measurements');
  if (options.runtimeCheck !== undefined && options.runtimeCheck !== 'minimal')
    throw new Error('--runtime-check must be minimal');
  const scope = options.linkTarget === undefined ? 'full' : 'link';
  if (scope === 'link') {
    if (!options.source?.endsWith('.fsm.ts'))
      throw new Error('--link-target requires explicit --source <name>.fsm.ts');
    if (options.optimize === false || options.runtimeCheck !== undefined)
      throw new Error(
        '--no-optimize and --runtime-check are not valid for link-only measurements',
      );
  }
  const runtimeCheck =
    scope === 'link'
      ? undefined
      : options.source
        ? options.runtimeCheck
        : 'minimal';
  const linkTarget = scope === 'link' ? resolve(options.linkTarget) : undefined;
  const root = injected.root ?? ROOT;
  const runtime =
    injected.runtime ??
    (await import(pathToFileURL(join(root, 'dist/index.js')).href));
  const outputParent = resolve(
    options.output ?? join(root, '.scratch/benchmarks'),
  );
  mkdirSync(outputParent, { recursive: true });
  const evidence = mkdtempSync(join(outputParent, 'compile-'));
  const work = join(evidence, 'work');
  mkdirSync(work);
  symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'), 'dir');
  const original = options.source ? resolve(options.source) : undefined;
  const source = join(work, original ? basename(original) : 'minimal.txt');
  writeFileSync(source, original ? readFileSync(original) : MINIMAL_WORKFLOW);
  const logPath = join(evidence, 'diagnostics.log');
  const metricPath = join(evidence, 'metrics.jsonl');
  const summaryPath = join(evidence, 'summary.json');
  const log = (text) => {
    appendFileSync(logPath, text);
    injected.stderr?.(text);
  };
  const record = (event) =>
    appendFileSync(metricPath, `${JSON.stringify(event)}\n`);
  const summary = {
    schema: 'sublang.slc.benchmark.v1',
    scope,
    ...(linkTarget === undefined ? {} : { linkTarget: identity(linkTarget) }),
    label: options.label ?? null,
    startedAt: new Date().toISOString(),
    status: 'incomplete',
    source: { ...identity(source), original: original ?? null },
    cold: true,
    runtimeCheck: runtimeCheck ?? null,
    pipeline: options.pipeline ?? 'playbook',
    optimize: scope === 'full' ? options.optimize !== false : null,
    reviewerDisabled: options.review !== true,
    freshPhaseSessions: options.freshPhaseSessions === true,
    timeoutSeconds,
    nodeVersion: process.version,
    dependencies: {},
    phases: [],
    calls: [],
    artifacts: [],
    logs: { diagnostics: logPath, metrics: metricPath },
  };
  const harnessFiles = [
    fileURLToPath(import.meta.url),
    fileURLToPath(new URL('./benchmark-runtime.mjs', import.meta.url)),
  ].map(identity);
  summary.verificationHarness = {
    files: harnessFiles,
    sha256: hash(JSON.stringify(harnessFiles)),
  };
  for (const name of [
    '@sublang/slc',
    '@sublang/playbook',
    '@sublang/cligent',
    '@openai/codex-sdk',
    '@anthropic-ai/claude-agent-sdk',
    'xstate',
    'typescript',
  ]) {
    const path =
      name === '@sublang/slc'
        ? join(root, 'package.json')
        : join(root, 'node_modules', name, 'package.json');
    if (existsSync(path))
      summary.dependencies[name] = JSON.parse(
        readFileSync(path, 'utf8'),
      ).version;
  }
  const runtimeDirectory = join(root, 'dist');
  if (existsSync(runtimeDirectory)) {
    const files = readdirSync(runtimeDirectory)
      .filter((name) => name.endsWith('.js'))
      .sort()
      .map((name) => {
        const { bytes, sha256 } = identity(join(runtimeDirectory, name));
        return { name, bytes, sha256 };
      });
    summary.compilerRuntime = {
      path: runtimeDirectory,
      files,
      sha256: hash(JSON.stringify(files)),
    };
  }
  if (existsSync(join(root, 'package-lock.json')))
    summary.lock = identity(join(root, 'package-lock.json'));
  if (options.config) summary.configFile = identity(resolve(options.config));
  const checkpoint = () =>
    writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Benchmark interrupted'));
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const started = performance.now();
  const timer = setTimeout(() => {
    summary.deadlineExceeded = true;
    controller.abort(new Error('Benchmark experiment deadline exceeded'));
    checkpoint();
  }, timeoutSeconds * 1000);
  let phase;
  const reporter = runtime.createProgressReporter(log);
  const progress = (event) => {
    reporter.sink(event);
    if (event.kind === 'phase-start') {
      phase = {
        name: event.phase,
        target: event.target,
        status: 'incomplete',
        startMs: elapsed(started),
      };
      summary.phases.push(phase);
    } else if (event.kind === 'phase-finish' || event.kind === 'phase-fail') {
      if (phase)
        Object.assign(phase, {
          status: event.kind === 'phase-finish' ? 'success' : 'error',
          elapsedMs: event.elapsedMs,
        });
    }
    // Runtime status text can include agent prose: keep it only in diagnostics.
    if (event.kind !== 'status')
      record({ ...event, experimentElapsedMs: elapsed(started) });
    checkpoint();
  };
  const adapterFactory = (agent) =>
    measureAdapter(
      (injected.adapterFactory ?? runtime.defaultAdapterFactory)(agent),
      {
        calls: summary.calls,
        currentPhase: () => phase?.name ?? null,
        record,
        checkpoint,
        freshPhaseSessions: options.freshPhaseSessions === true,
      },
    );
  const selectionFor = (selection) => {
    const selected = { ...selection };
    if (!options.review) delete selected.reviewer;
    summary.selection = selected;
    return selected;
  };
  checkpoint();
  try {
    const env = { ...(injected.env ?? process.env) };
    // One-agent measurements do not accidentally inherit reviewer settings.
    if (!options.review)
      for (const key of Object.keys(env))
        if (key.startsWith('SLC_REVIEWER_')) delete env[key];
    env.SLC_MODEL = options.model;
    if (options.agent) env.SLC_AGENT = options.agent;
    if (options.effort) env.SLC_EFFORT = options.effort;
    const pipelinePaths = options.pipelinePaths ?? [];
    if (pipelinePaths.length > 0)
      env.SLC_PIPELINE_PATH = pipelinePaths
        .map((path) => resolve(path))
        .join(delimiter);
    summary.pipelinePath = env.SLC_PIPELINE_PATH ?? null;
    const deps = await runtime.buildSlcDeps(
      {
        env,
        cwd: work,
        signal: controller.signal,
        progress,
        note: log,
        ...(options.config ? { configPath: resolve(options.config) } : {}),
      },
      (selection, settings) => {
        summary.stallTimeoutMs = settings.stallTimeoutMs;
        return runtime.createConfiguredExecutor(selectionFor(selection), {
          ...settings,
          adapterFactory,
        });
      },
      (selection, settings) =>
        runtime.createConfiguredCompiledFactory(selectionFor(selection), {
          ...settings,
          adapterFactory,
        }),
    );
    const discovery = await pipelineInputDiscovery(root);
    const resolver = deps.resolver;
    deps.resolver = async (reference) => {
      const candidates = await resolver(reference);
      summary.resolvedPipelines ??= {};
      summary.resolvedPipelines[reference] = candidates;
      summary.pipelineInputs ??= {};
      summary.pipelineInputClosures ??= {};
      for (const candidate of candidates) {
        const closure = await pipelineInputIdentity(candidate, discovery);
        summary.pipelineInputClosures[candidate] = closure;
        if (closure.status === 'complete')
          summary.pipelineInputs[candidate] = closure.files;
      }
      checkpoint();
      return candidates;
    };
    const args =
      scope === 'link'
        ? [`${summary.pipeline}.link`, source, linkTarget]
        : [
            summary.pipeline,
            source,
            ...(summary.optimize ? [] : ['--no-optimize']),
          ];
    summary.invocation = args;
    const compileStart = performance.now();
    const result = await runtime.runSlc(args, deps);
    summary.compile = {
      ok: result.ok,
      elapsedMs: elapsed(compileStart),
      outcome: result.outcome ?? null,
    };
    for (const diagnostic of result.diagnostics) log(`${diagnostic}\n`);
    for (const path of result.outputs)
      if (existsSync(path)) summary.artifacts.push(identity(path));
    if (result.ok && !controller.signal.aborted && summary.calls.length > 0) {
      const validationStart = performance.now();
      const validate =
        scope === 'link'
          ? (injected.validateLink ?? validateLinkedArtifact)
          : (injected.validate ?? validateArtifacts);
      summary.validation = await validate({
        result,
        work,
        root,
        signal: controller.signal,
        log,
        runtimeCheck,
        source,
        originalSource: original,
        sourceSha256: summary.source.sha256,
      });
      summary.validation.elapsedMs = elapsed(validationStart);
      summary.status = summary.validation.ok ? 'success' : 'failure';
    } else summary.status = 'failure';
  } catch (error) {
    summary.status = 'failure';
    log(`${error.stack ?? error}\n`);
  } finally {
    clearTimeout(timer);
    reporter.dispose();
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    if (controller.signal.aborted) summary.status = 'failure';
    summary.elapsedMs = elapsed(started);
    summary.finishedAt = new Date().toISOString();
    checkpoint();
  }
  return { summary, summaryPath, evidence };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(`Usage: node scripts/benchmark-compile.mjs --model <model> [options]
  --agent <id> --effort <value> --config <path>
  --source <path>          default: minimal three-line acceptance workflow
  --link-target <path>    link-only comparison; requires --source <name>.fsm.ts
  --runtime-check minimal enable the default runtime acceptance check for a supplied source
  --pipeline-path <path>   repeatable absolute pipeline search roots (pins allowed)
  --pipeline <name>        default: playbook
  --no-optimize            omit optimization passes
  --fresh-phase-sessions  experiment: omit adapter resume on each phase's first call
  --review                retain the configured independent Reviewer
  --output <directory>    evidence parent; every run creates a fresh child
  --timeout-seconds <n>    whole experiment deadline; default: 1200
  --label <text>          experiment label
Link-only success is separate from the cold full-compilation target.
Run npm run build first. Every invocation spends real model calls and retains evidence.
Summary omits prompt/result text; diagnostics.log may contain private source information.`);
    } else {
      const result = await benchmarkCompile(options, {
        stderr: (text) => process.stderr.write(text),
      });
      console.log(`${result.summary.status}: ${result.summaryPath}`);
      process.exitCode = result.summary.status === 'success' ? 0 : 1;
    }
  } catch (error) {
    console.error(`benchmark: ${error.message}`);
    process.exitCode = 1;
  }
}
