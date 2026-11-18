<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# SLC 全局空目录编译交付报告

验收 ID：`AT-slc-global-20261117`。本报告以最终冻结 cohort 12 为准，历史与当前、冷生成与环境重验分别列示。

**核心本地功能已完成修改并通过所列三平台测试；公开发布和合并仍受 CI/上游审计及公开安装证据阻塞。GLM 当前冷生成因额度限制未通过，不能记作成功。**

## 交付目标与实现

安装 SLC 自动取得所需 Playbook、Cligent、Claude/Codex SDK、TypeScript 和 Node 类型；输入流程定义文件，通过环境变量与 SLC CLI 编译。工作流自己持有一个内部 ESM 环境，新入口为 `.mjs`；项目根无需创建 package.json、tsconfig、node_modules 或 Git 仓库。编译、检查和加载使用同一 Playbook/XState 对，失败重编译保留已接受产物。当前 SLC 要求 Node >=25.5，三平台最终功能测试使用官方校验的 Node 26.13.1。

本轮不涉及独立 spex-playbook Skill，不评工作流业务结果质量。运行验证仅安全初始化/释放，不实际执行业务。

## 最终版本

| 包 | 版本 | npm tarball SHA-256 |
|---|---|---|
| `@sublang/cligent` | `0.40.0-rc.2` | `d826a46839b6257cebe349c16b9393a7fc3750a64f585828e73e9a786cf31fa3` |
| `@sublang/playbook` | `19.1.0-rc.5` | `f7339a42cb0219d5a5c1d0b6a48778f26c901435f7b9eed5b24fdd8547e2720d` |
| `@sublang/slc` | `0.23.0-rc.11` | `53c7267ea4b006cf06b47f0a11cd0ce2dfcc9a306688cba4a17f35348597d78c` |

冻结记录：[cohort 12](evidence/candidate-cohort-12/frozen-cohort.json)，SHA-256 `caa119f79235be47b82923f19c12a2cb85ea3d9f27277a731627016eae790c30`。源码包、源文件清单、相对初始提交的补丁均保留。

## 验收分层与结果

| 层次 | 实际结果 | 能证明什么 |
|---|---|---|
| 从零安装依赖 | cohort10 在 macOS/Linux/Windows 从仅指定 SLC 的 npm 安装成功 | 普通依赖自动取得两套 SDK、运行库与编译工具；是隔离分支镜像安装，不是 npmjs 公布版本 |
| 最终编译器安装 | cohort12 三平台仅升级 SLC 至 rc11；依赖声明与 cohort10 一致 | 最终实际安装树/SDK/native/runtime/CLI 逐文件与冻结包核对；这次升级不冒称从零安装 |
| 真实自然语言冷编译 | 当前 Codex 三平台 commonjs 父目录各1次成功 | 仅输入原流程定义，无旧工作流输入，五阶段真实 Agent 编译并通过当前安全启动检查 |
| 当前 GLM 冷编译 | 三平台各1次 HTTP429/1308额度拒绝 | SDK/native/登录参数已到达所选服务；未获得完整生成成功，停止重复请求 |
| 当前目录环境重验 | 48/48通过，51份成功证据含冷生成全部经后置审计 | 3OS×8父状态×2种历史编译产物；真实当前 CLI `--complete`，phase0/Agent0；不是48次新生成或两Provider可用性通过 |
| 源码完整回归 | SLC2111通过/2既有跳过；Playbook3248通过/34既有跳过；Cligent2353通过 | 实际命令、失败修订记录、输入清单与原始输出单独保留 |
| 静态与打包 | SLC8项独立静态/规格/定义/产物/发布元数据/演示检查全0；隔离镜像 packed consumer smoke全0 | 默认预算不扩大；维护演示仅显式使用足够的有限测试预算 |
| 公开发布/合并 | 未通过，PR保持草稿 | 不能用本地或隔离镜像结果替代 npmjs/OIDC/公开依赖安装或 exact-head CI |

八种父状态：无项目、CommonJS、ESM且已有Git、兼容但物理不同的运行库、仅声明未安装运行库、冲突运行库、错误父级类型/配置、中英文空格路径。每例保留父目录和祖先元数据前后、安装树身份、源输入与执行产物/快照、命令/时间/退出值、当前检查链与初始化/释放证据。

## 如何看耗时

冷生成和检查耗时分开记录，以下阶段时间包含 Agent 使用本地工具，不能当成纯模型推理时间；检查合计包含重复机械检查，部分本地 TypeScript/调度工作未单独计时，两列有重叠，不能相加求总耗时。

| 系统 | 真实冷编译 | 五个 Agent 编译阶段合计 | 有独立计时的机械检查合计 |
|---|---:|---:|---:|
| macos | 230.8 秒 | 226.0 秒 | 5.6 秒 |
| linux | 335.9 秒 | 312.7 秒 | 31.1 秒 |
| windows | 579.0 秒 | 521.6 秒 | 72.6 秒 |

| 系统 | 环境重验次数 | 单例中位耗时 | 单例最慢 |
|---|---:|---:|---:|
| darwin | 16 | 4.9 秒 | 6.4 秒 |
| linux | 16 | 23.2 秒 | 25.9 秒 |
| win32 | 16 | 47.1 秒 | 62.2 秒 |

