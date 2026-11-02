# 前端主 Agent 化适配清单（验收用）

> 用途：路线 C（`agent-native-prd-2026-10-17.md`）落地后，**逐项验证前端"先前使用 pipeline 的部分"是否已经适配**。
> 现在这份清单是**盘点 + 要求**，验收时逐行打勾并记录证据（截图/测试名）。
> 盘点依据：`src/services/api/pipeline.ts`、`src/stores/agentStore.ts`、`src/features/agent/*`、`src/pages/{HomePage,ExportPage,admin/PipelineAdminPage}.tsx`、`src/features/supervisor/*`。

## 0. 结论先行（盘点结果）

- 前端对"管线"的依赖集中在 **4 处**：`pipelineApi`（12 个方法）、`agentStore`（阶段/日志/建议状态机）、`AgentPanel`（SSE + 交互）、`Supervisor*`（消费 `/api/pipeline/{pid}/*`）。
- **没有任何一处直接读后端内部结构体**：都经 API/类型层，这是好消息——适配可以只改"数据形状映射层"，不用重写 UI。
- 真正的迁移成本在**语义**：`phase`（阶段）→ `plan step`；`logs`（trace 事件流）→ `events`（typed 事件流）；`suggestions`（自愈建议）→ `replan`。

## 1. 逐项适配清单

图例：**必须** = 主 agent 化上线前必须完成；**兼容** = 双轨期两套都能跑；**已就绪** = 现在就不用改。

| # | 模块 | 现在依赖什么 | C 之后必须变成什么 | 阶段 | 验收方式 |
|---|---|---|---|---|---|
| 1 | `services/api/pipeline.ts` | 12 个方法：`runAsync/run`、`status`、`result`、`trace`、`traceStreamUrl`、`retry`、`cancel`、`step`、`templates*`、`predict*` | 新增 `taskApi`（`create/status/events/eventsStream/pause/resume/cancel/inject/plan`）；`pipelineApi` 保留但标注"经典模式（将下线）" | C3 | 单测：新 API 客户端覆盖 8 个端点；`tsc` 无 `pipelineApi` 新引用 |
| 2 | `types/pipeline.ts` | `LogEntry`（`type: LogEventType` 枚举，含 `agent_start/agent_end/mg_*`）、`PipelinePhase`、`AgentStat`、`PipelineSummary` | 新增 `types/task.ts`：`Task`、`Plan`、`PlanStep`、`TaskEvent`（typed union）、`ToolCall`；保留旧类型一个版本 | C3 | `tsc`；事件类型断言测试（每种事件都能被前端渲染分支命中） |
| 3 | `stores/agentStore.ts` | `phase`（对应 6 阶段）、`logs[]`、`suggestions[]`、`agentStats`、`pipelineStartedAt` | 新增 `taskStore`：`task/plan/steps/events/cost`；`phase` 变为**派生值**（由 step 状态聚合），不再由后端阶段事件直给 | C3+C4 | store 单测：给定一串 `TaskEvent`，能算出 plan/step 状态与成本；不依赖 `phase` 字段 |
| 4 | `features/agent/AgentPanel.tsx` | `GET /trace/stream/{pid}`（EventSource）+ 日志过滤 + 重试按钮 + 建议面板 | 改用 `events/stream`（同源 SSE 契约，事件类型换成 TaskEvent）；重试按钮 → 「暂停/继续/注入」；建议面板 → 计划视图入口 | C4 | 组件测：mock SSE 推送 5 类事件后断言 UI；e2e：一条 task 从头跑完 |
| 5 | `features/agent/ReviewPanel.tsx` / `TimelineDiffView.tsx` | 读 `agentStore.suggestions`（自愈建议）与时间线快照 diff | `suggestions` 语义变为 `replan` 建议（来自 Kernel 的 reflect）；diff 组件保留（产物仍是 timeline） | C4 | 组件测：replan 建议渲染 + 采纳后计划变更可见 |
| 6 | `features/supervisor/useSupervisorEvents.ts` | 复用 `/trace/stream/{pid}`，按 `ledger_entry/attribution/diag_report/dispatch/subagent_*/exec` 分流 | 增加 `task_event` 分支（plan/step/tool_call/approval/artifact）；保留现有分支一个版本 | C3 | 单测：`toSupervisorEvent` 对新旧事件都能映射；未知类型丢弃 |
| 7 | `features/supervisor/*`（Drawer/DecisionTimeline/DiagnosisCard/ExecLogList/SubagentTree/…） | 消费 `/api/pipeline/{pid}/{ledger,decisions,subagents,exec,…}` | 「决策记录」段改为「计划变更」；诊断书改为「Step 归因」；执行日志/子代理/授权保留（v1.5 资产原样复用） | C4 | 组件测 + 人工核对：抽屉里能看到 plan/replan/step 归因 |
| 8 | `pages/HomePage.tsx` | `pipelineApi.runAsync` 起任务 | 走 `taskApi.create`（`plan_only` 默认开 → 先出计划页） | C3+C4 | e2e：首页输入一句话 → 出现计划 → 确认后开跑 |
| 9 | `pages/ExportPage.tsx` | 渲染队列 SSE（`/api/render/queue/stream`） | **不变**（渲染仍是独立队列，不属于 agent 编排） | — | 已就绪 |
| 10 | `pages/admin/PipelineAdminPage.tsx` | `GET /api/pipeline/runs` + trace JSON 检视 | 增加 `GET /api/task`（任务列表）；保留 runs 作为 legacy 视图 | C6 | 手动验证两套列表都能开 |
| 11 | `layouts/EditorLayout.tsx` | `<SupervisorLauncher />`（浮动入口） | 增加「计划」入口；浮动入口保留（授权/待审徽标仍需常驻） | C4 | 组件测：两个入口都能开面板 |
| 12 | 全局提示 | 无 | **配置建议条**：agent 想改 Persona/路由时只出现「建议」，点击才落盘（PRD Q2） | C4 | 组件测：建议条出现 → 点确认才调 settings API |
| 13 | 错误与降级文案 | 按阶段报错（`AgentPanel` 显示 `agent_end`/`error`） | 按 Step 报错 + 收尾三件套（结论/已完成/未完成原因） | C4 | 构造超限任务，前端展示三件套 |

