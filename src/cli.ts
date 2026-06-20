#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * The published `slc` executable shim (CLI package).
 *
 * It supplies the process-backed defaults `run` falls back to and wires
 * cancellation through `interruptSignal`: an interrupt aborts the in-flight run
 * via the signal passed into `runSlc` (CLI-10), and the returned exit code
 * becomes the process exit status (CLI-11). All behavior lives in the testable
 * `run`/`interruptSignal`; see app.ts.
 */

import { interruptSignal, run } from './index.js';

const { signal, dispose } = interruptSignal(process);

run(process.argv.slice(2), { signal })
  .then((code) => {
    dispose();
    process.exit(code);
  })
  .catch((error: unknown) => {
    dispose();
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`slc: ${message}\n`);
    process.exit(1);
  });
