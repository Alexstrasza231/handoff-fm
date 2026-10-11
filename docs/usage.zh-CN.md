# HandoffFM 使用指南

HandoffFM 在单个本地项目中记录一次**已经获得授权**的 Codex 与 DeepSeek 协作，在回环地址上回放，
并把选定的记录导出为离线只读 HTML。

本指南覆盖安装、命令行、watch 观看、委派 DeepSeek、离线导出。证据模型（到底证明了什么）见
[evidence.zh-CN.md](./evidence.zh-CN.md)。本文档本身不授予任何新权限：是否放行由你决定，
HandoffFM 只负责观察。

## 1. 环境要求与安装

| 项目 | 要求 |
| --- | --- |
| Node.js | 22.12 或更高（`engines.node >= 22.12.0`，`doctor` 会强制检查） |
| DeepSeek CLI（`dsh`） | 已安装且已完成认证；只有 `delegate` 需要它，且 HandoffFM 从不读取凭据 |
| Codex | 支持插件与 hooks 的版本，并且有可用的 hook 信任审查界面 |
| 操作系统 | Windows PowerShell 与 POSIX shell 都有示例；目前只有 Windows 端到端实测过 |

安装发布包即可。包里已经包含构建好的 CLI（`dist/`）与查看器（`web-dist/`），
不需要构建，也不需要开发依赖：

```sh
npm install -g https://github.com/Alexstrasza231/handoff-fm/releases/download/v0.1.2/handoff-fm-0.1.2.tgz
cd /path/to/your/project
handoff-fm init
handoff-fm doctor
```

本仓库跟踪的 `dist/` 与 `web-dist/` 就是为同一个包构建的，所以 Codex 插件与发布产物的行为一致。

如果是直接使用 git 仓库：

```powershell
# Windows PowerShell
npm ci
npm run build      # tsup -> dist/cli.js，vite -> web-dist/
node dist/cli.js doctor
```

```sh
# POSIX
npm ci
npm run build
node dist/cli.js doctor
```

注意：

- `dist/cli.js` 既是 hook 入口，也是 `handoff-fm` 可执行文件。拉取新代码后需要重新构建。
- 离线导出与 watch 查看器都依赖 Web 构建产物（`web-dist/`）。如果缺少 `web-dist/`，
  `watch` 打开页面会返回 `Resource unavailable`，`export` 会因读取 `web-dist/index.html`
  失败而报错；请先执行 `npm run build`。
- v0.1.2 是 GitHub 发布产物，**没有**发布到任何包注册表，因此 `npm install handoff-fm` 或
  `npx handoff-fm` 都不会解析到它。
- 下文用 `handoff-fm <命令>` 表示全局安装；在仓库里请替换为 `node dist/cli.js <命令>`。

## 2. 命令总览

```
handoff-fm <命令> [选项]
```

| 命令 | 作用 |
| --- | --- |
| `init` | 启用一个项目目录并登记到本地注册表 |
| `doctor` | 检查 Node、DeepSeek JSON 接口、以及是否已有 Codex hook 记录 |
| `watch` | 在回环地址启动实时查看页，附带每次启动的访问令牌 |
| `delegate deepseek` | 执行一个 DeepSeek 任务，并把它记入父级 Codex 会话 |
| `export` | 先生成预览，再按确认写出某一 run 的离线 HTML |
| `collect` | 把排队记录收集进持久日志，并打印全部事件 |
| `hook` | 内部命令：从 stdin 读取一条 hook JSON，不建议手动调用 |

通用约定：

- `--project PATH` 指定已启用的项目；不传时使用当前目录。
- 选项写法为 `--名称 值`；只写 `--名称` 时取值为 `true`。
- 任何命令失败都会返回非零退出码；`doctor` 在 Node 版本不足或 DeepSeek JSON 接口不可用时返回非零。

## 3. init：只启用需要的项目

