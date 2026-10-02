<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# 演示：从自然语言到双智能体代码评审循环

*[English](README.md)*

[中文规程](workflow.zh.txt)与[英文规程](workflow.txt)描述同一个有界的编码与评审循环。
编译后的工作流驱动编码者和审查者提交、评审和修复代码，直到评审通过或达到规程规定的上限。

## 先运行预编译工作流

需要macOS或Linux、Node.js ≥ 23.6、`git`，以及已安装并登录的[Claude Code CLI](https://www.anthropic.com/claude-code)。
在`demo/`目录安装依赖，并准备全新的临时副本。
下面的Git身份仅用于演示；若需在提交中记录自己的身份，可改为自己的姓名和邮箱：

```sh
npm install
demo_source="$PWD"
demo_work=$(mktemp -d)
cp sample.c workflow.txt workflow.zh.txt package.json playbook.config.yaml "$demo_work/"
cp -R reference "$demo_work/reference"
ln -s "$demo_source/node_modules" "$demo_work/node_modules"
cd "$demo_work"
printf 'node_modules/\n.spex/\n' > .gitignore
git init --quiet
git config user.name 'Demo Participant'
git config user.email 'demo@example.invalid'
git add .
git -c commit.gpgsign=false commit -m 'chore: Record demo baseline'
mkdir -p .spex/config
cp playbook.config.yaml .spex/config/playbook.config.yaml
export SPEX_HOME="$PWD/.spex"
npx playbook --list
```

后续命令都在临时副本中执行，初始提交保存原始示例与工作流制品，不使用现有工作目录的修改。

列表应包含`/workflow`和`/workflow.zh`。
随附的[配置模板](playbook.config.yaml)启用两个参考入口，将各自声明的角色绑定到两个稳定的player，并为这些player与Captain明确指定Claude Opus 5.5及`high`力度。
入口的相对路径基于`.spex/config/playbook.config.yaml`解析。
明确指定`SPEX_HOME`将本演示的配置与会话保存在`.spex/`中。

把[sample.c](sample.c)的真实缺陷交给中文工作流：

```sh
npx playbook run "/workflow.zh sample.c里的median函数有bug：结果依赖元素顺序，偶数长度数组也算错。请修复它。"
git log --oneline
```

此步骤会调用真实智能体。
工作流先确保当前目录本身是Git仓库的根目录，必要时初始化仓库；随后编码者修改并提交，审查者检查提交，双方按源规程限定的轮数处理问题：评审循环最多两次，争论最多两轮。
提交落在你运行命令的目录里。

先安装再使用`npx`：没有这些依赖时，`npx slc`与`npx playbook`可能提示安装无关的同名包。
[本演示的manifest](package.json)声明了带作用域的编译器、Playbook引擎，以及Claude和Codex SDK。

## 编译自己的版本

```sh
npx slc playbook workflow.zh.txt
```

编译使用`~/.config/slc/config.yaml`中的Coder设置；当前目录的`slc.config.yaml`优先。
比较结果时明确指定模型和力度，例如：

```yaml
agent: codex
model: gpt-6.1-sol
effort: xhigh
```

编译器规范化自然语言，生成GEARS规约与XState状态机，执行默认优化，再链接运行时模块。
stdout列出制品路径，stderr报告各阶段的进度与心跳。
耗时取决于规程和模型，[性能报告](../docs/compilation-performance.md)保留实测设置和结论的适用范围。
若源规程存在必须澄清的行为，编译以`2`退出，并列出源文件与问题；修改源文件，再运行同一命令。

新入口是`./workflow.zh.ts`，中间制品与测试在`./workflow.zh.playbook/`中。
若要运行新编译版本，把`.spex/config/playbook.config.yaml`中中文工作流的`from`由`../../reference/workflow.zh.ts`改为`../../workflow.zh.ts`，再重复上面的列表检查与运行命令。
英文参考入口仍然可用；编译`workflow.txt`会相应生成`workflow.ts`。

| 制品 | 用途 |
| --- | --- |
| `workflow.zh.text.md` | 声明角色与顺序步骤的规范化源文本。 |
| `workflow.zh.gears.raw.md` | 优化前的GEARS规约。 |
| `workflow.zh.gears.md` | 优化后的规约，包含固定的Git初始化脚本。 |
| `workflow.zh.fsm.ts` | 确定性的状态机。 |
| `workflow.zh.playbook.ts` | 链接后的运行时模块。 |
| `workflow.zh.*.test.ts` | 将制品与规约绑定的验证测试。 |
| `workflow.zh.ts` | 需要在Playbook配置中启用的注册入口。 |

## 角色与跨组复用

schema-3入口先在配置中启用，再通过斜杠命令调用，不作为位置参数传给`playbook run`。
中文入口声明`编码者`和`审查者`，英文入口声明`coder`和`reviewer`。
配置模板将两个语言版本都绑定到`demo.coder`和`demo.reviewer`。
使用不同player ID可隔离会话，也可以明确共享同一ID以复用上下文。

若要让审查者使用Codex，替换对应player配置：

```yaml
players:
  demo.reviewer:
    adapter: codex
    model: gpt-6.1-sol
    effort: xhigh
    permissions:
      mode: auto
      writablePaths: ['.git']
```

Codex CLI也需要登录。
智能体设置写入配置；旧的`--player`和`--captain`运行参数已移除。
更多覆盖方式与角色绑定规则见Playbook的[配置指南](https://github.com/sublang-ai/playbook/blob/main/docs/configuration.md)。

在其他项目中复用时，把入口与对应的`.playbook/`目录一起复制过去，在配置中启用新的绝对入口路径，绑定`requiredRoleIds`中的全部角色，再从新项目根目录调用斜杠命令。
宿主会按需把运行时引擎链接到外部制品旁边。
项目若声明了`@sublang/playbook`，则必须在项目内安装它；自动链接不会掩盖缺失的已声明依赖。
相应SDK需安装在宿主Cligent能解析到的位置。

规程源文本是可复用的内容：修改规程、编译新版本，检查生成的规约与测试，再分享入口和制品目录。
稳定player的绑定由使用规程的团队配置。
