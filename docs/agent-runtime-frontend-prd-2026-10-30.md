# Clipwright / 帧艺：Agent 运行时前端闭环 PRD

> 来源：2026-10-30 由 gpt-5.6-sol 对「后端 agent 化之后前端是否适配」做代码审查，结论为**部分适配**（P1×10 + P2×1），并据此产出本 PRD。
> **2026-10-30 修订**：按用户裁定取消台账式降级 UI，改为「主 agent 对话式解释 + 询问处置方案」；新增 `ask_user` 工具（§15）、思考流与工具可见性（§13）、阶段进度播报规范（§14）、动画提示词完善方案（§16）。变更明细见文末「附录 A」。
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
- 用户能在对话流中读懂降级现象与观众影响，看到主 agent 提出的方案、代价与推荐，并可回答后让任务继续；前端不呈现处置台账。
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
- 不建设降级台账式 UI，不向用户展示「已修复 / 已接受 / 待处置与理由」分组；前端只消费降级事实、主 agent 解释与问答事件。
- 不由前端创建、修改或补写降级收据；修复与接受收据只由后端重派结果或 `acknowledge_degradation` 产生。

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
3. `DegradationRows`：只呈现降级事件的最近事实摘要；不提供台账或「查看全部处置」入口。主 agent 的解释与 `TaskQuestionCard` 紧随相关降级事件进入对话流。
4. `TaskRuns`：run 列表，每个 run 可展开详情。
5. `TaskToolTrace`：全量轨迹，折叠默认关闭。
6. `EventFeed`：完整事件流，位于主体可滚动区，默认展示最近事件并提供「跳到最新」。

### 3.4 Run 与降级详情

- 新增 `src/features/task/TaskRunDetail.tsx`：通过现有 `taskApi.runDetail()` 获取单个 run；默认折叠；内容分为「输入与要求、结果与产物、待补信息、降级与处置、失败信息、工具轨迹引用」。
- 新增 `src/features/task/TaskQuestionCard.tsx`：在任务运行对话流与需求对话中复用，呈现 `question` 事件、选项/自由文本、超时默认项、答案回执与错误重试；降级事实仍由 `degradation` 事件摘要展示，不读取或展示收据台账。
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

**D1′：降级台账跨重启持久化，供 Kernel 与主 agent 决策使用。**

**取消**原 D1 的 `GET /api/task/{task_id}/degradations` 前端读取接口。本 PRD 不要求前端呈现「已修复/已接受/待处置与理由」台账面板；前端只呈现事件事实、主 agent 解释与询问。既然没有读取台账的前端消费者，就不为面板保留查询 API。

但**取消读取接口不等于取消持久化**。现有 `clipwright/services/degradation_ledger.py:22-25` 把 `_PENDING` 与 `_RECEIPTS` 放在进程内字典；`register()`、`mark_remediated()`、`accept()`、`outstanding()` 都依赖它们，见 `:65-80`、`:87-103`、`:106-137`。进程重启会丢失待处置事实与收据，Kernel 再读 `outstanding()` 也无法恢复。因此需改为任务级持久化存储，保证重启后 `register/pending/receipts/outstanding/summary/mark_remediated/accept` 语义一致、幂等、按 `(task_id, kind, scope)` 去重。落库载体沿用项目已选持久化层；当前证据不足以指定表/集合名，实施前核实。

持久化数据用于 Kernel 收尾守门、主 agent 形成事实说明、任务恢复后继续决策；**不直接暴露为前端台账接口**。前端仍通过现有任务事件恢复机制读取已发生的 `degradation`/`question`/`answer` 事件。待答问题持久化由 §15 单独规定，与降级台账**分开建模**，避免把交互状态当成处置收据。

实现要求：

- 持久化 pending 降级事实与 disposition 收据；保留 `RECEIPT_EXEMPT_KINDS`、`needs_receipt()`、`outstanding()` 现有语义。证据：`clipwright/services/degradation_ledger.py:47-62`、`:132-145`。
- `remediated` 与 `accepted` 收据只由既有后端动作产生，不由前端提交。证据：`clipwright/services/agent_kernel.py:439-452`、`clipwright/tool/surface.py:637-658`。
- 增加重启恢复单测：重建 ledger 后 pending、receipts、outstanding、summary 保持一致；重复登记与重复处置不产生重复收据。
- 不新增前端台账验收项；验收转由 §5 P1-2 对话闭环与 §15 问答恢复覆盖。

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

### P1-2：降级事实未形成主 agent 与用户之间的对话闭环

> **2026-10-30 用户裁定**：前端**不要**台账式降级 UI（不展示「已修复 / 已接受 / 待处置与理由」）。
> 降级处置改为：主 agent 用自然语言向用户解释现象与影响、给出方案与推荐、**询问**处置方案，用户在对话里回答。

**现状证据：** 后端 `degradation` 事件在 `clipwright/services/agent_kernel.py:429-435` 发出，事件携带阶段/工具和 `items`，可供前端显示事实。Kernel 的 `_DEGRADATION_DECISION_HINT_HEAD/_TAIL` 在 `clipwright/services/agent_kernel.py:88-104` 要求模型「当轮做出决定并在下一步立即执行」，给出重派、换策略或写接受收据等方向；`_pending_degradation_hint()` 在 `:493-505` 生成模型提示。收尾时通过 `degradation_ledger.outstanding()` 检查未处置项，见 `:990-1024`。信息型免收据种类由 `RECEIPT_EXEMPT_KINDS` 定义，见 `clipwright/services/degradation_ledger.py:47-62`；`outstanding()` 排除这些免收据项，见 `:132-138`。

现有提示词要求模型当轮决策，但**没有**要求「涉及观众可见取舍时，先向用户说明并等待回答，再执行用户选择」；也没有 `ask_user` 阻塞工具、待答问题持久化或答案恢复工具轮上下文的闭环。因此模型可以自行重派或接受，并不保证先解释、先询问。另有 `_PENDING_DEGRADATIONS` 运行时内存镜像，见 `clipwright/services/agent_kernel.py:85-87`；台账本体 `_PENDING/_RECEIPTS` 也是进程内字典，见 `clipwright/services/degradation_ledger.py:22-25`，服务重启后无法据此恢复完整待处置状态。

**改动点：**

- 前端不新增 `TaskDegradationPanel` 或收据列表。任务运行对话流消费 `degradation` 事件，展示阶段、降级事实，事件原文可展开看详情；紧随其后展示主 agent 的解释与问题。
- 主 agent 的降级询问统一调用 `ask_user`（§15），**不得**用 `POST /api/task/{id}/inject` 冒充该工具。`inject` 保留「用户主动随时插话」的语义（追加到 `Task.hints`、进下次规划，见 `clipwright/services/agent_kernel.py:664-678`、`clipwright/api/task.py:238-247`）；用户回答 `ask_user` 问题走 `POST /api/task/{id}/answer`，关联 `question_id`，发出 `answer` 事件并恢复等待中的工具调用。
- Kernel 的降级约束改为：先读本轮新发生的降级事实；对**影响观众可见结果且存在真实取舍**的事项，必须通过 `ask_user` 说明现象、影响、方案 A/B、各自代价与推荐，再等待用户回答；收到回答后才按选择重派或按既有规则处置。不能等待的情况只按明确的超时默认选项处理，并记降级。
- 用户选择「重派」时由主 agent 用现有 `delegate_agent(..., refresh=true)` 执行；重派成功由 `mark_remediated()` 写 remediated 收据。选择「接受」时仍必须调 `acknowledge_degradation` 写 accepted 收据——**不能用「用户选了接受」替代机器可验证的收据**。依据：`clipwright/services/agent_kernel.py:439-452`、`clipwright/tool/surface.py:83-99`。
- 持久化 `degradation_ledger` 的 pending/receipts（见 §4.2 D1′）与待答 `ask_user` 问题（见 §15.2）；不为前端新增台账读取路由。任务事件仍是前端对话流的事实来源。
- 前端在 `src/features/task/TaskQuestionCard.tsx` 渲染问题选项、自由文本、超时默认项与已答回执；回答提交到统一 `answer` 接口，不再额外调 `/inject`。
- 需求对话复用同一 `ask_user` 工具与 `question`/`answer` 事件语义，但问题归属为需求会话，走需求会话自己的 answer 路由与事件流；**不假定**任务事件 API 能承载需求会话。

**三段可直接使用的话术样例（主 agent 措辞，每段 ≤120 字）：**

1. **动画弱动效**：「动画阶段跑完了，但文字动效位移只有 24px（画布 1.2%，门槛 4%），观众会觉得这行字像静态贴图。A：重派动画重写关键帧（多花约 3 分钟，可能仍受模板限制）；B：保留现状，节奏更稳但动感偏弱。我推荐 A——动效是这段的看点。选哪个？要按 A 重派吗？」
2. **素材占位画面**：「第 3、5 场没找到匹配画面，现在是占位卡（纯色 + 文字），观众会看到两段"没有画面"的段落。A：放宽检索条件重搜（多花约 2 分钟，可能混入不太对题的素材）；B：保留占位并加说明卡。我推荐 A，优先级是先把画面补齐。选哪个？」
3. **工具失败率过高**：「粗剪阶段 133 次调用里 60 次失败（45%），主要是无效参数重试，产物是完整的，但这说明这一段很脆。A：重派粗剪并收紧参数（多花约 2 分钟）；B：先出片，之后我再单独优化这一段。我推荐 B，本片已有可用时间线。你选哪个？」

**交互与状态：**

- 收到 `degradation` 后，事件流展示事实，前端**不计算**「已修复/已接受/待处置」状态。
- 主 agent 的说明必须含：事实（哪个阶段、什么数据）、观众影响、方案 A/B 与各自代价、推荐及理由、明确问题。问题由 `question` 事件提供可点选项与自由输入入口。
- 用户提交后，卡片显示提交中 → 已答回执（回显所选）或可重试错误；收到 `answer` 事件后任务继续，后续主 agent 消息说明执行结果。
- 刷新后由历史 `question`/`answer` 事件重建；若服务已重启且待答问题不可恢复，answer 返回 410，前端提示「该问题已失效」，由主 agent 在可运行的新上下文中重新询问。
- `RECEIPT_EXEMPT_KINDS` 中的降级仍作为事件事实可读，但**不触发**必须询问的收据守门；其余降级是否需要用户参与，由主 agent 按影响与取舍决定；接受/修复仍须遵循既有收据机制。
- 对话式验收链路：降级发生 → 主 agent 消息出现现象/影响/方案 A/B/代价/推荐 → 用户点选或输入 → `question` 与 `answer` 事件可见 → 主 agent 恢复并继续 → 任务后续结果可见。

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

