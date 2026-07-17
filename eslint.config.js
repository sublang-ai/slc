// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.scratch/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Compiled playbook artifacts (agent-emitted, reviewed via the DR-009
    // checks and pins, not hand-maintained). link.md prescribes patterns the
    // style rules flag — e.g. re-throwing the latched control error from the
    // public boundary's `finally` — so style-only rules relax here while
    // correctness rules stay on.
    files: ['pipelines/playbook/*.slc/**', 'demo/workflow.playbook/**'],
    rules: {
      'no-unsafe-finally': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
