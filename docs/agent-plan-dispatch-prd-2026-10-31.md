# 主 agent 派发规划书 PRD（2026-10-31）

> 主题：把「用户确认创意简报 → 生成制作规划书」从**需求服务内联调用**改为**主 agent 通过 kernel 派发**，
> 让思考、阶段、结论、产物全部走同一条事件链路，而不是另开一条影子通道。
> 关联：[agent-unified-stream-prd-2026-10-30.md](agent-unified-stream-prd-2026-10-30.md)（单流与思考可见）、
> 后端 `J:\Clipwright\docs\modern-agent-review-prd-2026-10-30.md`（kernel 与阶段子 agent）。

---

## 1. 问题（有实证）

### 1.1 现状数据流（读码确认）

```
用户点「确认简报」
  → 前端 confirmBrief()  → POST /api/requirements/chat/stream/{sid}   message="确认，请生成完整的制作规划书。"
  → 后端 RequirementsService.chat() 的 brief_ready 分支
      → _generate_plan(brief, inputs, sid, on_event=…)
          → stage_subagent.run_inline("structure", StructureInput(...), context, timeout_sec=…)
          → _translate_plan(scenes, brief, script, …)
      → 写回 session.production_plan
  → SSE: reasoning_status(phase_not_streaming) +（本轮新增）stage 帧 + heartbeat + result
```

关键事实：**主 agent（kernel）全程没参与**。`run_inline` 只是"实例化 StructureAgent 跑一次"，
既不产生 `agent_run_*`，也不产生主 agent 的 `thinking` / `delegate_agent` 事件，所以：

| 缺失 | 用户可见后果 |
|---|---|
| 主 agent 的思考流 | 确认后只有阶段帧（派发结构/结构完成/翻译），没有"它为什么这么拆分镜"的推理 |
| `delegate_agent` 语义 | 阶段失败只回一句"规划书生成失败"，没有派发/重派/降级的完整轨迹 |
| `agent_run_*` 可寻址 | 规划书这一步在「轨迹」面板里查不到 run、不能追问/重放 |
| 统一的产物事件 | 规划书写进 session，但不进任务事件流，时间线里只有一条 stage 摘要 |

### 1.2 已有的两套"生成"路径（不该并存）

| 路径 | 入口 | 事件 | 产物 |
|---|---|---|---|
| A. 需求侧内联（现状） | `chat()` → `_generate_plan` → `run_inline` | 只有 `stage` / `heartbeat` | `session.production_plan` |
| B. 主 agent 任务（`proceed` 之后） | `kernel.create(TaskRequest)` → 主 agent `delegate_agent` 逐阶段 | 29 种事件全量（`agent_run_*` / `tool_call` / `thinking` / `progress` / `artifact`…） | workspace 产物 + 时间线 |

同一条流水线（structure → material → edit → animation → audio → quality）存在两种执行方式，
A 还是"看不见的那一种"。用户 2026-10-31 明确要求：**规划书这一步也要由主 agent 派发**。

---

## 2. 目标与非目标

### 目标
1. **一条执行通道**：正式规划书只能由主 agent 通过 `delegate_agent("structure")` 产出；
   `run_inline` 仅保留给"预览/局部修补"这类非正式路径（并在注释与 API 上标明）。
2. **过程可见**：确认简报后，时间线里连续出现 主 agent thinking → 派发 structure → 阶段进度 →
   阶段结论 → 规划书产物；失败时同样有派发/重试/降级轨迹。
3. **可寻址**：这次规划书生成对应一个 `run_id`，能在「轨迹」面板查到、能追问、能重放。
4. **不破坏现有确认流**：`brief_ready → plan_ready` 的状态机、`确认实施` 的 `proceed` 路径不变。

### 非目标
- 不把整个需求对话改成 Task（只把"规划书生成"这一跳交给 kernel）。
- 不改 `proceed` 之后的制作流程。
- 不新增事件类型（复用 29 种契约；若确需，必须前后端同步 + 契约测试）。