组织优化：先准备一次依赖；先做快速环境/本地检查，模型冷生成只取代表样例；三平台独立并发；同平台用例依次推进，遇到首个真实失败先停该线；已确认的 GLM 额度限制不重复等待；完整回归后台执行。没有把安装等待算成工作流编译，也没有把快照收集失败算成编译失败。Windows 安装升级较慢，原始 install 与 npm ls 计时分别保留，可继续从这些收据定位安装 I/O/网络开销，尚不把具体原因归咎于 SLC。


实际 npm 安装与盘点分开计时（隔离分支镜像）：

| 系统 | 从零仅安装SLC（rc9，依赖声明与最终版一致） | 最终rc11升级安装 | 升级后的npm ls |
|---|---:|---:|---:|
| macos | 46.1 秒 | 54.4 秒 | 0.5 秒 |
| linux | 106.6 秒 | 113.7 秒 | 1.1 秒 |
| windows | 339.3 秒 | 386.5 秒 | 28.2 秒 |

## 证据导航与独立追溯

- [51份成功后置审计索引](evidence/final-audit-12/index.json)：41/19等快照逐字节、检查 start/report/finish、最终已接受文件、manifest、当前 toolchain 与 init/dispose；不是只看退出码。
- [54条当前外部执行的历史导入索引](evidence/history-import-final-12/review-targets.json)：每条有输入/输出摘要、实际版本、模式和原命令。HISTORY 不改称 formal execute。
- [冷生成原始记录](evidence/native-12/)；Windows完整采集为 [complete-native-12](evidence/complete-native-12/)。
- [48项当前环境重验](evidence/native-retained-12-v2/)；Windows完整采集为 [complete-native-retained-12-v2](evidence/complete-native-retained-12-v2/)。历史输入原receipt归档、原FSM/linked哈希锚点与当前不变性均在每例目录。
- [完整回归、静态和打包命令](evidence/commands/)：最终前缀 `slc-final-rc11-*`。每个收据列 argv/cwd/start/end/exit/stdout/stderr SHA及Source/dist清单。
- [逐阶段耗时](evidence/timing-summary-12.json)；[实际安装升级](evidence/alternative-upgrade-12/)；[实际命令入口及工具链](evidence/preflight/)。
- [原始48次冷生成历史](evidence/history-matrix-05/)：cohort04 Codex24+GLM6成功、GLM18 quota；不与最终版本或48项环境重验合并统计。
- 独立设计/实现/执行/需求意见统一在 `.acceptance-local/native-v1/AT-slc-global-20261117/review-inbox/`；最终需求结果以原生 `results view` 为准。

## 边界、阻塞与替代方案

1. 当前 GLM 编译未完整验收：三次最新请求实际为额度拒绝，服务给出重置文本 `2026-11-18 09:01:59`，未说明时区。历史6次GLM成功、两套SDK自动安装与实际native启动、当前48项环境重验提供补充证据，但不能当当前GLM冷生成通过。可待服务额度恢复，仅补三平台同一冷用例；无需重装所有依赖或重跑48项环境矩阵。
2. Cligent exact-head distributable CI因开发依赖安全审计失败，Playbook/SLC公开CI因未发布的上游候选依赖安装失败。保持原有审计和发布门槛，不发布/合并。隔离镜像和本地包能验证安装内容与功能，不能验证 npmjs真实发布/OIDC/公开可见性；待依赖审计有合规解决后，按Cligent→Playbook→SLC发布候选，补真实公开安装与exact-head CI，再按原授权合并。
3. 目录环境矩阵证明当前检查/加载/内部依赖准备，不证明任意自然语言都能生成成功，也不证明业务结果质量。有限路径搜索仍可返回unverified，真实必需启动选项缺少合法输入时不猜默认值。`-o`保留既有能力和回归，不在本轮增加所有CLI参数×父状态的交叉乘积。
4. 现有参考演示保留Source/GEARS/FSM原字节；仅测试用例显式使用64调用/1024尝试/900000ms有限预算。产品默认仍8/64/300000ms。先前被真实回放暴露的失败、旧预算不足、测试工具引用/命令接线/Windows长路径收集失败均保留，未改记成功。

## PR

- [Cligent #101](https://github.com/sublang-ai/cligent/pull/101)
- [Playbook #115](https://github.com/sublang-ai/playbook/pull/115)
- [SLC #106](https://github.com/sublang-ai/slc/pull/106)

正式发布、公开安装、合并仍为阻塞状态；实现和本地核心验收的完成不替代这些交付门槛。

## 正式交付判定

新上下文需求Judge逐条判定并已登记：R1 blocked（当前两后端冷生成范围未关闭，GLM受额度限制）；R2 blocked（公开候选安装/OIDC、exact-head全绿及合并未闭环）；R3 formal blocked（原生记录要求所选场景具备必需正式passing证据，HISTORY不能冒称正式执行）。证据完整性、准确归类、跳过风险处置的独立复审通过，原窄范围passed意见与工具拒绝均原样保留，未改称数据失败。

最终原生结果见 [delivery-results-final12-judged.json](evidence/delivery-results-final12-judged.json)；逐需求意见/收据位于 `review-inbox/delivery-*-final12.json` 与 `delivery-judge/`。该状态表示实现和本地核心证据就绪，但不是整体可发布/合并的绿灯。
