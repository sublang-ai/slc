// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Generated verification tests import the package's public subpath. Point
    // that self-reference at source so a clean checkout does not require a
    // separate build before `npm test` can collect the committed tests.
    alias: {
      '@sublang/slc/verify': fileURLToPath(
        new URL('./src/verify.ts', import.meta.url),
      ),
    },
  },
  test: {
    // .scratch/ holds real-agent build evidence (compiled artifacts with their
    // emitted verification tests); it is reviewed by the build-and-review
    // scripts, not by the repo suite. Committed artifact directories under
    // pipelines/ DO run their emitted tests here.
    exclude: ['node_modules/**', 'dist/**', '.scratch/**'],
  },
});