```powershell
# Windows PowerShell —— 启用当前仓库
node dist/cli.js init

# 或指定路径，并使用不在 PATH 上的 DeepSeek 包装脚本
node dist/cli.js init --project C:\work\my-app --dsh-command "C:\Tools\dsh\dsh.cmd"

# 桌面端会话的工作目录不在项目内时，显式绑定该会话
node dist/cli.js init --bind-session <真实的 CODEX_SESSION_ID>
```

```sh
# POSIX
node dist/cli.js init
node dist/cli.js init --project /home/me/my-app --dsh-command /opt/dsh/bin/dsh
node dist/cli.js init --bind-session <真实的 CODEX_SESSION_ID>
```

`init` 会做三件事：

- 创建 `.handoff-fm/`，包含 `inbox/`、`objects/`、`pending/`、`quarantine/`、`config.json`
  与一份 `CONNECT.md` 本地提示；
- 如果项目 `.gitignore` 中没有 `.handoff-fm/`，就追加一行，避免本地记录被误提交；
- 把解析后的项目绝对路径登记到本机注册表
  （`%USERPROFILE%\.handoff-fm\projects.json`，或 `$HANDOFF_FM_HOME/projects.json`）。

`init` **保留**已有的 `config.json`，绝不覆盖；命令行参数是在已有配置上显式扩展：`--dsh-command`
设置 `dshCommand`，`--bind-session` 往 `boundSessions` 里追加一次（同一个会话 ID 不会重复加入）。
不带参数重跑只会重新登记。要手改 `dshCommand`，请直接编辑 `.handoff-fm/config.json` 并保留
`boundSessions`：

```json
{ "version": 1, "root": "C:\\work\\my-app", "dshCommand": "C:\\Tools\\dsh\\dsh.cmd", "boundSessions": [] }
```

只有当前 Codex 会话位于本项目的上级目录时，才需要 `--bind-session`；它让该会话的 hook 载荷归属到
本项目。请只绑定你从当前会话上下文里读到的真实会话 ID，绝不虚构。

`doctor` 与 `delegate` 都需要找到 `dsh`。如果普通 shell 里 `dsh headless --help` 正常，但 `doctor`
报 `deepseekJSON: not available`，说明桌面端/Codex 环境使用的路径不同——请用 `--dsh-command`
重新 `init`，指向确切的 CLI 路径。

## 4. 安装 Codex 插件并信任 hooks

插件清单是 [`../.codex-plugin/plugin.json`](../.codex-plugin/plugin.json)，它指向
`./hooks/hooks.json` 和随包技能。**安装插件不等于信任 hooks。**

```sh
# 1. 添加 GitHub marketplace，再添加插件
codex plugin marketplace add https://github.com/Alexstrasza231/handoff-fm
codex plugin add handoff-fm@handoff-fm

# 2. 审查确切的 hook 定义并信任
#    在 Codex 客户端打开 /hooks，逐条批准你希望启用的定义
```

