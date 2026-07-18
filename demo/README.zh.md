<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# 演示：从一段文本描述到可运行的双 agent 代码评审循环

*[English](README.md)*

一段未经加工的文本描述被编译成确定性的状态机工作流，该工作流驱动两个 agent——一个编码者、一个审查者——在一个真实的 Git 仓库上完成提交／评审／争论的循环，直到评审不再提出任何问题。

三行命令，在本目录下运行：

```sh
slc playbook workflow.zh.txt
playbook run ./workflow.zh.ts "<task>"
git log --oneline
```

## 输入

[`workflow.zh.txt`](workflow.zh.txt)：

> 用两个agent来完成输入的任务，一个agent按任务要求对当前目录的代码进行修改并提交Git，另一个agent对提交的commit进行review并提出合理问题，交回给第一个agent做判断。
> 它可以接受或拒绝但要讲清楚原因，两个agent争论直至达成一致（争论不超过2轮，即至多到总计第3次判断后不再争论，自己定夺），由第一个agent负责按结论修改代码，再次提交。
> 依此循环，直到review没有任何问题后结束。循环次数不超过2次。

留意这段话**未明确**的部分：没有给两个 agent 命名，没有交代一轮争论中如何交互，还默认当前目录已是 Git 仓库。编译器在状态机中把这三点都明确了下来，而文中两处明确的上界（争论至多 2 轮、循环至多 2 次）则成为状态机里的循环计数器。

## 前置条件