- 组件测试：新增/扩展 `TaskRunDetail.test.tsx`、`TaskFinishSummary.test.tsx`、`TaskQuestionCard.test.tsx`、`TaskArtifacts.test.tsx`、`TaskToolTrace.test.tsx`、`EventFeed.test.tsx`、`useTaskEvents.test.ts`、`ThinkingDisclosure.test.tsx`。
- E2E：扩展 `e2e/final-flow.spec.ts` 或新增 `e2e/agent-runtime-flow.spec.ts`，使用可控 fixture 或 mock API 断言关键工作流。
- 后端接口契约测试需覆盖 D1′ 持久化语义与 D2–D4 的字段兼容和状态语义；跨仓契约（28 种事件）由 CI 验证。

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
| M2：降级与预算语义 | P1-2、P1-4、P1-5；降级对话解释、预算闸和事件语义 | 降级事实、影响、方案与推荐可读；用户回答后主 agent 继续；显示限制/剩余量及事件摘要 | 前端 3–5 人日；后端 P1-2 持久化与提示约束 2–4 人日 |
| M3：恢复、性能、同步与导出闭环 | P1-6、P1-7、P1-9、P1-10、P2-1；SSE 补拉、轨迹虚拟化、结果重试、导出指纹及回归 | 刷新/断线恢复完整历史；大轨迹可滚动；同步延迟可恢复；导出重试语义有断言 | 前端 5–8 人日；后端 D2–D4 3–6 人日，取决于现有渲染快照能力 |
| M4：思考流与进度播报 | §13、§14；思考增量渲染、工具/Skill 可见、Kernel 确定性进度播报 | 需求对话能看 reasoning；副驾驶能看主 agent 与子 agent 的工具/Skill；进度播报由 Kernel 触发而非模型自觉 | 前端 3–5 人日；后端 3–5 人日 |
| M5：ask_user 主动询问闭环 | §15；后端工具/事件/接口、前端问答卡、需求 agent 接入与回归 | 任务与需求会话均可主动提问、回答并恢复；刷新可恢复，服务重启后旧问题如实失效；授权仍走 approval | 后端 10–17 人日；前端 3–5 人日 |
| M6：动画提示词 v2 | §16；九段式模板、S1–S12 风格模块、逐类提示词改写、提示词 lint | 六类文字 + 主要 MG 提示词通过 lint；motion coverage ≥45%；drawtext 能力外的效果明确登记为渲染侧需求 | 4–7 人日 |

**建议顺序：** M1 与 M2 可并行；M3 中 D4 需先确认后端原始时间线快照策略。M4 与 M2 有交叠（事件语义），建议 M4 的思考/工具可见性先于 P1-5 落地。M5a 先建立工具、问答持久化、事件与接口，M5b/M5c 可并行。M6 独立，可与前端里程碑并行推进。P1-2 的前端验收依赖 §15 问答事件与回答接口，不依赖台账查询 API。

## 10. 验收标准与测试矩阵

### 10.1 组件级：vitest/jsdom

| 编号 | 组件/测试 | 自动化断言 |
|---|---|---|
| P1-1 | `TaskRunDetail.test.tsx` | 展开 run 调用 `runDetail(taskId, runId)`；展示 brief、outputs、needs、failure、degradations、tool_calls_path；空字段显示空态；404 显示可重试错误。 |
| P1-2 | `TaskQuestionCard.test.tsx`、降级对话组件测试 | `degradation` 事件事实可读；主 agent 消息展示现象/影响/方案 A/B/代价/推荐；用户选项或自由文本通过 answer 接口提交；question/answer 回执与继续状态可见；不渲染台账状态。 |
| §13 | `ThinkingDisclosure.test.tsx`、`AgentPanel` reasoning 测试、`ToolCallRows` 测试 | reasoning 增量按序拼接且 `done` 后转已完成；`subagent_tool` 进入工具列表并区分 `kind=tool/skill`；超长思考截断提示与全文入口；空 reasoning 不伪造内容。 |
| §14 | Kernel 进度事件测试 | 8 类触发点各产出一条含必需字段的进度事件；首次降级与预算过半各只播报一次；连续失败计数成功后清零；播报不替代实际工具调用。 |
| §16 | 提示词 lint 测试 | 九段齐全、必含「不要」与「自检」、占位符齐备、数值区间与 easing 名合法、drawtext 提示词不出现粒子/模糊/3D/遮罩。 |
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
| P1-2 | 投递降级事件后，断言对话流出现主 agent 的现象、影响、方案 A/B、代价与推荐；用户点选或输入后断言 `answer` 事件可见、任务恢复并出现后续执行消息；页面无台账分组或收据查询请求。 |
| §13 | 任务 SSE 依次投递 reasoning delta、preamble、主 agent 工具、子 agent 工具、Skill、progress、report、done；需求对话投递 `status→reasoning→delta→result`；断言分区显示与来源标识正确。 |
| §14 | 从开工到收尾触发 8 类播报场景；断言每类播报字段完整、无空话话术、播报后仍有对应业务调用发生。 |
| §15 | 任务运行与需求对话分别触发 `ask_user`；断言问题卡、选项/自由文本、提交回执、agent 继续、刷新重建、超时默认项与取消行为；重启后旧问题回答返回 410 并禁用；授权场景仍显示 `ApprovalRows`。 |
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
- **旧任务缺问答事件或台账记录：** 只呈现当前可读取的降级事件；不推断用户已接受或问题已修复。尚未回答的旧问题若无持久化记录则显示不可恢复，不伪造可答卡片。
- **旧事件缺 detail 字段：** parser 对新增键使用可选值；未知结构保留原始 JSON，缺字段时不渲染空标签。
- **历史事件无 spilled 文件：** events 接口返回空或旧热层时显示当前可读取范围；不得无限请求或白屏。
- **服务重启导致 run 详情不可用：** 详情 404 显示记录缺失，并保留 run 列表摘要缓存；重放 409 显示运行实例已不可用。
- **收据台账当前内存化：** 后端重启会使处置记录消失。D1′ 要求持久化，以供 Kernel 与主 agent 决策；前端不展示台账，也不声称其状态。
- **待答问题跨重启：** 持久化问题与答案事实，但服务重启后旧 pending 问题转为不可答，answer 返回 410；主 agent 恢复后可新建问题。
- **任务快照与事件流不一致：** 以 `task_end` 事件和当前任务快照为同一任务事实的来源；恢复完成后可再拉一次 `GET /task/{id}` 校正终态。

### 11.2 开关与灰度

- 功能开关建议按模块配置：`taskRunDetail`、`taskQuestionCard`、`taskKindVisibility`、`taskEventHydration`、`taskTraceVirtualization`、`exportTimelineSnapshotRetry`。
- 新 UI 组件失败时可回退到现有列表/事件摘要，不影响主 Agent 执行和任务终态。
- SSE 恢复先在内部/测试环境灰度；监控补拉请求量、重复事件比率、seq 缺口率和水合失败率。
- D1′ 台账持久化灰度期间：读不到历史台账时只退化为「按本轮事件解释」，不得让任务因台账读失败而判失败；落库开关关闭时保持现有内存语义并记日志。
- 导出重试行为切换前增加明确按钮文案与 E2E；不得静默改变线上「重试」所用时间线。
- 回滚前端时保留后端新增字段兼容旧客户端；后端不要删除既有接口或改变已有字段类型。

## 12. 追溯表

| 问题编号 | 覆盖章节 | 验收用例 |
|---|---|---|
| P1-1 | 3.4、4.1、5、10.1、10.2 | `TaskRunDetail.test.tsx`；展开 run 的 E2E |
| P1-2 | 2.1、2.3、3.3、3.4、4.2 D1′、5、9、10、11 | 降级事实—主 agent 解释—用户回答—任务继续的组件与 E2E；台账持久化后端测试 |
| §13 | 3.3、13、10 | `ThinkingDisclosure.test.tsx`、reasoning 接线测试；思考流 E2E |
| §14 | 3.3、14、10 | Kernel 进度事件测试；播报 E2E |
| §15 | 3.4、4.2 D1′、5 P1-2、9 M5、10、11、15 | `TaskQuestionCard.test.tsx`、问答 service/API 测试；任务与需求对话 E2E；28 种事件跨仓契约测试 |
| §16 | 16、9 M6、10 | 提示词 lint 测试；生成侧指标回归 |
| P1-3 | 3.1、5、6.1、10 | `TaskFinishSummary.test.tsx`；终态 E2E |
| P1-4 | 3.2、5、6.4、10 | `UsageRows.test.tsx`；触闸 E2E |
| P1-5 | 3.3、3.5、5、6.2、8、10 | `EventFeed.test.tsx`、`eventSchema.test.ts`；事件语义 E2E |
| P1-6 | 3.5、4.1、4.2 D2、7、10 | `useTaskEvents.test.ts`；断线恢复 E2E |
| P1-7 | 3.5、5、7、10 | `TaskToolTrace.test.tsx`；2,000 条轨迹 E2E |
| P1-8 | 3.4、4.1、4.3、5、10 | `TaskRuns.test.tsx`；操作状态与错误码 E2E |
| P1-9 | 3.3、4.1、4.2 D3、5、10 | `TaskArtifacts.test.tsx`；同步延迟 E2E |
| P1-10 | 4.2 D4、5、10、11 | 导出重试单测；时间线 A/B 的 payload E2E |
| P2-1 | 2、5、9、10、11 | 全部组件矩阵；扩展后的 agent-runtime E2E 流程 |

## 13. 思考流与工具可见性（对应要求 2）

