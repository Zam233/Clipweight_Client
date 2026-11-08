# 时间线适配补齐 PRD（2026-10-31）

> 触发：用户实测「需求对话提示 **还没有可显示的内容**」——即单流视图在该有内容的时候空了。
> 本 PRD 把"这一轮时间线重构之后，哪些地方还停在旧世界里"逐条钉住，并给出修复顺序。
> 关联：[agent-session-timeline-prd-2026-10-31.md](agent-session-timeline-prd-2026-10-31.md)（S1–S5 已落地）、
> [agent-plan-dispatch-prd-2026-10-31.md](agent-plan-dispatch-prd-2026-10-31.md)（D1–D4 同版本交付）、
> [agent-unified-stream-prd-2026-10-30.md](agent-unified-stream-prd-2026-10-30.md)（展示层契约）。

---

## 0. 结论先行

空白的**直接原因是存量会话没有条目**，不是渲染坏了：

- 条目只在「新建会话」或「发生一轮对话」时写入。升级前建的会话，磁盘上只有空目录；
- 前端打开它 → `GET /{sid}/timeline` 返回 `items: []` → 空态文案「还没有可显示的内容」。
  这句话在语义上是错的：它把"**旧会话尚未迁移**"说成了"**本来就没有内容**"。

修复顺序：**先回填（T1）→ 再让空态说实话（T2）→ 再补齐单流丢掉的旧能力（T3）→ 收口一致性（T4/T5）→ 用 K:\demo 跑 E2E（T6）**。

---

## 1. 诊断证据（可复核，不是推测）