- Node.js ≥ 23.6
- `npm install -g @sublang/slc @sublang/playbook`——`slc` 编译器与 `playbook` 执行环境
- 已安装并登录的 [Claude Code](https://www.anthropic.com/claude-code)（`claude`）与 [Codex](https://openai.com/codex)（`codex`）CLI——它们分别扮演编码者与审查者。此外还有第三个 agent 会话，即 Captain，负责裁决每个状态的结果
- `git`

## 1. 编译文本描述

在本目录下：

```sh
slc playbook workflow.zh.txt
```

无需任何参数：`.txt` 输入即原始散文，`slc` 会先将其归一化；pipeline 的优化 pass 默认运行；未给 `--link` 时，`playbook` pipeline 会链接到已安装的 `@sublang/playbook` 运行时，并一并产出可运行的入口模块。编译由真实的编码 agent 执行（在 [`slc.config.yaml`](slc.config.yaml) 中配置；可用 `SLC_AGENT`／`SLC_MODEL`／`SLC_EFFORT` 覆盖），耗时可能达到数十分钟。

### 产物落在哪里

产物落在你的**当前目录**，绝不会写到别人的源文件旁边：`./workflow.zh.playbook/`（编译出的产物包）与 `./workflow.zh.ts`（可运行的入口）。在本目录下编译会就地重写已提交的产物包——由于产物由真实的编码 agent 生成，结果不会与已提交内容逐字节相同，`git diff` 正是值得一看的视图，而在 `demo/` 下执行 `git checkout -- .` 即可还原。想在不弄脏仓库的前提下试用编译器，换个目录运行即可：`cd /tmp && slc playbook /path/to/slc/demo/workflow.zh.txt` 会写出 `/tmp/workflow.zh.playbook/` 与 `/tmp/workflow.zh.ts`。

在本目录下编译还会发现演示自带的 [`slc.config.yaml`](slc.config.yaml)，其 `pipelinePath: [../pipelines]` 选中仓库已提交、已 pin 的 pipeline 定义；在别处编译则需自行配置 agent（`SLC_AGENT`），且定义来自已安装的 `@sublang/playbook`。

### 编译产出了什么

这套产物已经提交，因此你可以跳过编译，直接阅读：

| 产物 | 值得关注之处 |
| --- | --- |
| `workflow.zh.text.md` | 归一化后的源文件：两个未具名的 agent 成为声明出来的 player `编码者` 与 `审查者`，未言明的假设成为步骤 1——“开始前，确认当前目录是一个Git仓库的根目录；若不是，则先在此初始化一个Git仓库。” 原文的含义、顺序与语言都被保留；归一化添加的是结构——一个标题、一个 `Players:` 块，以及七个编号步骤。 |
| `workflow.zh.gears.raw.md` | 前端直接产出的 GEARS spec item：Git 检查是 `Captain shall 确保当前目录是一个 Git 仓库的根目录`——以散文表述的 Captain 直接工作，仍需 LLM 去理解。其余五项是 `Captain shall prompt <player>` 行为。 |
| `workflow.zh.gears.md` | 优化 pass 之后：Git 步骤被改写为 `Captain shall run:` **脚本 item**——`[ -e .git ] \|\| git init`，一条带两个退出码守卫的固定 shell 命令，不用 LLM——并在 `## Optimizations` 下记录了来龙去脉（`CODE-1: direct Captain work → script`）。 |
| `workflow.zh.fsm.ts` | XState 状态机：每个 GEARS item 对应一个*发起调用*的状态——Git 步骤调用 `script` actor，其余五个调用 `player` actor——此外还有一个空闲枢纽状态、一个等待 Boss 回复的挂起状态，以及两个终止状态。 |
| `workflow.zh.playbook.ts` | 链接后的运行时：驱动 FSM，通过宿主的四端口契约（`callPlayer`、`callJudge`、`emitStatus`、`emitTelemetry`）调用 agent，并在本地用 `sh -c` 执行脚本状态——无 LLM、无 token、毫秒级。 |
| `workflow.zh.*.test.ts` | 编译器随产物一同产出的验证：GEARS↔FSM 一致性、FSM 内省 pin、prompt 契约、转移覆盖。`npx vitest run demo/workflow.zh.playbook` 可运行它们，仓库的 `npm test` 同样会收集。 |
| [`workflow.zh.ts`](workflow.zh.ts) | 产出的入口模块，`playbook run` 直接消费：player、intent 与选项全部派生自编译产物。本演示不含任何手写的接线代码。 |

## 2. 在示例文件上运行它

[`sample.c`](sample.c) 是一个带真实 bug 的极小 C 文件：其 `median()` 结果依赖元素顺序，对偶数长度数组也算错。在本目录下，把它交给两个 agent：

```sh
playbook run ./workflow.zh.ts \
  "sample.c 里的 median 函数有 bug：结果依赖元素顺序，偶数长度数组也算错。请修复它。"
```

每个角色都默认使用 `claude`；想指定阵容，可加 `--player 编码者=claude:claude-sonnet-5 --player 审查者=codex:gpt-5.6-terra --captain claude:claude-sonnet-5`（`<adapter>[:<model>][@<effort>]`）。两个 player 的 ID 是 `编码者` 与 `审查者`——它们来自那段中文源文，所以是中文；产出的入口模块把它们声明为必需角色。任务文本是自由文本，在运行时传入，因此可以用任何语言书写，与工作流编译自哪种语言无关。

工作流作用于**当前目录**，其脚本化的第一步会检查该目录是否为 Git 仓库的**根目录**。本目录不是——它位于 slc checkout 内部——于是这一步就地执行 `git init`，全程没有 agent 参与，后续循环提交到这个新建的嵌套仓库中。随后：

- 编码者做出修改并提交；
- 审查者评审该 commit 并提出问题；编码者说明理由地接受或反驳；两者往复，受源文自身设定的上界约束；
- 当某轮评审不再有问题时，状态机到达终态，运行以 `0` 退出。

```sh
git log --oneline   # 只有经过评审的那些 commit——嵌套仓库自己的历史
git show            # 对 sample.c 的那次经过评审的修复
```

撤销这次运行：`rm -rf .git && git -C .. checkout -- demo/`。

真正投入使用时，就在你自己项目的根目录里、用你自己的任务运行同一条命令——在那里，脚本步骤会发现 `.git` 并直接通过。

> 两个 agent 会向你所在的那个目录提交。这正是它的用途——但请指向一个你愿意让它被修改的工作区。

加上 `--json --verbose` 可在 stdout 得到机器可读的摘要、在 stderr 得到逐状态的状态行——脚本步骤会在任何 agent 运行之前报告 `Executed script for <state> (exit 0).`。

## 这个演示说明了什么

- **自然语言就是源代码。** 那段话从未被编辑；归一化做的是把它隐含的结构显式化。
- **确定性的编排，agent 执行的工作。** 这个循环——谁行动、何时停止——是编译出来的状态机，而不是 prompt 的即兴发挥；只有每个状态**内部**的工作才用到 LLM。
- **优化是实打实的。** 一个无需判断的步骤变成了编译期可验证的 shell 命令：更省、更快，且不会产生幻觉。
- **验证与产物一同交付。** 编译器把用来把自身输出钉在源规格上的测试一并发布出来。

## 复现验收运行

[`acceptance/`](acceptance/) 存放维护者侧的测试装置：它把 `sample.c` 复制到一个临时目录作为种子，脚本化地跑完那次双 agent 运行，并校验全部产物与实际运行证据。详见 [`acceptance/README.md`](acceptance/README.md)。使用本演示完全不需要其中任何内容——上面的第 2 步就是同一次运行的手工版本。
