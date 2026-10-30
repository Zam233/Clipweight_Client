# 会话时间线重构 PRD（session.json 单一真相）

> 2026-10-31 · 触发：需求面板连续暴露顺序错乱类缺陷（思考沉底、简报卡错位、刷新后混乱），
> 根因是**位置靠客户端推断 + 多源合并**。本 PRD 把"会话时间线"从一个前端拼装物
> 改成**服务端一份有序日志**，前端只渲染它。

---

## 0. 结论先行：方案对，但必须补五条

用户的方案（会话启动即在工作区建 `session.json`，item = 类型/时间/内容，thinking 与 content 流式渲染后落盘，其余直接存）方向正确，能一次性消灭当前反复出现的顺序类缺陷。但**只靠"时间"不够**，需要补：

| # | 必须补的 | 为什么 |
|---|---|---|
| 1 | **`seq` 由服务端单调分配**，时间是展示字段 | 同一毫秒多条、时钟漂移、客户端时钟不可信；排序键必须唯一且单调 |
| 2 | **流式条目"先占位、后填充"**（同一 seq upsert） | 否则流式一条 + 落盘一条 = 重复；且前端要能按 seq 把流式块落回原位 |
| 3 | **写盘节流 + 原子替换** | 逐帧写 json 会 IO 爆炸；写入中断会留下半个文件 |
| 4 | **大 payload 外置**（thinking 正文、report/plan、tool 结果） | 单文件无限增长会让读写与恢复都变慢 |
| 5 | **上限与 compaction** | 长会话（几十万字思考）必须有 spill 与压缩策略，不能假装无限 |

另外，`report`（创意简报）与 `plan`（规划书）建议不要只存"内容"，还要存**结构化引用**（path + hash），
否则前端拿到的是不可渲染的大字符串，且无法判断"这份规划书是不是当前 brief 的产物"。

---

## 1. 现状为什么"混乱"（四个真实踩过的坑）

| 坑 | 现象 | 根因 |
|---|---|---|
| ① 消息下标 × 事件 seq 混域 | 思考永远排在所有消息之后 | 两套序号当同一把尺子用 |
| ② merge 覆盖排序键 | 整条流反向/乱序（最新在最上） | patch 把 `order` 当内容字段覆盖 |
| ③ 晚到事件替换条目 | 思考被搬到对话最末 | 用"到达顺序"当位置 |
| ④ 多源合并 | 刷新后位置全变 | 需求消息（浏览器 ts）+ 任务事件（服务端 seq）+ 前端派发序号 三源混排 |

**共同点**：位置在客户端"推断"。只要位置是推断出来的，就会在任何一次异步时序变化时错乱。
所以修法不是再修一次排序函数，而是**让服务端给出唯一、有序、可恢复的流**。

---

## 2. 目标架构

```
会话（session）启动
   └─ 工作区：workspaces/<project>/sessions/<session_id>/
        ├─ session.json          # 索引：有序 item 列表（轻量字段）
        ├─ items/<seq>.json      # 大 payload（thinking 全文、report、plan、tool 结果）
        └─ session.jsonl         # append-only 写入日志（崩溃恢复用）

写入方（唯一入口 SessionLog.append/upsert）：
   需求对话（thinking 流式 / content 流式 / ask_user 问答）
   主 agent 任务（task 事件投影：tool / subagent / skill / report / plan）

读取方：
   GET /api/requirements/{sid}/timeline?since_seq=&limit=     # 刷新/分页
   GET /api/requirements/{sid}/timeline/stream                # 实时（SSE，按 seq 递增）
```

**核心不变量**：
1. 一个会话只有**一条**有序流；前端不再合并任何第二数据源。
2. `seq` 单调递增、唯一、由服务端在**首次创建条目时**分配（流式条目在首帧分配）。
3. 条目一旦创建，`seq` 与 `time` 永不改写；后续只允许填充 `content`/`state`。
4. 排序永远按 `seq`；`time` 只用于展示与跨会话对账。

---

## 3. 数据结构

### 3.1 item（session.json 中的一条）

