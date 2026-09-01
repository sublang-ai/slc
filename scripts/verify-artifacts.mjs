// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Standalone review of a compiled `playbook` artifact directory: runs the four
// DR-009 compilation-correctness checks (conformance incl. Boss-reply coverage,
// introspection summary, prompt contract incl. composition when the linked
// module exposes its composer, and transition coverage) and prints findings.
// The review half of the build-and-review flow (DR-005, DR-007); run
// `npm run build` first.
//
//   node scripts/verify-artifacts.mjs <artifactDir> <basename>

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Review one compiled artifact through the supplied verification module.
 * Keeping orchestration separate from the CLI lets the repository audit prove
 * the independent review's data flow without depending on source formatting.
 */
export const reviewArtifact = async ({
  dir,
  basename,
  verification,
  pinning,
  log = console.log,
}) => {
  const {
    capturePromptContract,
    checkFsmCoverage,
    checkGearsFsmConformance,
    checkPromptComposition,
    enumerateCaptainStates,
    findConcurrentRoleSets,
    findMachineConfig,
    loadFsmModule,
    loadLinkedModuleForVerification,
    pinIntrospection,
    resolveArtifactSchemaForVerification,
  } = verification;
  const artifactDir = resolve(dir);
  const findings = [];
  const section = (title) => log(`\n== ${title}`);

  const gears = readFileSync(join(artifactDir, `${basename}.gears.md`), 'utf8');
  const fsmPath = join(artifactDir, `${basename}.fsm.ts`);
  const fsm = await loadFsmModule(fsmPath);
  const config = findMachineConfig(fsm);
  let provenance;
  if (pinning !== undefined) {
    try {
      const pipelineDir = resolve(artifactDir, '..');
      const loaded = await pinning.loadPinFile(pipelineDir);
      const record = loaded.file?.pins?.[basename];
      if (record !== undefined) {
        const verdict = (
          await pinning.evaluatePinFile(pipelineDir, loaded.file)
        )[basename];
        if (verdict === undefined) {
          throw new Error(`pin index has no verdict for ${basename}`);
        }
        if (verdict.status === 'current') {
          provenance = record.linkTarget.provenance;
        } else {
          log(
            `ignoring ${verdict.status} pin provenance for ${basename}: ${verdict.reason}`,
          );
        }
      }
    } catch (error) {
      // Pin parsing/currency has its own later gate. An unreadable or stale pin
      // is not artifact-schema evidence for the just-built bundle.
      log(
        `ignoring unavailable pin provenance for ${basename}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const linkedPath = join(artifactDir, `${basename}.playbook.ts`);
  let linked;
  let linkedLoadError;
  if (existsSync(linkedPath)) {
    try {
      linked = await loadLinkedModuleForVerification({ linkedPath, fsmPath });
    } catch (error) {
      linkedLoadError = error;
    }
  }
  const schemaResolution = resolveArtifactSchemaForVerification({
    ...(provenance === undefined ? {} : { provenance }),
    config,
    ...(linked === undefined ? {} : { linked }),
  });
  const artifactSchema = schemaResolution.artifactSchema;
  findings.push(
    ...schemaResolution.findings.map((finding) => `schema: ${finding}`),
  );

  section('gears↔fsm conformance');
  const conformance = checkGearsFsmConformance(gears, config, {
    concurrentRoleSets: findConcurrentRoleSets(fsm),
    ...(artifactSchema === undefined ? {} : { artifactSchema }),
  });
  findings.push(...conformance.map((f) => `conformance: ${f}`));
  log(conformance.length === 0 ? 'ok' : conformance.join('\n'));

  section('introspection');
  const pins = pinIntrospection(config);
  log(
    `captain states: ${pins.captain.length}; quiescent: ${pins.quiescent
      .map((s) => s.state + (s.final ? '(final)' : ''))
      .join(', ')}; initial: ${pins.initial}`,
  );
  log(
    `root events: ${Object.keys(pins.rootOn).join(', ') || '(none)'}; interrupt targets: ${pins.interruptTargets.length}`,
  );
  for (const state of pins.captain) {
    log(
      `  ${state.state} [${state.sourceItem} -> ${state.player}] results: ${state.resultKeys.join('/')} onDone: ${state.onDone.length} onError: ${state.onError.length}`,
    );
  }

  section('prompt contract');
  const rows = capturePromptContract(config);
  const promptActors = new Set(
    enumerateCaptainStates(config)
      .map(({ actor }) => actor)
      .filter((actor) => actor === 'captain' || actor === 'player'),
  );
  for (const row of rows) {
    log(
      `  ${row.state}: reads [${row.reads.join(', ')}] placeholders [${row.placeholders.join(', ')}]`,
    );
  }
  if (existsSync(linkedPath)) {
    if (linked !== undefined) {
      for (const [actor, exportName] of [
        ['captain', 'composeCaptainPrompt'],
        ['player', 'composePlayerPrompt'],
      ]) {
        if (!promptActors.has(actor)) continue;
        const compose = linked._internal?.[exportName];
        if (typeof compose !== 'function') {
          const message = `linked module exposes no _internal.${exportName} required by ${actor} states`;
          findings.push(message);
          log(message);
          continue;
        }
        const composition = checkPromptComposition({
          config,
          compose,
          actor,
          ...(artifactSchema === undefined ? {} : { artifactSchema }),
        });
        findings.push(...composition.map((f) => `composition: ${f}`));
        log(
          composition.length === 0
            ? `${actor} composition ok`
            : composition.join('\n'),
        );
      }
    } else {
      const message =
        linkedLoadError instanceof Error
          ? linkedLoadError.message
          : String(linkedLoadError);
      findings.push(`linked module failed to import: ${message}`);
      log(`linked module failed to import: ${message}`);
    }
  } else {
    const message = 'no linked module beside the artifacts';
    findings.push(
      promptActors.size === 0
        ? message
        : `${message}; composition cannot be reviewed for ${[...promptActors].join(' and ')} states`,
    );
    log(message);
  }

  section('transition coverage');
  const coverage = await checkFsmCoverage(fsm, {
    sourceText: readFileSync(fsmPath, 'utf8'),
  });
  findings.push(...coverage.map((f) => `coverage: ${f}`));
  log(coverage.length === 0 ? 'ok' : coverage.join('\n'));

  section('verdict');
  if (findings.length === 0) {
    log('PASS: no findings');
  } else {
    log(`FAIL: ${findings.length} finding(s)`);
  }
  return { findings, passed: findings.length === 0 };
};

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const [dir, basename] = process.argv.slice(2);
  if (!dir || !basename) {
    console.error(
      'usage: node scripts/verify-artifacts.mjs <artifactDir> <basename>',
    );
    process.exitCode = 2;
  } else {
    const [verification, pinCurrency, pins] = await Promise.all([
      import('../dist/verify.js'),
      import('../dist/pin-currency.js'),
      import('../dist/pins.js'),
    ]);
    const result = await reviewArtifact({
      dir,
      basename,
      verification,
      pinning: {
        evaluatePinFile: pinCurrency.evaluatePinFile,
        loadPinFile: pins.loadPinFile,
      },
    });
    if (!result.passed) {
      process.exitCode = 1;
    }
  }
}