---

## 3. 目标架构

```
confirmBrief (brief_ready)
   │  POST /api/requirements/{sid}/plan/dispatch        ← 新端点（幂等，返回 task_id + run_id）
   ▼
RequirementsService.dispatch_plan(sid)
   │  kernel.create(TaskRequest{..., plan_only: true, brief: 已确认 brief})   ← 复用现有 create
   ▼
Kernel（主 agent）
   │  thinking  →  delegate_agent("structure", brief)
   │              →  agent_run_start / subagent_tool / progress  （全量事件）
   │  narration →  "结构阶段完成：12 个场景"
   │  delegate_agent("translate") 或内部脚本       （规划书中文可读版）
   ▼
产物回填：kernel 结束前写 `reports/plan.json` + emit `artifact`；
         RequirementsService 监听 task 终态 → 读产物 → 写 session.production_plan
   ▼
SSE：需求侧仍订阅 /api/requirements/chat/stream（本跳期间转发任务事件）或改为
     前端同时订阅 /api/task/{task_id}/events/stream（推荐，见 §5）
```

### 3.1 为什么用 `plan_only: true` 的任务
- 复用 `kernel.create` / `TaskLimits` / 事件流 / `run_id` 可寻址，不新造执行器；
- 任务只需跑到"structure + 翻译 + 落盘规划书"就 `done`，不进入 material/edit；
- 失败时任务 `failed` 并带 `finish.reason`，需求侧据此回 `brief_ready` 并给出可重试的真原因。

### 3.2 会话状态映射

| 需求会话 status | 触发 | 前端展示 |
|---|---|---|
| `gathering` | 无 | 正常对话 |
| `brief_ready` | 简报产出 | 简报卡 + 「确认简报」 |
| `planning` | 点了确认（本轮新增语义：**已有 task_id**） | 单流里持续显示主 agent 阶段与思考 |
| `plan_ready` | 规划书回填成功 | 规划书卡 + 「确认实施」 |
| `brief_ready`（回退） | 任务 failed | 保留简报 + 显示失败原因 + 「重试生成规划书」 |

`planning` 与任务状态的关系（必须写死，避免两套真相）：
- 任务 `running` / `waiting_user` → 会话 `planning`；
- 任务 `done` → 会话 `plan_ready`（仅当产物可读，否则回退 `brief_ready`）；
- 任务 `failed` / `cancelled` → 会话 `brief_ready`，并把 `finish.reason` 落到消息流。

---

## 4. 接口与契约

### 4.1 新端点（幂等）

```
POST /api/requirements/{session_id}/plan/dispatch
  body: { retry?: boolean }            # retry=true 时按同一 brief 重新建任务
  200:  { task_id, run_id?, status: "planning", reused: bool }
  4xx:  404 会话不存在 / 409 已有在跑的规划书任务（返回已存在的 task_id）/
        400 会话还没有 brief（必须先出简报）
```

幂等键：`plan-dispatch:{session_id}:{brief_hash}`。同 brief 且任务仍在跑 → 返回既有 `task_id`，
`reused=true`（与 `proceed` 的幂等策略一致，键空间独立）。

### 4.2 事件（复用 29 种，不新增）

| 事件 | 来源 | 前端呈现 |
|---|---|---|
| `task_start` | kernel | 时间线："开始生成规划书" |
| `thinking` | 主 agent | 思考条目（默认展开、增量） |
| `narration` | 主 agent | 助手消息（"我把 62 秒分成 12 段…"） |
| `agent_run_start/update/end` | stage | 阶段条目 + 「轨迹」里的 run 详情 |
| `progress` | kernel/stage | 阶段进度（completed/total） |
| `tool_call` / `subagent_tool` | 主 agent / stage | 工具条目（含 Skill） |
| `artifact` | 规划书落盘 | 产物条目（可复制路径） |
| `question` / `answer` | 需要用户拍板时 | 问题卡（超时用默认项） |
| `task_end` | kernel | 任务结束条目（status + reason） |

