# 单一时间线与思考流 PRD（2026-10-30）

> 主题：把「需求对话」和「任务运行」合成一条按时间顺序的统一流，并让模型思考内容真的可看、可恢复。
> 关联文档：[agent-runtime-frontend-prd-2026-10-30.md](agent-runtime-frontend-prd-2026-10-30.md)（§13 可见性 / §15 ask_user）、
> 后端 `J:\Clipwright\docs\modern-agent-review-prd-2026-10-30.md`。
> 触发：用户在真实使用中反馈「点击『正在思考…』依旧无法展开」+「任务运行面板应该和需求对话合并，像 DeepSeek harness 那样按顺序显示」。

---

## 1. 问题与证据

### 1.1 P0：需求对话的思考流从来没生效过（已定位、已修）

**症状**：需求对话发消息后底部出现「正在思考…」，点击无反应；正文也不是逐字出现，而是过一会儿整段蹦出来。

**实测证据（可复现）**。
在干净后端上直接驱动 service 层，统计 `stream_chat` 产出的帧类型：

| 版本 | 帧统计 | 结论 |
|---|---|---|
| 修复前 | `{'status': 1, 'result': 1}` | 一个 `delta` / `reasoning` 帧都没有 |
| 修复后 | `{'status': 1, 'reasoning': 425, 'delta': 208, 'result': 1}` | 思考与正文都是真流式 |

**根因**（服务端，不在前端）：

```
clipwright/services/requirements_service.py
  _stream_gathering_llm():  await self._llm.stream_generate(messages, system_prompt=system)
clipwright/services/llm.py
  stream_generate(self, messages, model=None, timeout=None, use_flash=False, **kwargs)
      → system_prompt 掉进 **kwargs
      → client.generate_stream(messages, model=mdl, **kwargs)
      → OpenAI SDK: Completions.create() got an unexpected keyword argument 'system_prompt'
      → TypeError
requirements_service._handle_gathering():
  except Exception as e: logger.warning("流式 brief 失败，回退缓冲路径: %s", e)
      → 静默回退到非流式 structured_output，on_reasoning 从未被调用
```

日志实证（修复前）：

```
WARNING clipwright: 流式 brief 失败，回退缓冲路径:
  Completions.create() got an unexpected keyword argument 'system_prompt'
```

**为什么之前"看着像好的"**：回退路径仍会返回完整 JSON，前端最终拿到 `result` 帧并渲染回复，所以功能"能用"；丢掉的只是流式与思考。这属于**静默降级**——最坏的一种：用户看不到任何错误，产品经理也测不出来。

**已修（本轮）**：
1. `LLMService.stream_generate` 显式接收 `system_prompt`，拼成 `messages[0] = {"role":"system",...}`；
2. 同方法的元参数（`system_prompt` / `output_schema` / `on_delta` / `on_reasoning` / `messages` / `schema` / `on_preamble`）一律从 `**kwargs` 里剔除，杜绝同类 TypeError；
3. 回归测试 `J:\Clipwright\tests\clipwright\test_stream_system_prompt.py`：
   - `system_prompt` 不进 provider 参数、且成为 system 消息；
   - 元参数不漏给 provider；
   - 需求对话在 gathering 态真实产出 `delta` + `reasoning` 帧。

**仍未修（本 PRD 范围）**：回退是静默的（没有事件、UI 不告知）；非 `gathering/init` 状态没有任何思考流但 UI 仍写「正在思考…」。

### 1.2 P1：前端"假按钮"与状态文案错误

| 现象 | 位置 | 事实 |
|---|---|---|
| 无 reasoning 时渲染不可点的「正在思考…」 | `AgentPanel.tsx` 思考条 | 旧代码按 `liveReasoning` 是否为空二分：有 → 按钮，无 → 纯文本「正在思考…」。用户以为"点了没反应"，其实是根本没有内容 |
| 非 gathering 状态也写「正在思考」 | 同上 | 后端只在 `gathering`/`init` 走思考流；`brief_ready`/`planning`/`pipeline_running` 走缓冲路径，永远不会有 reasoning |

**已修（本轮，最小改动）**：
- 有 reasoning → 按钮显示「正在思考（N 字）▾」，可展开；
- 无 reasoning 且正文已在流式 → **整块不渲染**（既无按钮也无死文案）；
- 无 reasoning 且尚未吐字 → 中性文案「正在生成…」，`data-testid="live-thinking-pending"`；
- 前端回归：`AgentPanel.test.tsx` 新增两例，分别钉住这两种状态（不再存在可点的假按钮）。