| # | 证据 | 说明 |
|---|---|---|
| 1 | `J:\Clipwright\workspaces\sessions\req_cbdb1fd15d41\` 存在，但**只有 `archive/` 与 `items/` 两个空目录**，无 `session.json`、无 `journal` | 该会话零条目；`session.json` 只在真正写条目时才生成 |
| 2 | 目录 `LastWriteTime` = 启动后首次访问时刻 | 说明是**读路径**（`GET /timeline`）建的目录，不是写入建出来的 |
| 3 | 运行中的后端 `/openapi.json` 已含 `GET /{session_id}/timeline`、`/timeline/stream` | 后端代码是新的，排除"没重启导致 404" |
| 4 | 该会话是升级前建的：`session.messages` 有历史、`session.json` 无条目 | 存量会话没有迁移入口——**根因** |
| 5 | `SessionLog._ensure_loaded()` 第一行就 `self._ensure_dirs()`（`session_log.py:247`） | 读操作产生文件系统副作用：任何 GET 都会给不存在的会话建空目录（就是证据 1 那个目录） |

---

## 2. 失配清单（这一轮改动后仍停在旧世界的地方）

| # | 位置 | 症状 | 严重度 | 本 PRD |
|---|---|---|---|---|
| A1 | 后端：无迁移入口 | 存量会话永远空；只有再发一条消息才有条目 | **阻断** | T1 |
| A2 | `session_log._ensure_loaded` → `_ensure_dirs` | 读路径建空目录，运维看不出"到底有没有记录" | 中 | T4 |
| A3 | 前端 `SessionTimeline` 空态 | 「还没有可显示的内容」把"未迁移/接口失败"说成"没有内容" | **高（误导）** | T2 |
| A4 | `useSessionTimeline` | 拉取失败被 `catch {}` 吞掉，接着连 SSE；两者都失败也只显示空态 | 高 | T2 |
| A5 | `AgentPanel.tsx:1048` | 输入框门控是 `messages.length > 0`——单流视图里 `messages` 只是**旧视图的遗留数据**，一旦为空就没有输入框（新会话刷新后可能整块消失） | **高** | T3.5 |
| A6 | `AgentPanel.tsx:911` | 「加载更早的消息」按钮在单流视图里仍渲染，点它走的是 `/messages` 分页——与时间线分页两套 | 中 | T3.6 |
| A7 | 单流视图 | 用户发消息后、首个条目到达前**界面毫无反应**（旧视图有 thinking strip，单流没有） | 高 | T3.1 |
| A8 | 单流视图 | `reasoning_status` 的 unsupported/fallback 说明只在旧视图显示 → 用户会以为"思考丢了" | 中 | T3.2 |
| A9 | 后端 | `answer` 类型定义了却从不写入（`answer_question` 把答案当 user 消息写 `content` 条目） | 中 | T3.4 |
| A10 | `SessionTimeline` 的 question 行 | 只显示「待答」，不能在条目上作答（要靠面板下方的旧问题卡） | 中 | T3.3 |
| A11 | `sessionTimelineStore` | 每会话条目无上限、切换会话不清理；长会话 5000 条全驻内存 | 中 | T4 |
| A12 | `GET /timeline` | 逐条 `resolve`（每条读一个 `items/*.json`），500 条 = 500 次文件读 | 低 | T4 |
| A13 | 投影 `TYPE_MAP` | 内核 `plan`/`replan` 事件被投影成 `plan` 类型，和"制作规划书"撞车（派发版一旦开工就会暴露） | 中 | T5（含与 D 系列取舍） |
| A14 | `_emit_session_thinking` 双写 | 仍往旧事件流写 thinking；单流不读它 | 低 | 保留（旧视图还用），T5 标注 |
| A15 | `workspaces/_sessions/` 与 `workspaces/sessions/` | 两个近名目录：前者是 ask_user 问答状态，后者是时间线 | 低 | T5 文档说明 |

> A13 是本轮**必须**先修的：它不属于"存量会话"，而是"派发版一上线就会立刻错"的埋雷。

---

## 3. 目标与非目标

### 目标
1. **打开任何会话都能看到内容**：新会话有开场白，老会话自动从 `session.messages` 回填一次。
2. **空态说真话**：三种情况分开说（同步中 / 已迁移 N 条 / 真无记录或接口失败带原因）。
3. **单流不丢旧能力**：忙碌提示、思考能力五态、问题作答、输入框门控、分页按钮全部对齐。
4. **读路径无副作用、内存有界**：GET 不再建目录；前端每会话有窗口上限。
5. **与 D1–D4 不打架**：冲突点先定死（§6），避免两套 stage/plan/事件消费同时存在。

### 非目标
- 不改 `seq` / 落盘布局 / SSE 帧协议（S1 的契约稳定）。
- 不回填历史 `thinking`（旧事件流只有 `turn_ts`，没有精确位置，硬塞进去等于再造一次"推断位置"）。
- 不改「轨迹」面板的信息架构（用户明确要它保持专业分区视图）。
- 不做多进程并发写（沿用单进程假设，PRD 风险节已记）。

---

## 4. 方案

### T1 存量会话回填（后端）

```
SessionLog.backfill_messages(messages) -> int
  条件：items 为空（任何条目都没有）时执行一次
  映射：messages[i] → {type: "content", content, meta: {role, backfilled: true}, turn}
        turn = 该消息之前出现过的 user 条数 + 1（开场白那条 turn=0）
  ref：legacy:msg:<message_id 或 index>（幂等：重复调用跳过）
  返回：写入条数
```

- 触发点两处（都幂等）：`GET /{sid}/timeline` 前、`stream_chat` 开头。
- **回填的诚实边界**：`compress_history` 会把 >20 轮的历史压掉，所以回填只保证
  「当前会话里还留着的消息」。写入 `meta.source="backfill"`，前端在首条回填条目上显示
  一行小字「（历史消息已迁移，更早的已随会话压缩）」，不假装完整。
- 规划书/简报：`session.production_plan` / `creative_brief` 各补一条 `plan` / `report`
  条目（`ref = legacy:plan:<brief_hash>`），否则老会话点开只看到文字、卡片消失。

### T2 空态与错误如实呈现（前端）

- `useSessionTimeline` 把失败写进 store：`link: 'down'` + `lastError`（HTTP 码/文案）。
- `SessionTimeline` 空态分四支：
  | 情况 | 文案 |
  |---|---|
  | 拉取中（首帧未到） | 正在同步会话记录… |
  | 拉到 0 条 + `backfilled>0` | 已从历史消息迁移 N 条（更早的随会话压缩不可恢复） |
  | 拉到 0 条 + 无迁移 | 这个会话还没有记录：发一条消息就会有内容 |
  | 接口失败 | 时间线不可用（HTTP 500 / 网络中断），点此重试 |
- 重试按钮调 `hydrate` 重跑一次首屏拉取（不刷新页面）。

### T3 单流补齐旧能力（前端）

**T3.1 忙碌行**：`busy` 为真且最新条目不是本轮新条目时，在流末尾渲染一行
`data-testid="session-busy-row"`，文字用现有 `busyLabel`（"正在思考…"/"正在生成制作规划书…"）。
条目一到就消失（不占 seq，不入库——它是 UI 状态，不是事实）。

**T3.2 思考能力五态**：`reasoning_status` 收到 `available=null/unsupported/fallback` 时，
在忙碌行下方补一句说明；`available=true` 后清掉。**只在"本轮没有 thinking 条目"时显示**，
避免和真实思考条目重复。

**T3.3 问题条目可操作**：`question` 条目内联「选项按钮 / 自由文本输入」，
提交走 `requirementsApi.answer`（与旧问题卡同一接口）；提交后置灰并等 `answer` 条目。
旧问题卡（`requirements-question-host`）在单流视图下不再渲染，避免同一问题出现两次。

**T3.4 `answer` 条目（后端）**：`answer_question` 在调用 `chat()` **之前**写一条
`type=answer`（`content` = 还原成人话的答案，`meta.question_id`，`ref=q:<qid>`），
保证顺序是 `question → answer → 后续思考/正文`。`chat()` 仍写 user content 条目（那是给模型的消息），
两条并存但语义不同：`answer` = 用户拍板结果，`content(role=user)` = 喂给模型的文本。

**T3.5 输入框门控**：改为 `Boolean(requirementsSessionId)`，不再依赖 `messages.length`。
欢迎卡（"开始需求分析"）只在**没有会话**时出现，避免与时间线上的开场白重复。

**T3.6 旧分页按钮**：`requirements-load-earlier` 只在 `!unified` 渲染。

### T4 读路径无副作用 + 内存有界

- `_ensure_loaded` 不再 `mkdir`；`_flush_locked` / `_append_journal` 写前再 `_ensure_dirs()`。
- `list_items(resolve=False)`：不读 `items/*.json`（轨迹/调试用；时间线刷新仍 resolve）。
- `sessionTimelineStore`：每会话最多保留 `MAX_ITEMS_PER_SESSION = 3000` 条，超出从前端桶里丢最老
  （服务端仍有，向后翻页可再取）；`reset(prevSessionId)` 在会话切换/新建时调用。
- `SessionTimeline` 的 `loadEarlier` 在 `hasMore=false` 时不再请求。

### T5 一致性收尾

- **投影 `TYPE_MAP` 分流**（A13）：内核 `plan`/`replan` → `stage`（`meta.event_type` 保留原名，
  `meta.kind="execution_plan"`）；`plan` 类型从此**只**表示制作规划书（`meta.kind="production_plan"`）。
  这条与 D 系列强相关，取舍见 §6。
- `_emit_session_thinking` 保留，但注释改成"旧视图专用"；单流视图不读。
- 文档：本 PRD、session-timeline PRD 追加增量记录；`api_reference.md` 更新
  `/timeline` 响应新增 `backfilled` 字段与 `resolve` 参数；说明 `_sessions/` 与 `sessions/` 的区别。

### T6 人工/前端 E2E（K:\demo 数据）

用 `K:\demo` 的真实素材跑一遍完整链路（详见 §8）。

---

## 5. 里程碑与验收

| 里程碑 | 内容 | 验收（人工/自动化归属） |
|---|---|---|
| **T1 回填** | `backfill_messages`、两处触发点、plan/report 补齐 | 人工：打开旧会话立刻看到历史；重复刷新不重复 |
| **T2 空态** | 四支空态 + `lastError` + 重试 | 人工：断开后端时显示"时间线不可用（HTTP…）"，不是"没有内容" |
| **T3 能力对齐** | 忙碌行、五态说明、问题条操作、answer 条目、输入框门控、分页按钮 | 人工：发消息后立刻有"正在思考…"；问题条上能选；刷新后输入框还在 |
| **T4 副作用与上限** | 去掉读路径 mkdir、`resolve` 开关、前端 3000 上限、切换清理 | 人工：`workspaces/sessions/` 不再出现空目录；长会话滚动不卡 |
| **T5 分流与文档** | 投影 plan→stage、文档同步 | 只读代码 + 文档 |
| **T6 E2E** | `e2e/session-timeline.spec.ts` + K:\demo 数据 | 人工跑一次 `npx playwright test`，报告归档到 `e2e/artifacts/` |

---

## 6. 与《主 agent 派发规划书 PRD》的冲突与取舍（开发前先定死）

用户要求：**开发前检查 PRD 冲突并做出取舍**。以下六条是本 PRD（T 系列）与 D1–D4 的真实冲突，
逐条给定论——**下面这版口径即最终口径**，实现时不再临时改：

| # | 冲突 | 两个 PRD 的原文 | **取舍（定稿）** |
|---|---|---|---|
| C1 | **stage 条目谁写** | T 系列让 `_generate_plan` 的 `on_event` 落 `stage` 条目；D2 让 kernel 派发后由 `agent_run_*`/`progress` 投影出 stage | **同一时刻只有一个写者**：`_generate_plan(..., write_timeline=bool)`。默认 `True`（内联模式）；D3 接入派发后，`planning` 走任务投影，内联调用点传 `write_timeline=False`。禁止两边同时写 |
| C2 | **`plan` 类型撞车** | D §4.3 的 `plan` 条目 = 制作规划书；投影把内核 `plan`/`replan` 事件也映射成 `plan` | 投影改映射为 `stage`（`meta.kind="execution_plan"`），`plan` 类型专属制作规划书（`meta.kind="production_plan"`）。**在 T5 就改**，不等 D |
| C3 | **前端是否订阅任务事件** | D §5.1 说 `planning` 时前端挂 `useTaskEvents(task_id)` 进时间线 | **不订阅**。派发端点内就 `session_projection.bind(sid, task_id)`，条目由服务端投影产生（1s 轮询 + 拉取兜底）。前端只读 `/timeline/stream`——否则又变成"两份数据、两种顺序" |
| C4 | **会话状态谁改** | D §3.2 任务终态驱动会话 status | **后端改**（task 终态 → 读 `reports/plan.json` → 写 `session.production_plan` + status）。前端只读 `status`，不自己推断 `plan_ready` |
| C5 | **`run_inline("structure")` 退役范围** | D4 要求只剩预览调用点 | 只约束"**正式生成规划书**"。`_legacy_plan_from_scenes` / `_revise_raw_scenes` / `_handle_plan_revision` 仍用内联（它们是修订/兜底，不是首次生成），在代码注释与 PRD 里标明，不算违规 |
| C6 | **回填与派发产物撞 ref** | T1 回填 `plan` 条目；D 系列也写 `plan` 条目 | ref 分开：回填 `legacy:plan:<brief_hash>`，派发 `evt:<task_id>:<seq>`。且回填只在"零条目"时执行一次，天然不与之后派发冲突 |

另有两条**共享纪律**（不是冲突，但必须两边都遵守）：

- **后端每次改 Python 都要重启**（uvicorn 未开 reload）；E2E 前必须重启，否则测的是旧进程。
- **`meta.brief_hash` 与 `reports/plan.json` 的 `brief_hash` 同源**（都用
  `requirements_service._brief_hash`），否则"回填校验"两处对不上。

---

## 7. 风险与反模式

| 风险 | 影响 | 缓解 |
|---|---|---|
| 回填把压缩后的历史当成全量 | 用户以为丢了消息 | `meta.source="backfill"` + 首条回填条目标注"更早的随会话压缩不可恢复" |
| 回填与首轮 chat 并发 | 重复条目 | 回填在一次 `RLock` 内完成并检查"条目为空"，且 ref 幂等 |
| 忙碌行与 thinking 条目并存 | 界面上"正在思考"出现两次 | 忙碌行只在"本轮还没有 thinking 条目"时显示 |
| 问题条与旧问题卡并存 | 同一问题两个入口 | 单流视图不渲染 `requirements-question-host` |
| 前端 3000 上限丢条目 | 向前翻页取不回（若服务端已归档） | 丢的只是**渲染窗口**，服务端仍在；`archived_until_seq` 有边界说明 |
| 投影 plan→stage 影响轨迹面板 | 轨迹按事件类型分区，不受条目类型影响 | 轨迹面板读原始事件，不读条目类型 |

**反模式**：① 为了"看起来有内容"伪造条目；② 回填时用 `Date.parse`/插入顺序猜位置；
③ 单流里再挂一条 `useTaskEvents`；④ 让前端改会话状态；⑤ 读接口建目录/写文件。

---

## 8. E2E 方案（K:\demo）

数据：`K:\demo\要求.md`（166B，选题与硬要求）、`K:\demo\文案.md`（12KB，口播文案）、
`K:\demo\配音.mp3`（28MB）。

用例 `e2e/session-timeline.spec.ts`（新建，不复用 `unified-stream.spec.ts` 的历史断言）：

1. 打开 `/` → 新建制作：把 `要求.md` 的要求作为首轮输入，文案走「上传参考文件」/粘贴。
2. 断言时间线：`session-timeline` 出现，首条是开场白（`role=assistant`），其后是用户消息。
3. 首轮思考：`session-item-thinking` 出现在**用户条目之后、回复条目之前**（顺序断言取 `data-seq`）。
4. 简报：`timeline-item-report` 出现且含 `brief-card`；正文（`unified-item-message`）仍在。
5. 确认简报 → 出现 `session-item-stage`（派发结构/结构完成/翻译）；若派发版已接入，则断言
   `session-item-tool`/`subagent` 与 `task-trace-stats` 有事件。
6. 规划书：`timeline-item-plan` + `plan-card`，`data-seq` 大于简报条目。
7. **刷新页面**：条目 `data-seq` 序列与刷新前逐条一致（比对数组）。
8. 「轨迹」：`task-trace-heading` 文本含「轨迹」，`task-trace-stats` 事件数 > 0。
9. 零 `pageerror`。

产物：`e2e/artifacts/session-timeline/run.log` + 截图；失败时打印时间线快照 JSON（`data-seq` 列表）。

---

## 9. 执行纪律

1. 后端每改必重启（`scripts\stop.ps1` + `scripts\start.ps1`），重启后先 `curl /openapi.json` 确认端点。
2. 前端改完 `npx tsc --noEmit` 必须干净（编译检查，不是测试）。
3. 不跑 pytest/vitest（用户 2026-10-31 裁定：测试与验证由人做）；E2E 仅在 §T6 显式授权时跑。
4. 提交信息写清"为什么"，多行走 `git commit -F`。

---

## 12. 执行记录（2026-10-31，T1–T6 全部落地）

触发：用户实测「需求对话提示 **还没有可显示的内容**」。后端 `5cc6606`、前端 `24747c2`、
E2E `a4a6521`；派发侧见 [agent-plan-dispatch-prd §11](agent-plan-dispatch-prd-2026-10-31.md)。

| 里程碑 | 落地内容 |
|---|---|
| **T1 回填** | `SessionLog.backfill_messages()` + `is_empty()`；`GET /timeline` 与 `stream_chat` 两处触发（幂等）；简报/规划书各补一条 `report`/`plan`（`ref=legacy:*:<brief_hash>`）；不回填历史 thinking（只有 `turn_ts`，塞进去等于再次"推断位置"）。**实测**：`req_cbdb1fd15d41` 回填 5 条（欢迎+用户+回复+确认卡+简报卡） |
| **T2 空态** | 四支空态（同步中/已迁移 N 条/真无记录/接口不可用+HTTP 码+重试）；`lastError` + `retryTick` 触发订阅重跑；`useSessionTimeline` 不再 `catch {}` 吞错误 |
| **T3 能力对齐** | 忙碌行（`session-busy-row`，仅在无 streaming 条目时出）、思考能力说明（`session-reasoning-note`）、问题条目内联作答（选项/自由文本 → `requirementsApi.answer`，已答状态由服务端 `answer` 条目推出）、后端补写 `answer` 条目（`ref=q:<qid>`）、输入框门控改看"有没有会话"、开场卡只在无会话时出、旧分页按钮只在旧视图渲染、单流视图不再重复出问题卡 |
| **T4 副作用与上限** | `_ensure_loaded` 去掉 mkdir（读接口不再给不存在的会话建空目录）；`GET /timeline?resolve=0` 只给索引；前端每会话 3000 条上限 + 切会话 `reset(prev)` |
| **T5 分流与文档** | 投影把内核 `plan`/`replan` 映射为 `stage`（`meta.kind=execution_plan`），`plan` 类型专属制作规划书；api_reference / services_overview / parity 同步 |
| **T6 E2E** | `e2e/session-timeline.spec.ts`（K:\demo 数据）跑通，2.3 分钟 |

### E2E 结果（真实前后端，两轮一致）

```
刷新前条目序列 [1,2,3,4] → 刷新后 [1,2,3,4]（逐条一致）
用户 seq=2 / 思考 seq=3 / 回复 seq=4   ← 思考夹在提问与回复之间（核心收益）
点「确认简报」→ 5s 内出现 stage+tool+subagent 条目（D3 不再是空等）
最终 37 条 data-seq 严格升序，plan 卡在 seq=37（D1 回填成功）
pageErrors = []
```

### E2E 查出并已修的两个真问题（比跑通更有价值）

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | 实时收到简报条目但**卡片不渲染**，刷新后才出现 | `report`/`plan` 走外置，`append/patch/finish` 帧只发 `to_dict()`（只有 `content_ref`，无 `content`）；只有 REST snapshot 会解析 | `SessionLog._frame_item()`：发布帧带解析后的 content（>64KB 才省略）→ 后端 `12dbb0b` |
| 2 | plan_only 产物已落盘，任务仍判 `degradation_unresolved` → 规划书被回退 | 分镜走了模板兜底（`scenes_fallback`），收据没集齐就判失败 | plan_only 且产物已落盘时跳过降级收据守门（降级条目仍在时间线上可见）→ 后端 `12dbb0b` |

### 与本文的差异

1. **T3.3 问题条目作答的"已答"判定**改用服务端 `answer` 条目（不靠本地状态），
   否则刷新后已答问题又变回可点。
2. **T4 的 3000 上限只截前端窗口**：服务端仍完整，向前翻页可取回；`archived_until_seq` 给边界。
3. **「轨迹」入口在「新增标签」菜单里**（不在主标签栏），派发任务收尾后打开会显示空态——
   属既有行为，本轮不改（要改属于轨迹面板的信息架构，用户明确要它保持专业分区视图）。

### 遗留（不在本 PRD 范围）

- 多进程并发写仍按单进程假设（文件锁未接）。
- 回填只覆盖"会话里还留着"的消息（`compress_history` 之前的已丢），前端已如实标注。