```json
{
  "seq": 42,
  "type": "thinking",
  "time": "2026-10-31T22:14:03.412+08:00",
  "turn": 3,
  "state": "done",
  "source": "requirements",
  "ref": null,
  "content_ref": "items/42.json",
  "content_inline": null,
  "meta": { "chars": 1760, "streaming": false }
}
```

| 字段 | 说明 |
|---|---|
| `seq` | 服务端分配，单调；**唯一排序键** |
| `type` | `thinking` / `content` / `tool` / `skill` / `subagent` / `report` / `plan`（见 3.2） |
| `time` | 发生时刻（ISO8601，带时区）；展示用 |
| `turn` | 第几轮对话（同一轮的 thinking/content 归组，便于折叠与定位） |
| `state` | `streaming` / `done` / `failed` / `interrupted` |
| `source` | `requirements` / `task` / `system`（谁产生的） |
| `ref` | 关联标识：task 事件 `evt:<task_id>:<seq>`、run `run:<run_id>`、question `q:<id>` |
| `content_ref` / `content_inline` | 二者取一：大内容外置，小内容内联（阈值默认 8KB） |
| `meta` | 类型相关补充（工具名/状态/耗时、报告标题、规划书 hash 等） |

### 3.2 类型与内容契约

| type | content | 是否流式 | 外置 |
|---|---|---|---|
| `thinking` | 模型思考全文 | **是**（逐块追加） | 是（可能几十万字） |
| `content` | 正文（助手回复） | **是** | 是（超阈值） |
| `tool` | `{tool, args_brief, status, duration_ms, error}` | 否（先 running 后 done，同一 seq upsert） | 否 |
| `skill` | `{skill, status, duration_ms}` | 否 | 否 |
| `subagent` | `{agent, run_id, stage, status, summary}` | 否 | 否 |
| `report` | `{title, overview, ...结构化 brief}` | 否 | 是 |
| `plan` | `{markdown_ref, brief_hash, scene_count, duration_sec}` | 否 | 是 |

`report` / `plan` 的 `content_ref` 指向独立 JSON 文件，`session.json` 只留索引与 hash——
这样"这份规划书对应哪版 brief"可判定，不需要把整份规划书塞进时间线。

### 3.3 session.json 顶层

```json
{
  "version": 1,
  "session_id": "req_xxx",
  "project_id": "proj_xxx",
  "created_at": "...",
  "updated_at": "...",
  "next_seq": 128,
  "items": [ /* 3.1 的轻量条目，按 seq 升序 */ ],
  "counters": { "thinking": 12, "content": 9, "tool": 31, "skill": 2, "subagent": 4, "report": 1, "plan": 1 }
}
```

---

## 4. 写入协议

### 4.1 单一写入口

```python
class SessionLog:
    def append(self, *, type, content, source="requirements", turn=None,
               ref=None, state="done", meta=None) -> Item      # 直接条目
    def begin(self, *, type, source, turn=None, meta=None) -> Item  # 流式占位（state=streaming）
    def chunk(self, seq: int, delta: str) -> None                   # 追加流式增量（内存）
    def finish(self, seq: int, content: str | None = None,
               state="done", meta=None) -> None                     # 收尾并落盘
    def patch(self, seq: int, **fields) -> None                     # 同 seq 更新（tool running→done）
```

纪律：
- `append` / `begin` 是**唯一**新增条目的方式，`seq` 在内部原子分配（per-session 锁 + `next_seq`）。
- `chunk` 只改内存缓冲；`finish` 与"节流 flush"才真正写盘（见 4.2）。
- `patch` 不改 `seq` / `time` / `type` / `turn`（不可变字段白名单）。

### 4.2 流式落盘策略

- **节流**：每 200ms 或累计 4KB 触发一次 flush；`finish` 强制 flush。
- **先占位**：`begin` 立刻在 `session.jsonl` 记一条 `{op:"begin", seq, type, time, turn}`，
  前端首帧就拿到 seq，把流式块落到正确位置。