**待做（见 §5）**：按阶段给出不同文案 + 后端显式声明 reasoning 能力/可用性。

### 1.3 P1：需求侧思考不持久、与任务侧语义不一致

| 维度 | 需求对话（现状） | 任务运行（现状） |
|---|---|---|
| 载体 | 组件局部 `useState('liveReasoning')` | `TaskEvent`（`thinking` 事件） |
| 编号 | 无 | 单调 `seq` |
| 恢复 | 刷新即丢 | REST hydrate + SSE 按 `lastSeq` 补拉 |
| 增量渲染 | `setLiveReasoning(prev + delta)`，无上限重建策略 | `ThinkingDisclosure` 按 seq 增量累积，40 万字上限明示 |
| 会话事件 | `requirements:<session_id>` 流里只有 `question`/`answer` | 完整事件流 |

结论：合并时间线**不能**复用 `liveReasoning` 这个字符串，必须先把需求侧思考变成带序号的条目（§5.1）。

### 1.4 P1：provider 能力模型把"能配 reasoning effort"当成"能看 reasoning 内容"

`clipwright/providers/base.py::ProviderCapabilities` 只有 `reasoning_effort`，没有 `reasoning_content`。
于是"模型支持高强度推理"≠"模型会回吐思考内容"，前端只能靠"收没收到帧"倒推，无法在请求开始时就诚实标注。

### 1.5 P2：其它真实缺陷（读码确认）

| # | 问题 | 位置 |
|---|---|---|
| 1 | SSE 解析只取每个事件的第一条 `data:` 行，标准多行 `data:` 会丢数据 | `services/api/requirements.ts` 的 `streamChat` |
| 2 | 模块文档写"当前完整响应缓冲后一次性推送"，与已实现的真流式冲突，误导维护者 | `requirements_service.py` 顶部注释 |
| 3 | 会话事件接口只服务 question/answer，需求消息/思考没有服务端历史 | `GET /api/requirements/{sid}/events` |
| 4 | `agentStore` 消息上限 `slice(-200)`、`taskStore` 上限 400，合并后若直接平铺会双倍超限 | `agentStore.ts` / `taskStore.ts` |
| 5 | 任务侧 UI 仍是"按类别聚合的竖排分区"（阶段/轮次/工具/降级/授权/事件/轨迹各一块），同一条时间顺序被切了七八段 | `CopilotTaskRunTab.tsx` |

---

## 2. 目标与非目标

### 目标
1. **一条流**：从用户第一句话到最终结论，按时间顺序在同一滚动区呈现——用户消息、模型思考、工具调用（含子 agent / Skill）、阶段进度、提问与回答、降级解释、结论与产物。
2. **思考可见**：思考内容可展开、可增量、刷新后可恢复；**没有就说没有**（不给假按钮、不假装思考）。
3. **可恢复**：刷新/断线后时间线按序号补齐，不重排、不重复、不丢。
4. **可回退**：新时间线与旧分区 UI 并存到验收通过，用 feature flag 切换。

### 非目标
- 不重写任务执行内核，不改 agent 编排逻辑。
- 不把 `TaskToolTrace`（磁盘全量轨迹）当作实时条目并入主流程——它是条目的展开详情。
- 不在本期实现跨 session/task 的全局 `timeline_seq`（先留协议位，见 §4.2）。

---

## 3. 现状数据模型对照

| 项目 | 需求侧 | 任务侧 |
|---|---|---|
| 类型 | `RequirementMessage{ id, role, content, timestamp, streaming?, ... }` | `TaskEvent{ seq, type, ts, message, detail, causation_id?, run_id?, span? }` |
| 序号 | 无（客户端 `uid()`） | 服务端单调 `seq` |
| 时间戳 | 浏览器 `new Date()` | 服务端 `ts` |
| 传输 | `POST /api/requirements/chat/stream`（SSE 帧：status/ reasoning / delta / question / result / error） | `GET /api/task/{id}/events`（hydrate + 分页）+ SSE |
| 去重 | 无 | `seq <= lastSeq` 丢弃 |
| 分页 | 无（本地 `slice(-200)`） | `since_seq` / `before_seq` / `has_more` / `oldest_available_seq` |
| 恢复 | 草稿（localStorage） | REST hydrate → 订阅 SSE → 断线按 `lastSeq` 补拉 |