### 4.3 产物契约

`reports/plan.json`：
```json
{ "session_id": "...", "brief_hash": "...", "scenes": [...],
  "markdown": "...", "summary": "...", "total_duration_sec": 62,
  "scene_count": 12, "generated_by": "kernel", "run_id": "run_..." }
```
回填规则：只有 `generated_by == "kernel"` 且 `brief_hash` 与当前 brief 一致才写
`session.production_plan`；不一致就回退 `brief_ready` 并提示"简报已变，请重新确认"。

---

## 5. 前端改动

1. `confirmBrief()` 改为调 `/plan/dispatch`，拿到 `task_id` 后：
   - 把 `planning` 状态与 `task_id` 一起写入 store；
   - 挂 `useTaskEvents(task_id)`（引用计数已防双订阅），任务事件直接进时间线；
   - 「轨迹」面板此时自动指向该 task（可查 run、可重放）。
2. 任务终态：`done` → 拉 `/api/requirements/session/{sid}` 取 `production_plan` 渲染规划书卡；
   `failed` → 展示 `finish.reason` + 「重试生成规划书」（调 `retry=true`）。
3. 需求侧 `chat/stream` 在 `planning` 期间不再承担规划书生成，只保留普通对话能力
   （用户在生成期间仍能说话 → 走 `inject` 或排队到下一轮，见 §7 风险）。
4. 事件归属纪律：`planning` 期间的任务事件**只由时间线消费一次**（轨迹面板复用同一投影）。

---

## 6. 迁移与里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **D1 后端派发通道** | `POST /plan/dispatch`；`plan_only` 任务；`reports/plan.json` 落盘；回填逻辑；幂等与 409 | 单测：dispatch 幂等、并发只建一个任务、产物回填、brief 变更不回填、failed 回 `brief_ready` |
| **D2 主 agent 提示词与阶段** | kernel 提示词增加"plan_only 任务：只跑 structure + 翻译并落盘"分支；`delegate_agent(structure)` 必触发 | 单测：plan_only 任务的事件序列包含 `thinking`/`agent_run_start(structure)`/`artifact`/`task_end(done)` |
| **D3 前端接线** | confirmBrief 改派发、planning 期间订阅任务事件、终态回填与重试 | vitest：点确认后时间线出现任务事件；done 后出现规划书卡；failed 后出现原因与重试按钮 |
| **D4 收口** | `run_inline("structure")` 只允许预览路径（加断言/注释/校验）；文档与 PRD 执行记录 | 全局搜索 `run_inline("structure"` 只剩预览调用点；回归全绿；人工 E2E 一遍 |

---

## 7. 风险与反模式

| 风险 | 影响 | 缓解 |
|---|---|---|
| 规划书任务与需求会话双真相 | 状态互相覆盖 | 状态映射写死在 §3.2，只允许 kernel 终态驱动需求状态 |
| 用户在 `planning` 期间发消息 | 消息与任务事件交错 | 一律进时间线；若需影响生成则走 `inject`（已有语义），不重开一轮 chat |
| `plan_only` 任务误跑后续阶段 | 成本翻倍 | kernel 提示词 + 执行器双重门禁；`TaskLimits(max_turns=小)`；任务结束校验产物 |
| brief 在生成期间被改 | 产物与简报不一致 | `brief_hash` 校验，不一致不落盘 |
| 事件重复消费 | 时间线出现双份 | 只由投影层消费；轨迹面板读同一投影；`useTaskEvents` 引用计数 |
| 幂等键冲突 | 点两次建两个任务 | `plan-dispatch:{sid}:{brief_hash}` + 409 返回既有 task |

**反模式**（写进 review checklist）：
1. 在 `_generate_plan` 里"再调一次 kernel"却仍保留 `run_inline` 主路径 → 两套执行并存。
2. 前端在 `planning` 期间同时订阅 `chat/stream` 与 `task/events` 且各自渲染 → 双份。
3. 任务 `failed` 时伪造"已生成规划书"或静默回退到内联生成 → 又回到看不见的路径。