- **原子写**：`session.json` 用 `session.json.tmp` + `os.replace`；`session.jsonl` 用 append（O_APPEND）。
- **崩溃恢复**：进程启动扫描 `session.jsonl` 里 `begin` 无 `finish` 的条目 → 标 `state="interrupted"`，
  内容取最后一次 flush 的快照；**不丢、不假装完成**。

### 4.3 上限与 compaction

- `session.json` 只放轻量条目（目标 ≤ 2MB）；大内容一律 `content_ref`。
- 超过 `MAX_ITEMS`（默认 5000）时：把最老的 N 条归档到 `archive/part-<n>.jsonl`，
  `session.json` 保留索引区间（`archived_until_seq`），前端分页按需拉。
- `thinking` 单条超过 40 万字：截断并写 `meta.truncated=true`（**明确标注**，不静默丢）。

### 4.4 并发

- per-session `asyncio.Lock` 保护 `next_seq` 与文件写。
- task 事件投影由内核侧调用 `SessionLog.append`（同一入口，天然串行）。
- 跨进程（多 worker）场景：以文件锁（`msvcrt.locking` / `fcntl.flock`）兜底；
  本期假设单进程（与现有 workspace 写入一致），在 PRD 风险节记录。

---

## 5. 读取协议

### 5.1 拉取（刷新/分页）

```
GET /api/requirements/{sid}/timeline?since_seq=0&limit=200
→ { items: [...], has_more, latest_seq, archived_until_seq }
```

前端**按 `seq` 升序渲染**，不需要任何本地排序或时间比较。

### 5.2 实时（SSE）

```
GET /api/requirements/{sid}/timeline/stream?since_seq=<latest>
→ SSE 帧：{op:"append"|"chunk"|"patch"|"finish", item|seq|delta}
```

- 首帧带 `since_seq` 之后的所有条目（补齐断线窗口）。
- `chunk` 帧只带 `seq + delta`，前端按 seq 找到条目追加——**这就是流式渲染**。
- 心跳每 10s（已有机制复用），前端忽略。

### 5.3 与现有接口的关系

| 现有 | 处置 |
|---|---|
| `GET /{sid}/messages`、`/{sid}/events` | 保留为兼容读；S4 之后前端不再使用 |
| `chat/stream`（`delta`/`reasoning`/`stage` 帧） | 保留为**写入触发**；同时写 session log（双写期） |
| `GET /api/task/{id}/events` | task 侧仍是执行源；**投影**进 session log（source=task, ref=事件） |

---

## 6. 前端改造

1. **单一数据源**：`sessionTimelineStore` 只吃 `{op, item, delta}`，`itemsByKey` 按 `seq` 排序渲染。
2. **删除启发式**：`dispatch` 序号、`Date.parse` 比较、`req:live:*` 临时条目、`_merge` 的 ordinal 逻辑全部下线。
3. **流式渲染**：收到 `begin` 建条目（state=streaming，默认展开）；`chunk` 追加到该 seq；`finish` 收尾。
4. **刷新**：先 `timeline?since_seq=0` 拉全量（分页），再订阅 `timeline/stream?since_seq=latest`；
   断线重连按 `since_seq` 补齐（不需要 `seqGap` 推断，服务端给 `has_more`/`archived_until_seq`）。
5. **消息气泡**：`content` 与 `thinking` 仍走现有渲染组件（Markdown / 折叠），但数据来自 item。
6. **「轨迹」面板**：读同一份 item 的原始 `ref`（事件），不再单独订阅 task SSE。

---

