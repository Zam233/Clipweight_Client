# Clipwright / 帧艺：Agent 运行时前端闭环 PRD

> 来源：2026-10-30 由 gpt-5.6-sol 对「后端 agent 化之后前端是否适配」做代码审查，结论为**部分适配**（P1×10 + P2×1），并据此产出本 PRD。
> 后端基线：`J:\Clipwright` 提交 `86d4503`（代码）+ `1359d69`（三份 PRD 文档）；前端基线：`J:\Clipweight-Client` 提交 `166f897`。
> 审查核对结果：任务快照已经提供 `limits`、`usage`、`finish`，事件补拉接口已有 `since_seq`，且后端 `events_since()` 默认合并磁盘溢出记录——缺口主要在前端没有接通这些能力。收据台账当前是进程内存结构、没有任务收据读取路由；渲染 `.fp` 是后端缓存侧车文件，未核实存在可由前端消费的指纹 API，因此分别列为后端契约请求（D1）与待核实项（D4）。

**文档状态：** 可进入实现拆分
**产品范围：** 任务运行标签中的 Agent run、降级处置、终态、预算、事件恢复、工具轨迹、产物同步及导出一致性。
**实现约束：** 本期不改变 Agent 执行策略；前端优先消费现有接口与字段。需要后端新接口或字段的部分列为明确契约请求。所有未由代码证实的部分标为「待核实」。

## 1. 背景与现状

后端 Agent 化后，一次任务不再是按固定管线顺序执行的步骤集合，而是由主 Agent 决策、调用工具、派发阶段子 agent、检查降级并收敛为任务终态的运行时。后端已有可寻址 run、完整工具轨迹、事件溢出存储、预算护栏和终态收尾数据。

前端已接入事件、run 列表、轨迹、产物和用量等基础数据，但关键字段没有形成用户可理解的闭环。例如，run 详情接口已封装却没有 UI 调用点；终态只显示结论，没显示结束原因和未完成项；页面刷新后不会补齐 SSE 断线期间的事件；预算只显示消耗，不显示限额。

这会让用户把「Agent 正在动态决策」误读成「固定阶段正在推进」，也会把「降级条数」误读成「已处理」或「无需处理」。刷新后记录缺失、预算触闸原因不明、任务结束但产物暂不可见等情况，会进一步削弱对执行结果的信任。

**代码核对边界：** 已直接核对后端 `clipwright/api/task.py`、`schema/task.py`、`schema/run.py`、`services/degradation_ledger.py`、`services/task_events.py`，以及前端任务 API、store、类型、任务运行组件、标签和导出页。PRD 中凡涉及其他渲染路由、指纹传输方式、追问排队持久性或发起人身份信息，均按「待核实」或后端契约请求处理。

## 2. 目标、非目标与用户故事

### 2.1 目标

**P0：保证任务事实完整、可恢复、可解释。**

- 用户可查看 run 的 brief、outputs、needs、failure、完整 degradations 与轨迹路径。
- 用户能区分已修复、已接受、待处置及免收据的信息型降级，并看到收据证据。
- 任务结束后能看懂结束原因、完成项、未完成项。
- 用户能同时查看用量、限制、剩余量及触发的预算闸。
- 刷新和断线重连后能补回历史事件，不静默丢失已落盘记录。
- 项目时间线同步稍有延迟时，产物区继续重试，不把暂时性空快照当作最终事实。
- 导出提交和重试必须显示实际采用的时间线版本/指纹；确认策略前，不声称重试采用「最新」或「原始」时间线。

### 2.2 P1：让 Agent 操作过程与长任务数据可用

- 工具轨迹支持分页与虚拟化，明确标记 `internal`、`kernel` 与去重结果。
- 追问、重放具备独立过程态、可读错误、重放结果摘要，并正确消费返回的 run。
- 事件语义在摘要和详情中可读，不要求用户解读原始 JSON。
- 增加覆盖详情、降级、断线恢复、终态预算和导出一致性的组件及 E2E 测试。

### 2.3 非目标

- 不重写 Agent Kernel，不改变阶段调度、工具选择或守门策略。
- 不把 Plan 改造为真实执行进度。`hypothesis_only` 计划仍标注为初始假设。
- 不在前端提供「接受降级」操作。本期优先准确展示后端已有的处置事实；是否允许用户新增接受收据需另行评审后端语义与权限。
- 不在没有后端契约的情况下推断 run 的操作者、重放产物归属或时间线指纹。
- 不改造与本任务无关的导出队列、渲染器或旧管线页面。

### 2.4 用户故事

- **P0**：作为创作者，我要打开某次阶段 run，知道 Agent 收到什么要求、产出了什么、缺少什么、为何失败，以及工具轨迹保存在哪里。
- **P0**：作为创作者，我要知道降级是否已修复、由何种处置收据关闭，哪些问题仍待处理。
- **P0**：作为创作者，我要知道任务为什么结束、哪些内容完成、哪些未完成，以及哪个预算限制触发了停止。
- **P0**：作为创作者，刷新或断网恢复后，我要看到连续的事件记录，并在记录有缺口时得到明确提示。
- **P1**：作为创作者，我要在追问或重放时看到请求处理中、完成结果或可采取的错误反馈。
- **P1**：作为创作者，我要在大量工具轨迹和事件中仍能流畅滚动、分页和定位。

## 3. 信息架构与组件落位

页面按「结论与限制 → 实时执行 → 可寻址 run → 全量轨迹与历史」的层次组织。保持现有单列任务运行标签，不引入新页面。

### 3.1 顶部结论区

**位置：** `CopilotTaskRunTab.tsx` 顶部 `TaskToolbar` 下方，现有 conclusion 文案所在位置。

**组件：**

- 新增 `src/features/task/TaskFinishSummary.tsx`
  - 显示终态状态、reason 中文解释、结论、已完成清单、未完成清单。
  - reason 未知时显示原值并注明「新终态，前端待适配」，不得伪装为失败。
  - 运行中、没有 `finish` 时不显示终态面板。
  - 终态详情默认展开；完成项、未完成项分别分组。未完成项为空时显示「没有记录未完成事项」。

### 3.2 用量与预算区

**位置：** 顶部结论区之后，原 `UsageRows` 所在位置。