**核心矛盾**：两套模型一个是"对话消息"，一个是"执行事件"。合并必须在**展示层**做，而不是把事件塞进消息数组。

---

## 4. 统一时间线：数据结构与合并规则

### 4.1 条目类型（discriminated union）

```ts
type TimelineSource = 'requirements' | 'task' | 'tool-trace' | 'local';
type TimelineScope = { sessionId?: string; taskId?: string };

interface BaseItem {
  key: string;              // 全局唯一，稳定（见 §4.3）
  dedupeKey: string;
  source: TimelineSource;
  order: { stream: TimelineSource | 'local'; ordinal: number };
  ts?: string;              // 原始时间戳，仅展示
  receivedAt: number;       // 到达时刻，只做同源 tie-breaker
  scope: TimelineScope;
  parentKey?: string;       // 例如 tool_result → tool_call
}

type TimelineItem =
  | BaseItem & { kind: 'message'; role: 'user'|'assistant'|'system'; content: string; streaming?: boolean }
  | BaseItem & { kind: 'reasoning'; phase: 'requirements'|'task'; text: string; done: boolean;
                 availability: 'available'|'unsupported'|'unavailable' }
  | BaseItem & { kind: 'tool'; tool: string; origin: 'main'|'subagent'|'skill'|'internal';
                 status?: string; ms?: number; error?: string; capacity?: { stage?: string; attempt?: number } }
  | BaseItem & { kind: 'stage'; stage: string; status: string; completed?: number; total?: number; summary?: string }
  | BaseItem & { kind: 'question'; questionId: string; question: string; options?: { id: string; label: string }[];
                 allowFreeText?: boolean; deadlineAt?: number; status: 'pending'|'answered'|'expired' }
  | BaseItem & { kind: 'answer'; questionId: string; optionId?: string|null; text?: string|null; source?: string }
  | BaseItem & { kind: 'approval'; approvalId: string; risk?: string; status: string }
  | BaseItem & { kind: 'degradation'; scope: string; impact?: string; recovered?: boolean }
  | BaseItem & { kind: 'task-end'; status: string; conclusion?: string; completed: string[]; unfinished: string[] }
  | BaseItem & { kind: 'gap'; from: number; to: number };   // 历史缺口，不静默拼接
```

设计约束：
- `kind` 是 **UI 语义**，`source` 是数据来源；两者不正交混用（同一 `kind` 可来自不同 source）。
- 后端新增事件类型时，只需要在 normalizer 增加一个映射分支，**不需要改 UI 组件**。
- `gap` 是合法条目：宁可显式告诉用户"这段历史缺失"，也不要悄悄拼接。

### 4.2 排序：不用裸时间戳

排序键优先级（从高到低）：
1. 后端下发的跨域序号（本期不实现，协议预留字段 `timeline_seq`）；
2. **流程锚点**：`requirements.message` 在其 `task` 创建之前；`task` 内按 `seq`；`tool-trace` 按 `(stage, attempt, index)`；
3. 同源内 `receivedAt`；
4. 稳定兜底：`key` 字典序（保证两次渲染顺序一致，避免"列表跳动"）。

明确禁止：`items.sort((a,b) => Date.parse(a.ts) - Date.parse(b.ts))`——客户端与服务端时钟不同源，SSE 到达顺序≠事件发生顺序，重连补发会整列跳动。

### 4.3 去重键

| 来源 | dedupeKey |
|---|---|
| 需求消息 | `req:msg:{sessionId}:{message.id}`（首次入库即固化 id，禁止每次 hydrate 重新 `uid()`） |
| 需求思考 | `req:reason:{sessionId}:{turnIndex}` |
| 任务事件 | `task:evt:{taskId}:{seq}`（分区保存 `lastSeqByTask`，不用全局 `lastSeq`） |
| 工具轨迹 | `task:trace:{taskId}:{stage}:{attempt}:{index}`；若带 `causation_id=seq:<n>` 则**合并进**该 tool 条目，不新增行 |
| 提问/回答 | `req:q:{questionId}` / `task:q:{questionId}` |

### 4.4 增量合并（三层，纯函数 + 独立 store）

```
normalize(source record) → TimelineItem        // 只做字段映射
merge(existing[], incoming[]) → TimelineItem[]  // 去重 + patch，不 append 重复
project(scope, beforeKey?, limit?) → 可见条目     // 组件只吃投影结果
```

