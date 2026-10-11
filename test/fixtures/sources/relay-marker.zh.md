<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# 验证

Roles:

- Tester
- Auditor

负责人给出验证请求时，Captain shall prompt Tester，先给出以下指令：

```markdown
为 specs/ 中的每个规约条目补齐可执行的测试并全部运行。
在当前分支上提交一个 commit。
```

再以引用形式（`>`）附上验证请求：

> 验证请求：<caller-input>

Tester 提交后，Captain shall prompt Auditor，先给出以下指令：

```markdown
检查追溯矩阵是否覆盖全部规约条目，列出编号的发现。
```

再以引用形式（`>`）附上验证请求和 Tester 的输出：

> 验证请求：<caller-input>
> Tester 输出：<tester-output>

审核员没有发现时结束。