**改动：** 在 `CopilotTaskRunTab.tsx` 中将 `UsageRows` 改为接收完整 `TaskUsage` 和 `TaskLimits`。

**交互：**

- 展示使用量、限额和剩余量；无上限的 `budget_usd: null` 显示「未设置金额上限」。
- `unknown_cost_calls > 0` 时显示「有 N 次调用的成本未知，金额未包含这些调用」。
- 命中 `gate_hit` 后突出实际触发的闸及其事件原文/结构化 detail。
- 非触闸终态不制造「触闸」结论。

### 3.3 真实执行区

**位置：** 保留 `真实进展（来自事件）` 标题，其下依次展示：

1. `ModelTurnRows`：Agent 叙述、意图与思考摘要。
2. `StageRows`、`ToolCallRows`、`ApprovalRows`：现有实时摘要。
3. `DegradationRows`：改为只显示最近摘要，并提供「查看全部处置」展开入口。
4. `TaskRuns`：run 列表，每个 run 可展开详情。
5. `TaskToolTrace`：全量轨迹，折叠默认关闭。
6. `EventFeed`：完整事件流，位于主体可滚动区，默认展示最近事件并提供「跳到最新」。

### 3.4 Run 与降级详情

- 新增 `src/features/task/TaskRunDetail.tsx`：通过现有 `taskApi.runDetail()` 获取单个 run；默认折叠；内容分为「输入与要求、结果与产物、待补信息、降级与处置、失败信息、工具轨迹引用」。
- 新增 `src/features/task/TaskDegradationPanel.tsx`：汇总事件、run 详情和收据接口（若后端新增）中的降级状态；按待处置、已修复、已接受、免收据分组。
- `TaskRuns.tsx` 保留列表项摘要；详情按需获取，单次只允许一个 run 展开，切换时取消或忽略上一个详情请求的迟到响应。

### 3.5 轨迹与事件区

- `TaskToolTrace.tsx`：按阶段与 attempt 选择轨迹；分页游标按 offset 推进；列表虚拟化。
- `EventFeed.tsx`：新增语义化摘要渲染和事件缺口提示；原始 detail 仍可展开查看，避免丢字段。
- `useTaskEvents.ts`：负责首屏水合和 SSE 订阅生命周期，不把恢复逻辑散落在展示组件中。
- `taskStore.ts`：作为 seq 去重及事件有界缓存的唯一入口；保留 `hydrateEvents`，增加恢复状态和缺口元数据。

## 4. 接口契约

### 4.1 已存在接口

| 方法与路径 | 状态 | 前端消费字段与用途 |
|---|---|---|
| `GET /api/task/{task_id}` | 已存在 | `{task, events}`；`task` 包含 `status`、`limits`、`usage`、`finish`、`plan`。用于首屏任务快照及刷新恢复。 |
| `GET /api/task/{task_id}/events?since_seq={seq}` | 已存在 | `{task_id, since_seq, count, items}`；事件含 `seq/type/ts/message/detail`，可选 `trace_id/run_id/span/causation_id`。后端调用 `events_since()`，默认合并 spilled 和内存事件。 |
| `GET /api/task/{task_id}/events/stream` | 已存在 | SSE `data:` 帧为事件公开结构。当前实现连接时 `last_seq=0`，会从头读取，未消费 `since_seq` 或 `Last-Event-ID`。本期前端通过 REST 补拉并 seq 去重，不依赖该流具备续传。 |
| `GET /api/task/{task_id}/runs` | 已存在 | `{task_id,count,items}`；摘要含 `run_id/kind/stage/role/status/attempt/duration_ms/cost_usd/degradations/tool_calls/tool_calls_path/report_path/summary/replayed`。 |
| `GET /api/task/{task_id}/runs/{run_id}` | 已存在 | `{task_id,run}`；后端返回 run 的全量数据。其实际字段以 `AgentResult` 为准，包括 `brief/outputs/needs/degradations/tool_calls/tool_calls_path/failure/provider/model` 等。`agent` 显示名字段当前未见于 `AgentResult`，不得假设存在。 |
| `POST /api/task/{task_id}/runs/{run_id}/message` | 已存在 | 请求 `{text}`，长度 1–2000；响应 `{task_id,run_id,stage,pending}`。该消息排入该阶段下次派发。 |
| `POST /api/task/{task_id}/runs/{run_id}/replay` | 已存在 | 响应 `{task_id,stage,status,replayed,run}`；前端 API 类型当前未声明响应中的 `run`，需补齐类型消费。 |
| `GET /api/task/{task_id}/tool-calls?stage=&attempt=&limit=&offset=` | 已存在 | `{task_id,stage,attempt,path,total,offset,limit,count,internal,failed,items,available}`。单次 `limit` 最大 20,000；前端建议固定 200 项分页。 |
| `GET /api/task/{task_id}/result` | 已存在 | `{task_id,has_timeline,tracks,clips,duration_sec,output_path}`。目前不包含同步状态、重试建议或时间线指纹。 |
| `POST /api/task/{task_id}/to-project` | 已存在 | 响应 `{task_id,project_id,name}`；无 timeline 返回 409。 |
| `POST /api/task/{task_id}/resume` | 已存在 | 终态返回 409，detail 中含 `reason: task_terminal/status/message`；不属于 run 操作错误。 |

### 4.2 明确后端契约请求

**D1：新增任务降级台账查询。**

请求新增 `GET /api/task/{task_id}/degradations`，仅返回该任务的台账，不接受客户端提交 task_id 以外的路径信息。

建议响应：

```json
{
  "task_id": "task_...",
  "pending": [
    {
      "kind": "weak_motion",
      "scope": "animation",
      "impact": "成片动效较弱",
      "requires_receipt": true
    }
  ],
  "receipts": [
    {
      "kind": "weak_motion",
      "scope": "animation",
      "mode": "remediated",
      "reason": "重派 animation 阶段并成功",
      "impact": "",
      "at": "2026-10-30T12:00:00",
      "run_id": "run_...",
      "actor": null
    }
  ],
  "summary": {
    "pending": 1,
    "receipts": 1,
    "exempt": 1
  }
}
```