`merge` 规则：
1. `dedupeKey` 命中 → **patch 已有条目**（streaming 追加、tool_result 回填 status/ms/error、answer 标记 question 已答）；
2. 未命中 → 插入到有序位置（§4.2），不重排整表；
3. `seq` 不连续且未加载 → 生成 `gap` 条目。

### 4.5 Store 形状（新 `timelineStore`，只读投影）

```ts
interface TimelineState {
  itemsByKey: Record<string, TimelineItem>;
  orderedKeys: string[];
  requirements: { sessionId: string | null; loaded: boolean; hasEarlier: boolean };
  tasks: Record<string, { lastSeq: number; oldestSeq: number; hasEarlier: boolean;
                          seqGap: { from: number; to: number } | null; loaded: boolean }>;
  live: { requirements: boolean; tasks: Record<string, boolean> };
  hydrateRequirements(sessionId: string): Promise<void>;
  hydrateTask(taskId: string): Promise<void>;
  applyRequirementMessage(m: RequirementMessage): void;
  applyRequirementReasoning(sessionId: string, delta: string, done?: boolean): void;
  applyTaskEvent(taskId: string, e: TaskEvent): void;
  applyToolTrace(taskId: string, calls: TaskToolCall[]): void;
  loadEarlier(scope: TimelineScope): Promise<void>;
  reset(scope: TimelineScope): void;
}
```

**边界纪律**：
- `agentStore` / `taskStore` 仍是领域状态源（brief、plan、usage、task status 等）；
- `timelineStore` 只是**投影**，不反向写领域状态；
- 时间线的数据装配只发生在这里；组件里禁止 `[...messages, ...events].sort()`。

### 4.6 渲染与性能

- 单列表 + 窗口化：首屏最近 100 条，向上滚动加载更早（复用 `taskStore.loadEarlierEvents` 的语义）；
- 单条内部做二级折叠：思考正文（`max-h` + 40 万字上限）、工具参数/结果（`EventFeed` 的 detail 展开）、全量轨迹（点开才 `GET /tool-calls`）；
- `reasoning` 累积逻辑抽成纯函数 `accumulateReasoning(prev, items)`，任务侧与需求侧共用（现有 `ThinkingDisclosure` 内联实现迁出）；
- 禁止两个组件同时消费同一事件（见 §8 反模式 3）。

---

## 5. 思考流与能力声明

### 5.1 后端：显式的能力与可用性

1. `ProviderCapabilities` 增补两个字段（默认 `False`，由适配器声明）：
   ```python
   reasoning_effort: bool = False      # 能配强度
   reasoning_content: bool = False     # 会回吐思考内容
   reasoning_streaming: bool = False   # 内容是否逐块到达
   ```
2. 需求对话 `stream_chat` 在**第一帧**补一条能力/可用性声明（不新增任务事件类型，只走 SSE 帧）：
   ```json
   {"type":"reasoning_status","data":{"supported":true,"available":true,"reason":null,"phase":"gathering"}}
   ```
   取值：
   - `supported=false, reason="provider_not_exposed"`：模型不回吐思考；
   - `supported=true, available=false, reason="stream_fallback"`：流式失败已回退（**必须**在回退时补发）；
   - 正常流式：`available=true`。
3. 回退路径不再"只写 warning"：`_handle_gathering` 回退时发 `reasoning_status(stream_fallback)`，并把原因带进 `result.diagnostics`（前端可展示"本轮思考内容不可用原因"）。
4. 需求侧思考落盘：写入 `requirements:<session_id>` 事件流（新事件复用现有 `thinking` 类型，`detail.phase="requirements"`），使刷新/重连可恢复；`GET /{sid}/events?since_seq=` 即可回放。**不新增事件类型**，契约仍为 29 种。

### 5.2 前端：五种状态，一个都不许假装

| 状态 | 判定 | UI |
|---|---|---|
| `pending` | 请求中、未收到 reasoning、未收到 `reasoning_status` | 「正在生成…」（不可点） |
| `available` | 已收到 reasoning | 「正在思考（N 字）▾」可展开，增量追加 |
| `unsupported` | `reasoning_status.supported=false` | 「该模型不提供思考内容」（静态说明，不占行） |
| `fallback` | `reasoning_status.available=false, reason=stream_fallback` | 「思考内容不可用（流式已回退）」+ 原因 |
| `idle` | 不在生成中 | 不显示 |

阶段文案也要分开（不再一律「正在思考」）：
`gathering/init` → 「正在思考 / 正在整理需求」；`brief_ready` 修订 → 「正在修改方案」；
`plan_ready` 修订 → 「正在修改规划」；`pipeline_running` → 「管线运行中，请看下方时间线」。

