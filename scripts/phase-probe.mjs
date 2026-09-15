// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** Opt-in, bounded single-phase measurement; semantic oracles stay outside execution. */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  hash,
  identity,
  measureAdapter,
  pipelineInputDiscovery,
  pipelineInputIdentity,
} from './benchmark-compile.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const milliseconds = (start) => Math.round(performance.now() - start);
function tree(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((e) =>
    e.name === 'node_modules'
      ? []
      : e.isDirectory()
        ? tree(join(root, e.name))
        : e.isFile()
          ? [identity(join(root, e.name))]
          : [],
  );
}
function dependencyGraph(root) {
  const entries = [
    '@sublang/playbook',
    '@sublang/cligent',
    '@anthropic-ai/claude-agent-sdk',
    '@openai/codex-sdk',
    '@sublang/spex',
    'xstate',
    'typescript',
    '@typescript/native',
    '@types/node',
  ];
  const seen = new Set(),
    packages = [],
    entryPoints = [];
  function walk(p) {
    p = realpathSync(p);
    if (seen.has(p)) return;
    seen.add(p);
    const json = identity(join(p, 'package.json')),
      meta = JSON.parse(readFileSync(json.path, 'utf8'));
    const node = {
      name: meta.name,
      version: meta.version,
      root: p,
      metadata: json,
      edges: [],
    };
    packages.push(node);
    const req = createRequire(json.path);
    for (const [name, range] of Object.entries({
      ...meta.dependencies,
      ...meta.optionalDependencies,
      ...meta.peerDependencies,
    })) {
      const candidate = (req.resolve.paths(name) ?? [])
        .map((dir) => join(dir, name))
        .find((dir) => existsSync(join(dir, 'package.json')));
      const edge = {
        name,
        range,
        optional:
          Object.hasOwn(meta.optionalDependencies ?? {}, name) ||
          meta.peerDependenciesMeta?.[name]?.optional === true,
        peer: Object.hasOwn(meta.peerDependencies ?? {}, name),
      };
      if (candidate) {
        edge.root = realpathSync(candidate);
        node.edges.push(edge);
        walk(candidate);
      } else {
        edge.unresolved = true;
        node.edges.push(edge);
      }
    }
  }
  for (const name of entries) {
    const p = join(root, 'node_modules', name);
    if (existsSync(join(p, 'package.json'))) {
      entryPoints.push({ name, root: realpathSync(p) });
      walk(p);
    } else entryPoints.push({ name, unresolved: true });
  }
  return {
    entryPoints,
    packages: packages.sort((a, b) => a.root.localeCompare(b.root)),
    identityBasis:
      'resolved dependency package metadata and edges; code identities recorded separately; optional unavailable dependencies stay explicit',
  };
}
function sanitizeSelection(value) {
  const { agent, model, effort, fastMode, reviewer } = value;
  return { agent, model, effort, fastMode, ...(reviewer ? { reviewer } : {}) };
}
function unchanged(files) {
  return files.every((file) => {
    try {
      return identity(file.path).sha256 === file.sha256;
    } catch {
      return false;
    }
  });
}
/** Corpus authoring metadata never flows into the performing request. */
export function selectCase(manifestPath, id) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.cases))
    throw Error('corpus manifest needs cases');
  const matches = manifest.cases.filter((value) => value && value.id === id);
  if (matches.length !== 1)
    throw Error('case selection must resolve exactly once');
  const { sourcePath, sourceSha256, sourceBytes, phase } = matches[0];
  if (
    typeof id !== 'string' ||
    typeof sourcePath !== 'string' ||
    !/^([a-f0-9]{64})$/.test(sourceSha256 ?? '') ||
    !Number.isSafeInteger(sourceBytes) ||
    sourceBytes < 0 ||
    typeof phase !== 'string'
  )
    throw Error('invalid public case fields');
  return {
    caseId: id,
    source: resolve(dirname(resolve(manifestPath)), sourcePath),
    sourceSha256,
    sourceBytes,
    phase,
  };
}
export async function recordPhase(options, injected = {}) {
  const overallStarted = performance.now();
  if (!/^[-\w]+\.(?:text2gears|gears2fsm)$/.test(options.phase ?? ''))
    throw Error('phase must name one non-link text2gears or gears2fsm phase');
  if (typeof options.model !== 'string' || !options.model.trim())
    throw Error('model is required');
  for (const key of ['source', 'config'])
    if (!options[key]) throw Error(`${key} is required`);
  if (
    ['optimize', 'linkTarget', 'runtimeCheck', 'expected', 'oracle'].some(
      (key) => key in options,
    )
  )
    throw Error(
      'phase scope does not accept full/link/semantic-oracle options',
    );
  const timeoutSeconds = Number(options.timeoutSeconds ?? 300);
  if (!(timeoutSeconds > 0 && timeoutSeconds <= 2147483))
    throw Error('invalid deadline');
  const root = resolve(options.compilerRoot ?? ROOT),
    original = resolve(options.source),
    config = resolve(options.config),
    extension = options.phase.endsWith('.gears2fsm') ? '.gears.md' : '.md';
  const originalIdentity = identity(original),
    configIdentity = identity(config);
  if (options.sourceSha256 && options.sourceSha256 !== originalIdentity.sha256)
    throw Error('source identity does not match selected corpus member');
  if (
    options.sourceBytes !== undefined &&
    options.sourceBytes !== originalIdentity.bytes
  )
    throw Error('source byte count does not match selected corpus member');
  const parent = resolve(options.output ?? join(tmpdir(), 'slc-phase-probes'));
  mkdirSync(parent, { recursive: true });
  const evidence = mkdtempSync(join(parent, 'phase-')),
    work = join(evidence, 'work');
  mkdirSync(work);
  const source = join(work, `workflow${extension}`);
  writeFileSync(source, readFileSync(original));
  symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'), 'dir');
  const paths = {
    summary: join(evidence, 'summary.json'),
    metrics: join(evidence, 'metrics.jsonl'),
    diagnostics: join(evidence, 'diagnostics.log'),
    clarification: join(evidence, 'clarification.json'),
  };
  const summary = {
    schema: 'sublang.slc.phase-probe.v1',
    scope: 'phase',
    caseId: options.caseId ?? null,
    reviewerDisabled: true,
    fixtureInjection:
      injected.runtime !== undefined || injected.adapterFactory !== undefined,
    fastModeRequested: options.fastMode === true,
    phase: options.phase,
    status: 'incomplete',
    startedAt: new Date().toISOString(),
    cold: true,
    timeoutSeconds,
    source: identity(source),
    sourceFixture: originalIdentity,
    configuration: configIdentity,
    invocation: [options.phase, source],
    api: { invoked: false },
    actualCliExit: null,
    cliExecution: 'not-invoked',
    compiler: {
      root,
      node: process.version,
      metadata: identity(join(root, 'package.json')),
      files: tree(join(root, 'dist')).filter((f) => f.path.endsWith('.js')),
    },
    dependencies: dependencyGraph(root),
    harness: {
      files: [
        identity(fileURLToPath(import.meta.url)),
        identity(join(HERE, 'benchmark-compile.mjs')),
      ],
    },
    phases: [],
    calls: [],
    executions: [],
    artifacts: [],
    logs: paths,
  };
  if (existsSync(join(root, 'package-lock.json')))
    summary.lock = identity(join(root, 'package-lock.json'));
  summary.primaryDependencyCode = summary.dependencies.packages
    .filter((p) =>
      [
        '@sublang/playbook',
        '@sublang/cligent',
        '@anthropic-ai/claude-agent-sdk',
        '@openai/codex-sdk',
        '@agentclientprotocol/sdk',
        '@opencode-ai/sdk',
        'xstate',
        'p-queue',
        'typescript',
        '@types/node',
      ].includes(p.name),
    )
    .map((p) => ({
      name: p.name,
      root: p.root,
      files: tree(p.root).filter((f) =>
        /\.(?:mjs|cjs|js|json|node|ts)$/.test(f.path),
      ),
    }));
  const checkpoint = () =>
    writeFileSync(paths.summary, JSON.stringify(summary, null, 2) + '\n');
  const log = (text) => appendFileSync(paths.diagnostics, String(text));
  const record = (event) =>
    appendFileSync(paths.metrics, JSON.stringify(event) + '\n');
  const protectedFiles = [
    summary.source,
    originalIdentity,
    configIdentity,
    summary.compiler.metadata,
    ...summary.compiler.files,
    ...summary.harness.files,
    ...summary.dependencies.packages.map((p) => p.metadata),
    ...summary.primaryDependencyCode.flatMap((p) => p.files),
    ...(summary.lock ? [summary.lock] : []),
  ];
  let runtime;
  try {
    runtime =
      injected.runtime ??
      (await import(pathToFileURL(join(root, 'dist/index.js')).href));
  } catch (error) {
    log(`${error.stack ?? error}\n`);
    summary.status = 'failure';
    summary.preservation = {
      sourceUnchanged: unchanged([summary.source, originalIdentity]),
      cohortUnchanged: unchanged(protectedFiles),
      pipelineClosureComplete: false,
    };
    summary.historyBefore = { apiAvailable: false, published: null };
    summary.history = { apiAvailable: false, published: null };
    summary.comparison = {
      eligible: false,
      reasons: ['runtime-load-failed'],
      scope: 'phase-only',
    };
    summary.phaseAcceptance = { ok: false, fullArtifactValidation: false };
    summary.preparationElapsedMs = milliseconds(overallStarted);
    summary.executionElapsedMs = 0;
    summary.elapsedMs = milliseconds(overallStarted);
    summary.finishedAt = new Date().toISOString();
    checkpoint();
    return { summary, summaryPath: paths.summary, evidence };
  }
  const discovery = await pipelineInputDiscovery(root);
  const abort = new AbortController();
  const started = performance.now();
  let phase;
  const interrupt = () => abort.abort(new Error('phase probe interrupted'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  summary.preparationElapsedMs = milliseconds(overallStarted);
  summary.deadlineScope =
    'compiler execution and acceptance accounting after cohort capture';
  const timer = setTimeout(() => {
    summary.deadlineExceeded = true;
    abort.abort(new Error('phase probe deadline exceeded'));
    checkpoint();
  }, timeoutSeconds * 1000);
  const reporter = runtime.createProgressReporter(log);
  const progress = (event) => {
    reporter.sink(event);
    if (event.kind === 'phase-start') {
      phase = {
        name: event.phase,
        target: event.target,
        status: 'incomplete',
        startMs: milliseconds(started),
      };
      summary.phases.push(phase);
    }
    if (['phase-finish', 'phase-fail'].includes(event.kind) && phase)
      Object.assign(phase, {
        status: event.kind === 'phase-finish' ? 'success' : 'failure',
        elapsedMs: event.elapsedMs,
      });
    if (event.kind !== 'status') record(event);
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
        freshPhaseSessions: false,
      },
    );
  const select = (selection) => {
    const value = { ...selection };
    delete value.reviewer;
    summary.selection = sanitizeSelection(value);
    return value;
  };
  const observed = (executor, selection) => ({
    async run(request, signal) {
      const entry = {
        ...selection,
        definition: identity(request.definitionPath),
        requestKind: request.kind,
        source: request.source ?? null,
        startedAt: new Date().toISOString(),
      };
      summary.executions.push(entry);
      checkpoint();
      try {
        return await executor.run(request, signal);
      } finally {
        entry.finishedAt = new Date().toISOString();
        checkpoint();
      }
    },
  });
  let result;
  const history = await (injected.history ??
    import(pathToFileURL(join(root, 'dist/build-history.js')).href).catch(
      () => undefined,
    ));
  const artifactDir = join(work, `workflow.${options.phase.split('.')[0]}`);
  async function historyState() {
    try {
      return {
        apiAvailable: typeof history?.loadBuildHistory === 'function',
        published:
          typeof history?.loadBuildHistory === 'function'
            ? (await history.loadBuildHistory(artifactDir)) !== null
            : null,
      };
    } catch {
      return { apiAvailable: true, published: null, readFailed: true };
    }
  }
  summary.historyBefore = await historyState();
  checkpoint();
  try {
    const env = { ...(injected.env ?? process.env) };
    for (const key of Object.keys(env))
      if (
        key.startsWith('SLC_REVIEWER_') ||
        [
          'SLC_AGENT',
          'SLC_MODEL',
          'SLC_EFFORT',
          'SLC_FAST_MODE',
          'SLC_PIPELINE_PATH',
        ].includes(key)
      )
        delete env[key];
    env.SLC_FAST_MODE = String(options.fastMode === true);
    env.SLC_MODEL = options.model;
    if (options.agent) env.SLC_AGENT = options.agent;
    if (options.effort) env.SLC_EFFORT = options.effort;
    if (options.pipelinePaths?.length)
      env.SLC_PIPELINE_PATH = options.pipelinePaths
        .map((p) => resolve(p))
        .join(delimiter);
    summary.pipelinePath = env.SLC_PIPELINE_PATH ?? null;
    const deps = await runtime.buildSlcDeps(
      {
        env,
        cwd: work,
        configPath: config,
        signal: abort.signal,
        progress,
        note: log,
      },
      (selection, settings) => {
        summary.stallTimeoutMs = settings.stallTimeoutMs;
        return observed(
          runtime.createConfiguredExecutor(select(selection), {
            ...settings,
            adapterFactory,
          }),
          { kind: 'interpreted' },
        );
      },
      (selection, settings) => {
        const factory = runtime.createConfiguredCompiledFactory(
          select(selection),
          { ...settings, adapterFactory },
        );
        return async (selected) =>
          observed(await factory(selected), {
            kind: 'compiled',
            artifact: identity(
              join(selected.pipelineDir, selected.record.artifact.path),
            ),
            artifactBundle: {
              root: join(
                selected.pipelineDir,
                selected.record.artifactBundle.path,
              ),
              files: tree(
                join(selected.pipelineDir, selected.record.artifactBundle.path),
              ),
            },
            pipeline: selected.pipelineDir,
            phase: selected.phase,
            pin: selected.record,
          });
      },
    );
    const resolver = deps.resolver;
    deps.resolver = async (reference) => {
      const found = await resolver(reference);
      summary.resolvedPipelines ??= {};
      summary.resolvedPipelines[reference] = found;
      summary.pipelineInputs ??= {};
      for (const path of found) {
        const closure = await pipelineInputIdentity(path, discovery);
        summary.pipelineInputs[path] = closure;
        if (closure.status === 'complete')
          protectedFiles.push(...closure.files);
      }
      checkpoint();
      return found;
    };
    summary.api = { invoked: true, returned: false };
    result = await runtime.runSlc(summary.invocation, deps);
    summary.api = {
      invoked: true,
      returned: true,
      ok: result.ok,
      outcome: result.outcome ?? (result.ok ? 'success' : 'failure'),
    };
    for (const diagnostic of result.diagnostics) log(diagnostic + '\n');
    if (result.clarification) {
      writeFileSync(
        paths.clarification,
        JSON.stringify(result.clarification, null, 2) + '\n',
      );
      summary.api.clarification = {
        schema: result.clarification.schema,
        phase: result.clarification.phase,
        target: result.clarification.target,
        sources: result.clarification.sources,
        questionCount: result.clarification.questions.length,
        reportSha256: hash(JSON.stringify(result.clarification)),
      };
    }
    summary.artifacts = result.outputs.filter(existsSync).map(identity);
    summary.phaseAcceptance = {
      basis:
        'ordinary runSlc single-phase generic and applicable registered checks',
      fullArtifactValidation: false,
      ok:
        result.ok &&
        result.outputs.length === 1 &&
        summary.artifacts.length === 1 &&
        !abort.signal.aborted,
    };
    summary.status = abort.signal.aborted
      ? 'interrupted'
      : result.clarification
        ? 'clarification-required'
        : summary.phaseAcceptance.ok
          ? 'success'
          : 'failure';
  } catch (error) {
    summary.status = abort.signal.aborted ? 'interrupted' : 'failure';
    log(`${error.stack ?? error}\n`);
  } finally {
    protectedFiles.push(
      ...summary.executions.flatMap((e) =>
        e.artifact ? [e.artifact, ...e.artifactBundle.files] : [],
      ),
    );
    summary.preservation = {
      sourceUnchanged: unchanged([summary.source, originalIdentity]),
      cohortUnchanged: unchanged(protectedFiles),
      pipelineClosureComplete:
        Object.values(summary.pipelineInputs ?? {}).length > 0 &&
        Object.values(summary.pipelineInputs ?? {}).every(
          (c) => c.status === 'complete',
        ),
    };
    summary.history = await historyState();
    if (milliseconds(started) >= timeoutSeconds * 1000) {
      summary.deadlineExceeded = true;
      abort.abort(new Error('phase probe deadline exceeded'));
    }
    const comparisonReasons = [];
    if (summary.fixtureInjection) comparisonReasons.push('fixture-injection');
    const requiredEntries = [
      '@sublang/cligent',
      '@sublang/playbook',
      'xstate',
      'typescript',
    ];
    const providerPackage = {
      'claude-code': '@anthropic-ai/claude-agent-sdk',
      codex: '@openai/codex-sdk',
      gemini: '@agentclientprotocol/sdk',
      opencode: '@opencode-ai/sdk',
    }[summary.selection?.agent];
    summary.dependencies.required = {
      entries: requiredEntries,
      providerPackage: providerPackage ?? null,
      missing: [
        ...requiredEntries.filter(
          (name) =>
            !summary.dependencies.entryPoints.some(
              (entry) => entry.name === name && !entry.unresolved,
            ),
        ),
        ...(providerPackage &&
        !summary.dependencies.packages.some((p) => p.name === providerPackage)
          ? [providerPackage]
          : []),
      ],
    };
    if (summary.dependencies.required.missing.length > 0)
      comparisonReasons.push('required-dependency-entry-unavailable');
    if (!providerPackage)
      comparisonReasons.push('selected-provider-identity-unavailable');
    if (
      summary.dependencies.packages.some((p) =>
        p.edges.some((e) => e.unresolved && !e.optional),
      )
    )
      comparisonReasons.push('required-dependency-unresolved');
    if (summary.compiler.files.length === 0)
      comparisonReasons.push('compiled-runtime-identity-unavailable');
    if (
      !summary.preservation.sourceUnchanged ||
      !summary.preservation.cohortUnchanged
    ) {
      summary.status = 'failure';
      comparisonReasons.push('protected-or-cohort-input-changed');
    }
    if (!summary.preservation.pipelineClosureComplete)
      comparisonReasons.push('pipeline-input-closure-incomplete');
    if (!summary.history.apiAvailable || summary.history.published === null)
      comparisonReasons.push('history-state-unavailable');
    if (
      result?.clarification &&
      (summary.history.published === true ||
        result.outputs.includes(result.clarification.target))
    ) {
      summary.status = 'failure';
      comparisonReasons.push('clarification-published-output-or-history');
    }
    if (abort.signal.aborted) {
      summary.status = 'interrupted';
      comparisonReasons.push('interrupted');
    }
    summary.comparison = {
      eligible: comparisonReasons.length === 0,
      reasons: comparisonReasons,
      scope: 'phase-only; no semantic-oracle or full-compilation verdict',
    };
    summary.phaseAcceptance ??= {
      ok: false,
      basis:
        'ordinary runSlc single-phase generic and applicable registered checks',
      fullArtifactValidation: false,
    };
    if (
      summary.status !== 'success' ||
      !summary.preservation.pipelineClosureComplete
    )
      summary.phaseAcceptance.ok = false;
    clearTimeout(timer);
    reporter.dispose();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    summary.executionElapsedMs = milliseconds(started);
    summary.elapsedMs = milliseconds(overallStarted);
    summary.finishedAt = new Date().toISOString();
    checkpoint();
  }
  return { summary, summaryPath: paths.summary, evidence };
}

export function parsePhaseArguments(args) {
  const options = { pipelinePaths: [] };
  const values = {
    '--compiler-root': 'compilerRoot',
    '--source': 'source',
    '--source-sha256': 'sourceSha256',
    '--source-bytes': 'sourceBytes',
    '--phase': 'phase',
    '--config': 'config',
    '--agent': 'agent',
    '--model': 'model',
    '--effort': 'effort',
    '--output': 'output',
    '--timeout-seconds': 'timeoutSeconds',
    '--manifest': 'manifest',
    '--case': 'caseId',
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help') options.help = true;
    else if (arg === '--fast-mode') options.fastMode = true;
    else if (arg === '--pipeline-path') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw Error(`${arg} needs a value`);
      options.pipelinePaths.push(resolve(value));
    } else if (Object.hasOwn(values, arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw Error(`${arg} needs a value`);
      options[values[arg]] = value;
    } else throw Error(`unknown argument ${arg}`);
  }
  if (options.sourceBytes !== undefined)
    options.sourceBytes = Number(options.sourceBytes);
  if (options.help) return options;
  if (options.manifest !== undefined) {
    if (!options.caseId) throw Error('--manifest requires --case');
    if (
      ['source', 'sourceSha256', 'sourceBytes', 'phase'].some(
        (key) => key in options,
      )
    )
      throw Error(
        'manifest selection cannot override selected source or phase',
      );
    const selected = selectCase(resolve(options.manifest), options.caseId);
    delete options.manifest;
    Object.assign(options, selected);
  } else if (options.caseId !== undefined)
    throw Error('--case requires --manifest');
  return options;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parsePhaseArguments(process.argv.slice(2));
    if (options.help) {
      process.stderr.write(
        `Usage: node scripts/phase-probe.mjs --phase <pipeline.text2gears|pipeline.gears2fsm> --source <path> --config <path> --model <model> [options]\n  --compiler-root <path>   measured installation; default: this repository\n  --manifest <path> --case <id>  select only public source fields instead of --source/--phase\n  --source-sha256 <hash> --source-bytes <n>  optional manual-source identity checks\n  --agent <id> --effort <value> --fast-mode\n  --pipeline-path <path>   repeatable explicit pipeline search roots\n  --output <directory> --timeout-seconds <n>  execution deadline, default: 300\nIndependent review and fast mode are disabled by default; inherited agent/effort/fast/reviewer/pipeline settings are cleared.\nEvery ordinary invocation makes real model calls. Phase acceptance does not establish full workflow correctness.\nSummary and raw diagnostic/clarification evidence stay in the fresh output directory; stdout is empty.\n`,
      );
    } else {
      const result = await recordPhase(options);
      process.stderr.write(
        `phase-probe: ${result.summary.status}; ${result.summaryPath}\n`,
      );
      process.exitCode = result.summary.phaseAcceptance.ok ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`phase-probe: ${error.message}\n`);
    process.exitCode = 1;
  }
}