- `pending/receipts/summary` 可由现有 `degradation_ledger` 提供；`requires_receipt` 应由 `needs_receipt()` 计算。
- `run_id` 与 `actor` 在当前 `Disposition` 未见，属于新增字段请求；不能从现有 `scope` 或 reason 可靠推断。
- 收据台账当前为进程内存 `_PENDING/_RECEIPTS`。后端需明确重启后恢复策略；如要求历史任务长期可审计，需持久化台账，不能仅新增读取路由。
- 未完成 D1 前，前端使用 run 详情及事件中的已知信息显示降级，但不得声称展示了全任务的完整收据台账或责任人。

**D2：任务事件恢复元数据。**

现有 REST 事件接口已可补拉 spilled 事件，无需新增字段即可完成前端恢复。为准确告知历史缺口，建议可选增加响应字段：

```json
{
  "oldest_available_seq": 1,
  "latest_seq": 2100,
  "spilled_max_seq": 1700,
  "complete": true
}
```

以上字段当前接口未返回，标记为后端补充。当前前端可通过请求返回的首末 seq 发现局部缺口，但不能可靠判断服务器是否曾丢失 spilled 文件中的数据。

**D3：项目同步完成状态与任务结果版本。**

建议 `/result` 增加：

```json
{
  "sync_status": "pending|complete|failed",
  "sync_updated_at": "ISO-8601",
  "timeline_fingerprint": "sha256:..."
}
```

这些字段当前未见。若后端不提供，前端仅可对终态后的空结果做有限重试，无法判断是「同步中」还是「最终无 timeline」。

**D4：导出指纹契约。**

`services/render.py` 已核实存在 `.fp` 侧车读写，但未核实渲染提交/队列接口对外返回该指纹。后端需确认：

- 导出提交响应是否带 `timeline_fingerprint`。
- 队列恢复接口是否保留提交时指纹。
- 重试是使用失败任务保存的原始 timeline，还是当前项目最新 timeline。
- 若重试沿用当前实现从 store 读取最新时间线，响应应明确返回本次采用的指纹。

未确认上述契约前，UI 将指纹标为「服务端未提供」，不能以 `.fp` 文件路径推断已采用的时间线版本。

### 4.3 错误码及前端处理

| 接口 | 错误码 | 交互 |
|---|---|---|
| run 详情 | 404 | 「该次运行记录已不可用。刷新列表后重试。」提供「重新加载」按钮。 |
| run 详情、runs、轨迹、事件 | 403 | 「当前账号无权查看此任务。」停止自动重试。 |
| 追问 | 400 | 显示后端校验原因；空白文本前端拦截；文本超过 2000 字时本地提示。 |
| 追问、重放 | 404 | 「该次运行记录已不存在。请刷新任务记录。」 |
| 重放 | 400 | 显示「该运行记录缺少阶段信息，暂时无法重放。」或后端返回的结构化原因。 |
| 重放 | 409 | 显示「任务已结束或服务已重启，当前进程中没有可重放的运行实例。」具体文本以实际后端响应为准。 |
| 结果、建项目 | 409 | 保留现有业务提示；产物区按同步状态继续重试，不把 409 转成成功。 |
| 任一接口 | 5xx/网络错误 | 显示「读取失败，记录仍保留在页面；可重试。」提供局部重试，不清空已有数据。 |

## 5. 逐条解决方案

以下问题编号与代码审查清单保持一致。

### P1-1：Run 详情接口无调用点

**现状证据：** `src/services/api/task.ts:146-153` 定义 `runDetail()`；`src/features/task/TaskRuns.tsx:31-50` 只加载 runs 列表，run 项无详情展开交互。后端详情路由位于 `clipwright/api/task.py:449-458`。

**改动点：**

- 新增 `src/features/task/TaskRunDetail.tsx`。
- `TaskRuns.tsx` 新增每条 run 的「查看详情」折叠按钮，展开时调用 `taskApi.runDetail(taskId, runId)`。
- 在 `src/types/task.ts` 新增 `TaskRunDetail`、`TaskDegradation`、`TaskRunFailure` 类型；不把 API 返回维持为 `Record<string, unknown>`。
- `taskApi.runDetail()` 响应改用显式结构类型。

**交互与状态：**

- 初次展开显示 skeleton；失败显示错误原因与「重试加载」；收起不清除已加载详情。
- 空 `outputs/needs/degradations/tool_calls` 显示「此运行没有记录该类信息」。
- `tool_calls_path` 可复制；存在摘要轨迹时提供「查看全量轨迹」，选择对应 stage/attempt。
- run 中的敏感长文本默认折叠，点击后显示完整 brief/failure，避免无限撑高列表。
- 未提供 `agent` 名时只显示 `stage` 或 `role`；不得显示伪造的 agent 名。

**文案：**「运行详情」「输入要求」「产出」「待补信息」「失败原因」「降级与处置」「完整轨迹文件」「此运行没有记录该类信息」「详情读取失败，已有内容仍保留。重试加载」。

### P1-2：降级收据与未处置状态无 UI 闭环

**现状证据：** 收据结构定义于 `clipwright/services/degradation_ledger.py:28-40`；台账查询函数在 `:128-145`，但 `clipwright/api/task.py` 未见收据读取路由。前端 `TaskRuns.tsx:99-101` 只显示降级数量；`CopilotTaskRunTab.tsx:333-380` 的 `DegradationRows` 从最近事件读取，并尝试从 event detail 读取 mode/reason/resolved；现有 `degradation` 事件不保证这些键。

**改动点：**

- 新增 `TaskDegradationPanel.tsx`，由 `CopilotTaskRunTab.tsx` 在 `DegradationRows` 位置挂载。
- 优先调用 D1 收据接口；兼容接口未实现、旧任务没有台账的状态。
- `eventSchema.ts` 为降级 detail 增加可选解析键：`kind/scope/impact/mode/reason/resolved/receipt_exempt`。未知键保存在 `raw`。
- `TaskRunDetail.tsx` 内按 run 显示对应降级，提供跳转/定位到全局降级面板。
- 「谁修好的/谁接受的」：目前后端 `Disposition` 没有 actor 字段。前端显示「处置人：暂未记录」；后端补 `actor` 后才显示真实身份。`remediated` 可显示「重派阶段并成功」，不得推断具体人。

**交互与状态：**