### 5.3 需求消息的历史来源

本期最小可用：`GET /api/requirements/session/{session_id}` 已返回 `messages`，直接用；
思考历史走 §5.1.4 的会话事件流。
长期（下期）：给需求消息分配服务端序号，与任务事件共用 `timeline_seq`。

---

## 6. 里程碑与验收

### M1：思考流真通 + 诚实 UI（本轮已完成大部分）
- 后端：`stream_generate` 参数隔离（已合入）；`reasoning_status` 帧；回退补发状态。
- 前端：五状态机（pending/available/unsupported/fallback/idle）；阶段文案分开。
- 验收：
  - 服务层探针：gathering 流里 `reasoning>0 && delta>0`（已有 `test_stream_system_prompt.py`）；
  - `reasoning_status` 帧在 SF1（正常）/SF2（回退）两条路径都出现；
  - 前端：无 reasoning 时**不存在** `live-thinking-toggle`；有 reasoning 时可展开且字数正确。

### M2：统一时间线（只读投影，不动领域状态）
- 新增 `timeline/normalize.ts`（纯函数，逐条覆盖 29 种事件 → `TimelineItem`）、`timelineStore`、`UnifiedTimeline` 组件；
- `CopilotTaskRunTab` 增加 `?timeline=1` / feature flag 双视图；
- 验收：
  - 同一份事件集，normalizer 输出条目数 = 事件数 − 被合并的 `tool_result` 数（可断言）；
  - 乱序送入（先 result 后 call）最终渲染顺序仍正确；
  - 重复 hydrate 两次不产生重复条目（`dedupeKey` 幂等）；
  - 1200 条事件下首屏渲染 ≤100 条 DOM 节点。

### M3：把需求对话与任务运行合到一条流
- `AgentPanel` 的消息列表与任务时间线共用一个滚动容器；
- `TaskQuestionCard`、授权、降级、`TaskFinishSummary`、产物卡片改为条目级 renderer；
- 保留工具栏（暂停/继续/取消/注入）在流顶部，不进流；
- 验收：
  - E2E：新建制作 → 需求对话 → 确认实施 → 任务 → 导出，全程**只有一条滚动流**；
  - 刷新后时间线完整恢复（消息 + 思考 + 工具 + 结论）；
  - `pageErrors` 为空；旧分区视图可回退。

### M4：性能与恢复硬化
- 虚拟滚动 + 历史分页（需求侧新增 `before_id`/`has_more`）；
- `gap` 条目可见；`seq` 缺口不静默拼接；
- 验收：2000 条事件 + 40 万字思考，滚动 60fps 无长任务（Performance 采样记录进测试报告）。

---

## 7. 迁移与回退

1. **阶段 1（只合并展示）**：保留 `agentStore.requirementsMessages`、`taskStore.events`、`CopilotTaskRunTab` 的所有操作入口；新增只读投影层。flag 默认关。
2. **阶段 2（换 renderer）**：旧分区组件逐个退役（`StageRows`/`ModelTurnRows`/`ToolCallRows`/`ThinkingDisclosure`/`EventFeed`），但**先保留测试**，确认新条目覆盖原能力后再删。
3. **阶段 3（统一状态归属）**：需求侧思考与消息进入服务端事件历史，前端只保留投影。

回退：flag 一键切回旧视图；数据层不动，只影响渲染。

---

## 8. 反模式（写进 review checklist）

1. **把 `TaskEvent` 塞进 `requirementsMessages`**：丢 `seq`/`causation_id`/`detail`，还会被草稿持久化，切换 task 时污染会话。
2. **按裸时间戳排序**：见 §4.2。
3. **同一事件被两个组件消费**：思考重复、工具行翻倍、统计不一致。一个事件只有一个主视觉归属。
4. **把 `TaskToolTrace` 当实时事件全量并入**：它是磁盘分页数据，重复渲染。正确关系是"条目 → 展开详情"。
5. **组件内 `[...messages, ...events].sort()`**：每帧全量 normalize + sort，排序规则散落，测试无法锁定契约。
6. **用"有没有收到帧"当能力判断**：provider 不回吐时永远 pending，必须靠 §5.1 的能力声明。

