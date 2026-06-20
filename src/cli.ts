#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * The published `slc` executable shim (CLI package).
 *
 * It supplies the process-backed defaults `run` falls back to and wires
 * cancellation: an interrupt aborts the in-flight run through the signal passed
 * into `runSlc` (CLI-10), and the returned exit code becomes the process exit
 * status (CLI-11). All behavior lives in the testable `run`; see app.ts.
 */

import { run } from './index.js';

const controller = new AbortController();
const abort = (): void => controller.abort();
process.once('SIGINT', abort);
process.once('SIGTERM', abort);

run(process.argv.slice(2), { signal: controller.signal })
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`slc: ${message}\n`);
    process.exit(1);
  });