### 13.1 现状结论（逐项核实）

**A1 主 agent 任务侧：后端发的是 reasoning 增量。** `agent_loop._on_reasoning` 在收到非空 delta 时立即发 `thinking` 事件，`detail` 含 `delta`、`done: false`、`round`；轮次结束时另发 `done: true`。证据：`clipwright/services/agent_loop.py:410-421`、`:527-535`。

**A2 任务侧前端：能看，但不是"流式追加"的最优实现。** `ThinkingDisclosure` 从任务事件读思考内容、默认折叠，展开后把**所有 thinking 事件重新拼接**（每次事件变化都整体重算）。证据：`src/features/copilot/ThinkingDisclosure.tsx:3-6`、`:12-39`。任务事件经 SSE 进 store：`src/features/task/useTaskEvents.ts:40-53`。

**A3 需求对话侧：后端有 reasoning 帧，前端没消费。** 服务端在 `gathering/init` 把 reasoning 增量推入 SSE 队列，API 编码为 `{type:"reasoning", data:...}`；前端订阅回调只处理 `status` 与 `delta`，`setLiveReasoning` 有状态声明但没有增量赋值。证据：`clipwright/services/requirements_service.py:2260-2267`、`:2275-2291`、`:2314-2316`；`clipwright/api/requirements.py:290-305`；`src/features/agent/AgentPanel.tsx:162-164`、`:312-324`、`:662-686`。**结论：点「正在思考」能看到按钮态，看不到思考内容。**

**A4 工具可见性：主 agent 能看；子 agent 的 `subagent_tool` 只作为事件行文字出现，没进工具列表；Skill 没有独立标识。** `ToolCallRows` 只配 `tool_call`/`tool_result`，最多最近 8 对：`src/features/copilot/CopilotTaskRunTab.tsx:150-160`、`:191-219`。`subagent_tool` 的字段齐备（agent/stage/tool/capability/status/duration_ms/args_brief/error）：`clipwright/agents/base.py:220-263`；前端 parser 其实能解析成 tool 结构：`src/features/task/eventSchema.ts:197-211`，但列表没接入。Skill 走同一条记账路径，名记为 `skill:<名>`：`clipwright/agents/base.py:295-319`，前端 `KIND_CN` 有「技能」但没有专用标签/栏位：`src/features/task/labels.ts:10-16`、`:38-67`。

**A5 已确认的硬约束。** store 只保留最近 400 条事件：`src/stores/taskStore.ts:9-10`、`:19`、`:162-166`；完整历史需走 `GET /api/task/{id}/events?since_seq=`：`clipwright/api/task.py:155-184`。

### 13.2 前端呈现设计

1. **任务运行页**
   - `ThinkingDisclosure` 升级为独立「模型思考」区：默认折叠；标题显示状态（生成中 / 已完成 / 模型未提供）与已接收片段数；展开后按增量**追加**渲染（保留滚动位置：用户在底部时自动跟随，向上阅读时暂停跟随）。
   - `thinking`（provider reasoning）与 `narration`（模型面向用户的说明）分栏；`report`、`subagent_progress`、`agent_run_update` 归入「阶段进度与汇报」，不混进思考区。
   - 工具列表合并三类来源：主 agent（`tool_call`/`tool_result`）、阶段子 agent（`subagent_tool`）、Skill（`kind=skill`）。按「主 agent / 阶段子 agent」分组，可按阶段、调用者、工具名、状态筛选。
   - **全部可见（2026-10-30 用户裁定）**：默认呈现**全量**调用，不做「最近 N 条」截断。现有 `ToolCallRows` 只取 `slice(-8)`（`CopilotTaskRunTab.tsx:191`）属于过渡实现，须改为「全量列表 + 虚拟滚动 + 按需加载历史」，并保留 `tool_calls_total` 之类的总数口径；任何采样都必须显式标注「已采样，共 M 条」并给出查看全部入口。
   - Skill 必须显式标「技能」，名字从 `kind=skill` 或 `skill:<名>` 解析；**不得**把 `skill:xxx` 当普通工具名显示。
2. **需求对话页**
   - SSE 收到 `reasoning` 时更新独立 reasoning 状态；有内容才显示「正在思考」可展开，空内容不伪造。
   - reasoning 结束显示已完成标记；正文回复（`delta`）仍作为独立 assistant 气泡，不并入 reasoning。
   - 无 reasoning 能力的 provider：不显示思考区，或显示「该模型未提供思考过程」（二选一，不许留空白按钮）。
3. **折叠与超长**
   - **思考内容全部可见**：折叠只是默认收起，展开后必须是**完整**文本（不得只给首尾或最近 N 段）；超过窗口时按 §13.3 的历史分页继续取，而不是丢弃。
   - 折叠摘要只显示片段数与总字数，不预览全文。
   - 展开区高度上限；超过 20,000 字时首屏保留头尾摘要 + 「查看完整思考」（分页或虚拟列表）。
   - 切换任务/会话必须清理对应 reasoning 状态，禁止串显上一个任务的内容。

### 13.3 后端契约（需要补的字段）

1. **任务 `thinking` 事件**（`clipwright/services/agent_loop.py::_on_reasoning`）固定字段：`detail.delta`、`done`、`round`、`channel`（`reasoning`/`summary`）、`source`（`main_agent`/`stage_agent`）、`agent`、`stage`、`run_id`、`seq_in_round`、`truncated`。同步 `clipwright/schema/task.py::EVENT_TYPES` 注释与前端 `eventSchema.ts` parser；单事件增量设上限，超限拆条，**禁止截断后仍标 complete**。
2. **需求对话 SSE**（`clipwright/services/requirements_service.py` + `api/requirements.py`）：固定 `{type:"reasoning", data:{delta,done,round,source}}`，与 `delta`/`result` 相互独立；前端 `services/api/requirements.ts` 与 `AgentPanel.streamChat` 解析 `reasoning`。
3. **`subagent_tool`**（`clipwright/agents/base.py::_note_tool_call` / `call_skill`）：新增 `kind: "tool" | "skill"`、`run_id`、`seq_in_run`；`call_skill` 保持 `skill:` 前缀兼容旧数据。
4. **历史查询分页**：`GET /api/task/{id}/events` 增加 `before_seq`、`limit`（当前只有 `since_seq`，见 `clipwright/api/task.py:155-162`），供「历史分页」而非只靠 400 条内存窗口。需求会话 reasoning 的历史恢复需要独立的会话事件读取契约（任务事件接口不适用）。

### 13.4 性能与健壮性

- SSE 消费端按帧缓冲：同一动画帧内的多个短 delta 合并成一次状态提交（`requestAnimationFrame`/节流），避免每个 token 触发一次列表重渲染。
- reasoning 用**增量缓冲**（chunk 数组 + 惰性 join），不做每个 token 的全量 `filter/join`（现实现的问题，见 `ThinkingDisclosure.tsx:12-39`）。
- 主 agent 与子 agent 状态按 `task_id`/`run_id` 隔离；重连按 seq 去重。
- **「全部可见」不靠前端内存**：store 的 400 条只是实时窗口，历史一律走服务端分页（§13.3 第 4 点）；思考与工具列表均按「最新在前 + 可上翻历史」组织，翻到顶部时自动加载更早一页。
- 解析失败/未知事件类型保留原始 detail 并可诊断，不静默丢弃。

### 13.5 验收断言

**组件级**：`ThinkingDisclosure` 默认 `aria-expanded=false`；多段 `delta` 后按序拼接、`done=true` 转已完成；空 reasoning 不显示假内容；`truncated=true` 显示截断提示与全文入口；`ToolCallRows` 同时渲染 `tool_call/tool_result` 与 `subagent_tool`，`kind=skill` 显示「技能」；同一批次多 delta 只触发一次批量更新。
**全部可见断言**：投递 200 条以上 `tool_call`/`subagent_tool`/Skill 混合事件，断言列表条数等于事件条数（或等于 `tool_calls_total`），**不存在**「只显示最近 8 条」；滚动到顶部触发历史分页且不重复、不跳项；思考文本长度与拼接结果等于所有 `thinking.delta` 之和。

**E2E**：任务 SSE 依次投递 reasoning delta → narration → 主 agent 工具 → 子 agent 工具 → Skill → progress → report → done，页面分区与来源标识正确；需求对话投递 `status→reasoning→delta→result`，点「正在思考」能看到内容、assistant 气泡只显示 `delta/result`；provider 无 reasoning / 断线重连 / 重复 seq 时不串任务、不重复拼接；超过 400 条事件时实时视图仍响应且历史可分页读取。

## 14. 阶段进度播报规范（对应要求 3）

### 14.1 现状核实

已具备：任务启动 `task_start`（`clipwright/services/agent_kernel.py:613`）；阶段开始 `step_start`、结束 `step_end`（`clipwright/services/stage_subagent.py:375-379`、`:505-531`）；阶段内可选 `subagent_progress`（`clipwright/services/agent_context.py:127-144`，**是否有具体节点播报取决于阶段代码**）；工具循环结束时的主 agent `report`（`clipwright/services/agent_loop.py:527-535`）；Kernel 在补派/跳过等决策点的 `narration`（`agent_kernel.py:468-477`、`:953`、`:1014`、`:1046`）。

缺口：**没有证据表明「开工 / 预算过半 / 同一工具连续失败 / 收尾前 / 需要用户决策」这些节点由 Kernel 确定性播报**；`agent_kernel._emit_report`（`:1424-1458`）能生成阶段完成 headline/bullets，但全仓未检出调用点（**待核实是否实际触发**）。`EVENT_TYPES` 对 `narration` 的契约描述是「规划后/改计划后」，`thinking` 是 provider reasoning 增量（`clipwright/schema/task.py:44-50`）。

**结论：会播报，但是"模型自觉 + 少数程序点"，不是"到一定阶段一定播报"。** 长阶段里用户可能连续几分钟只看到工具行。

### 14.2 必须播报的触发点

