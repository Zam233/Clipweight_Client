# 刷新后会话记录消失 / 时间轴没有动画轴（2026-11-02 第二轮）

两个问题分别查、分别修，都有实机数据证据。

---

## 一、刷新后"主 agent 调用动画 agent → web_search / web_fetch → 产出动画"的记录消失

### 证据

会话 `req_b250226989f4`（= `proj_1f31ca5cab5b` 的会话）磁盘上是**完整的**：

```
session.json: items=1591
type 分布: tool=1061, stage=259, content=138, subagent=51, thinking=45, artifact=17, ...
```

丢失点在**分页**，不在存储：

```
GET /api/requirements/req_b250226989f4/timeline?limit=500
  旧: items=500  seq=1..500      latest_seq=1591   ← 只给最老一页
```

前端首屏就是这一次请求（`useSessionTimeline`：`timeline(sid, {sinceSeq: 0, limit: 500})`），
所以刷新后看到的是**开局 500 条需求问答**；用户描述的动画阶段（`seq≈1167`：
`animation_agent` 的 `web_search` / `web_fetch` success，以及 `stage=animation` 条目）
全在 500 名开外，于是"刷新就没了"。数据没丢，是首屏取错了窗口。

### 修法

`api/requirements.py::session_timeline`：三个游标（`since_seq/until_seq/before_seq`）都没给时，
取 `before_seq = latest_seq + 1` —— **给最新一页**，`has_more` 正好表示"还有更早的"，
与前端「加载更早」语义一致；带游标的增量/翻页行为不变。

### 验证

```
GET .../timeline?limit=500  →  items=500  seq=1092..1591  has_more=True
  其中 seq=1167 subagent stage=animation
       seq=1170 tool animation_agent web_search success
       seq=1171..1174 tool animation_agent web_fetch success
GET .../timeline?limit=60   →  seq=1532..1591  has_more=True
```

---

## 二、时间轴上没有动画轴

### 证据

动画确实做出来了。任务黑板 sidecar 里的最终时间线是**五轨含动画轨**：

| 任务 | final_timeline |
|---|---|
| `task_55db71fe3a` | 视频43 / 文字22 / 字幕320 / 音频43 / **动画20**（mg 13） |
| `task_be1fb1f17d` | 视频43 / 文字22 / 字幕320 / 音频43 / **动画20** |
| `task_bf811c0df6` | timeline 视频53 / 文字0 / 字幕123 / 音频53 / 画中画1（**无动画**） |

而项目 `proj_1f31ca5cab5b` 上一轮被写进去的正是 **bf811c0df6 的那一份（无动画、无 metadata）**。

### 根因

`services/task_project_sync.project_id_of(task)` 只认 `extra.proceed_project_id` / `project_id`。
续跑/派发任务的 extra 里**没有**项目 id（`task_55db71fe3a` / `be1fb1f17d` / `cbb0a07a72`
的 extra 均无 `proceed_project_id`，因为它们是在我给 chat 补 `project_id` 之前创建的），
于是 `sync_timeline_to_project` 直接返回空串 —— **那一轮跑出的含动画轨的时间线从未写回项目**。

会话↔项目绑定其实应当能兜底，但：

- `session_log.set_project()` 只有私有 `_project_id`，外部读不到；
- 全仓**没有任何地方**调用它（`get_log(sid, project_id=...)` 是唯一入口，而 proceed 路径没传）。

结论：`session.json` 里 `project_id` 一直是空字符串，兜底路径也是断的。

### 修法（三处，缺一不可）

1. `services/session_log.py`：新增公共只读属性 `SessionLog.project_id`（旧实现只有私有字段）。
2. `services/task_project_sync.py::project_id_of`：取值顺序改为
   `proceed_project_id` → `project_id` → **会话绑定的项目**（`extra.session_id` 反查），
   命中兜底时打 info 日志。
3. `api/requirements.py::_proceed_as_task`：带 `project_id` 时 `get_log(sid, project_id=pid)`
   补绑定；`services/requirements_service._continue_as_task`：`project_id` 为空时读会话绑定，
   归一后写进 `extra.proceed_project_id` 并补绑定。

另外 `api/project.py::update_project` 加了一条**只留痕不改行为**的告警：若磁盘上的时间线带
`metadata.agent_sig`（agent 刚写回）而这次 PUT 的片段更少，说明编辑器自动保存可能覆盖了
agent 的结果——日志里会明确写"agent N 片段 → 客户端 M 片段"。

### 数据修复（已完成，可回滚）

用 `task_be1fb1f17d`（最新一条含动画的终态任务）的黑板时间线写回项目，并打上
`metadata.source=task:task_be1fb1f17d` + `agent_sig`：

```
旧: 视频53 / 文字0 / 字幕123 / 音频53 / 画中画1        （备份见下）
新: 视频43 / 文字22 / 字幕320 / 音频43 / 动画轨20
```

- 备份文件：`projects/proj_1f31ca5cab5b/timeline.backup-<时间戳>.json`（原封不动）
- 同时补上会话↔项目绑定：`req_b250226989f4 → proj_1f31ca5cab5b`

### 验证

```
GET /api/project/proj_1f31ca5cab5b
  视频轨43 / 文字轨22 / 字幕轨320 / 音频轨43 / 动画轨20
  metadata: {"source":"task:task_be1fb1f17d","agent_sig":"125ee1e6…","restored_at":"…"}
重启后端后再查：动画轨=20（持久化正常）
```

---

## 遗留风险（下次该盯的）

1. **编辑器自动保存 vs agent 回写**：现在只是告警。真正的解法是给时间线加"谁最后写的"
   语义（`metadata.source` + 客户端脏标记），或者让 agent 写入后主动通知编辑器 reload
   （已有 `artifact(kind=timeline)` 事件 + 4s 轮询，但客户端若在 reload 前 autosave 仍会覆盖）。
2. **会话分页语义**：修好后首屏是"最新一页"，但更早的记录要点「加载更早」逐页取；
   如果用户期望一次看到全部，需要前端把 `limit` 提到几千或做虚拟滚动。
3. 已有会话的历史时间线不会自动重写——只有**修复脚本**处理过的这个项目补上了动画轨；
   其他项目若也有同类丢失，需要按同一脚本（黑板 sidecar → `_manager.save`）逐个修。
