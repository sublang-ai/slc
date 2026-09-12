// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** Generic pipeline fixtures author no GEARS items, so their FSM is empty. */
export function pipelineOutput(target: string, label = 'output'): string {
  return target.endsWith('.ts')
    ? `// ${label}\nexport const machine = { config: { states: {} } };\nexport const concurrentRoleSets = [];\n`
    : `${label}\n`;
}
