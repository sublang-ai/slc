# 两个 agent 的任务工作流

Players:

- `编码者`
- `审查者`

### REPO-1

当工作流开始时，Captain shall run:

> [ -e .git ] || git init

Results:
- `ok`: 命令以状态码零退出。
- `failed`: 命令以非零状态码退出。

### IMPL-1

当 Boss 给出输入任务且当前目录是 Git 仓库根目录时，Captain shall prompt `编码者`：

> 按输入任务的要求修改当前目录的代码：<task>。
> 将改动提交到 Git。

### REVIEW-1

当 `编码者` 已提交改动时，Captain shall prompt `审查者`：

> 审查当前目录中的最新 commit。
> 就其提出合理的问题。

Results:
- `findings`: `审查者` 提出了合理的问题并交回给 `编码者`。输出应包含 `findings: <逐字的问题内容>`。
- `clean`: `审查者` 没有提出任何问题，工作流结束。

### JUDGE-1

当 `审查者` 已提出问题并交回给 `编码者` 时，Captain shall prompt `编码者`：

> 对 `审查者` 提出的问题做判断：<findings>。
> 对每个问题给出接受或拒绝，并逐一说明原因。

Results:
- `agreed`: `编码者` 与 `审查者` 就问题达成一致。输出应包含 `conclusion: <达成一致后要做的改动>`。
- `disagreed`: `编码者` 判断后仍存在分歧。输出应包含 `judgment: <编码者接受或拒绝的决定及原因>` 与 `conclusion: <编码者当前打算做的改动>`。

### ARGUE-1

当 `编码者` 已对问题做出判断、仍存在分歧、且 `编码者` 累计判断次数少于三次时，Captain shall prompt `审查者`：

> 考虑 `编码者` 对你所提问题的判断：<judgment>。
> 对你仍不认同的问题据理力争。

Results:
- `findings`: `审查者` 保留尚未解决的问题，交由 `编码者` 再次判断。输出应包含 `findings: <尚未解决的问题>`。
- `agreed`: `审查者` 接受 `编码者` 的判断，不再有争议问题。

### IMPL-2

当 `编码者` 与 `审查者` 已结束讨论（达成一致或在第三次判断之后）且已完成的 review 循环少于两次时，Captain shall prompt `编码者`：

> 按结论修改当前目录的代码：<conclusion>。
> 将改动提交到 Git。

## Optimizations

- REPO-1: direct Captain → script
