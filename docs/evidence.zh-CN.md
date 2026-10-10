# HandoffFM 证据模型

HandoffFM 的目标是让一个问题在事后仍然可答：**这次协作到底做了什么，我们有多确定？** 本文定义
证据词汇，明确何时归属被证明、何时不被证明，并区分"已实现且已测试"和"尚未验证"的内容。

请与 [usage.zh-CN.md](./usage.zh-CN.md) 一起阅读。本文不授权任何委派或发布行为。

## 1. 词汇

每条记录都有 `actor` 与 `evidence`。查看器和导出器都会保留它们；导出**不会**提升等级。

| `actor` | 含义 |
| --- | --- |
| `codex` | Codex 会话、它的 hooks，或 Codex 子代理 |
| `deepseek` | `delegate` 启动的 DeepSeek 进程，或在其任务窗口内观察到的改动 |
| `system` | HandoffFM 自身，包括收集器修复与 `recording.gap` |
| `unknown` | 无法确定写入方 |

| `evidence` | 含义 |
| --- | --- |
| `observed` | HandoffFM 在自己的操作或可信 hook 载荷中直接看到 |
| `declared` | Agent 自己这么说，陈述本身即记录（没有独立核验） |
| `unknown` | 事实被注意到了，但归属或完整性未被证明 |

`actor` 为 `codex`/`deepseek` 表示"归属于"，不是"已证明由其撰写"。`actor: 'deepseek'` 搭配
`evidence: 'unknown'` 是刻意的常见组合：改动发生在 DeepSeek 工作期间，但普通的 shell 写入无法证明
是谁写的。

### 三个等级的实际含义

- **observed（已观察）**——HandoffFM 自己的捕获动作：hook 载荷到达并归属到已启用项目、包装器开始或
  结束一次 run、事件被提交进日志。observed 说明**记录本身**是忠实的，**不**说明底层工作正确或完整。
- **declared（自述）**——Agent 自己的文本：最终消息或完成声明。陈述本身即记录，没有任何独立核验。
  `agent.message` 与委派完成里的文本都属于 declared。
- **unknown（未知）**——确实观察到的事实，但**写入方**没有被确立。shell 写入、脚本、重叠编辑，
  以及每一条 DeepSeek 文件改动都是 unknown。unknown 不等于"没有证据"，而是"不要把它归到某个具名写入方"。

要记住的实际不对称：Codex 的直接编辑**有可能**达到 `observed`；DeepSeek 的文件改动**不可能**。

## 2. 事件类型

| 类型 | 角色 | 典型证据等级 | 说明 |
| --- | --- | --- | --- |
| `session.started` | codex / deepseek | observed | Codex 的 `SessionStart`；DeepSeek 的 `session` 事件提供会话 ID |
| `task.started` | codex | observed | 携带提交的提示词 |
| `delegate.started` | codex | observed | 由 `delegate` 写入，含标题与任务提示词 |
| `tool.started` | codex / deepseek | observed；DeepSeek 事件被截断时为 unknown | 工具名、调用 ID、收到的输入 |
| `tool.completed` | codex / deepseek | observed | 生产方提供时记录退出码与状态 |
| `file.changed` | codex / deepseek | 只有隔离的显式 `apply_patch` 为 observed，其余为 unknown | 快照 diff 加内容寻址的前后 blob |
| `agent.message` | codex / deepseek | declared | Agent 的最终文本，未经核验 |
| `delegate.completed` / `delegate.failed` | deepseek | observed | 包装器生命周期；委派成功不等于改动被接受 |
| `turn.completed` / `turn.interrupted` | codex | observed | Codex 的 `Stop` 与 `Interrupt` hooks |
| `recording.gap` | system | unknown | 有记录被丢弃、修复、隔离，或无法捕获 |

## 3. Codex 记录