---

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 需求消息无服务端序号 | 跨源顺序只能靠流程锚点近似 | 本期用锚点排序 + 显式 `gap`；下期加 `timeline_seq` |
| 事件类型 29 种 → normalizer 覆盖面 | 漏映射会出现"事件看不见" | 单测强制：`EVENT_TYPES` 每个 type 必须有映射用例（跨仓契约测试扩展） |
| 一次性切 UI | 回归面大 | feature flag + 旧视图保留到 M3 验收 |
| 长思考文本（40 万字）+ 虚拟滚动 | 主线程卡顿 | 条目内二级折叠 + 文本窗口；`accumulateReasoning` 增量拼接 |
| 需求侧思考落盘增加事件量 | 2000 条上限提前触发 spill | 思考按 `once_per_turn` 聚合（每轮一条，`detail.delta` 追加）而非逐字一条 |

---

## 10. 验收断言汇总（可直接落成测试）

**后端**
1. `stream_generate(system_prompt=...)`：system 成为 `messages[0]`；provider 收到的 kwargs 不含任何元参数。
2. gathering 流：`reasoning` 帧 ≥2、`delta` 帧 ≥2，且 `reasoning_status.available=true`。
3. 流式失败回退：出现 `reasoning_status{available:false, reason:"stream_fallback"}`，且 `result` 仍返回。
4. 需求会话事件流：一次提问后 `events?since_seq=0` 能看到 `thinking`（phase=requirements）与 `question`。

**前端**
5. 无 reasoning：无 `live-thinking-toggle`；有 reasoning：按钮字数与实际累积长度一致。
6. normalizer：29 种事件全部有映射；`tool_result` 合并进 `tool` 而非新增行。
7. 时间线：乱序 + 重复 hydrate 后条目数稳定、顺序稳定。
8. E2E：单滚动流覆盖需求 → 任务 → 导出全链路，刷新后恢复，`pageErrors` 为空。

---

## 附录 A：GPT-5.6 Sol 独立评审（`yuanjvai/gpt-5.6-sol`）与分歧记录

**评审产出**：结构化意见一份，主要贡献在**问题 2（统一时间线）**——discriminated union、normalizer/store/projection 三层、去重键、反模式清单，本 PRD §4/§8 大量吸收。

**分歧（重要，记录在案）**：Sol 判定问题 1 的"直接根因是前端渲染条件"，并把 `on_reasoning` 链路判为"完整"。**这一条与实测不符**：

- 实测（干净后端 + service 层探针）修复前帧统计仅 `status`/`result`，`on_reasoning` 回调**一次都没被调用**；
- 修复后同一探针产出 425 个 `reasoning` 帧、208 个 `delta` 帧；
- 根因是 `stream_generate` 没有 `system_prompt` 形参 → 参数透传 TypeError → 静默回退（§1.1）。

Sol 的读码路径止步于 `requirements_service` 侧接线，没有核到 `llm.py` 的签名与 provider 调用点，因此把"链路完整"当成前提，转而归因于前端条件与 provider 能力。这提示一个流程问题：**读码评审不能替代运行验证**，凡是"某条链路是否真的执行"的结论，必须给运行证据。

**Sol 指出且本轮已采纳的其它项**：
- `ProviderCapabilities` 缺 `reasoning_content`（§5.1.1）；
- 需求侧思考不持久、与任务侧语义不一致（§1.3 / §5.1.4）；
- 非 gathering 状态文案错误（§5.2）；
- SSE 多行 `data:` 解析缺陷（§1.5）；
- `requirements_service.py` 顶部文档过期（§1.5）；
- 反模式："把 task event 塞进 messages"、"按 timestamp 排序"、"双组件消费同一事件"（§8）。

---

## 附录 B：本轮已落地的代码

| 位置 | 改动 |
|---|---|
| `J:\Clipwright\clipwright\services\llm.py::stream_generate` | 新增 `system_prompt` 形参；system 消息前置；元参数剔除 |
| `J:\Clipwright\tests\clipwright\test_stream_system_prompt.py` | 4 例：参数隔离 / system 注入 / 元参数不漏 / 需求流产出 reasoning+delta |
| `J:\Clipweight-Client\src\features\agent\AgentPanel.tsx` | 无 reasoning 时不渲染假按钮；有 reasoning 时显示字数 |
| `J:\Clipweight-Client\src\features\agent\AgentPanel.test.tsx` | +2 例：无 reasoning 且正文流式中 → 无任何思考控件；未吐字时 → 「正在生成…」 |

§5/§6 的其余条目（`reasoning_status` 帧、五状态机、统一时间线、虚拟滚动）尚未实现，按 M1–M4 推进。
