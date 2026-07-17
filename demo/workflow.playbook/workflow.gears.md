<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

Players:

- `编码者`
- `审查者`

### CODE-1

When 工作流启动, Captain shall run:

> git rev-parse --is-inside-work-tree 2>/dev/null || git init

Results:
- `ok`: 命令以零状态码退出。
- `failed`: 命令以非零状态码退出。

### CODE-2

When 仓库准备就绪, Captain shall prompt `编码者`:

> 按任务要求对当前目录的代码进行修改。
> 提交Git。

### CODE-3

When 编码者提交了改动, Captain shall prompt `审查者`:

> 对提交的commit进行review。
> 提出合理问题。

Results:
- `issues`: 审查者提出了合理问题，交回给编码者判断。输出应包含 `reviewComments`：审查者提出的问题。
- `clean`: 审查者对提交的commit未发现任何问题。

### CODE-4

When 审查者提出问题待编码者判断, Captain shall prompt `编码者`:

> 对审查者提出的问题做出判断：<reviewComments>
> 可以接受或拒绝，但要讲清楚原因。

Results:
- `responded`: 编码者对每个问题做出接受或拒绝的判断并讲清原因。输出应包含 `coderResponse`：编码者的判断与理由。

### CODE-5

When 编码者给出判断与理由, Captain shall prompt `审查者`:

> 阅读编码者的判断与理由：<coderResponse>
> 与编码者争论，直至达成一致。

Results:
- `agreed`: 审查者与编码者达成一致。输出应包含 `agreedConclusion`：双方一致的修改结论。
- `disputed`: 尚未达成一致，审查者继续争论。输出应包含 `reviewComments`：审查者进一步的问题或理由。

### CODE-6

When 双方达成一致, Captain shall prompt `编码者`:

> 按结论修改代码：<agreedConclusion>
> 再次提交。

## Optimizations

- CODE-1: direct Captain work → script
