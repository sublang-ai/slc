// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // .scratch/ holds real-agent build evidence (compiled artifacts with their
    // emitted verification tests); it is reviewed by the build-and-review
    // scripts, not by the repo suite. Committed artifact directories under
    // pipelines/ DO run their emitted tests here.
    exclude: ['node_modules/**', 'dist/**', '.scratch/**'],
  },
});