## 2. 双轨期（C3）必须同时成立的三件事

1. `AGENT_MODE=off` 时前端走老路径，**行为与今天一致**（PRD A13：timeline 逐字节比对，由后端保证，前端只需保证不并发订阅两套流）。
2. 两个入口互斥展示：经典模式不显示「计划」入口，agent 模式不显示「重试 Agent 按钮」。
3. SSE 只订阅一条：`/trace/stream` 与 `/events/stream` 不得同时开（否则事件重复、成本翻倍）。

## 3. 当前状态（C4 之后，2026-10-17）

> C4 不是"加一个可选视图"，而是**把任务工作台做成主路径**：
> 首页主 CTA → `/task` → 计划确认 → `/task/{id}` 执行 → 收尾三件套。
> 下表按代码逐项核对，✅ = 已有实现与测试，⚠️ = 部分，❌ = 仍是管线语义。

| # | 模块 | 状态 | 证据（C4 后） |
|---|---|---|---|
| 1 | `services/api/task.ts` | ✅ 新增 | 8 个方法 + `eventsStreamUrl`；`taskApi` 覆盖 PRD §8.4 |
| 2 | `types/task.ts` | ✅ 新增 | `Task/Plan/PlanStep/TaskEvent`（15 种事件类型），无 `phase` |
| 3 | `stores/taskStore.ts` | ✅ 新增 | 事件折叠推导 plan/step 状态；重复 seq 去重；400 条上限；15 条单测 |
| 4 | `features/task/` 组件 | ✅ 新增 | `PlanPanel`（先看再花钱）/`TaskToolbar`（暂停/继续/取消/插话）/`EventFeed`（调用流） |
| 5 | `pages/TaskPage.tsx` + `TaskLauncherPage.tsx` | ✅ 新增 | 工作台 + 一句话入口；收尾三件套可见 |
| 6 | `features/task/useTaskEvents.ts` | ✅ 新增 | 订阅 `/api/task/{id}/events/stream`；终态自动断流 |
| 7 | `router.tsx` | ✅ 已改 | 新增 `/task` 与 `/task/$taskId`（懒加载 + 会话守卫） |
| 8 | `pages/HomePage.tsx` | ✅ 已改 | 主 CTA「一句话出片（主 Agent）」→ `/task`（`HomePage.tsx:711`） |
| 9 | `pages/ExportPage.tsx` | ✅ 保持 | 渲染队列 SSE 独立于编排，不需要改 |
| 10 | `features/agent/AgentPanel.tsx` | ❌ **未替换** | 仍走 `pipelineApi.getTraceStreamUrl` + `agentStore.suggestions`；C7 随老入口一并下线 |
| 11 | `ReviewPanel.tsx` / `TimelineDiffView.tsx` | ❌ 未适配 | 仍读 `agentStore.suggestions`（管线自愈语义） |
| 12 | `pages/admin/PipelineAdminPage.tsx` | ❌ 未适配 | 仍只读 `/api/pipeline/runs`；任务列表在 `/task` 页内 |
| 13 | 配置建议条（Q2） | ❌ 缺失 | agent 改配置只能提议，后端尚无"建议"事件类型 |
| 14 | `EditorLayout` 内的任务入口 | ❌ 缺失 | 编辑器内还没放「任务」入口（只有浮动调度按钮） |

