<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# 演示：从一段文本描述到可靠的双 agent 代码评审循环

*[English](README.md)*

一段自然的文本描述被编译成确定性的状态机工作流，该工作流驱动两个 agent——一个编码者、一个审查者——在真实的 Git 仓库上完成提交／评审／争论的循环，直到评审不再提出任何问题。

## 快速开始

前置条件：macOS 或 Linux（Windows 请使用 WSL 或 Git Bash——工作流的脚本化步骤经由 `sh` 执行）、Node.js ≥ 23.6、`git`，以及已安装并登录的 [Claude Code CLI](https://www.anthropic.com/claude-code)（`claude` 命令可用）。也可以按角色改用其他 agent 或模型，参见[角色设置](#角色设置)。

本目录是一个自包含的 npm 项目。在 `demo/` 下先安装，再运行：

```sh
npm install
```

```sh
npx slc playbook workflow.zh.txt
```

```sh
npx playbook run ./workflow.zh.ts \
  "sample.c 里的 median 函数有 bug：结果依赖元素顺序，偶数长度数组也算错。请修复它。"
```

```sh
git log --oneline
```

每一步做什么：

1. **`npm install`** 安装 `@sublang/slc`（编译器）与 `@sublang/playbook`（提供 `playbook` 命令，以及生成文件从 `./node_modules` 导入的运行时引擎）。必须先于各条 `npx` 命令执行——若什么都没装，`npx` 会提示从 npm 仓库下载名为 `slc`、`playbook` 的**无关同名包**。
2. **`npx slc playbook workflow.zh.txt`** 把这一段描述编译成可运行的 playbook。编译会调用你配置的 agent，**可能耗时十分钟以上**；`./workflow.zh.ts` 出现即编译成功。赶时间？可以跳过——[`reference/`](reference/) 内附带预编译制品，直接运行 `npx playbook run ./reference/workflow.zh.ts "<task>"`（任务文本同下一步）。
3. **`npx playbook run …`** 把带 bug 的 [`sample.c`](sample.c) 交给两个 agent。它们在此处新建的 Git 仓库里提交、评审、争论；每一轮都是真实的 agent 工作，同样需要一些时间。当某轮评审不再有问题时，运行以 `0` 退出。
4. **`git log`** 查看循环产出：经过评审的提交（`git show` 显示最终修复）。

## 详细说明

### 输入

[`workflow.zh.txt`](workflow.zh.txt)——以上命令所编译的中文源文本；[`workflow.txt`](workflow.txt) 是同一段落的英文表述，由[英文版 README](README.md) 的流程编译：

> 开始工作前，确保当前目录本身是一个 Git 仓库的根目录；若此处没有 `.git`，就在此处初始化一个 Git 仓库。
> 用两个agent来完成输入的任务，一个agent按任务要求对当前目录的代码进行修改并提交Git，另一个agent对提交的commit进行review并提出合理问题，交回给第一个agent做判断。
> 它可以接受或拒绝但要讲清楚原因，两个agent争论直至达成一致（争论不超过2轮，即至多到总计第3次判断后不再争论），由第一个agent负责按结论修改代码，再次提交。
> 依此循环，直到review没有任何问题后结束。循环次数不超过2次。

留意这段话**未明确**的部分：没有给两个 agent 命名，也没有交代一轮争论中如何交互。编译器将在状态机中把这两点明确下来；文中明确的仓库根目录设置会成为脚本状态，两处明确的上界（争论至多 2 轮、循环至多 2 次）则会成为状态机里的循环计数器。

### 编译

```sh
npx slc playbook workflow.zh.txt
```

`slc` 会先将输入文本按 playbook 要求规范化，最终链接到已安装的 `@sublang/playbook` 运行时，并默认执行减少 LLM 调用的编译优化。
编译所用的 agent 由 `~/.config/slc/config.yaml` 指定（首次运行会自动生成，默认为 Claude Code）。
编译耗时可能超过十分钟。

制品输出在当前目录下，包括：`./workflow.zh.playbook/`（编译中间产物）与 `./workflow.zh.ts`（可运行的入口）。
我们提供参考制品供预览或对比校验：中文流程位于 [`reference/workflow.zh.playbook/`](reference/workflow.zh.playbook/)，英文流程位于 [`reference/workflow.playbook/`](reference/workflow.playbook/)。
你也可以跳过实际编译，直接阅读这些参考制品。

| 中间制品 | 说明 |
| --- | --- |
| `workflow.zh.text.md` | 规范化后的源文本：声明 player `编码者` 与 `审查者`，把原文整理为编号步骤。 |
| `workflow.zh.gears.raw.md` | 由源文本生成的 GEARS 规约条目（优化前）。 |
| `workflow.zh.gears.md` | 优化后的 GEARS 规约条目：Git 检查被改写为无需 LLM 的固定 shell 命令。 |
| `workflow.zh.fsm.ts` | 由 GEARS 条目生成的 XState 状态机。 |
| `workflow.zh.playbook.ts` | 链接后的运行时模块：驱动状态机并调用各 agent。 |
| `workflow.zh.*.test.ts` | 随制品产出的验证测试，确保编译输出符合源规约。 |

### 使用

[`sample.c`](sample.c) 是一个带真实 bug 的极小 C 文件：其 `median()` 结果依赖元素顺序，对偶数长度数组也算错。在本目录下，把它交给两个 agent 处理：

```sh
npx playbook run ./workflow.zh.ts \
  "sample.c 里的 median 函数有 bug：结果依赖元素顺序，偶数长度数组也算错。请修复它。"
```

（跳过了编译？直接运行参考入口：`npx playbook run ./reference/workflow.zh.ts "<task>"`）

### 角色设置

每个角色都默认使用 `claude`——包括编码者、审查者两个 player，以及 Captain（隐藏的编排者，负责轮次路由与结果裁决）。想按角色指定 agent、模型或推理力度，可加形如 `<adapter>[:<model>][@<effort>]` 的参数，例如：`--player 编码者=claude:claude-sonnet-5 --player 审查者=codex:gpt-5.6-terra --captain claude:claude-sonnet-5@high`。（英文参考入口的 player 名为 `Coder` 与 `Reviewer`。）

工作流作用于**当前目录**，其脚本化的第一步会检查该目录是否为 Git 仓库的**根目录**。本目录不是，于是这一步首先执行 `git init`，随后：

- 编码者做出修改并提交；
- 审查者评审该 commit 并提出问题；编码者接受或反驳，并说明理由；两者往复，不超过原文设定的上界；
- 当某轮评审不再有问题时，状态机到达终态，运行以 `0` 退出。

```sh
git log --oneline   # 经过评审的那些提交
git show            # 对 sample.c 的修复
```

如果想重新运行，可从 slc 仓库根目录（`demo/` 的上一级）还原 `demo/`：

```sh
rm -rf demo/.git demo/workflow.zh.playbook demo/workflow.zh.ts
git checkout -- demo/
```

（已安装的 `demo/node_modules` 可以保留。）

真正投入使用时，在你自己项目的**根目录**下运行 `playbook run` 命令，指定 playbook 路径，换成你自己的任务——在那里脚本步骤会发现 `.git` 并跳过初始化。把入口（`workflow.zh.ts`）**连同**它的 `workflow.zh.playbook/` 目录一并复制过去，这两者不可分开。若采用全局安装（playbook 3.1 及以上），这样就够了——`playbook run` 首次在那里运行时会把引擎链接到制品旁边。若那个项目的 `package.json` 声明了 `@sublang/playbook`，则应在该项目内安装（`npm install --save-dev @sublang/playbook@3`）：已声明的依赖具有权威性，此时自动链接会拒绝执行，而不会掩盖缺失的安装。本演示正是因此采用项目内安装——它位于 slc 仓库之内，而该仓库的 manifest 声明了这个引擎。
两个 agent 的提交会落在你运行命令的那个目录所在的仓库里。

## 这个演示说明了什么

- **自然语言就是源代码。** 输入的自然语言从未被编辑；规范化做的是把它隐含的结构显式化。
- **确定性的编排。** 这个循环——谁行动、何时停止——是编译出来的状态机，而不是 prompt 的即兴发挥；只有每个状态**内部**的工作才用到 LLM。
- **编译期优化。** 一个无需判断的步骤变成了编译期可验证的 shell 命令：更省、更快，且不会产生幻觉。
- **验证与产物一同交付。** 编译器同时生成用来验证自身输出符合源规约的测试。