| 触发点 | 确定性触发条件 | 播报必须包含 | 需要用户决策时 |
|---|---|---|---|
| 开工 | 任务进入运行态、首次调度成功 | 进度 `n/N`；目标摘要；当前行动；下一步 | 列出待确认项；无则明写「无需决策」 |
| 每阶段开始 | 派发阶段子 agent 前 | 阶段名；`n/N`；输入来源摘要；本阶段目标；预计下一节点 | 写明会影响用户选择的参数 |
| 每阶段结束 | 阶段返回 ok/degraded/failed/timeout | 状态；产出或结论；失败证据或降级影响；下一步 | 只列尚未自动解决且确需拍板的事项 |
| 首次降级 | 每类降级首次出现 | 降级类型；触发原因；能力影响；恢复/替代策略；下一步 | 若替代方案改变结果范围，给选项（走 §15 `ask_user`） |
| 预算过半 | 任一预算维度首次达 50% | 维度；当前/上限；预计剩余工作；策略 | 有超预算风险时给选项 |
| 同一工具连续失败 | 同工具同参数指纹连续失败 ≥2 次 | 工具/能力；次数；错误摘要；已尝试的变化；停止重复的原因；下一步 | 只有存在不同代价分支时才要求选择 |
| 收尾前 | 进入最终校验/汇总/产物落盘前 | 已完成项；未完成项；当前检查；收尾后动作 | 列出无法自动决定的事项 |
| 需要用户决策 | 闸门、授权、输入不足、存在互斥方案且自动策略无法决定 | 决策问题；选项及影响；默认策略；暂停状态 | 明确回答入口与超时/继续策略 |

进度 `n/N` = 已完成阶段 / 计划阶段；动态新增阶段时同步调整 N 并说明「计划已调整」。无法可靠计算 N 时必须写「进度：阶段 X（总数未定）」，**不得虚构百分比**。

### 14.3 播报内容与文案约束

- 单条常规播报 ≤120 汉字；多个失败证据时主播报仍 ≤120 字，细节折叠。
- 每条必含：`n/N`（或"总数未定"）、刚完成/刚发生的事实、当前结论、下一步、需要用户决定的事（无则写「无需决策」）。
- **禁止空话**：「接下来我准备……」「我正在努力……」「请稍等」「稍后给你结果」一律不允许；播报必须包含已发生的动作或可验证的状态变化。
- 不把未执行的计划写成已完成；不把模型猜测写成工具结果；结论必须能追到事件、阶段返回值或工具结果。
- `thinking` 是 provider reasoning，**不作**进度播报；`narration` 是说明文本，**不替代**结构化阶段状态；`report` 是阶段/轮次结论，**不替代**工具调用、阶段调度与产物写入。

### 14.4 Kernel 侧确定性触发

1. 在 `AgentKernel.run` 的任务启动、阶段派发、阶段返回、降级登记、预算快照、连续失败计数、最终校验等**状态转换点**生成播报事件，不依赖模型自觉。
2. 统一入口 `AgentKernel.emit_progress(task, trigger, progress, conclusion, next_action, decision=None)`，只从已知状态与执行结果组装。
3. **新增事件类型 `progress`（2026-10-30 已采纳，与模型生成的 `narration` 分开）**，字段：`trigger`、`stage`、`completed`、`total`、`percent`、`action`、`conclusion`、`next_action`、`decision_required`、`decision_options`、`budget{dimension,used,limit,ratio}`、`failure_streak{tool,fingerprint,count,error_summary}`、`source="kernel"`、`ts`、`run_id`。**事件契约 26 → 29**（`question` / `answer` / `progress`），需同步三处：`clipwright/schema/task.py::EVENT_TYPES`、`tests/test_event_contract.py`、`src/features/task/eventSchema.ts` + `eventSchema.test.ts`。
4. 去重规则：首次降级按 `(task, kind)` 一次；预算过半按维度一次；失败连击按 `(tool, 参数指纹)` 计数、成功即清零。
5. 播报事件**先写入事件账本再继续**；写失败只记日志，不得让业务因播报失败而失败。
6. **落 reports（2026-10-30 用户裁定）**：每条 `progress` 同时追加到任务工作区的 `reports/progress.jsonl`（一行一条 JSON，字段与事件 detail 同构，另带 `task_id`/`ts`/`seq`），并在 `reports/INDEX.md` 末尾维护一节「进度时间线」（时间、`n/N`、阶段、结论、下一步）。目的：①事件热层会淘汰，报告不该跟着消失；②人可以直接读文件复盘；③重启后可用它把进度补回事件流（可选，按 `seq` 去重）。落盘失败记 `progress_write_failed` 降级并继续，不得阻断任务。

### 14.5 前端呈现

- 任务页顶部加「阶段进度」区：`n/N`、当前阶段、最近事实、结论、下一步、决策状态。
- `progress` 用结构化卡片 + 可展开证据；`thinking` 独立折叠区；`subagent_progress` 归到对应阶段的细粒度进度；`report` 进阶段结论区。
- 到达即追加真实事件，不用 spinner 文案替代状态事实；超过内存窗口时提供服务端分页入口。
- `decision_required=true` 时才显示选项与继续/暂停；无决策项时不显示假交互控件。

### 14.6 验收断言

**Kernel/服务级**：8 类触发点各至少产出一条含必需字段的进度事件；每条 `progress` 都能在 `reports/progress.jsonl` 找到同 `seq` 的一行，且 `INDEX.md` 的「进度时间线」条目数与之匹配；首次降级与预算过半各只播报一次；阶段失败/超时/降级/连续失败都播真实状态与下一步，成功后连击计数清零；任何播报不得替代紧随其后的工具/阶段实际调用（断言业务调用仍发生且顺序正确）；事件写失败不改变业务结果；分母缺失时输出「总数未定」。

**组件级**：阶段开始/结束后进度条按 `n/N` 更新；`thinking`/`narration`/`subagent_progress`/`report`/`progress` 分区显示且来源无歧义；决策事件仅在 `decision_required=true` 时出现可操作选项，提交后显示服务端确认。

**E2E**：从开工到收尾依次触发 8 类场景，页面每次只显示事实明确的播报；注入空 narration、超长摘要、未知触发类型、重复 SSE、断线重连时不崩溃、不串任务、不丢「需决策」状态。

## 15. ask_user：主 agent 询问用户（对应要求 4）

### 15.1 定位与边界

`ask_user` 是主 agent / 需求 agent **主动提出一个具体问题并在答案到达前暂停当前工具轮**的机制，用于产品偏好、含糊需求、结果取舍、降级处置等需要用户拍板的场合。

| 机制 | 语义 | 不混用理由 |
|---|---|---|
| `ask_user` | agent 主动提问，有 `question_id`，任务/会话进入 `waiting_user`，答案关联该问题并恢复 agent | 本 PRD 新增 |
| `inject` | 用户**随时插话**，追加到任务 `hints`，下次规划/决策消费；不承诺 agent 正在等这条 | 证据：`clipwright/services/agent_kernel.py:664-678`、`clipwright/api/task.py:238-247` |
| `approval_request` | 高风险操作的授权确认，沿用两级确认 | 证据：`clipwright/schema/task.py:35-36`；**不得**用 `ask_user` 替代授权 |

用户选「接受降级」只是决策输入；若该 kind 要求收据，主 agent 仍须调 `acknowledge_degradation`（`clipwright/tool/surface.py:83-99`）。

### 15.2 工具注册与 Schema

在 `clipwright/tool/surface.py` 增加 `ASK_USER = "ask_user"`，加入 `AGENT_TOOLS`、`_AGENT_TOOL_SPECS`、`_AGENT_TOOL_TIER`（注册扩展点：`:33-46`、`:144-153`、`:357-385`；路由点：`:778-821`）。

```json
{
  "type": "object",
  "properties": {
    "question": {"type": "string", "minLength": 1, "maxLength": 2000},
    "options": {"type": "array", "maxItems": 8, "items": {
      "type": "object",
      "properties": {
        "id": {"type": "string", "minLength": 1, "maxLength": 80},
        "label": {"type": "string", "minLength": 1, "maxLength": 120},
        "detail": {"type": "string", "maxLength": 500}
      },
      "required": ["id", "label"], "additionalProperties": false}},
    "allow_free_text": {"type": "boolean", "default": false},
    "default_option_id": {"type": ["string", "null"]},
    "timeout_sec": {"type": "integer", "minimum": 30, "maximum": 86400, "default": 1800},
    "context_refs": {"type": "array", "maxItems": 20,
                     "items": {"type": "string", "maxLength": 200}}
  },
  "required": ["question", "options", "allow_free_text", "timeout_sec"],
  "additionalProperties": false
}
```

**档位：`write_local`。** 它写本地问答状态并阻塞当前轮，但不调外部服务、不产生高额成本；`read` 不符其副作用，`costly` 高估成本。

**实现位置**：工具名/schema 在 `surface.py`；状态机与持久化放独立 `clipwright/services/ask_user.py`；`surface.execute()` 路由到该服务执行器，避免把等待/超时/恢复堆进工具注册表。执行需拿到 `task` 或需求会话上下文，不能只靠 `pipeline_id` 识别需求会话。

### 15.3 执行与阻塞语义

现状 `TaskStatus = pending | planning | running | paused | done | failed | cancelled`（`clipwright/schema/task.py:20`），终态 `done/failed/cancelled`（`:24`）。**新增 `waiting_user`**，同步状态 schema、公开快照、前端类型、状态映射、恢复逻辑与 API 校验。

- `paused` = 用户/控制端要求暂停，走既有 resume；`pause()` 设 `_CONTROL[task_id]="pause"`（`agent_kernel.py:634-642`）。
- `waiting_user` = 工具已发出待答问题，Kernel 挂起当前工具轮直到答案/有效超时默认项/取消；需保留 `question_id`、deadline 与待恢复调用状态。
- **不复用** `_CONTROL="pause"` 表达等待（该控制值只有 `pause|cancel`，见 `agent_kernel.py:39-40`）：混用会把主动暂停误报成等待答复，且没有 question 关联与超时默认语义。

行为契约：