- 默认摘要显示待处置数量及已收据数量；展开后按状态分组。
- `RECEIPT_EXEMPT_KINDS` 中的降级归为「信息型，无需收据」，不计入待处置数量。
- `replayed_not_fixed`、`final_receipt_attempt`、`degradation_unresolved` 若出现在事件或 detail，列为显著事件状态；它们不是 `Disposition.mode`，不得显示成收据。
- 接口 404/旧任务无数据时显示「此任务没有可读取的收据台账；历史事件仍可查看」，事件降级摘要继续可见。
- 列表超过 100 条时分页，每页 50 条；不在事件每次更新时重复加载详情。

**文案：**「待处置」「已修复」「已接受」「信息型，无需收据」「仍待处置，任务收尾可能受此影响」「尝试重放后问题仍存在」「收尾前仍有降级未处置」「正在尝试补齐收据」「处置人：暂未记录」「处置理由：{reason}」「影响：{impact}」。

### P1-3：终态原因与 unfinished 未展示

**现状证据：** `TaskFinish` 包含 `conclusion/completed/unfinished/reason`，见 `clipwright/schema/task.py:162-168`；store 从 `task_end` 读取这些字段，见 `src/stores/taskStore.ts:171-184`；UI 仅显示 conclusion，见 `CopilotTaskRunTab.tsx:430-434`；标签映射位于 `src/features/task/labels.ts:18-28`，未包含 reason 映射。

**改动点：**

- 新增 `TaskFinishSummary.tsx`。
- `labels.ts` 增加 `FINISH_REASON_CN` 与 `finishReasonLabel()`。
- `CopilotTaskRunTab.tsx` 顶部传递完整 `task.finish`，移除仅渲染 conclusion 的旧段落。

**交互与状态：**

- 终态 panel 显示结束 reason、结论、完成项和未完成项。
- 兼容历史任务缺少 finish：显示「任务已结束，但该任务没有保存收尾详情」。
- 未知 reason 保留原值，不映射为通用失败。
- `unfinished` 非空时默认展开；空列表显示「没有记录未完成事项」。

**文案：** 例如：`tool_loop_completed` →「Agent 执行完成」；`degradation_unresolved` →「仍有降级未处置」；`dry_run_preview` →「预览运行完成」；`gate:{原因}` →「达到运行限制：{原因}」。完整映射见第 6 节。

### P1-4：预算只显示已用量

**现状证据：** 后端 `Task` 含 `limits` 与 `usage`，见 `clipwright/schema/task.py:180-188`、`:202-216`；公开任务返回包括两者。前端 `UsageRows` 仅收 usage 并显示 turns/tool_calls/tokens/cost，见 `CopilotTaskRunTab.tsx:61-85`。

**改动点：**

- `UsageRows` 增加 `limits` prop，显示四道闸的「已用 / 上限 / 剩余」。
- 新增 `budgetGateFromEvent()` 从 `gate_hit.detail.reason` 和 `message` 读取触闸信息；只做结构字段优先、文本作为兜底，不覆盖服务端原文。
- `src/types/task.ts` 校准 `TaskUsage.wall_sec` 与 `TaskLimits` 类型，保持兼容旧快照缺字段。

**交互与状态：**

- 计数剩余值为 `max(0, limit - used)`；墙钟显示秒或格式化时长；金额 `null` 显示无上限。
- 成本未知单独显示，不把未知计为零。
- 服务端 reason 匹配失败时显示「触发限制：{原始 detail/message}」，不猜是哪道闸。

**文案：**「模型往返 12 / 30，剩余 18」「工具调用 41 / 80，剩余 39」「运行时长 00:12:30 / 01:00:00，剩余 00:47:30」「金额预算 $0.32 / $1.00，剩余 $0.68」「未设置金额上限」「已达到工具调用上限」。

### P1-5：新增事件语义未映射为可读内容

**现状证据：** 前端已有 26 种事件名，`eventSchema.ts:18-47` 维护集合，`labels.ts:38-67` 映射事件名称；`EventFeed.tsx:35-39` 的可展开集合缺 `tool_result/narration/agent_run_*`。`eventSchema.ts:196-210` 的 ToolDetail 未定义 `deduped/source/remaining_turns`。

**改动点：**

- `eventSchema.ts` 扩展可选 detail 字段解析，并以 `raw` 保留未知值。
- `EventFeed.tsx` 增加 `eventSummary(event)`，使用 `parseTaskEvent()` 构造人类可读摘要。
- 增加 `narration`、`tool_result`、`agent_run_start/update/end`、`inject` 等类型的结构化折叠详情。
- 更新 `labels.ts`，增加状态、来源和去重标签映射。

**交互与状态：**

- 摘要不以英文内部字段名代替中文；未知字段在详情 JSON 中保留。
- `tool_result` 能显示状态、耗时、是否去重、来源和剩余回合。
- `narration.kind` 按已知值映射；未知 kind 显示原值。
- `inject` 显示「已排队给阶段 X，下次派发时生效」。
- `kernel_recovery` 与两个 gate continue 类事件采用信息级别，不渲染为失败。

**文案：**「内核补派」「时间线检查后继续」「降级检查后继续」「调用结果已复用」「由内核触发」「剩余回合 3」「已追加要求，等待该阶段下次派发」。

### P1-6：SSE 无续传游标，不补拉溢出历史

**现状证据：** `useTaskEvents.ts:40-53` 直接订阅 SSE，未先水合；`taskStore.ts:153-160` 有 `hydrateEvents()`，当前组件无调用路径。`taskStore.ts:162-165` 已按 seq 去重并保留最近 400 条。后端 `GET /events` 支持 `since_seq`，见 `clipwright/api/task.py:155-162`；`events_since()` 默认 `include_spilled=True`，见 `clipwright/services/task_events.py:205-212`。SSE 当前从 `last_seq=0` 开始，见 `api/task.py:172-179`。

**改动点：**

- `useTaskEvents.ts` 首次订阅前执行 `taskStore.hydrateEvents(taskId, 0)`；完成后再开始 SSE，避免历史和实时交错。
- SSE 每次断线恢复前以 store 的 `lastSeq` 调用 `GET /events?since_seq=lastSeq`，REST 补拉成功后再重新连接。
- `taskStore.applyEvent()` 保持 seq 去重；水合批次按 seq 排序后应用。
- 对同一 task 的 hydrate 加互斥/请求代号，忽略旧 task 请求迟到结果。
- 若后端将来支持 SSE `since_seq` 或 `Last-Event-ID`，可在此基础上切换，不作为本期前置依赖。