请信任该插件定义的**正好六个** hook。部分桌面客户端用自己的信任界面代替 `/hooks`；使用你的客户端
提供的入口即可，但一定要先读清定义再批准。你要批准的正是 `hooks/hooks.json` 里的六个事件
（`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`Interrupt`），
每个都执行 `node "${PLUGIN_ROOT}/dist/cli.js" hook`，超时 3 秒。

- 这些 hook 只做观察：不会阻断、批准或改写任何工具调用。记录失败时只向 stderr 写一行提示，
  工具运行不受影响。
- 不要使用任何绕过、强制或跳过信任的开关来规避 hook 审查。如果你还没准备好信任，就先不信任：
  代价只是没有记录。
- 信任之后，只要本项目产生过至少一条 `tool.started` 记录，`doctor` 就会显示
  `codexHooks: observed`。在 Windows + Codex 桌面端上，已经观察到通过官方 CLI 信任后产生的真实
  `apply_patch` hook 记录。但这仍只是"本项目的记录正在到达"这一级别的证据，不代表每个客户端、
  每个系统或每个回合都被完整捕获——详见 [evidence.zh-CN.md](./evidence.zh-CN.md)。

## 5. doctor

```powershell
node dist/cli.js doctor --project C:\work\my-app
```

```sh
node dist/cli.js doctor --project ~/my-app
```

输出 JSON；硬性条件不满足时退出码非零：

```json
{
  "node": "ok",
  "deepseekJSON": "ok",
  "codexHooks": "observed",
  "project": "C:\\work\\my-app"
}
```

- `node`：正常为 `ok`，否则为 `Node 22.12+ required`。
- `deepseekJSON`：`dsh headless --help` 成功且输出包含 `--json` 时为 `ok`，否则为 `not available`。
  修正 PATH，或在 `init` 时传 `--dsh-command`。如果开发机上 `dsh` 不在 `PATH` 上，
  这里合法地显示 `not available` 并退出 1，但只要显式配置了 `dshCommand`，委派仍然可用。
- `codexHooks`：已有 Codex `tool.started` 记录时为 `observed`，否则为 `not yet verified`。
  它不代表某一次会话被完整记录了。
- `node` 或 `deepseekJSON` 不为 `ok` 时 `doctor` 退出非零；`codexHooks` 不影响退出码。

## 6. watch：本地实时查看器

首页显示 Codex 和 DeepSeek，各一句最近动作、任务标题、连接状态和一行当前任务用量。
未采集到的用量留空，不估算。模型、实例 ID 和证据说明移到详情。

- **查看详情**：打开 **过程记录 / 用量明细** 两个页签；点角色可筛选对应人员。
- **回放过程**：打开时间位置、速度、逐条移动和交接／失败跳转。
- **更多**：选择运行、试玩示例、分享预览、字幕和减少动效。
- **看个例子**：空状态里的静态示例入口，明确标为示例，不调用模型。

舞台字幕是固定趣味台词，真实原话与命令结果在操作详情中。
用量来源、部分数据、任务关联与 `--usage` 导出说明见[任务用量指南](./usage-tokens.zh-CN.md)。

```powershell
node dist/cli.js watch --project C:\work\my-app
node dist/cli.js watch --project C:\work\my-app --port 4500   # 4417 被占用时
```

```sh
node dist/cli.js watch --project ~/my-app
node dist/cli.js watch --project ~/my-app --port 4500
```

进程会打印一次性地址并保持前台运行：

```
HandoffFM watching enabled project
http://127.0.0.1:4417/#token=<32 字节十六进制>
Keep this process running. The URL grants access to local records; do not share it.
```

需要了解的行为：

- 服务只监听 `127.0.0.1`；`Host` 头不是精确的 `127.0.0.1:<端口>` 时直接返回 403；如果带了 `Origin`
  头，它必须是 `http://127.0.0.1:<端口>`。请使用打印出来的地址：`localhost` 或局域网 IP 会被拒绝。
- 所有 `/api/*` 请求都需要令牌，可以作为 `token` 查询参数，或放在
  `Authorization: Bearer <token>` 头里。页面从 URL 片段（`#` 之后）读取令牌，并以 Bearer 方式发送。
  静态文件不需要令牌，但同样受 Host/Origin 校验；数据端点仍然需要。
- 服务是只读的：非 GET 请求返回 405，也不存在任何命令执行端点。它不会修改你的项目，只会对
  `.handoff-fm/` 执行收集。
- 端口冲突会立即失败：`Port <n> is in use. Choose --port NUMBER.`。端口必须是 1–65535 的整数。
  换一个端口重启即可。
- 实时更新走 `/api/stream` 的 SSE：服务端按客户端的 `Last-Event-ID`/`since` 序号补发事件，每 300 毫秒
  发一次心跳，缓冲超过 1 MiB 就断开该流。如果不带 `since` 直接连接，会先把已记录事件全部补发一遍。
- 重启不丢记录：`inbox/` 中排队的文件会被收集器写入 `.handoff-fm/events.jsonl`
  （`watch`、`collect`、`export` 都会触发收集），重连的页面从自己的最后序号继续。用 Ctrl+C 停止；
  停止 watcher 不会丢失已记录事件。
- 查看器里的舞台字幕是刻意设计的玩笑文案，不是任何 Agent 的发言，请不要当作模型输出引用。