hooks 每个事件提交一份 JSON 载荷；CLI 从 stdin 读取，解析出已启用的项目，然后才写入记录。如果项目
未启用，或载荷的工作目录在项目之外（且会话未被显式绑定），则什么都不记录——hook 在此情况下是静默的。

Codex 文件改动的归属规则：

- **observed：** 工具是 `apply_patch`，改动路径在 patch 中点名，没有并行操作处于 pending，且前后
  快照恰好显示这一处内容变化。这是唯一声称 `codex` 撰写的情况。任一条件不满足，记录就保持
  `unknown`——不存在"大概是 Codex"这种中间等级。
- **unknown（间接或重叠）：** 其他所有路径——写文件的 shell 命令、脚本、格式化工具，或与其他在途
  工具发生重叠的编辑。重叠是对称的：两个操作重叠时双方都保持 `unknown`，包括先完成的那一个。
- 每条 `file.changed` 都会记录 `reason` 字符串，这个区分会一直保留到导出。

因为 `observed` 要求隔离，真实会话完全可能产出**全部为 `unknown`** 的 `file.changed` 记录，
即使每一次直接编辑都是 `apply_patch`。请读 `reason` 字符串而不是想当然：等级回答的是"这是谁写的"，
不是"有没有变化"。

Codex 的 `agent.message` 来自 `Stop` hook 的 `last_assistant_message`，等级为 `declared`
——那只是 Agent 的自述，不是已核验的事实。

随包提供的 hook 面就是 `hooks/hooks.json` 里的那六个事件。捕获代码也认识 Codex 子代理的
start/stop 载荷，会把它们记为 `delegate.started` / `delegate.completed`（文本为 `declared`），
但随包清单并没有注册这些 hook 事件，所以默认安装不会产生子代理记录。

## 4. DeepSeek 记录

`delegate deepseek` 启动 `dsh headless --json -`，把任务文件写入 stdin，并规范化 JSON 事件流：

- `thinking`、`text`、`status` 事件被丢弃。推理内容从不落盘。
- `session` 事件提供 DeepSeek 会话 ID；`status`/`turn_end` 事件提供完成原因，字符串形式与
  `{kind}` 对象形式都能解析。
- `final` 事件提供打印到 stdout 的回答，记录为 `declared`。
- 任何标记为 `truncated` 的事件都以 `evidence: 'unknown'` 记录——被截断的流无法证明发生了什么。
- 超大或无法解析的行会变成 `recording.gap`；delegate 继续运行。
- 子进程 stderr 刻意从不落盘、也不转发：DSH 的诊断输出可能包含推理内容。

### 为什么 DeepSeek 的文件 diff 永远是候选

DeepSeek 的 stdout 通知**不是写入前的屏障**。DSH 进程是异步写文件的，因此某个写工具的
`tool_result` 既不能证明正是这个工具造成了下一次快照中的改动，也不能证明期间没有别的写入方。
所以，在委派窗口内观察到的每一条 `file.changed` 都以 `candidateActor: 'deepseek'` 和
`evidence: 'unknown'` 记录，理由是"外部事件流不是写入前屏障"。与 Codex 隔离 `apply_patch` 的情形
不同，这里没有"直接工具"的例外。

未被工具结果报告过的改动，也会在委派窗口结束时以任务窗口快照 diff 的形式捕获，同样为 `unknown`，
因为确切写入方并未确立。

### 如何解读一次委派

- 退出码 `0` 需要同时满足：子进程退出 0、收到 `final` 消息、完成原因缺失或为 `completed`。其他任何
  组合都会写入 `delegate.failed` 并返回 `1`。成功说的是**这条命令**，不是代码。
- `delegate.completed` 的含义是"**交稿待检查**"。它**不**表示工作正确、完整或被接受，也不表示测试通过。
- 如果终止事件缺失，包装器仍会记录 `delegate.failed`，并追加一条 `recording.gap` 说明完成情况无法
  核验，让不完整的记录保持可见，而不是看起来像成功。