**交互与状态：**

- store 保留最近 400 条用于实时 UI；从后端补拉全部历史时分页或分批请求，避免单次将超大结果灌入 DOM。
- 若 API 返回序列号不连续，显示「事件序号存在缺口（X–Y），部分历史记录可能不可用」，保留现有事件并提供「重新同步」。
- 旧任务无事件时显示正常空态，不当作加载失败。
- 恢复接口失败时保留本地缓存，提示「历史同步失败，实时事件仍可能继续到达」。

### P1-7：全量轨迹大量数据一次性进入 DOM

**现状证据：** `TaskToolTrace.tsx:110-124` append 所有已加载页，`:254-258` 为每条常驻列表项；分页大小 200。类型说明仅有 `source`，无 `deduped` 字段，见 `src/types/task.ts:176-185`。

**改动点：**

- `TaskToolTrace.tsx` 引入项目已安装的虚拟列表方案；若依赖未安装，先检查现有列表依赖，避免重复引入。
- 虚拟化阈值：当前已加载行数超过 200 时启用虚拟列表；固定行高不可靠时使用可变高测量，确保错误详情展开不遮挡其他行。
- 每页保持 200 条，滚动接近底部时可自动加载下一页，仍保留可访问的「加载更多」按钮。
- `TaskToolCall` 类型增加 `deduped?: boolean` 与 `remaining_turns?: number`（字段需确认后端轨迹实际落盘含义）。
- `TraceRow` 增加 `source=kernel`、`deduped=true` 标签。

**交互与状态：**

- 阶段/attempt 切换清空旧列表并回到顶部。
- 加载下一页失败不丢已有页，显示「下一页读取失败，重试」。
- 空轨迹保留「这份轨迹是空的」；无文件时继续隐藏区块。
- 轨迹总量、失败数、内部数沿用后端 summary，不以当前已加载数替代 total。

**文案：**「内部」「由内核触发」「去重：本次结果已复用」「加载更多（还有 N 次）」「下一页读取失败，重试」。

### P1-8：追问/重放无过程态，未消费返回 run

**现状证据：** `TaskRuns.tsx:51-77` 只用共享 `busy` 禁用按钮并显示字符串；`runReplay` 的类型 `src/services/api/task.ts:165-173` 未包含 `run`，组件也未读取返回 run。后端 replay 返回 run，见 `clipwright/api/task.py:507-514`。

**改动点：**

- `taskApi.runReplay()` 返回类型补齐 `run`。
- `TaskRuns.tsx` 将 `busy` 从单一 run id 改为 `{runId, action}`，分别表达追问和重放。
- 重放成功后，将响应中的新 run 摘要并入/替换当前列表，再刷新 runs；刷新失败时仍先显示此次结果。
- 新增错误码格式化函数 `src/features/task/taskApiError.ts`，解析 HTTP status 与 FastAPI detail（字符串、对象、验证错误数组）。

**交互与状态：**

- 追问按钮处理中显示「正在排队…」；成功后明确显示「已排队 N 条，阶段 X 下次派发时生效」。
- 重放处理中显示「正在重跑…」，并在该 run 行展示 spinner。
- 响应中 `replayed=true` 时显示「服务端返回回放结果，未确认发生真实重跑」；不宣传为真重跑。
- 400/404/409 分别映射为字段校验、run 不存在、任务/运行时已结束；网络错误提供重试。
- 一个 run 操作处理中只锁定该 run 的相关按钮，不阻塞其他 run。
- 任务终态时按钮禁用，tooltip 文案明确；测试兼容后台任务仍存内存但产品不提供终态重放的策略。

### P1-9：项目同步与任务终态竞态

**现状证据：** `clipwright/api/task.py:85-114` 中 `kernel.run()` 返回后，`finally` 才调用 `sync_timeline_to_project()`；同步失败仅记录并忽略。`TaskArtifacts.tsx:42-56` 终态后只请求一次 `/result`；`:58` 无快照即整块隐藏。

**改动点：**

- `TaskArtifacts.tsx` 采用状态机：`loading → ready | empty-final | retrying | error`。
- 终态后首次请求结果；若 `has_timeline=false` 且同步状态缺失或 `pending`，在 1、2、4、8 秒间隔重试，最多 5 次、总时长不超过约 20 秒。
- 若 D3 提供 `sync_status`，以它决定重试：`pending` 继续；`complete` 且无 timeline 显示最终空态；`failed` 显示同步失败。
- 有 `timeline` 时显示轨道、片段、时长与「在编辑器中打开」；保留现有 `toProject` 错误处理。
- 新增「重新检查产物」按钮，用户可手动触发一次查询。

**交互与状态：**

- 重试期间显示「任务已结束，正在等待项目时间线同步（第 N/5 次）」。
- 超时仍无产物显示「尚未发现可编辑时间线。可重新检查；任务记录不会受影响。」
- 任务结束但确实没有 timeline 时不无限重试。
- 组件卸载、taskId 变化时取消计时和忽略迟到响应。

### P1-10：导出重试语义与时间线指纹未对齐

**现状证据：** `ExportPage.tsx:68-86` 根据 URL 恢复项目与 timeline；`submitRender()` 在 `:260-289` 使用当前 timeline 提交。`retryRender()` 在 `:325-343` 保存原 settings/filename，但从 `useTimelineStore.getState().exportTimeline()` 重新读取当前 timeline。后端 `services/render.py:472-488` 定义指纹函数，`:1171-1196` 读写 `.fp` sidecar；未核实指纹已通过 API 暴露。

**产品决策：**

- **失败重试默认重试原始提交快照**，保证「重试」语义可复现。若前端未保留原始 timeline，可由渲染后端保存原输入，或在队列任务创建时持久化其输入引用。
- **「使用当前时间线重新提交」作为独立动作**，明确读取当前项目最新时间线并创建新的渲染任务。
- 当前实现用最新 timeline、旧设置和旧文件名的行为应改为上述明确语义之一；本 PRD 选择保留「重试原始提交」的用户预期。后端是否具备原始 timeline 快照能力：待核实，若没有需补契约。

**改动点：**