## 7. 委派一个任务给 DeepSeek

`delegate` 通过 stdin 把有边界的任务文本传给 `dsh headless --json -`，记录规范化后的事件流，把
DeepSeek 的最终回答原样写到 stdout，并把 run/task ID 写到 stderr。它**不会**给 DeepSeek 任何新权限：
运行前请保持你原有的工具与范围限制。

### 7.1 写任务文件

把有边界的任务文本写到项目内的文件。放在 `.handoff-fm/` 这类已被忽略的目录里，任务文件就不会进入快照
和 Git。

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force .handoff-fm | Out-Null
@'
Summarize the failing test in tests/store.test.ts and propose the smallest fix.
Do not commit. Report the files you would touch and why.
'@ | Set-Content -Encoding utf8 .handoff-fm\task.md
```

```sh
# POSIX
mkdir -p .handoff-fm
cat > .handoff-fm/task.md <<'EOF'
Summarize the failing test in tests/store.test.ts and propose the smallest fix.
Do not commit. Report the files you would touch and why.
EOF
```

任务必须非空，且不超过 128 KiB。

### 7.2 使用真实的父会话 ID

`--parent-session` 是必填项，必须是发起委派的那次 Codex 会话的真实会话 ID。请从当前会话/hook
上下文里读取，不要虚构。`--parent-turn` 可选：有真实 turn ID 就传，没有就省略。

```powershell
# Windows PowerShell
node dist/cli.js delegate deepseek `
  --task-file .handoff-fm\task.md `
  --title "修复 store 测试" `
  --parent-session <真实的 CODEX_SESSION_ID> `
  --parent-turn <真实的 CODEX_TURN_ID> `
  --project C:\work\my-app
```

```sh
# POSIX
node dist/cli.js delegate deepseek \
  --task-file .handoff-fm/task.md \
  --title "修复 store 测试" \
  --parent-session <真实的 CODEX_SESSION_ID> \
  --parent-turn <真实的 CODEX_TURN_ID> \
  --project ~/my-app
```

为什么必须精确：记录按 `runId` 分组。父会话 ID 是纯标识符
（`A–Z a–z 0–9 _ -`，不超过 160 字符）时会被原样用作 run ID，Codex 与 DeepSeek 的记录才会落在同一个
可回放 run 中；否则它会被哈希，委派记录会变成另一个 run，父级关联也就看不见了。请按 Codex 给出的
原样传入。

### 7.3 返回结果

- stdout：DeepSeek 的最终回答（原样透传）。
- stderr：`HandoffFM run: <runId>; task: <taskId>`，其中 run ID 可用于 `watch` 和 `export`。
- 退出码：仅当子进程退出 0、收到 final 消息、且完成原因为缺失或 `completed` 时才为 `0`；其他组合
  返回 `1`，并记录 `delegate.failed`。

成功退出意味着这次交接**交稿待检查**，而不是已通过。exit code 0 只说明*该命令本身*通过了。
请用自己的工具检查改动文件、运行项目既有检查，并继续让 hooks 记录你自己的编辑。

### 7.4 继续已有的 DeepSeek 会话

传入 `--session-id` 可以复用已有的 DeepSeek 会话，而不是新开一个。请从记录里读取真实会话 ID
（DeepSeek 的 `session` 事件会带上它），不要猜：

```powershell
# Windows PowerShell —— 列出本次 run 中已记录的会话 ID
node dist/cli.js collect --project C:\work\my-app |
  ConvertFrom-Json |
  Where-Object { $_.actor -eq 'deepseek' -and $_.kind -eq 'session.started' } |
  Select-Object -Last 1 sessionId, runId
```

```sh
# POSIX —— 同样的效果，不依赖额外工具
node dist/cli.js collect --project ~/my-app \
  | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{for(const e of JSON.parse(s))if(e.actor==="deepseek"&&e.kind==="session.started")console.log(e.runId,e.sessionId)})'
```

然后用第二个有边界的任务继续这段对话：