- 父级关联（`runId`、`taskId`、`parentTaskId`）会被保留。父会话 ID 若不是纯标识符就会被哈希，从而把
  run 拆开；参见 [usage.zh-CN.md](./usage.zh-CN.md)。

## 5. 记录无法告诉你的事

审查或导出记录时，请保持这些边界可见：

- **快照是经过过滤的。** 依赖与构建目录、`.git`、`.work`、`.handoff-fm`、dotenv 与凭据文件、密钥
  材料、二进制文件、超过 1 MiB 的文件和符号链接都被排除；扫描 5000 个文件后停止。被排除路径的改动
  永远不会被报告，因此这些文件可以毫无记录地发生变化。
- **时间只是观察时间。** `at` 是 HandoffFM 记录事件时的本地时钟，不一定是文件系统实际变化的时刻。
  导出显示的是相对于所选首条事件的偏移。
- **恢复保留已提交字节，然后做标记。** 没有换行的未提交尾部片段会被截掉，它之前的每一行已提交
  记录都会保留。校验失败或超大的 inbox 记录会被隔离。每次损坏恰好产生一条 `recording.gap`，
  但被丢弃的内容已从日志中消失（隔离文件仍保留供人工检查）。
- **死亡收集器可以恢复，同时保护新所有者。** 恢复只删除确认已死亡 PID 的具体随机所有者标识，
  再删除空目录；不按时间抢占存活进程。尚未完成创建的空锁目录在 10 秒后可恢复。已提交记录已 fsync。
  PID 复用时保守处理：存活的 PID 仍视为忙碌。
- **顺序是提交顺序，不是因果顺序。** 稠密且唯一的序号表示记录在日志中的提交顺序，而非底层工作的
  实际先后。
- **命令通过不等于验收通过。** 测试、构建、`doctor` 或 delegate 退出 0，从不意味着被委派的改动已被
  审查、正确或已合并。"该命令通过"就是全部结论。
- **字幕不是发言。** 查看器里的舞台字幕是刻意设计的玩笑文案。

## 6. 隐私取向

默认与开启是刻意分开的两步。

| 数据 | 默认 | 开启开关 |
| --- | --- | --- |
| 提示词与标题 | 排除 | `--prompts` |
| 文件路径 | 排除 | `--paths` |
| Diff | 排除 | `--diffs` |
| 工具/Agent 输出、退出码、消息 | 排除 | `--outputs` |
| 角色、事件类型、证据等级、序号 | 包含 | — |
| 相对时间 | 包含（导出中始终相对，绝不用绝对时间） | — |
| run/session/task ID | 以别名包含（`run-1`、`instance-1`、`task-1`） | — |

- 默认导出不含任何源码文本、路径、diff、输出，也不含墙上时钟时间。
- 各开关彼此独立、可叠加；`--prompts --paths` 只加入这两类，不加入其他内容。
- 遮蔽只是尽力而为，不构成保证：Bearer 令牌、`sk-`/`ghp_`/`github_pat_` 形态的密钥、
  `*_API_KEY=`/`PASSWORD=`/`SECRET=`/`TOKEN=` 赋值，以及以机密命名的对象字段，会在存储记录与导出中
  被遮蔽。自由文本、罕见格式、文件内容或 diff 中仍可能残留机密。**确认或分享前请务必亲自检查预览**，
  并假定已开启的输出与 diff 可能包含路径和机密。
- 离线导出是本地、只读、不执行的：`default-src 'none'` 的 CSP、没有 `connect-src`，
  bundle、样式与角色立绘全部内联，不发起网络请求。角色署名会保留在导出的页面内。
- `init` 会把 `.handoff-fm/` 加入 `.gitignore`，快照也会排除它。请让本地记录留在版本控制之外。

## 7. 验证状态

快照时间：2026 年 10 月。以下是当前测试与探测在**本仓库实现层面**覆盖的范围
（确切断言请见 `tests/` 目录）：