1. 校验参数 → 建 `question_id` → 写持久化问答存储 → 发 `question` 事件 → 置 `waiting_user`。
2. 工具调用挂起；收到有效 `answer` 后写答案到持久化状态与**下一轮模型上下文**，发 `answer` 事件，恢复该调用并把状态置回 `running`。答案不能只留在事件里。
3. 超时且有 `default_option_id` → 生成系统答案，发 `answer`（`source="timeout_default"`），并登记 `ask_user_timeout_default` 降级（记录原问题、默认项、deadline）；无默认项 → 终止等待并如实转失败/需重新决策，**禁止静默代选**。
4. 用户取消任务 → 待答问题置 `cancelled`，后续答案返回 409（取消走既有 `cancel()`，`agent_kernel.py:644-662`）。
5. **服务重启**：不对重启前的待答问题接受答案；恢复为 `expired`，answer 返回 410，并在恢复上下文记「服务重启，原问题已失效」。主 agent 恢复后可新建 `question_id` 重问。历史可读，旧问题不可再答。
6. 待答问题、答案、状态迁移、deadline、恢复信息必须持久化；进程重启**不尝试**恢复旧协程或旧工具栈。

**与既有 resume 的关系（2026-10-30 用户裁定，按此实现）**

现状：`agent_kernel.resume()`（`:1122`）只做「非终态 → 清 `_CONTROL` → 重新进 tool loop」，而 `TASK_TERMINAL = {done, failed, cancelled}`（`schema/task.py:24`）——`paused` 不在其中，所以今天的 resume 是「从产物继续干」，**没有在飞调用需要交付**。`ask_user` 是第一个「有在飞调用、结果必须由外部事件交付」的工具，因此必须划清：

1. **活进程内**：`waiting_user` 时 `POST /resume` **拒绝**，返回 `409 {reason:"waiting_answer", question_id, message:"任务正在等待回答，请先回答问题或取消"}`。出口只有两个：`POST /answer` 或 `POST /cancel`。**不得**把 resume 解释成「用 `default_option_id` 替你回答」——那是静默代选。
2. **重启恢复后**：被恢复任务里所有 pending 问题标 `expired`（answer → 410），任务状态从 `waiting_user` **回落 `paused`**，并 emit 一条 `narration`「原问题已失效，任务继续」；此时 `resume` 正常放行（已无挂起调用），主 agent 需要时重新 `ask_user` 新问题。
3. **resume 本质不变**：仍是「清暂停 + 重进 loop」，只增加一个前置拒绝条件与重启后的状态回落；终态 409 `task_terminal` 契约不动。

前端相应：`waiting_user` 显示问题卡（`TaskQuestionCard`）并**隐藏/禁用**「继续」按钮；收到 409 `waiting_answer` 时提示「请先回答上面的问题」，不显示为失败。

### 15.4 事件契约（26 → 29）

新增两种事件：

- `question`：`detail` 含 `question_id`、`owner_type`（`task`/`requirements`）、`owner_id`、`question`、`options`、`allow_free_text`、`default_option_id`、`timeout_sec`、`deadline_at`、`context_refs`。
- `answer`：`detail` 含 `question_id`、`option_id`（自由文本时 null）、`text`、`source`（`user_option`/`user_text`/`timeout_default`）、`answered_at`。

必须同步修改三处：①`clipwright/schema/task.py::EVENT_TYPES`；②`tests/test_event_contract.py` 的**数量断言 26 → 29**（保留集合/顺序/去重断言）；③前端 `src/features/task/eventSchema.ts` + `eventSchema.test.ts`（26 → 29，补三个类型的解析与字段）。这是**向后兼容的增量**：不改旧事件字段；旧前端收到未知类型走现有 unknown 兜底（`eventSchema.ts:11-14`），显示原始 detail。

> 三个新增类型合计：`question`（§15.4）、`answer`（§15.4）、`progress`（§14.4，已采纳）→ 26 + 3 = **29**。

### 15.5 REST 接口

**任务**：`POST /api/task/{task_id}/answer`（鉴权沿用任务所有权，参考 `/inject`，`api/task.py:238-247`）

```json
{"question_id": "q_01J...", "option_id": "rerun", "text": null}
```

成功：`{"task_id":"task_...","question_id":"q_01J...","status":"accepted","task_status":"running","answer_event_seq":143}`

错误：`404`（task 或 question 不存在/不属于该任务）；`409`（已回答、任务已取消/终止、状态冲突；`detail.reason="already_answered"` 并带已提交答案摘要）；`410`（已超时/因重启失效/已关闭，`detail` 含 `reason` 与 `question_id`）；`403`（无权）。

**需求会话**：新增 `POST /api/requirements/{session_id}/answer`（请求同构，响应换 `session_id/session_status`）。需求会话**不复用** `Task.status`，用自己的 `waiting_user` 与 `session_id` 关联；`chat/stream` 在提问时发 `question` SSE 帧、回答后发 `answer` 帧再继续 `delta/result`（当前 `stream_chat` 只推 `status/delta/reasoning/result/error`，见 `requirements_service.py:2260-2316`，需增交互帧与可恢复的 session 事件）。

**待答查询**：`GET /api/task/{task_id}/questions?status=pending`、`GET /api/requirements/{session_id}/questions?status=pending`，供刷新后恢复问题卡；**只返回交互问题，不返回降级台账**。重启失效项返回 `status="expired"`，前端禁答并显示原因。

### 15.6 幂等与约束

- `question_id` 服务端生成不可猜测，创建幂等：工具重试返回原问题，不产生第二个 `question` 事件。
- 一题只答一次；重问必须新 ID，并在 `context_refs` 关联旧问题。
- 单任务/单会话最多 3 个 pending；超限返回结构化错误，不建问题、不挂起。
- 必须 `options.length >= 2` 或 `allow_free_text=true`；`default_option_id` 必须在 options 内；option id 题内唯一；自由文本 1–2000 字且仅当 `allow_free_text=true`。
- `timeout_sec` 限定 30–86400，服务端计算并持久化绝对 `deadline_at`；前端倒计时只做展示，不作为超时裁定来源。
- 不得用于危险操作授权、权限提升、绕过风控。

### 15.7 前端 `TaskQuestionCard`

新增 `src/features/task/TaskQuestionCard.tsx`，owner-neutral props 支持任务与需求会话：

- 展示问题、选项 `label/detail`、自由输入、默认项倒计时与 deadline；提交中 / 已答回执 / 已超时失效 / 权限错误 / 网络错误可重试（重试用原 `question_id`，由服务端幂等保护）。
- 在 `CopilotTaskRunTab` 的任务运行对话流与需求对话页各挂载一次；提交走各自 API adapter，组件内不区分授权逻辑。
- 刷新后先用历史 `question`/`answer` 事件重建，再拉 pending 校准；重启失效项只读展示并禁用回答。
- 与 `IntentCard`（`src/features/agent/IntentCard.tsx:40-117`，需求意图预览/确认后执行）**并存**、各司其职；`ApprovalRows` 继续只做授权，不与问题卡合并。
- 无障碍：问题与选项容器 `role="group"` + `aria-labelledby`；选项可 Tab/方向键，支持键盘 `1/2/3` 选前三项；倒计时与提交结果 `aria-live="polite"`；错误 `role="alert"`；不以颜色单独表达状态。
- `data-testid`：`task-question-card`、`task-question-prompt`、`task-question-option-{id}`、`task-question-free-text`、`task-question-countdown`、`task-question-submit`、`task-question-receipt`、`task-question-error`。

### 15.8 里程碑与验收

| 里程碑 | 范围 | 自动化断言 | 估算 |
|---|---|---|---:|
| M5a：后端工具/持久化/事件/接口 | 注册 `ask_user`；任务与需求 owner；`waiting_user`；question/answer；answer 与 pending 查询；重启失效语义 | 工具面 schema 含六个字段；参数约束失败不落库；一次回答只产生一个 `answer`；待答达上限返回错误；重启后旧问题 410；事件契约 28 种且前后端同序 | 后端 5–8 人日 |
| M5b：前端问答卡 | `TaskQuestionCard`、两处复用、刷新重建、无障碍 | vitest：选项/自由文本/倒计时渲染；提交后回执；409/410/网络错误状态；键盘选择；aria 标记 | 前端 3–5 人日 |
| M5c：需求 agent 接入 | 需求 agent 调工具；SSE `question`/`answer` 帧与恢复 | service 测试：提问可答、回答后 agent 继续、刷新/重连可从 session 事件恢复、需求会话不访问任务 API | 后端 3–5 人日 |
| M5d：跨模块回归 | 降级解释、需求追问、授权分流、取消/超时/重启 | Playwright：degradation → 解释 → 选项/自由文本 → answer → 任务继续；`approval_request` 仍由 `ApprovalRows` 处理；重启后旧问题禁答并显示失效原因 | 前后端 2–4 人日 |

## 16. 动画提示词完善方案（对应要求 5）