```sh
node dist/cli.js delegate deepseek \
  --task-file .handoff-fm/task2.md \
  --title "同一会话的后续任务" \
  --parent-session <真实的 CODEX_SESSION_ID> \
  --session-id <真实的 DEEPSEEK_SESSION_ID> \
  --project ~/my-app
```

两个任务会记录在同一个父级 `runId` 下（按 Codex 会话分组），而 DeepSeek 的 session ID 表明第二次
任务延续了前一次对话。

## 8. 离线导出：先预览，再逐项确认

`export` 只读取本地记录，不执行任何脚本，也不发起任何网络请求。导出的 HTML 带有
`default-src 'none'` 的 CSP 且没有 `connect-src`，因此文件既无法回连网络，也不会执行自身 bundle
之外的页面逻辑。

```powershell
# 1. 默认预览 —— 只有角色、通用事件类型与相对时间
node dist/cli.js export <RUN_ID> --output C:\work\share\run.html --project C:\work\my-app

# 2. 检查预览后，逐项选择并确认写出
node dist/cli.js export <RUN_ID> --output C:\work\share\run-confirmed.html --project C:\work\my-app `
  --prompts --paths --diffs --outputs --confirm
```

```sh
# 1. 默认预览
node dist/cli.js export <RUN_ID> --output ~/share/run.html --project ~/my-app

# 2. 逐项开启并确认
node dist/cli.js export <RUN_ID> --output ~/share/run-confirmed.html --project ~/my-app \
  --prompts --paths --diffs --outputs --confirm
```

各开关的行为：

| 开关 | 加入导出的内容 |
| --- | --- |
| （不加） | 角色、事件类型、序号、证据等级、别名化的 run/session/task ID、相对时间 |
| `--prompts` | 任务提示词与标题文本 |
| `--paths` | `file.changed` 记录中的文件路径 |
| `--diffs` | `file.changed` 记录中保存的 diff |
| `--outputs` | 工具/Agent 文本、输出、退出码、状态、失败信息与完成原因 |
| `--confirm` | 写入真实输出路径，而不是预览路径 |

实用规则：

- 预览是默认行为，并且在结构上就是安全的：未开启的字段根本不会被复制进导出。`at` 变成相对 run
  首事件的偏移，run/session/task ID 变成 `run-1`、`instance-1`、`task-1` 之类的别名。
- 预览写入 `<output>.preview.html`，并且从不覆盖：文件以独占方式创建，若预览已存在则命令失败。
  删除旧文件，或换一个 `--output`。
- `--confirm` 只改变写入路径，不会顺带开启任何类别。既要预览又要确认时，请重复执行命令（先预览，
  再用同一命令把 `--output` 指向确认文件名并加 `--confirm`）。
- 开启后的提示词、路径、diff、输出中可能包含机密、绝对路径、粘贴进任务的令牌，或工具回显的凭据。
  遮蔽（Bearer 令牌、`sk-`/`ghp_` 形态的密钥、`*_API_KEY=...`/`PASSWORD=`/`SECRET=`/`TOKEN=`
  赋值，以及以机密命名的字段）只是尽力而为。确认或分享之前，请亲自完整检查预览。
- 查看器的 `/api/export` 端点行为一致：`?run=<id>` 加上相同开关，同样只读，并由 watch 令牌鉴权。

## 9. 记录存放位置

所有内容都是项目级、纯本地的：

```
<项目>/.handoff-fm/
  config.json        项目配置（dshCommand、boundSessions）
  CONNECT.md         init 写入的本地设置提示
  inbox/             待收集的排队记录
  objects/           文件内容/diff 的内容寻址存储
  pending/           进行中的工具记账文件
  quarantine/        校验未通过、保留待查的记录
  events.jsonl       持久追加日志（每行一个 JSON 对象）
  journal.lock       独占收集目录，包含 PID 和随机标识的所有者文件
