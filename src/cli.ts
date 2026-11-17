#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * The published `slc` executable shim (`cli` package).
 *
 * It supplies the process-backed defaults `run` falls back to and wires
 * cancellation through `interruptSignal`: an interrupt aborts the in-flight run
 * via the signal passed into `runSlc` (cli-10), and the returned exit code
 * becomes the process exit status (cli-11). All behavior lives in the testable
 * `run`/`interruptSignal`; see app.ts.
 */

import { messageOf } from './errors.js';
import { isolatedCheck } from './isolated-check.js';
import { checkFailureCategory } from './check-report.js';
import { resolve } from 'node:path';
import { interruptSignal, run } from './index.js';

const { signal, dispose } = interruptSignal(process);

const args = process.argv.slice(2);
const checking = args[0] === 'check';
const check = async (): Promise<number> => {
  const [kind, ...paths] = args.slice(1);
  const jobs: Record<
    string,
    { job: string; count: number; optional?: number }
  > = {
    types: { job: 'types', count: 1 },
    fsm: { job: 'fsm', count: 2, optional: 1 },
    link: { job: 'linked', count: 2 },
    entry: { job: 'lifecycle', count: 2 },
  };
  const item = jobs[kind];
  if (
    !item ||
    paths.length < item.count ||
    paths.length > item.count + (item.optional ?? 0)
  )
    throw new Error(
      'usage: slc check types <target> | fsm <gears> <fsm> [runtime] | link <linked> <fsm> | entry <entry> <fsm>',
    );
  const values: unknown[] = paths.map((path) => resolve(path));
  if (kind === 'link') values.push(true);
  const findings = await isolatedCheck(item.job, values, signal);
  await new Promise<void>((resolveOutput, rejectOutput) =>
    process.stdout.write(
      JSON.stringify({
        schema: 'sublang.slc.check.v1',
        status: findings.length ? 'failed' : 'verified',
        ...(findings.length
          ? { category: checkFailureCategory(findings) }
          : {}),
        findings,
      }) + '\n',
      (error) => (error ? rejectOutput(error) : resolveOutput()),
    ),
  );
  return findings.length ? 1 : 0;
};
(checking ? check() : run(args, { signal }))
  .then((code) => {
    dispose();
    process.exit(code);
  })
  .catch((error: unknown) => {
    dispose();
    const message = messageOf(error);
    process.stderr.write(`slc: ${message}\n`);
    process.exit(1);
  });