---

## 8. 验收断言（可直接落测试）

**后端**
1. `POST /plan/dispatch` 两次（同 brief）→ 同一个 `task_id`，第二次 `reused=true`。
2. 并发 5 次 dispatch → 只创建一个任务。
3. 任务 `done` 后：`reports/plan.json` 存在、`session.production_plan` 与其一致。
4. brief 变更后 dispatch → 旧任务产物不覆盖（`brief_hash` 不匹配）。
5. 任务 `failed` → 会话回 `brief_ready`，消息流里有 `finish.reason`。
6. 事件序列断言：`task_start → thinking → agent_run_start(structure) → … → artifact(plan) → task_end(done)`。

**前端**
7. 点「确认简报」后 1s 内时间线出现任务条目（不再是空等）。
8. `planning` 期间思考条目增量出现（默认展开）。
9. 任务 `done` 后出现规划书卡与「确认实施」。
10. 任务 `failed` 后出现失败原因 + 「重试生成规划书」，点击走 `retry=true`。
11. `planning` 期间任务事件在时间线里**只出现一次**（轨迹面板不重复渲染）。

---

## 9. 附录：本轮之前已修的相关缺陷（避免重复踩坑）

| 缺陷 | 根因 | 提交 |
|---|---|---|
| 需求对话「正在思考」点不开、0 字 | `stream_generate` 无 `system_prompt` 形参 → 参数透传 TypeError → 整条流式静默回退 | `8fc5cd6` |
| 首轮对话没有流式 | `useRequirementsAutoStart` 用非流式 `chat()` | 随 M1 前端提交 |
| 时间线顺序错乱（最新在最上） | `_merge` 的 patch 覆盖了 `order`，已存在条目 ordinal 被反复写回 0 | `6a05b70` |
| 确认简报后整段静默 | 缓冲分支一帧不发 → SSE 被判死 | `97a9486`（心跳 + 阶段帧 `58e9ffb`/`198c370`） |
| 正文被创意简报顶掉 | 气泡里"带附件跳过正文"的旧逻辑 | `d737aac` |

**教训**：凡是"某条链路是否真的执行"的结论必须有运行证据（服务探针 / 真实浏览器诊断），
读码评审只能提出候选；时间线的 `order` 属身份字段，任何 merge 都不得覆盖。

---

## 10. 执行记录（2026-10-31）：思考与阶段已能在同一条流里定位

原计划里"派发链路要复用一套客户端拼装逻辑"的顾虑已被
[`agent-session-timeline-prd-2026-10-31.md`](./agent-session-timeline-prd-2026-10-31.md)
的 S1/S2 解决：`stage` 是会话时间线的一等条目，`thinking` 由服务端按发生时刻分配 `seq`，
`plan` 条目自带 `brief_hash`（可直接判定"这份规划书对应哪版简报"）。

因此 D1–D4（主 agent 派发规划书）开工时的要求变得明确：

1. 派发过程只写时间线条目（`stage`/`subagent`/`thinking`/`plan`），**不要**再给前端的
   拼装层喂序号；
2. `reports/plan.json` 的 `brief_hash` 与 `plan` 条目的 `meta.brief_hash` 必须同源
   （都用 `requirements_service._brief_hash`），否则"回填校验"两处对不上；
3. 生成期间不能整段静默——`_generate_plan` 现在已在三个节点发 `stage` 帧并落条目，
   派发版本要保持同样的可见性。

提交：后端 `6cd18ca`（S1+S2），前端 `1c0341c`（S3+S4）。

---

## 11. 执行记录（2026-10-31，D1–D4 全部落地）

后端 `c78595a`（D1+D2）、前端 `aa8e10f`（D3）、后端 `fb77383`（D4）、`12dbb0b`（E2E 查出的两处修复）。
配套：时间线适配见 [agent-timeline-adaptation-prd §12](agent-timeline-adaptation-prd-2026-10-31.md)。