- `ExportPage.tsx` 为队列项保存提交快照引用、提交时指纹和时间线版本信息；禁止仅保存设置却把「重试」展示为重试旧输入。
- `QueueCard` 拆分「重试本次提交」与「使用当前时间线重新提交」。
- 扩展 render API 类型，展示 `timeline_fingerprint`；若后端未返回则显示「服务端未提供指纹」。
- E2E 建立旧/新 timeline 明显不同的 fixture，断言两个操作提交的 payload 与指纹各自符合语义。

**交互与状态：**

- 原快照不可用时禁用「重试本次提交」，显示「原始时间线快照不可用，请使用当前时间线重新提交」。
- 当前 timeline 未加载或为空时，不允许新提交。
- 用户重新提交后生成独立队列项和新 task id，不覆盖失败任务的审计记录。
- 不根据 `.fp` 本地文件猜测服务端记录；具体指纹传输字段须由 D4 确认。

### P2-1：Agent 化语义的前端与 E2E 测试不足

**现状证据：** `e2e/final-flow.spec.ts` 已覆盖基本任务、事件/轨迹、渲染和下载；`TaskRuns.test.tsx` 覆盖列表、追问、重放调用和终态禁用，但未覆盖 run 详情、HTTP 错误、加载过程和响应 run 消费。

**改动点：**

- 组件测试：新增/扩展 `TaskRunDetail.test.tsx`、`TaskFinishSummary.test.tsx`、`TaskDegradationPanel.test.tsx`、`TaskArtifacts.test.tsx`、`TaskToolTrace.test.tsx`、`EventFeed.test.tsx`、`useTaskEvents.test.ts`。
- E2E：扩展 `e2e/final-flow.spec.ts` 或新增 `e2e/agent-runtime-flow.spec.ts`，使用可控 fixture 或 mock API 断言关键工作流。
- 后端接口契约测试需覆盖 D1-D4 的字段兼容和状态语义；跨仓契约由 CI 验证。

**交互与状态：** 测试断言以可访问名称、`data-testid`、API 调用参数和用户可见状态为准，不依赖 CSS 类名。测试覆盖空态、错误、重试、分页、旧任务缺字段和未实现后端契约时的降级展示。

## 6. 关键文案表

### 6.1 `finish.reason` → 前端文案

| 后端值 | 前端文案 |
|---|---|
| `tool_loop_completed` | Agent 执行完成 |
| `plan_completed` | 计划执行完成 |
| `task_completed` | 任务完成 |
| `dry_run_preview` | 预览运行完成 |
| `degradation_unresolved` | 仍有降级未处置 |
| `gate:{原因}` | 达到运行限制：{原因} |
| `cancelled` / `cancel` | 任务已取消 |
| `paused` | 任务已暂停 |
| `step_failed...` | 执行步骤失败 |
| `tool_loop_error...` | Agent 执行出错 |
| `tool_loop_unavailable...` | Agent 执行服务不可用 |
| `validation_failed` | 结果校验未通过 |
| 空字符串 | 未记录结束原因 |
| 其他未知值 | 新终态（待适配）：{原值} |

reason 显示文案不决定 status；status 仍使用后端任务状态/现有 `terminalStatusOf()` 推导。未知 reason 不应覆盖或重分类后端状态。

### 6.2 事件语义标签与摘要

| 事件或 detail 值 | 标签/摘要 |
|---|---|
| `tool_result.deduped=true` | 结果已复用（去重） |
| `tool_result.source=kernel` | 由内核触发 |
| `tool_result.remaining_turns=N` | 剩余回合 N |
| `narration.kind=kernel_recovery` | 内核正在补派 |
| `narration.kind=timeline_gate_continue` | 时间线检查后继续 |
| `narration.kind=degradation_gate_continue` | 降级检查后继续 |
| `inject` | 已追加要求，等待阶段下次派发 |
| `agent_run_start` | 子 agent 已派出 |
| `agent_run_update` | 子 agent 状态更新 |
| `agent_run_end` | 子 agent 已结束 |
| 未知 event/detail | 显示中文事件类型；详情内保留原始 JSON |

表内 detail 值属于待按后端实际 payload 进一步验证的语义映射；未出现时不展示空标签。

### 6.3 收据标签

| 字段/事件 | 文案 |
|---|---|
| `mode=remediated` | 已修复 |
| `mode=accepted` | 已接受 |
| 无收据且需要收据 | 待处置 |
| 命中 `RECEIPT_EXEMPT_KINDS` | 信息型，无需收据 |
| `replayed_not_fixed` | 重放后仍未修复 |
| `final_receipt_attempt` | 正在尝试补齐收据 |
| `degradation_unresolved` | 收尾时仍有降级未处置 |
| 收据有 reason | 处置理由：{reason} |
| 收据有 impact | 影响：{impact} |
| actor 缺失 | 处置人：暂未记录 |

以上事件值的出现位置和 payload 结构须以实际事件 detail 为准；未核实的字段不作为必填。

### 6.4 预算标签

| 限制字段 | 前端标签 |
|---|---|
| `max_turns` | 模型往返上限 |
| `max_tool_calls` | 工具调用上限 |
| `max_wall_sec` | 运行时长上限 |
| `budget_usd=null` | 未设置金额上限 |
| `usage.unknown_cost_calls > 0` | 有 N 次调用的成本未知，金额未包含这些调用 |
| 限制已用尽 | 已达到{对应限制名称} |

## 7. 性能与健壮性

### 7.1 长列表与分页

- `TaskToolTrace` 每页 200 项；加载超过 200 项时启用虚拟列表，DOM 只渲染可视区及前后各 10 行缓冲。
- run 列表正常规模可一次加载；超过 100 条时前端分页，每页 50 条。后端当前 runs 接口未见分页参数，超出时将产生全量 JSON 响应；如实测 run 数量可达数百，需追加后端分页契约。
- 降级面板每页 50 条，默认只展开待处置分组。
- 事件流 store 保留最近 400 条；UI 的 `EventFeed` 不再把 400 条上限表述成历史已丢失，而是显示「页面缓存最近 400 条，更多历史可从服务器补载」。
- 历史事件超过 400 条时通过 `GET /events?since_seq=` 分批获取，具体批量大小建议 500；若后端不支持 limit，则需要新增 `limit` 参数以避免一次响应过大。