> 参考：[XiaoyeCodes/code-animation-prompts](https://github.com/XiaoyeCodes/code-animation-prompts)（341 种代码动画风格提示词、193 张参考静帧、离线挑选器、Claude Code/Codex Skill）。本节只借鉴其**提示词工程与索引组织方式**，不复制其素材、文案或第三方许可内容。

### 16.1 可借鉴清单

| # | 借鉴点 | 对方的做法 | 我们的落法 |
|---|---|---|---|
| 1 | 风格按系列分类 | 341 种分 A–G / M / K / Z / H / L / V / X / R / O 十系列，各系列有明确侧重点 | 新增 `clipwright/animation/prompts/style_catalog.json`：模块 id、系列、标签、适用动画类型、渲染路径。不改渲染器 |
| 2 | 先检索、再读单份 | `scripts/styles.py search 水墨`、`show B3`；明确"不要一次加载全部提示词" | 新增 `prompts/scripts/styles.py`：`search` / `show` / `match --type`；生成时按类型+风格 ID 定点读取，只注入候选摘要 |
| 3 | 气质模糊时先给候选 | 给 2–3 个候选，说明色彩、运动、适用内容，再推荐一个 | 落成 §16.5：用 §15 的 `ask_user` 让用户选风格，结果写进 animation 阶段 brief |
| 4 | 主画风 / 运动 / 版式职责分离 | "不要把多个风格的全部约束机械叠加" | 风格模块字段拆 `visual_language` / `motion` / `composition`，类型提示词只引用一个主模块 |
| 5 | 一句角色 + 唯一交付物 | "你是一位前端动效工程师，写一个完整 index.html，只用原生 Canvas 2D" | 文字提示词：只输出 `TextDef` JSON；MG 类型提示词：只输出当前生成器接受的结构化 JSON |
| 6 | 画面是时间的纯函数 | `draw(t)`；禁 `Math.random`；带种子 `mulberry32(7)` 只在启动生成；"同一个 t 每次画出来一模一样" | drawtext 路径：关键帧时间必须落在 `[0, duration]` 且同输入时间序列稳定；MG HTML 路径：时间轴按绝对时间、固定 seed |
| 7 | 参数区间代替形容词 | 粒子半径/深度/相位/力度用区间 + 指数给出 | 字号、位移、透明度、缩放、错峰间隔全部给数值区间（见 §16.2 ③④） |
| 8 | 常量表 | 画布、粒子数、总长、关键时间点、焦距一次性列出 | 模板固定常量表：1920×1080、字幕带 160px、行宽 ≤14 字、元素 ≤3、时长区间 |
| 9 | 分段时间函数 + 代码 | `z1(t)` 加速段、急刹 0.6s、爆炸、后撤，给出 `camZ(t)` 实现 | 关键帧阶段表（阶段名 / t_start / t_end / 属性起止值）+ 允许 easing 白名单 |
| 10 | 严格的"不要"清单 | 不要 `Math.random`、不要在 draw 里存状态、不要用 DOM、不要多余颜色、爆炸后不要再画光环 | 每类提示词带"不要"清单：不要静态贴图式只变透明度、不要 `position=bottom`、不要超 3 元素、不要复述字幕原文 |
| 11 | 自检清单（可执行问句） | "同一个 t 刷新两次是否一样""t=2.8 是不是星光线+青/琥珀环""一帧 4000 线会不会卡" | 每类提示词带自检问句 + 机器可测指标（见 §16.4） |
| 12 | 严格输出格式 | 只输出一个代码块，不许省略号/"其余同上" | 只输出 JSON 对象，不加围栏与解释；禁止残留占位符 |
| 13 | 能力分流 | 允许 Canvas/WebGL/Three.js 等重实现 | 明确三条渲染路径（drawtext / mg_fastpath / MG HTML），**drawtext 不承诺**粒子/模糊/3D/遮罩；需要即登记为渲染侧需求 |
| 14 | 参考静帧 | 193 张静帧与提示词一一对应 | 本期不引入外部图片；可选后续为 S1–S12 各生成 1 张参考帧存 `docs/`，只作对照，不进版本库大文件 |

### 16.2 提示词模板规范 v2（九段式骨架）

可作为 `clipwright/animation/prompts/text/_base.md` / `prompts/types/_base.md`：

```md
# {{类型名称}}（{{type_id}}）提示词 v2

## ① 角色与交付物
你是 {{角色}}，把输入 {{输入内容}} 转换成一个 {{唯一交付物}}。
目标渲染路径：{{drawtext 关键帧 | mg_fastpath | MG HTML}}。只实现该路径明确支持的能力，
不得把静态描述冒充成已实现的动画。

## ② 硬约束
- 关键帧时间以片段局部秒计，满足 0 <= time <= {{duration_sec}}；按时间升序。
- 相同输入 + 相同提示词版本必须产生相同结构与关键帧；禁止逐帧依赖上一帧状态、禁止未固定随机。
- 只输出 JSON 对象，不加围栏、说明、注释。
- 文本行宽 <= {{max_line_chars}} 字（通用上限 14）；元素数 <= {{max_elements}}（通用上限 3）。
- 字幕带 = 画面底部 {{caption_band_px}}px（160）；所有元素必须避让字幕带与安全边界。
- 事实只能来自 {{source_fields}}；不得推算、补造、把推测写成结论。

## ③ 常量表
| 常量 | 值 |
|---|---|
| 画布 | 1920 x 1080 |
| 字幕带高度 | 160px |
| 单行文字上限 | {{max_line_chars}} 字 |
| 元素上限 | {{max_elements}} |
| 片段时长 | {{min_duration}}–{{max_duration}}s，本次 = {{duration_sec}}s |
| 安全区 | x=8%–92%，y=8%–{{safe_bottom_percent}}% |

## ④ 分段关键帧公式与 easing 词典
先给不重叠的阶段表：{{阶段名 / t_start / t_end / 目标元素 / 属性起止值}}。
缺省属性保持静止；不得用形容词代替数值。

drawtext 路径允许的 easing（必须命中 keyframes_expr.EASING_EXPR）：
linear / ease-in / ease-in-quad / ease-out-quad / ease-in-out-quad /
ease-in-cubic / ease-out-cubic / ease-in-out-cubic /
ease-in-quart / ease-out-quart / ease-in-out-quart /
ease-in-expo / ease-out-expo / ease-in-out-expo /
ease-in-back / ease-out-back / ease-in-out-back /
ease-out-elastic / ease-out-bounce
禁止写 back-out / elastic-out / bounce：MG validator 认这些名字，但 drawtext 的 FFmpeg 映射不认。

## ⑤ 风格模块引用
主画风：{{S 编号}}；只用该模块的配色、形状、线宽与层数。
运动方式：{{单一运动策略}}；不得叠加其它模块的运动约束。
版式：{{本类型版式}}；语义结构优先于风格参考。
禁止项：{{模块禁止项}}。

## ⑥ 不要清单
- 不要 {{禁止的事实或表达}}。
- 不要 {{该渲染路径不支持的属性}}。
- 不要引入参考风格里的文案/数据/品牌/人物。
- 不要靠加元素绕过 {{元素上限/版面约束}}。

## ⑦ 自检清单
- [ ] JSON 可解析、必需字段完整、无占位符残留。
- [ ] 关键帧时间在 0–{{duration_sec}}s 内且升序。
- [ ] 文本长度、元素数、字幕带、安全区全部合规。
- [ ] 主体有可观察属性变化（装饰变化不算）。
- [ ] 末段静止 >= {{read_hold_sec}}s。
- [ ] 每个事实值能追到输入来源；同输入再生成时间点不变。
- [ ] 所用属性都在 {{renderer}} 支持范围内。

## ⑧ 输出格式
只输出一个 JSON 对象，结构见：{{type_specific_json_schema}}。
禁止注释、围栏、"其余同上"。

## ⑨ 失败回退
1. 解析失败按 `_extract_json` 顺序重试：裸 JSON → ```json 围栏 → 首个 `{` 至末个 `}`。
2. 结构问题交给 `_normalize`：时长钳制、关键帧夹取、元素截断到 {{max_elements}}、文字键收敛到 `content`；归一化不算语义修复。
3. 校验失败最多重试 {{max_attempts}} 次；仍失败则返回失败并走模板/降级 kind。
4. 超长文本先语义摘要，禁止静默截断；字幕带冲突时移到 upper/center，仍冲突则减元素或降级。
5. 降级必须记 type_id、prompt_version、失败字段、fallback kind；不得把回退描述成成功生成。
```

**与现有实现对齐**：`MAX_LINE_CHARS=14`、`MAX_ELEMENTS=3`、`CAPTION_BAND_PX=160`（`text_generation.py`）；`validate_text_def()` 已检查元素数/单行字数/`position=bottom`/像素 y 是否进字幕带并调用 `validate_mg_json()`；`_extract_json()` 支持裸 JSON、围栏、首尾大括号三种提取。**注意**：`keyframes_expr.EASING_EXPR` 与 `mg/validator.py` 的 easing 白名单**不同**，提示词对 drawtext 只能列前者。

### 16.3 风格模块表（S1–S12）

这些模块是从 341 种风格中提炼的**能力适配**，不是逐条复制。色值为倾向，透明度/字号/坐标仍由类型提示词约束。

| 编号 | 视觉语言 | 关键参数倾向 | 渲染路径 | 适用类型 | 禁止项 |
|---|---|---|---|---|---|
| S1 星光线 | 暗底 + 少量线性光轨暗示运动方向，主体仍是文字/数据 | `#101820`/`#39D5FF`/`#F5F7FA`；线宽 1–2px；发光 0–4px；位移 80–160px/s | drawtext 只做文字平移/变色；光轨需 MG HTML | reveal_line、title_stack、mg_title_reveal | drawtext 不得声称粒子；光轨不得压正文与字幕带 |
| S2 粒子聚形 | 固定种子粒子由散到聚，构成单一图形或标题轮廓 | `#17212B`/`#00C2A8`/`#FFC857`；粒子 80–240；聚合 0.6–1.2s | MG HTML | 片头标题、mg_logo_intro | 本期不落 drawtext；禁每帧随机；粒子不得遮字 |
| S3 极简几何 | 单一线/矩形/圆建立焦点，不做多余装饰 | `#F4F6F8`/`#20262E`/强调 `#E4572E`；线宽 1–3px；位移 20–80px/s | drawtext 关键帧 / mg_fastpath | emphasis_keyword、reveal_line、comparison、flow_chart | 同屏不超过 1 个强调色；禁厚重阴影 |
| S4 图表生长 | 轴、线、数据按阅读顺序依次显现 | `#15232D`/`#3A86FF`/`#FFBE0B`；线宽 2–3px；错峰 0.12–0.22s | mg_fastpath；复杂图表 MG HTML | bar_chart、line_chart、mg_data_bars | 不改数据顺序；无有效数据不画数值图 |
| S5 分屏对照 | 左右同构，用间距/符号/明度表达差异 | `#1E2933`/`#4CC9F0`/`#F4A261`；分隔线 2px；入场差 0.2–0.4s | mg_fastpath / MG HTML | comparison、mg_comparison_split | 禁跨维度比较；禁只换颜色不表意 |
| S6 技术标注 | 细线连接对象与短标签，类工程示意 | `#16212B`/`#26C6DA`/`#DCE3E8`；线宽 1px；位移 8–16px | drawtext 仅文字层；指示线需 mg_fastpath/MG HTML | label_callout、diagram、flow_chart | 禁悬空标签；禁挡人脸与字幕 |
| S7 编辑部引语 | 引号/正文/来源形成稳定阅读层级 | `#F5F1E8`/`#222222`/`#C44536`；正文 28–44px；位移 12–20px | drawtext 主文本；完整卡片 MG HTML | quote_block、mg_quote_card | 禁伪造引文与来源；禁不透明大底板 |
| S8 发布会数字 | 单一大数字主导，单位贴近，入后留读数时间 | `#101820`/`#F8FAFC`/`#00A6A6`；主数字约画高 18%–24%；计数 0.6–0.9s | drawtext 关键帧（缩放/颜色）；逐值跳数需 MG HTML | number_punch、mg_data_counter | 日期/版本/编号禁从 0 计数；禁裸数字 |
| S9 柔光玻璃 | 低对比柔和色面，主体清楚 | `#F7FBFF`/`#8ECDF2`/`#4F6D7A`；发光 2–6px；位移 20–60px/s | MG HTML | mg_title_reveal、mg_quote_card | 不得把 blur 说成 drawtext 已支持；禁低对比正文 |
| S10 水墨留白 | 黑白主调 + 一点朱砂，用留白控节奏 | `#111111`/`#F2F0E9`/`#B23A2F`；线宽 2–5px；慢移 10–40px/s | MG HTML；drawtext 只能黑白红文字近似 | title_stack、quote_block、hierarchy | 墨迹扩散/纸纹需 MG HTML；禁与像素霓虹混用 |
| S11 像素赛博 | 像素网格、硬边色块、短促错位 | `#0B1020`/`#00F5D4`/`#F72585`/`#EDEDED`；位移 100–240px/s | MG HTML；drawtext 只能模拟文字色/平移 | codeblock、diagram、title_stack | 禁衬线标题；本期不做 blur/3D/故障粒子 |
| S12 电影字幕标题 | 克制排版，层次靠字号/字距/安全区 | `#101010`/`#F4F4F4`/`#D9A441`；描边阴影 0–2px；位移 8–24px | drawtext 关键帧 | reveal_line、quote_block、title_stack | 禁长段重复字幕；禁厚光晕与全幅底色 |

### 16.4 逐类改进点

#### 文字动画（`clipwright/animation/prompts/text/`）

**`emphasis_keyword.md`**
- 现状问题：Motion 写「`0.25–0.4s back-out 入场（scale 0.88→1.0，opacity 0→1）`」——`back-out` 不在 drawtext 的 `EASING_EXPR` 映射里（应写 `ease-out-back`）。
- 改法：`## Motion` 改为 `ease-out-back`（保守可退 `ease-out-cubic`），入场 0.25–0.4s、scale 0.88→1.0、opacity 0→1，弹跳幅度 ≤4% 且只发生一次；明确"主体覆盖按主文本自身关键帧计算，装饰线不计入第二主体"。
- 可测指标：主元素 1、装饰 ≤1；主文本 ≤10 字；入场 ≤0.4s；easing 命中 `EASING_EXPR`；覆盖率 ≥45%；同输入关键帧时间完全一致。

**`reveal_line.md`**
- 现状问题：Motion 写「`遮罩揭示或 16px 上移淡入（0.4–0.6s ease-out）`」——遮罩属性 drawtext 没有。
- 改法：遮罩标注为 MG HTML 选项；drawtext 固定 `translate_y: 16→0`、`opacity: 0→1`、0.4–0.6s、`ease-out`。`## Semantic constraints` 加每行 ≤14 字、最多两行、超长先摘要。
- 可测指标：≤2 行、单行 ≤14 字；drawtext 输出不含 mask/clip；入场 ≤0.6s；揭示后静止 ≥0.6s；文本框 `y+height ≤ 920px`。

**`quote_block.md`**
- 现状问题：Composition 写「`卡片居中偏下（避开底部字幕带）`」——`position=center` 不保证卡片整体不落字幕带；Motion「`卡片从下方 12–20px 浮入`」在 drawtext 只转译主文字，引号与卡片不独立渲染。
- 改法：`## Semantic constraints` 增加 `quote_text` / `attribution` 字段与来源约束；`## Composition` 明确正文主层固定在上部 70%，底边不超过 y=920px；`## Motion` 加 renderer 分支：drawtext 把引号+正文合成一个主文本层整体浮入 12–20px，需独立卡片/引号/出处时走 MG HTML。
- 可测指标：引文逐字匹配率 100%；无出处不生成来源；≤2 行、单行 ≤18 字；字幕带碰撞 0；drawtext 最终只有 1 个可见文本层。

**`label_callout.md`**
- 现状问题：Composition 写「`距离 16–24px`」但没定义对象坐标/锚点/像素参照；Motion「`描边高亮扫过一次`」超出关键帧能力。
- 改法：`## Semantic constraints` 增加 `target_ref` 与 `target_position`（归一化坐标），无坐标就降级为静态标签、不造位置；`## Motion` 把 drawtext 版限定为标签平移 8–12px + 透明度入场，扫光仅 MG HTML。
- 可测指标：每标签 ≤8 字；每片段 ≤2 标签；`target_ref` 覆盖率 100%；距离改比例表达；人脸与字幕带碰撞 0。

**`number_punch.md`**
- 现状问题：Motion 写「`数字从 0 计数到目标值（0.6–0.9s）`」，Semantic constraints 只要求"数值在旁白里出现"，没区分数量 / 日期 / 版本号。
- 改法：加 `number_kind=countable|identifier`；只有 `countable` 且原文给单位时允许从 0 计数；日期/版本/序号用原值揭示；drawtext 主路径用整体 scale/opacity，逐值跳数与单位错峰层走 MG HTML。
- 可测指标：主数字精确出现在源文本；单位紧邻率 100%；`identifier` 从 0 计数次数 = 0；入场/计数 ≤0.9s；主数字数 = 1；字号 ≥画高 18%。

**`title_stack.md`**
- 现状问题：Composition 写「`主标题 48–64px 粗体，副标题 28–34px`」但没写分辨率基准；主标题 12 字 / 副标题 18 字被通用 14 字上限覆盖。
- 改法：`## Composition` 明示 1920×1080 基准并按 `font_size * width / 1920` 缩放；保留主标题 ≤12 字、副标题 ≤18 字、层间距 ≥12px；`## Motion` 给 drawtext 版一个合并主文本整体入场，独立错峰仅 MG HTML。
- 可测指标：≤3 层；主/副标题字数合规；整体高度 ≤画高 45%；底边 ≤920px；动画完成 ≤1.2s。

#### MG 类型（`clipwright/animation/prompts/types/`）

**`bar_chart.md`**：Example 写「`数据：旁白给出「数据对比，垂直柱状图」。`」是类型描述不是数据。改：`## Semantic constraints` 要求每条 `label/value/unit/source_ref`，缺任一不画数值柱；`## Composition` 定义 2–6 根柱、同单位、零基线、只在语义允许时排序；Example 换成带字段的 JSON 样例。指标：柱数 2–6、标签数值一一对应、来源覆盖 100%、无输入时数值标签数 0。

**`flow_chart.md`**：Example「`数据：旁白给出「判断/分支/循环逻辑结构」。`」无实际节点。改：节点 `id/label/source_ref`、边 `from/to/relation/source_ref`，分支条件只能来自原文；`## Motion` 明确先根节点再按边方向逐层入场、错峰 0.15–0.3s、末段静止 ≥0.6s。指标：节点 2–6、边端点存在、关系来源 100%、节点重叠 0。

**`comparison.md`**：Example「`数据：旁白给出「对比两个事物 A vs B，渐变背景 + 逐元素入场」。`」把设计指令当输入。改：加 `comparison_dimension`，左右各含 `label/value/source_ref`，无共同维度就改并列卡片、不标 VS；Example 换字段化输入；渐变需 MG HTML，mg_fastpath 不支持时降级纯色。指标：左右维度一致 100%、补充词每侧 ≤1、入场差 0.2–0.4s、无数字事实时不生成数字。

**`line_chart.md`**：Example「`数据：旁白给出「趋势变化，带面积填充 + 数据点」。`」没有实际点。改：至少 3 个含 `x_label/y_value/unit/source_ref` 的点且 x 有序；两个点只做对比不输出趋势结论；`## Motion` 从第一个点按输入顺序描线、每点 0.12–0.2s，面积填充为 MG HTML 可选项。指标：点 ≥3、x 顺序与输入一致、来源 100%、缺点时趋势结论数 0。

### 16.5 风格候选先问后定

风格描述不清或候选会显著改变色彩/节奏/版式时，动画阶段先用 §15 的 `ask_user` 给 2–3 个候选；用户已明确指定模块编号时不重复问。

```json
{
  "question": "这段动画采用哪种视觉风格？",
  "options": [
    {"id": "S3", "label": "S3 极简几何（推荐）",
     "detail": "黑白底 + 橙红强调；细线、单主体、短促平移；drawtext 可实现文字部分"},
    {"id": "S4", "label": "S4 图表生长",
     "detail": "深底 + 蓝黄数据色；柱体/折线按数据顺序揭示；适合有真实数值的图表"},
    {"id": "S10", "label": "S10 水墨留白",
     "detail": "黑白 + 朱砂一点；慢入场、留白明显；复杂笔触需 MG HTML"}
  ],
  "allow_free_text": true,
  "timeout_sec": 1800,
  "default_option_id": "S3"
}
```

默认项取值顺序：用户显式风格 → Persona `visual_config` / `style_hint` 中最兼容且渲染可得的一项 → 推荐项。`default_option_id` 只用于用户跳过/超时，**不伪称用户已确认**。

衔接：Requirements 阶段把用户选择写入 brief（`animation_style_id`、`animation_style_label`、`animation_style_source=user|persona|default`、`animation_style_locked`）；Animation 阶段把它放进 clip 的 brief/`inputs`，同时传 `palette`、`motion_profile`、`composition_profile`、`renderer_capability`。若用户选择与类型/渲染路径冲突，保留其色彩节奏偏好、列出不可实现项并选降级路径——**不得**把 S2 粒子风格默默当成 drawtext 粒子。生成结果记录所选模块、来源、prompt version、renderer、fallback kind。

### 16.6 索引化与验收

**索引化**：`clipwright/animation/prompts/style_catalog.json` 存元数据（`id`/`name`/`series`/`keywords_zh`/`keywords_en`/`palette_hex`/`motion_tags`/`composition_tags`/`suitable_types`/`avoid_types`/`forbidden`/`renderer_paths`/`reference_source`/`prompt_version`/`status`）；模块正文放 `prompts/styles/S1.md`…`S12.md`；各类型提示词增加 `style_modules: [S...]`。检索脚本 `scripts/styles.py`：`search <关键词>`（返回 ≤10 条摘要）、`show <id>`（读单份正文）、`match --type <type_id> --hint <文本>`（按类型适配过滤 + 关键词）。**默认只注入 ≤3 个候选摘要**，选定后只读对应模块与类型提示词；禁止把 12 份模块正文或全部类型提示词一次性拼进 prompt。模块与类型提示词各算 SHA-256 短哈希，生成 trace 记 `style_module_version` / `type_prompt_version`。

**提示词 lint（可自动化，建议 `prompts/lint_prompts.py`，进 CI）**：
- 九段标题齐全（legacy 七段先 warning，迁移后 error）；「不要」与「自检」各 ≥1 条；
- 占位符齐备且有默认值；发布版禁止残留未展开变量；
- 数值合法：`0 < min_duration <= max_duration <= 60`；关键帧 ∈ `[0,duration]`；元素上限 ≤3；单行 ≤14 字；alpha ∈ `[0,1]`；
- easing 名必须命中目标路径白名单（drawtext 用 `keyframes_expr.EASING_EXPR`，不用 `mg/validator.py` 白名单代替）；
- 不支持能力词扫描：drawtext 类型提示词出现粒子/模糊/3D/遮罩/独立卡片层时，必须标注「MG HTML 路径」或「本期不落」。

**生成侧验收**：

| 项 | 指标 |
|---|---|
| 弱动效 | 数据集弱动效率 ≤5%；主体关键帧覆盖率 ≥45%（装饰变化不计） |
| 确定性 | 固定输入 + 提示词版本重复生成 2 次，规范化后关键帧时间序列完全一致；接口无法保证采样确定性时至少保证归一化/模板回退后稳定，并记录 temperature/seed |
| 位置 | 对文本框实际边界断言 `y + height ≤ 920px`；所有文字避开底部 160px |
| 字数/元素 | 不超类型上限与通用上限；超限不得静默截断后当成功 |
| JSON | `_extract_json` 成功率 ≥98%；重试 ≤2 次；修复后校验通过率 ≥95%；记录裁剪/夹取次数 |
| 对比度 | 正文 ≥4.5:1；大号主数字 ≥3:1；依赖实拍背景无法静态测色时要求描边/阴影或 `rgba(...,0.25–0.55)` 底板并抽帧检查 |
| 事实性 | 图表数值/标签/单位与输入映射率 100%；无数值时数值图数量 0 |
| 能力 | drawtext 输出不得含未支持的粒子/模糊/3D/遮罩/多层独立卡片；需要即走 MG HTML 或登记渲染侧需求 |
| 回退 | 记录 `type_id`、`prompt_version`、失败原因、fallback kind；失败产物不计入 LLM 成功率 |

本章**不改渲染器**：粒子、模糊、3D、遮罩、多层独立文字等超出 drawtext 能力的效果，按 MG HTML 路径验证或登记为渲染侧需求。

## 附录 A：2026-10-30 修订记录

本次修订依据用户五条裁定，改动如下（P 编号沿用第 5 章）：

| # | 用户裁定 | 改动位置 | 影响 |
|---|---|---|---|
| 1 | 前端不需要台账式降级 UI，改为主 agent 解释 + 询问处置方案 | §2.1、§2.3、§3.3、§3.4、§4.2 D1→D1′、§5 P1-2 整节重写、§9 M2、§10.1/§10.2、§11、§12 | 删除 `TaskDegradationPanel` 方案；取消给前端的台账查询接口 D1，改为后端持久化 D1′；降级改由 `ask_user` 承载询问 |
| 2 | 核实"正在思考"是否流式、副驾驶能否看到工具/Skill | 新增 §13 | 核实结论：任务侧能看到思考事件（但整体重算、非增量渲染）；需求对话侧 SSE 有 reasoning 帧但**前端未消费**；`subagent_tool` 未进工具列表、Skill 无独立标识 |
| 3 | 核实主 agent 是否主动播报进度与思考 | 新增 §14 | 核实结论：只有"模型自觉 + 少数程序点"，缺开工/预算过半/连续失败/收尾前等确定性触发；本章给出 8 类触发点表与 Kernel 侧 `emit_progress` 方案 |
| 4 | 新增 `ask_user` 工具（前后端） | 新增 §15；§2.1/§3.4/§9 M5/§10/§11/§12 相应条目 | 新工具 + `waiting_user` 状态 + 事件契约 26→28 + `POST .../answer` + `TaskQuestionCard` + 需求会话复用 |
| 5 | 动画提示词参考 `XiaoyeCodes/code-animation-prompts` 后完善 | 新增 §16；§9 M6 | 14 条可借鉴清单、九段式模板 v2、S1–S12 风格模块、六类文字 + 四类 MG 逐类改进点、风格候选先问后定、索引化与 lint |

| 6 | 2026-10-30 二次确认 | §13.2、§13.4、§13.5、§14.4、§14.6、§15.3、§15.4 | ①思考与工具**全部可见**（废除「最近 8 条」截断，全量+历史分页）；②`progress` 事件**正式采纳**（契约 26→29）并**同时落 `reports/progress.jsonl` + INDEX 进度时间线**；③定死 `waiting_user` 与 `resume` 的三条规则（活进程拒绝 409 `waiting_answer` / 重启后回落 paused 并放行 / resume 本质不变） |

**新增/重编章节**：§13 思考流与工具可见性、§14 阶段进度播报规范、§15 ask_user、§16 动画提示词完善方案、附录 A（本表）。
**取消项**：`TaskDegradationPanel`、`GET /api/task/{id}/degradations`（D1）、`taskDegradationLedger` 开关。
**仍待后端确认**：D1′ 落库载体（Mongo / `reports/` 落盘，PRD 要求至少不丢 pending 与收据）、需求会话事件读取契约、`waiting_user` 与前端 `TaskToolbar` 的按钮映射细节（本轮已定：显示问题卡、禁用「继续」）。

**已定（2026-10-30）**：`progress` 事件采纳（总数 29）；`waiting_user` 走「活进程拒绝 resume / 重启后回落 paused 放行」；思考与工具全部可见。

## 执行记录（2026-10-30 · 第 9 轮 · M4 可见性 / M5c 需求问答 / 导出重试拆分）

对齐本 PRD 的 §13（思考流与工具可见）、§15.5–15.7（需求会话问答）、§20（导出重试）与 §9 的 M3 尾巴。

- **§13 思考与工具全部可见（M4 前端）**
  - `AgentPanel` 真正消费 SSE `reasoning` 帧：旧实现声明了 `liveReasoning` 却从不赋值，
    「正在思考 ▾」实际永远是空的；现在逐块累积（上限 20 万字）、每轮提问清空，
    且**正文已经开始流式时思考条仍然可见**（`busy && (无 streaming 消息 || 有 reasoning)`）。
  - `ThinkingDisclosure` 改增量累积：旧实现每次渲染把全部片段重新 `join` 一遍，长任务是 O(n²)；
    现在按 seq 只拼接新增片段，首帧指纹（seq+首条文本）变化或 seq 后退时整体重建——
    换了任务不会把上一轮思考接在下面；到 40 万字上限时明说不再追加，不静默吞。
  - `ToolCallRows` 三路合并（主 agent 的 `tool_call`/`tool_result` 配对 + `subagent_tool` + Skill），
    并**删除 `slice(-8)`**：来源筛选（全部/主 agent/子 agent/技能）与计数、`kernel` 补派、
    `deduped` 复用、`remaining_turns` 逐行标注；窗口化首屏 60 行 + 「加载更早的」逐段翻到底
    （不截断，也不把上千行一次塞进 DOM）。`ModelTurnRows` 取消 `slice(-6)` 并同样窗口化。
  - `eventSchema` 补 `ToolDetail.seq_in_run`，子 agent 行显示 `@agent#序号`。
- **§15.5–15.7 需求会话问答（M5c）**
  - `requirementsApi` 增 `questions(sid, status)` / `answer(sid, body)` / `sessionEvents(sid, sinceSeq)`，
    全部挂在 `/api/requirements/...`——**需求会话不访问任务事件 API**。
  - `AgentPanel` 挂 `TaskQuestionCard`（`askerLabel="需求 agent"`）：刷新/重连先从 `/questions`+`/events`
    重建卡片，SSE `question` 帧到达即刻出卡；回答后回显 agent 续跑的新回复并刷新待答列表；
    拉取失败时不假装有问题，也不打断对话。`TaskQuestionCard` 新增 `askerLabel` 参数（默认主 agent）。
- **§20 导出重试拆分（M3 尾巴）**
  - 提交时冻结时间线快照 + FNV-1a 指纹（`exportSnapshot.ts`）；失败卡片只给「重试本次提交」（跑快照），
    时间线改过才额外给「用当前时间线重新提交」，并把「提交快照 xxxxxxxx · 当前 yyyyyyyy」显示出来。
    旧实现永远跑当前时间线却叫重试——改完时间线再点重试，等于偷偷换了内容还说是重试。
- **验证**：`tsc --noEmit` 干净；`vitest` **136 文件 / 1171 例**全绿（新增
  `CopilotToolTransparency.test.tsx` 8 例、`exportSnapshot.test.ts` 7 例、`AgentPanel.test.tsx` M5c 3 例 +
  reasoning 2 例与导出重试 4 例）；后端同轮 `pytest` 4925 passed。
- **未完成**：M6（动画提示词 v2）未开始；`TaskToolTrace` 已有后端 `limit/offset` 分页，
  本轮未再加虚拟滚动。