**结论**：13 项旧清单里 **9 项已落地（含 6 项新增）**，剩 4 项明确未做：
AgentPanel/ReviewPanel（C7 随老入口删除）、PipelineAdminPage（并入任务列表）、配置建议条（依赖后端事件）。
这三项**不是漏做，是有意推迟**——它们要么依赖 C5 的注入语义，要么跟着 C7 一起删，现在做等于白做。

> 验收口径：**每一项必须有证据**（测试文件:用例名 / e2e 录屏 / 截图）。没有证据视为未通过——这是上一轮"接线没接上却被当成做完"的教训。
> C4 的自动化证据：`src/stores/taskStore.test.ts`(15) + `src/features/task/task-ui.test.tsx`(12)，
> 前端全量 891 passed、tsc 0 错、eslint 0 error、build 通过。

## 4. 路线 C 验收（2026-11-02 复核）

本轮按代码逐项复核，**只勾有证据的**；新增项来自 2026-11-02 用户裁定。

| # | 模块 | 状态 | 证据 |
|---|---|---|---|
| 1 | `services/api/task.ts` | ✅ | 8 方法 + `eventsStreamUrl` |
| 2 | `types/task.ts` | ✅ | `Task/Plan/PlanStep/TaskEvent`（29 事件类型联合） |
| 3 | `stores/taskStore.ts` | ✅ | 事件折叠 + `seq` 去重 + 400 上限 + 同轮 thinking 合并（2026-11-02 新增，防高频事件把页面拖死） |
| 4 | `features/task/*` | ✅ | `PlanPanel` / `TaskToolbar` / `EventFeed` / `TaskQuestionCard` / `RunningSubagents` |
| 5 | `pages/TaskPage.tsx` | ✅ | 工作台 + 收尾三件套 |
| 6 | `features/task/useTaskEvents.ts` | ✅ | 共享 SSE（引用计数 + 终态 close + `since_seq` 续传，不变量 #17） |
| 7 | `router.tsx` | ✅ | `/task`、`/task/$taskId` |
| 8 | `pages/HomePage.tsx` | ✅ | 主 CTA 走「新建制作 → 需求对话 → 主 Agent」 |
| 9 | `pages/ExportPage.tsx` | ✅ 不需要改 | 渲染队列独立于编排 |
| 10 | `features/agent/AgentPanel.tsx` | ⚠️ 部分 | 需求对话主路径已改用**会话时间线**（`SessionTimeline` + `/chat/stream` SSE），轨迹是固定标签；文件里仍留有 `pipelineApi.getTraceStreamUrl` / `getResult` 的 legacy 分支（等 C7 随老入口一起删） |
| 11 | `ReviewPanel.tsx` / `TimelineDiffView.tsx` | ❌ | 仍读 `agentStore.suggestions`（管线自愈语义）；C7 下线 |
| 12 | 配置建议条（Q2） | ❌ 仍缺 | 后端还没有"配置建议"事件类型；agent 目前只能在正文里提议 |
| 13 | 错误/降级文案 | ✅ | `TaskFinishSummary` 三件套 + `degradation` 条目 + 降级收据（`acknowledge_degradation`） |
| 14 | 编辑器内任务入口 | ✅ | 编辑器右侧 `CopilotDock`：`需求对话` + `轨迹`（固定），产物新开 `artifact` 标签 |

### 4.1 本轮新增（2026-11-02 用户裁定）