## 7. 里程碑与验收

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **S1 存储与 API** | `SessionLog`（append/begin/chunk/finish/patch）、`session.json` + `jsonl` + `items/`、原子写与恢复、`GET timeline`、`GET timeline/stream` | 单测：seq 单调唯一、并发 append 不抢号、流式 upsert 只产生一条、崩溃后 `interrupted`、compaction、40 万字截断标注 |
| **S2 写入接线（双写）** | 需求对话的 thinking/content 走 `begin/chunk/finish`；tool/skill/subagent 由 chat 与 task 事件投影 append；report/plan 落盘 + 引用 | 单测：一轮完整对话产生的 item 序列与预期完全一致（type 顺序、turn 归组） |
| **S3 前端切读** | `sessionTimelineStore` + 渲染改造 + 刷新恢复；旧 `unifiedTimelineStore` 只保留只读兼容 | vitest：乱序 SSE 帧最终仍按 seq 渲染；刷新后顺序与刷新前逐条一致（快照比对） |
| **S4 清理** | 删除 `dispatch`/时间戳启发式、`req:live` 临时条目、前端合并逻辑；「轨迹」改读同一份 item | 全局搜索无 `dispatch` 排序、无 `Date.parse` 比较；回归全绿 |
| **S5 收口** | 两份旧 PRD 执行记录追加；人工 E2E（新建会话 → 多轮 → 刷新 → 轨迹） | 人工确认清单逐条打勾 |

---

## 8. 风险与反模式

| 风险 | 影响 | 缓解 |
|---|---|---|
| 逐帧写盘 | IO 打满、界面卡顿 | 节流 200ms/4KB + 结束强制 flush |
| 单文件膨胀 | 读写变慢、恢复变难 | 大内容外置 + `MAX_ITEMS` 归档 + 单条截断标注 |
| 多进程并发写 | seq 冲突、文件损坏 | 本期单进程假设 + 文件锁兜底；写入路径集中到一个类 |
| 双写期两套数据不一致 | 前端看到两份 | S2 双写、S3 切读、S4 删除旧路；切换用 flag |
| 崩溃留下半条流式 | 顺序断/内容缺 | `interrupted` 状态 + 最后 flush 快照，明确标注 |
| 迁移期 task 事件重复投影 | 时间线重复 | 投影幂等键 `ref`（`evt:<task>:<seq>`），重复 append 视为 patch |

**反模式**：① 前端继续"推断位置"；② 流式与落盘各建一条；③ 把 report/plan 全文塞进 `session.json`；
④ 让前端负责合并 task 事件与 chat 帧。

---

## 9. 三个待拍板点的执行口径（已按推荐落地）

用户 2026-10-31 授权「按你推荐的来」，三个点定案如下，实现与本文一致：

| # | 决定 | 理由 |
|---|---|---|
| 1 | 会话目录 = `workspace_root()/sessions/<session_id>/` | 会话在**项目存在之前**就创建（新建制作第一步就开需求会话），按 `<project>/sessions/` 分目录在创建时刻没有 project 可挂；放到工作区根下既与项目目录同根，又能跨项目排查 |
| 2 | `subagent` **逐次调用**各记一条（带 run_id/阶段/结论摘要） | 一次阶段派发的多个子 agent 是不同事件，合成一条会让"谁干了什么"不可追溯 |
| 3 | 节流 200ms / 4KB；归档阈值 5000 条（保留 4000） | 与 PRD §4.2/§4.3 原值一致 |

补充两条实现细节（写代码时才暴露的）：

- **思考增量不能逐条落盘**：任务侧 `thinking` 是 token 级增量（一次调用数百条），
  投影必须**按轮合并**走 `begin/chunk/finish`，否则每条重写全文是 O(n²) 写盘。
- **`state` 只有四值**（`streaming/done/failed/interrupted`）：事件的 `status` 是
  业务字段，放 `meta.status`；不要为"running"再发明一个条目状态。

---

## 10. 与既有 PRD 的关系

| PRD | 关系 |
|---|---|
| `agent-unified-stream-prd-2026-10-30.md` | 单流形态与思考可见性的**展示层**约定；本 PRD 把它依赖的数据源换成服务端唯一日志 |
| `agent-plan-dispatch-prd-2026-10-31.md` | 规划书改由主 agent 派发；其产生的 `thinking`/`subagent`/`plan` 条目直接写进本 PRD 的 session log（正好解决"回放锚点"问题） |

实施顺序建议：**本 PRD 的 S1/S2 先做**（存储与写入），再叠加 plan-dispatch（D1–D4），
否则派发链路又要复用一套客户端拼装逻辑。
