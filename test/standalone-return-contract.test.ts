// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
import { describe, expect, it } from 'vitest';
import { checkSourceReturnContracts } from '../src/verify-source.js';
const source =
  '成功时，Writer 返回 message 字符串，将它原样交给调用者。输入无法读取时，Writer 返回 reason 字符串。';
const gears = `# Flow
Roles:
- Writer
## External Behavior
### FLOW-1
When successful, \`flow\` shall return message to the caller [[FLOW-3](#FLOW-3)].
### FLOW-2
When input is unavailable, \`flow\` shall return reason to the caller [[FLOW-3](#FLOW-3)].
## Internal Behavior
### FLOW-3
Captain shall prompt Writer:
> Generate the message or explain why unavailable.
Results:
- \`generated\`: Successful generation. Output shall include \`message: <string>\`.
- \`unavailable\`: Input unavailable. Output shall include \`reason: <string>\`.
`;
describe('Source-bound terminal-return producer integration', () => {
  it('binds both explicit source conditions to producer fields and caller obligations', () => {
    expect(checkSourceReturnContracts(source, gears)).toEqual([]);
  });
  it('catches a translated parser prefix before any GEARS consumer', () => {
    expect(
      checkSourceReturnContracts(
        source,
        gears.replaceAll('Output shall include', '输出应包含'),
      ).join('\n'),
    ).toContain('no declared producer field');
  });
  it('catches an omitted caller obligation even when producer text claims success', () => {
    expect(
      checkSourceReturnContracts(
        source,
        gears.replace('return message to the caller', 'finish'),
      ).join('\n'),
    ).toContain('no matching success workflow-output obligation');
  });
  it('catches a missing return condition and retains source line evidence', () => {
    expect(
      checkSourceReturnContracts(
        source,
        gears.replace('When input is unavailable,', 'When successful,'),
      ).join('\n'),
    ).toMatch(/Source line 1.*reason.*no matching failure/);
  });
  it.each([
    ['producer', 'message', 'Output shall include `message: <string>`.', ''],
    ['producer', 'reason', 'Output shall include `reason: <string>`.', ''],
    ['output', 'message', 'return message to the caller', 'finish'],
    ['output', 'reason', 'return reason to the caller', 'finish'],
  ])(
    'reports the independent %s.%s omission at its Source condition',
    (kind, field, before, after) => {
      const findings = checkSourceReturnContracts(
        source,
        gears.replace(before, after),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('Source line 1');
      expect(findings[0]).toContain('terminal return ' + field);
      expect(findings[0]).toContain(
        field === 'message' ? '成功时' : '输入无法读取时',
      );
      expect(findings[0]).toContain(
        kind === 'producer'
          ? 'no declared producer field'
          : 'no matching ' +
              (field === 'message' ? 'success' : 'failure') +
              ' workflow-output obligation',
      );
    },
  );
  it('does not claim arbitrary-natural-language completeness', () => {
    expect(
      checkSourceReturnContracts('Writer 返回 message 字符串。', gears).join(
        '\n',
      ),
    ).toContain('unverified:');
  });
});