| 里程碑 | 落地内容 |
|---|---|
| **D1 派发通道** | `POST /{sid}/plan/dispatch`（幂等键 `session_id:brief_hash`，`retry` 重建，400 `no_brief`/404）；`RequirementsService.dispatch_plan()` 建 `plan_only` 任务（`TaskLimits(40, 80)`）+ 写 `planning` + `session_projection.bind()` + 1s 终态监听；`_finalize_dispatched_plan()` 读 `reports/plan.json` → 校验 `brief_hash` → `_translate_plan` 生成可读规划书 → 写 `plan_ready` + `plan` 条目；失败/产物空/简报变更 → 如实回 `brief_ready` 并说明原因 |
| **D2 提示词与守门** | `agent_loop._PLAN_ONLY_SYSTEM`（只派 structure、不进 material/edit/animation/audio、拿到场景立刻收尾）+ `_user_prompt` 目标段；`kernel._finish_plan_only()` 把守门换成"有分镜场景 + `reports/plan.json` 落盘"，不再要求 `final_timeline`；模型没派结构阶段 → 内核确定性补派一次；`done` 白名单加 `plan_only_completed` |
| **D3 前端接线** | `confirmBrief` 改调 `/plan/dispatch`；`task_id` 写入 taskStore；**不**订阅任务事件流（条目由服务端投影）；终态由后端驱动（前端只轮询会话 status，离开 `planning` 才放开 busy）；失败给出 `no_brief` 等具体原因并回 `brief_ready` |
| **D4 收口** | `PLAN_DISPATCH_ENABLED`（`CLIPWRIGHT_PLAN_DISPATCH=0` 应急）；`chat()` 的确认分支直接转派发；`_generate_plan` 加护栏：派发开启时走内联会写一条可见 `degradation`（`kind=plan_inline_fallback`），不允许第二条正式通道藏在日志里 |

### 与本文的一处取舍（写进 PRD 口径）

**规划书"可读化"留在需求侧**：内核只负责派 `structure` 并落 `scenes`（`reports/plan.json`
不含 `markdown`）。理由是翻译需要 brief/persona/文案上下文，内核没有这些；
需求侧在回填时用同一个 `_translate_plan` 生成正文，失败用 `_default_markdown` 兜底。
`brief_hash` 仍由内核写、需求侧校验，**同源**这一点不变。

### 真实运行证据（K:\demo E2E，2026-10-31）

点「确认简报」后时间线里依次出现（`data-seq` 严格递增）：

```
18 content  用户确认         19 stage  task_start(plan_only=True)
20-21 content 上下文装载      22-23 content 回执 + report
24 stage    execution_plan   26 stage  progress(start)
28 content  tool_loop         29 thinking 主 agent 思考（"只派一次 structure…"）
30 content  preamble          31 tool      delegate_agent
32 subagent agent_run_start   33 stage     structure running
35 artifact doc_write(报告)   36 stage     structure → degraded(4 分镜)
37 subagent agent_run_end     39 degradation scenes_fallback
40 thinking 重派思考           42-44 再次 delegate_agent → structure
...        reports/plan.json 落盘（artifact）→ 需求侧回填 → plan 条目 seq=37
```

最终 37 条条目升序，规划书卡正常出现，`pageErrors=[]`，全流程 2.3 分钟。

### 遗留

- 幂等登记 `_PLAN_DISPATCH` 是进程内内存表：进程重启后同一 brief 再点确认会新建任务
  （不重复扣费之外的副作用是"可能有两个任务都产出 plan.json"，回填按 `brief_hash` 校验，
  内容一致则等价）。后续可落盘到 `reports/`。
- 「轨迹」面板当前读"当前任务"上下文；从「新增标签」打开且无绑定任务时显示空态
  （既有行为，未在本轮改动范围内）。
