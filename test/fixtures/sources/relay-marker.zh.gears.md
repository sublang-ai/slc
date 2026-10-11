<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# 验证

Roles:

- Tester
- Auditor

## 行为

### VERIFY-1

当负责人给出验证请求时，Captain shall prompt Tester:

> 为 specs/ 中的每个规约条目补齐可执行的测试并全部运行。
> 在当前分支上提交一个 commit。
>
> > 验证请求：<caller-input>

Results:
- `tested`: Tester 补齐测试、运行并提交。Output shall include `testerOutput: <verbatim final text>`.

### VERIFY-2

当 Tester 提交后，Captain shall prompt Auditor:

> 检查追溯矩阵是否覆盖全部规约条目，列出编号的发现。
>
> > 验证请求：<caller-input>
> > Tester 输出：<tester-output>

Results:
- `hasFindings`: Auditor 列出了至少一条编号的发现。
- `noFindings`: Auditor 没有发现；工作流结束。