### 7.2 SSE 恢复算法

1. 任务进入运行页时清空上一 task 的内存事件视图，并加载 `GET /api/task/{id}` 快照。
2. 调用 `GET /events?since_seq=0` 补拉历史；按 seq 升序送入 store。
3. store 对 `seq <= lastSeq` 的重复事件丢弃。
4. 若事件接口分页，持续请求直至返回条数小于 limit；分页契约当前未提供，须先确认/补充。
5. 历史补拉完成后建立 SSE；连接断开时以 store `lastSeq` 再做 REST 补拉，再重新建流。
6. 对缺失 seq 区间记录 `gapStart/gapEnd`，UI 显示缺口提示并允许重新同步。
7. 一旦发现 `task_end`，仍可短暂完成事件补拉，但停止持续自动重连。

### 7.3 Store 上限与提示口径

- `MAX_TASK_EVENTS=400` 继续作为 store 内存上限，避免实时渲染无限增长。
- `lastSeq` 表示已应用最大 seq，另增 `oldestLoadedSeq` 与 `hasEarlierEvents` 表达客户端是否只载入部分历史。
- 事件被 store 淘汰不代表后端丢失；不得再显示「更早的已从内存丢弃，完整记录见任务事件接口」而没有加载入口。
- 后端缺少 spilled 文件或事件服务不可用时，显示「部分历史记录当前不可读取」，并将恢复按钮保留在界面。

### 7.4 请求与渲染

- 详情请求采用 runId 级别缓存；每次打开详情不重复请求，显式刷新才绕过缓存。
- 切换任务时取消定时器、SSE 句柄和待处理请求；旧任务响应不得污染当前 store。
- Run 列表活动期间可按现有策略刷新；终态后停止自动轮询。
- 所有自动重试设上限并提供手动重试，避免后端抖动造成无限请求。

## 8. 无障碍与 i18n 口径

- 沿用 `src/features/task/labels.ts` 的集中映射方式；新状态和错误文案不得散落在组件里。
- 所有可交互按钮有中文可访问名称；图标按钮提供 `aria-label` 和 tooltip。
- 折叠面板使用按钮并维护 `aria-expanded`、`aria-controls`；状态变化使用 `role="status"` 或 `aria-live="polite"`。
- 不用颜色作为唯一状态表达；「待处置/已修复/已接受」同时显示文字和状态图标/标签。
- 失败与触闸使用 `role="alert"`；普通加载与成功提示不抢焦点。
- 长文本支持键盘展开、复制和滚动；虚拟列表保证可见行可被键盘聚焦，或提供等效非虚拟分页模式。
- 数字使用本地化格式；金额统一美元格式，缺失、未知和零值文案严格区分。
- 后端内部值仍在详情中可查，但列表优先显示中文标签；未知值以「待适配：原始值」呈现，不能默默丢弃。

## 9. 里程碑与工作量

人日以一名熟悉 React/TypeScript、vitest 和 Playwright 的前端工程师估算；后端契约实现另列。估算包含组件测试，不包含产品设计评审和全量回归等待时间。

| 里程碑 | 范围 | 独立验收 | 估算 |
|---|---|---|---:|
| M1：执行结论与可寻址 run | P1-1、P1-3、P1-8；新增 run detail、终态摘要、操作反馈与错误映射 | 可以从 run 列表展开完整详情；终态展示 reason/unfinished；追问重放状态与错误可理解 | 前端 4–6 人日 |
| M2：降级与预算语义 | P1-2、P1-4、P1-5；降级面板、收据状态、预算闸和事件语义 | 用户可区分处置状态、看到限制/剩余量及事件可读摘要 | 前端 3–5 人日；后端 D1 2–4 人日，含台账持久化评估 |
| M3：恢复、性能、同步与导出闭环 | P1-6、P1-7、P1-9、P1-10、P2-1；SSE 补拉、轨迹虚拟化、结果重试、导出指纹及回归 | 刷新/断线恢复完整历史；大轨迹可滚动；同步延迟可恢复；导出重试语义有断言 | 前端 5–8 人日；后端 D2–D4 3–6 人日，取决于现有渲染快照能力 |

**建议顺序：** M1 与 M2 可并行；M3 中 D4 需先确认后端原始时间线快照策略，避免先实现错误的「重试」语义。

## 10. 验收标准与测试矩阵

### 10.1 组件级：vitest/jsdom

| 编号 | 组件/测试 | 自动化断言 |
|---|---|---|
| P1-1 | `TaskRunDetail.test.tsx` | 展开 run 调用 `runDetail(taskId, runId)`；展示 brief、outputs、needs、failure、degradations、tool_calls_path；空字段显示空态；404 显示可重试错误。 |
| P1-2 | `TaskDegradationPanel.test.tsx` | remediated/accepted/outstanding/exempt 分组文案正确；unknown actor 显示「处置人：暂未记录」；旧任务无接口数据仍展示事件降级并有兼容空态；`replayed_not_fixed` 不被判为已修复。 |
| P1-3 | `TaskFinishSummary.test.tsx` | 已知 reason 映射准确；unfinished 列表逐项展示；未知 reason 保留原值并标待适配；缺失 finish 显示历史空态。 |
| P1-4 | `UsageRows.test.tsx` | 显示 usage/limits/remaining；null 金额上限显示未设置；未知成本不显示为零；命中 gate 显示原始触闸信息。 |
| P1-5 | `EventFeed.test.tsx`、`eventSchema.test.ts` | 新 detail 标签和摘要正确；展开保留原始字段；unknown 字段不会抛错；inject 和 kernel recovery 文案准确。 |
| P1-6 | `useTaskEvents.test.ts`、`taskStore.test.ts` | 首次 REST hydrate 先于 SSE；断线按 lastSeq 补拉；重复 seq 去重；检测缺口；旧 task 响应不污染新 task。 |
| P1-7 | `TaskToolTrace.test.tsx` | 分页使用 200 limit 与递增 offset；`source=internal/kernel`、deduped 标签正确；大量行启用虚拟列表；下一页失败保留已有数据并可重试。 |
| P1-8 | `TaskRuns.test.tsx` | 追问与重放显示独立处理中；400/404/409 显示可读文案；重放返回 run 被呈现；成功后刷新列表；任务终态按钮禁用。 |
| P1-9 | `TaskArtifacts.test.tsx` | 终态空结果按退避策略有限重试；同步 complete 后无 timeline 显示最终空态；手动重新检查有效；卸载后不更新状态。 |
| P1-10 | 导出重试单测 | retry payload 使用原始时间线快照；「使用当前时间线重新提交」使用当前 timeline、新 task id；指纹缺失时显示未提供而非伪造。 |
| P2-1 | 契约与回归套件 | 前端事件类型集合与后端 `EVENT_TYPES` 对齐；历史缺字段、接口未部署和服务重启场景不白屏。 |

