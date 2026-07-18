<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# 工作流

Players:

- `编码者`
- `审查者`

### CODE-1

当工作流开始时，Captain shall run:

> git rev-parse --is-inside-work-tree 2>/dev/null || git init

Results:
- `ok`: 命令以状态码 0 退出。
- `failed`: 命令以非 0 状态码退出。

### CODE-2

当 Boss 给出待完成的任务、且当前目录已是 Git 仓库时，Captain shall prompt 编码者:

> 你要完成的任务是：<task>。
> 按任务要求，对当前目录的代码进行修改。
> 将修改提交到 Git。

### CODE-3

当编码者完成一次提交、有改动待审查，且审查-修改循环至多进行 2 次时，Captain shall prompt 审查者:

> 对最新提交的 commit 进行 review。
> 提出合理的问题；若没有任何问题，请明确说明通过。

Results:
- `issues`: 审查者提出了需要处理的问题；输出应包含 `reviewFindings: <审查者提出的问题>`。
- `clean`: 审查者认为没有任何问题，流程结束。

### CODE-4

当审查者提出问题、交回给编码者判断，且编码者的判断不超过 3 次（争论不超过 2 轮）时，Captain shall prompt 编码者:

> 审查者提出的问题：<reviewFindings>。
> 审查者对你上一次判断的回应（如有）：<reviewerRebuttal>。
> 针对每个问题，决定接受还是拒绝，并讲清楚原因。
> 与审查者讨论，争取达成一致；若无法达成一致，则由你自行定夺，给出最终结论。

Results:
- `agreed`: 编码者与审查者达成一致，或已到第 3 次判断由编码者自行定夺；输出应包含 `conclusion: <最终结论>`。
- `dispute`: 尚未达成一致，仍需继续争论；输出应包含 `coderRuling: <编码者对各问题的接受或拒绝判断及原因>`。

### CODE-5

当编码者作出判断、双方尚未达成一致，且争论不超过 2 轮时，Captain shall prompt 审查者:

> 编码者对你所提问题的判断与原因：<coderRuling>。
> 针对编码者的判断进行回应，说明你是否接受其理由。
> 若仍有异议，请进一步说明，争取与编码者达成一致。

Results:
- `responded`: 审查者对编码者的判断作出了回应；输出应包含 `reviewerRebuttal: <审查者的回应>`。

### CODE-6

当编码者与审查者就问题达成结论后，Captain shall prompt 编码者:

> 按以下结论修改代码：<conclusion>。
> 将修改再次提交到 Git。

## Optimizations

- CODE-1: direct Captain work → script