```

- `init` 会把 `.handoff-fm/` 加进 `.gitignore`，请保持这样。全局注册表
  （`~/.handoff-fm/projects.json`）也只留在本机，不进仓库。
- `hook` 只为**既执行过 `init`、又对该载荷工作目录在范围内**（或显式绑定会话）的项目记录。无关项目
  不会被记录——hook 在此情况下是静默的，这是设计使然。
- 记录只追加。收集器以原子创建目录和带 PID 的随机所有者标识取得独占权，不按时间抢占存活进程。
  恢复只删除已确认死亡进程的具体标识，再删除空目录；尚未写入所有者的空目录在 10 秒后可恢复。
  新所有者的标识会阻止延迟执行的恢复者删掉它的目录。记录 ID 的去重信息持久存在日志里，重启后有效。
- 收集同时会修复被截断的末行：没有换行的未提交尾部片段会被截掉，而已提交的每一行都会保留，
  随后用恰好一条 `recording.gap` 标记这次损坏。校验失败或超大的 inbox 记录会被隔离，
  同样只产生一条 `recording.gap`，而不是无声消失。
- 快照会排除依赖与构建目录（`node_modules`、`dist`、`web-dist`、`build`、`coverage`、
  `test-results`、`playwright-report`、`.git`、`.work`、`.handoff-fm`）、dotenv 与凭据文件、
  密钥材料、二进制文件、超过 1 MiB 的文件以及符号链接，并在扫描 5000 个文件后停止。
  被排除路径的改动永远不会被声称。

## 10. 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| `HandoffFM: recording gap; tool execution is unaffected.` | 某条 hook 载荷无法读取或无法归属。工具运行未受影响。检查 `doctor`，再确认项目已启用且在范围内。 |
| `codexHooks: not yet verified` | 本项目还没有 Codex `tool.started` 记录。确认插件已添加、hooks 已信任，且会话工作目录位于项目内（或已绑定会话）。 |
| `deepseekJSON: not available` | `dsh headless --help` 失败或缺少 `--json`（这也会让 `doctor` 退出 1）。修正 PATH，或用 `--dsh-command` 重新 init。 |
| `Port 4417 is in use.` | 另一个 watcher 占用了端口。停止它，或传 `--port`。 |
| 页面返回 `Resource unavailable` | 缺少 Web 构建产物；执行 `npm run build` 生成 `web-dist/`（发布包安装不需要）。 |
| 403 `Invalid Host` | 你打开了 `localhost` 或局域网地址。请用 `http://127.0.0.1:<端口>/#token=<令牌>`。 |
| 401 `Access token required` | 令牌缺失或错误。重新复制打印出来的 URL，包含 `#` 之后的全部内容。 |
| `Unsafe DSH path or argument` | Windows `.cmd`/`.bat` 命令路径含 shell 元字符，或某个 delegate 参数不是纯标识符。请把 `--dsh-command` 指向干净路径；任务文本始终走 stdin，不作为参数传递。 |
| `Run has no recorded events` | 该项目中不存在该 run ID，或日志里没有它的已提交事件。查看 `/api/runs` 或执行 `collect`。 |
| 预览报 `EEXIST` | `<output>.preview.html` 已存在。删除它，或换新的 `--output`。 |
| `delegate` 退出码 1 | DeepSeek 非零退出、没有发出 final 消息，或完成原因不是 `completed`。失败会记为 `delegate.failed`；请先读取记录的原因再重试。 |
| `HandoffFM: journal unlock delayed; committed records are safe.` | Windows 延迟清理所有者文件，下一次收集会重试；已提交记录已 fsync。不会按时间抢占存活进程。 |

## 11. 相关文档

- [../README.zh-CN.md](../README.zh-CN.md) 与 [../README.md](../README.md) —— 项目概览与快速开始。
- [evidence.zh-CN.md](./evidence.zh-CN.md) —— 证据等级、归属规则，以及当前测试能证明和不能证明什么。
- [../skills/handoff-fm/SKILL.md](../skills/handoff-fm/SKILL.md) —— 驱动该流程的随包技能。
- [../.codex-plugin/plugin.json](../.codex-plugin/plugin.json) 与
  [../hooks/hooks.json](../hooks/hooks.json) —— 你要审查的确切插件与 hook 定义。
