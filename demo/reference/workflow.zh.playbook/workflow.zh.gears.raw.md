# 用两个agent完成输入的任务

Roles:

- `编码者`
- `审查者`

## 意图

用两个 agent 完成 Boss 输入的任务：`编码者` 按任务要求对当前目录的代码进行修改并提交 Git，`审查者` 对提交的 commit 进行 review 并提出合理问题，交回给 `编码者` 做判断。
`编码者` 可以接受或拒绝但要讲清楚原因，两个 agent 争论直至达成一致（争论不超过 2 轮，即至多到总计第 3 次判断后不再争论），再由 `编码者` 负责按结论修改代码、再次提交。
依此循环，直到 review 没有任何问题后结束；循环次数不超过 2 次。
开始工作前，当前目录本身须是一个 Git 仓库的根目录。

## 行为

### WORKFLOW-1

当 Boss 给出输入的任务、工作尚未开始时，Captain shall 确保当前目录是 Git 仓库的根目录:

> 确保当前目录本身是一个 Git 仓库的根目录。
> 若此处没有 `.git`，就在此处初始化一个 Git 仓库。

### WORKFLOW-2

当 Git 仓库准备就绪时，Captain shall prompt `编码者`:

> 按 Boss 输入的任务要求对当前目录的代码进行修改。
> 将修改提交Git。
> 输入的任务：
> <inputTask>

### WORKFLOW-3

如果已进行的循环次数少于 2 次，当 `编码者` 完成一次提交（首次提交，或按结论再次提交）时，Captain shall prompt `审查者`:

> 对 `编码者` 提交的 commit 进行 review。
> 提出合理问题。

Results:
- `issues`: `审查者` 提出了问题，交回 `编码者` 做判断。输出应包含 `reviewFindings: <verbatim final text>`。
- `clean`: review 没有任何问题，流程结束。

### WORKFLOW-4

当 `审查者` 把提出的问题交回 `编码者` 做判断时，Captain shall prompt `编码者`:

> 以下是 `审查者` 对你的提交提出的问题：
> <reviewFindings>
> 对这些问题做判断：可以接受或拒绝，但要讲清楚原因。

Results:
- `accept`: `编码者` 接受了 `审查者` 的问题，双方达成一致。输出应包含 `coderJudgment: <verbatim final text>`。
- `reject`: `编码者` 拒绝了 `审查者` 的问题，并讲清楚了原因。输出应包含 `coderJudgment: <verbatim final text>`。

### WORKFLOW-5

如果 `编码者` 在本次循环中的判断次数少于 3 次（争论不超过 2 轮），当 `编码者` 拒绝 `审查者` 的问题时，Captain shall prompt `审查者`:

> 以下是 `编码者` 的判断及其原因：
> <coderJudgment>
> 判断你是否同意 `编码者` 的判断。
> 若不同意，就与 `编码者` 争论，直至达成一致。

Results:
- `dispute`: `审查者` 不同意 `编码者` 的判断，继续与其争论。输出应包含 `reviewerRebuttal: <verbatim final text>`。
- `agreed`: `审查者` 同意 `编码者` 的判断，双方达成一致。

### WORKFLOW-6

当 `审查者` 继续与 `编码者` 争论时，Captain shall prompt `编码者`:

> 以下是 `审查者` 继续争论的理由：
> <reviewerRebuttal>
> 再次对 `审查者` 的问题做判断：可以接受或拒绝，但要讲清楚原因。

Results:
- `accept`: `编码者` 接受了 `审查者` 的理由，双方达成一致。输出应包含 `coderJudgment: <verbatim final text>`。
- `reject`: `编码者` 仍然拒绝，并讲清楚了原因。输出应包含 `coderJudgment: <verbatim final text>`。

### WORKFLOW-7

当双方达成一致，或 `编码者` 已做出本次循环中总计第 3 次判断而不再争论时，Captain shall prompt `编码者`:

> 以下是本次 review 的结论：
> <coderJudgment>
> 按结论修改当前目录的代码。
> 将修改再次提交Git。