- hook 捕获的项目范围限定、真实工具身份、退出码记录。
- 证据规则：隔离的 `apply_patch` 为 `observed`；shell 写入与重叠编辑保持 `unknown`；同时发生的 hook
  编辑从不声称归属。
- DeepSeek 规范化：丢弃 `thinking`；被截断的事件从不声称归属；完成原因的字符串与对象形式规范化一致。
- 收集器持久性：跨重启去重、非法记录隔离、末行修复、每次损坏事件恰好一条 `recording.gap`、
  以及陈旧锁回收。
- 快照对私有文件、依赖、二进制、超大与链接文件的排除。
- 导出隐私：默认分享不含源码文本、私有标识符、路径或墙上时钟时间。
- watch 服务要求令牌与可信的 Host/Origin，只读，并支持事件流。
- 真实的 DSH 包装器委派可以在本开发环境中运行并被记录。

本项目自身记录中**真实跑过**的部分：

- 在 Windows + Codex 桌面端上，通过官方 CLI 信任插件的确切 hooks 后产生了真实 hook 记录：
  会话、提示词、`apply_patch` 的 `tool.started`/`tool.completed`，以及文件改动。
  `doctor` 显示 `codexHooks: observed`。
- `delegate deepseek` 已通过配置的 DSH 包装器执行真实委派，并记录了规范化后的 DeepSeek 事件流
  （`tool.started`/`tool.completed`/`file.changed`/`delegate.completed`）。
- 目前产出的每一条 `file.changed` 都是 `unknown`（候选）。这是预期行为而非失败：
  那些会话不满足 Codex `observed` 所需的隔离条件。

如实说明的限制：

- **桌面端 hook 的接受情况取决于客户端与项目。** hook 定义与管线已实现、载荷形态已测试，Windows
  Codex 桌面端也确实投递了记录。但不要把它推广到每个客户端、系统或回合。请把
  `codexHooks: observed` 理解为"本项目的记录正在到达"，而不是完整性证明。
- **桌面聊天记录并不完整，嵌套工具捕获也没有编排。** HandoffFM 只记录客户端通过已信任 hooks 实际
  投递的内容：它不重建聊天历史，也不包装或拦截嵌套工具调用。
- **不声称在 Linux 或 macOS 桌面端验证过。** 只有 Windows 端到端实测过。计划中的 Linux CLI/browser
  CI 用夹具测试；Linux 上的 Codex 与 DSH 桌面端仍未测试。
- **不声称已发布到注册表。** v0.1.0 面向 GitHub 发布产物；没有 npm registry 可用性，也不作任何采用度、
  热度或唯一性声明。
- **验证是一套流程，不是一枚徽章。** 请针对你自己的项目运行你自己的检查。

### 在本机重现检查

```powershell
# Windows PowerShell
npm test                       # 通过 tsx 运行 tests/ 下的 node --test
node dist/cli.js doctor --project C:\work\my-app
```

```sh
# POSIX
npm test
node dist/cli.js doctor --project ~/my-app
```

如果在受限沙箱中无法创建子进程，测试运行器会在任何断言执行前以 `spawn EPERM` 失败。这是环境限制，
既不算通过也不算失败——请在普通 shell 中重跑以获得真实结果。

`npm test` 覆盖上文列出的单元与集成行为。它不能证明某个具体 Codex 桌面版本会投递 hook 载荷，也不能
证明任何被委派的改动是正确的。请在此基础上加入你自己的审查与项目检查。

## 8. 逐步审查一次交接

1. `handoff-fm doctor` —— 确认环境，并确认记录正在到达。
2. `handoff-fm watch` —— 逐条阅读 run：角色、类型、证据等级。
3. 把每一条 `unknown` 当作一个问题：这个文件到底是谁写的？
4. 对改动运行项目自身的检查；delegate 退出 0 只意味着"交稿待检查"。
5. 这时才导出：先默认预览，再逐项开启并加 `--confirm`。
6. 分享前完整检查预览——遮蔽只是尽力而为，不是保证。