### 10.2 E2E：Playwright

| 编号 | E2E 场景与自动化断言 |
|---|---|
| P1-1 | 打开任务运行标签，展开指定 run；断言 brief、outputs、failure 与轨迹入口可见，点击轨迹入口后阶段/attempt 选择正确。 |
| P1-2 | 使用含 remediated、accepted、outstanding、exempt 的 fixture；断言四种标签、reason/impact 文案和待处置计数正确；没有 actor 时不出现假姓名。 |
| P1-3 | 完成含 reason、completed、unfinished 的任务；断言三个区域均出现且 reason 中文映射正确；未知 reason 显示原值。 |
| P1-4 | 设置有限 turns/tools/wall/budget 并触发其中一闸；断言使用量、限额、剩余量和闸原因同时显示。 |
| P1-5 | 投递 `tool_result` 去重、kernel 来源、remaining_turns、三种 narration kind 与 inject fixture；断言摘要可读且详情可展开。 |
| P1-6 | 注入超过 400 条事件的任务，刷新并模拟 SSE 断线；断言 REST 使用正确 `since_seq` 补拉 spilled 历史，重复事件只显示一次，缺口提示可见。 |
| P1-7 | 载入不少于 2,000 条工具轨迹；断言只按页请求、虚拟化节点数量受限、内部/kernel/deduped 标签正确，滚动加载不重复或跳项。 |
| P1-8 | 模拟追问处理中、重放成功返回 run、400/404/409/网络失败；断言行级 busy、响应摘要和错误文案正确。 |
| P1-9 | 终态后先返回 `has_timeline=false`，稍后返回 true；断言产物区显示等待状态并最终出现「在编辑器中打开」，不永久停留在空态。 |
| P1-10 | 提交时间线 A 后将项目改为时间线 B；失败重试断言 payload 使用 A；「使用当前时间线重新提交」断言使用 B 且产生新任务；有后端指纹时断言 UI 显示一致。 |
| P2-1 | `final-flow.spec.ts` 保留既有出片流程并串接 run 详情、降级收据、budget gate、断线恢复和导出语义断言；确保基线渲染和下载流程仍通过。 |

## 11. 风险与回滚

### 11.1 兼容风险

- **旧任务没有 runs：** `TaskRuns` 返回空数组时保留不占版面的策略；不能因详情接口 404 让任务标签整体失败。
- **旧任务没有收据：** 收据区显示「无可读取的台账」，事件中已有的降级仍可见；不得将所有历史降级自动分类为已接受或已修复。
- **旧事件缺 detail 字段：** parser 对新增键使用可选值；未知结构保留原始 JSON，缺字段时不渲染空标签。
- **历史事件无 spilled 文件：** events 接口返回空或旧热层时显示当前可读取范围；不得无限请求或白屏。
- **服务重启导致 run 详情不可用：** 详情 404 显示记录缺失，并保留 run 列表摘要缓存；重放 409 显示运行实例已不可用。
- **收据台账当前内存化：** 后端重启可能使处置记录消失。D1 应先定义持久化行为；否则 UI 需明确展示「服务重启后该任务收据台账不可恢复」。
- **任务快照与事件流不一致：** 以 `task_end` 事件和当前任务快照为同一任务事实的来源；恢复完成后可再拉一次 `GET /task/{id}` 校正终态。

### 11.2 开关与灰度

- 功能开关建议按模块配置：`taskRunDetail`、`taskDegradationLedger`、`taskEventHydration`、`taskTraceVirtualization`、`exportTimelineSnapshotRetry`。
- 新 UI 组件失败时可回退到现有列表/事件摘要，不影响主 Agent 执行和任务终态。
- SSE 恢复先在内部/测试环境灰度；监控补拉请求量、重复事件比率、seq 缺口率和水合失败率。
- D1 收据接口灰度期间，接口不可用只隐藏台账详情并保留事件区，不把 404 当成任务失败。
- 导出重试行为切换前增加明确按钮文案与 E2E；不得静默改变线上「重试」所用时间线。
- 回滚前端时保留后端新增字段兼容旧客户端；后端不要删除既有接口或改变已有字段类型。

## 12. 追溯表

| 问题编号 | 覆盖章节 | 验收用例 |
|---|---|---|
| P1-1 | 3.4、4.1、5、10.1、10.2 | `TaskRunDetail.test.tsx`；展开 run 的 E2E |
| P1-2 | 3.4、4.2 D1、5、6.3、10、11 | `TaskDegradationPanel.test.tsx`；收据状态 E2E |
| P1-3 | 3.1、5、6.1、10 | `TaskFinishSummary.test.tsx`；终态 E2E |
| P1-4 | 3.2、5、6.4、10 | `UsageRows.test.tsx`；触闸 E2E |
| P1-5 | 3.3、3.5、5、6.2、8、10 | `EventFeed.test.tsx`、`eventSchema.test.ts`；事件语义 E2E |
| P1-6 | 3.5、4.1、4.2 D2、7、10 | `useTaskEvents.test.ts`；断线恢复 E2E |
| P1-7 | 3.5、5、7、10 | `TaskToolTrace.test.tsx`；2,000 条轨迹 E2E |
| P1-8 | 3.4、4.1、4.3、5、10 | `TaskRuns.test.tsx`；操作状态与错误码 E2E |
| P1-9 | 3.3、4.1、4.2 D3、5、10 | `TaskArtifacts.test.tsx`；同步延迟 E2E |
| P1-10 | 4.2 D4、5、10、11 | 导出重试单测；时间线 A/B 的 payload E2E |
| P2-1 | 2、5、9、10、11 | 全部组件矩阵；扩展后的 agent-runtime E2E 流程 |