| 项 | 状态 | 证据 |
|---|---|---|
| 能力解析是唯一入口 | ✅ | `BaseAgent.call_tool` 删除 `fallback_name()` 名称兼容路径；解析不到 → `NOT_FOUND`，不再绕过插件/配置状态执行 |
| 主 Agent 墙钟不设上限 | ✅ | `TaskLimits.max_wall_sec` 默认 `3600 → 0`（0 = 不限）；回合/工具预算闸保留。**其余中止条件待用户确认**（见下） |
| 时间线「谁最后写的」 | ✅ | `task_project_sync.stamp_writer()`：`metadata.last_writer = agent:<task_id> / editor[:<user>]` + `written_at` + `agent_sig`；编辑器保存时打 `editor`（内容未变则保留 agent_sig，变了就清掉，agent 中间回写停手） |
| 各 agent 实时生成时间轴 | ✅ | `agent_kernel` 每派完阶段即 `sync_timeline_to_project(incremental=True)`，本轮把 `degraded` 也纳入；前端收到 `artifact(kind=timeline)` 事件即时刷新（+4s 轮询兜底） |
| 资源库按工作区目录呈现 | ✅ | 新端点 `GET /api/workspace/{id}/media-tree`（实时目录树，含未索引媒体，跳过系统目录）+ 左侧资源库新增「工作区」标签（`WorkspaceMediaTree`） |

### 4.2 待确认：主 Agent 新中止条件

墙钟去掉后，建议保留/新增这些终止条件（**等你拍板**）：

1. **回合预算**（`max_turns`，现在 proceed 建任务给 160）
2. **工具调用预算**（`max_tool_calls`，现在 800）
3. **金额/令牌预算**（未配置 = 无上限）
4. **无进展**：连续 N 轮没有任何新产物/黑板变化（建议 N=6）
5. **重复动作**：同一工具+参数的连续失败熔断（已有：per-tool 连续 5 次）
6. **降级未处置**：`degradation_unresolved` 收尾门（已有）
7. **完成标准达成**：`final_timeline` 写入且收尾校验通过（已有）
8. **用户取消/暂停**（已有）

**已确认（2026-11-02 用户裁定）**：只保留 **完成标准达成 / 用户取消暂停 / 降级未处置**，
**新增无进展检测 N=6**、**扩展跨阶段重复动作熔断**；回合 / 工具调用 / 金额三道闸
改为 `0 = 不限`（`TaskLimits` 默认全 0，`agent_loop` 只留结构性护栏 400/4000/24）。
实现位置：`agent_kernel._gate_hit`（无进展 `_PROGRESS` + 熔断 `_REPEAT_FAILS`）、
`agent_kernel._on_tool_call`（跨阶段失败指纹计数）、`schema/task.py:TaskLimits`。

### 4.3 任务执行期「停止」控制（2026-11-02 落地）

| 项 | 状态 | 证据 |
|---|---|---|
| 运行条上的停止按钮 | ✅ | `AgentPanel` 运行条 `data-testid="requirements-running-bar"`（出现在 `status ∈ {pipeline_running, planning}`），右侧 `data-testid="requirements-stop"`；点击进入 `stopping`（转圈 + 禁用，防连点） |
| 输入区原样恢复 | ✅ | composer 渲染条件是 `!['pipeline_running','planning'].includes(status)`；`stopRunningTask()` 拿到响应即 `setStatus('plan_ready')` + 清 `requirementsBusy`，编辑框 / 附件按钮 / 发送按钮**不刷新就回来** |
| 后端真中止 | ✅ | `POST /api/requirements/{session_id}/stop` → `RequirementsService.stop_task()`：`kernel.cancel()` 打断协程（只改状态会让阶段跑满墙钟）+ 作废待答问题 + `task_end{reason:"cancelled"}` |
| 中止留痕 | ✅ | 会话消息与时间线各写一条 `metadata.user_stopped=true` 的说明，`context_loader` 带进下一轮上下文——续跑的主 agent 知道是**用户主动喊停**，接着做而不是从头再来 |
| 无活任务不伪造 | ✅ | 没有在跑的任务时 `stopped=false`、`note` 为空，只把悬空状态修正为 `plan_ready` |

代码侧自检（单进程 TestClient）：任务 `pending → cancelled`、会话 `pipeline_running → plan_ready`、
末条消息 `user_stopped=True`、时间线条目出现、二次点击 `stopped=false`。
详见 `docs/agent-stop-control-2026-11-02.md`。
