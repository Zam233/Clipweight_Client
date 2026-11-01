# 中止后「主 agent 不再启动」的根因与上下文审计（2026-10-31）

用户报：**任务中止后，在需求对话里再输提示词点发送，主 agent 不会继续启动。**
同时问：主 agent 到底能不能读到「工具调用 / skill / 子 agent」这些上下文。

---

## 一、为什么不会继续启动

### 1. 四条状态分支里，没有任何一条会建任务

`requirements_service._chat_router` 按会话 `status` 路由，但**只有 `/proceed` 会建任务**：

| 会话状态 | 旧行为 | 结果 |
|---|---|---|
| `pipeline_running` | 只回一句「管线正在运行中，请稍候」 | 任务早就中止了也照回套话 |
| `pipeline_done` | 只回模板文案；只有说「重新生成」才回到 `plan_ready` | 主 agent 不启动 |
| `plan_ready` | 当成"规划书修订意见"，跑一次 LLM 改文案 | 主 agent 不启动 |
| `brief_confirmed` | 只提示"正在生成规划书" | 无动作 |

### 2. 会话根本没被释放（数据证据）

`_release_session_after_task` 会在任务终态时把会话拉回 `plan_ready` 并写一条
`metadata.task_released` 的说明。实测库里：

- `status = pipeline_running` 的会话 **34 个**；
- 带 `task_released` 标记的会话 **0 个**。

也就是说这条释放路径**从未真正生效**。两个原因：

1. `watch_task_session` 只在派发任务的进程里活着。后端一重启 `_TASKS` 就空了，
   循环里 `task is None → continue` 会**空转到 1 小时**，永不释放。
2. 前端在 `pipeline_running` 下把输入区藏起来，用户唯一的出路是刷新页面。

于是「中止 → 再说一句 → 继续干」这条最自然的操作整条不存在。

### 3. 修法（本轮已落地）

1. **续跑通道**：`_maybe_continue_as_task` + `_continue_as_task`。
   只要会话**跑过任务**（有 `task_released` 标记）且当前**没有活着的任务**，
   用户这句话就当成新任务目标，重新拉起主 agent：
   - `pipeline_done` → 直接续跑；
   - `plan_ready`（已中止过）→ 续跑（没跑过的仍然走"规划书修订"，保留原闭环）；
   - `pipeline_running` 但绑定任务已终态/不存在 → 先按释放处理，再续跑；
   - 没有规划书但有简报（中止在"生成规划书"阶段）→ 重派规划任务。
   - 「确认」「重新生成」这类短指令不抢分支（零 LLM 调用的启发式判定）。
2. **释放兜底**：`watch_task_session` 连续 5 次取不到任务即认定任务丢失 →
   `_release_session_missing_task` 把会话放回 `plan_ready`。
3. **存量修复**：`release_stale_pipeline_sessions()`（随清理任务周期执行）把
   "状态还在运行中、绑定任务却已不在"的会话一次性放开。本轮实跑：**34 → 0**。
4. **前端**：chat 请求带上 `project_id`（续跑要靠它定位原工作区、成片写回当前项目）；
   返回体里的 `task_id` 会立即装进 task store，「轨迹」标签跟着切到新任务。

---

## 二、上下文审计：主 agent 现在能读到什么

### 单任务内部（本来就是通的）

- 一次 `LLMService.with_tools` 内，工具调用与结果以 **tool 消息**回灌给模型（最多 12 轮）；
- 跨内核轮（续跑/返工）靠 `task.context_digest`（结构化事实，上限 24 条）；
- 子 agent 的产出通过 `reports/*.md`、黑板（`task_blackboard`）、`agent_run` 摘要暴露；
- skill 与工具一样走 surface，调用结果同样回灌。

### 跨任务 / 跨轮（原先是断的，本轮补上）

`context_loader.load()` 原来只装：`docs/brief.md`、`docs/plan.md` 场景表、文案 artifact、
已有产物、记忆召回、最近报告、上一步失败。**没有会话对话，也没有上一轮的工具/子 agent 轨迹**
—— 中止后续跑等于让主 agent 从零摸索。现在新增三段（按优先级）：

| 段 | 内容 | 来源 |
|---|---|---|
| `## 本轮用户指令（最高优先级）` | 用户这句话 + "这是续跑、接着做完"的提示 | `extra["user_instruction"]` |
| `## 会话对话（最近，越靠后越新）` | 最近 12 条用户/主 agent 明文（事件 detail 噪声被过滤） | `session_log.tail(260)` |
| `## 上一轮执行轨迹` | 工具/技能/子 agent/阶段/降级/汇报（连续重复行去重） | 同上（`session_projection` 投影的任务事件） |

`context_loaded` 事件会多出 `session_timeline` 来源，带 `tools / subagents / stages` 计数，
"模型看到了什么"可审计。

---

## 三、验证

- `python -m py_compile` + `import clipwright.services.requirements_service` 通过；
- 续跑路由（用 stub 替换建任务，避免真花钱）实测：

  | 场景 | 结果 |
  |---|---|
  | 已中止 · `plan_ready` | 续跑 |
  | 已中止 · `pipeline_running`（悬空） | 续跑 |
  | 已完成 · `pipeline_done` | 续跑 |
  | 从没跑过 · `plan_ready` / `gathering` | 走原分支 |
  | 「确认」 | 走原分支 |

- 上下文装载（真实会话数据）实测：输出含本轮指令 + 会话对话 + 上一轮轨迹，
  轨迹里能看到 `[tool@edit_agent] video_trim error（trim output invalid…）`
  这类子 agent 明细；
- 存量会话：`pipeline_running 34 → 0`，34 个会话补上了 `task_released` 标记；
- `npx tsc --noEmit` 干净。

**未验证（需要真实点一次）**：中止 → 输一句 → 发送 → 新任务起来并跑通。
这条会真调用模型并发任务，留给人工确认。

---

## 四、时间轴实时同步：原来「只刷新一次」

用户追问「agent 生成完时间线，能实时显示在时间轴上吗」。查下来是**半个 bug**：

- 后端确实在每派完一个阶段就 sync_timeline_to_project(incremental=True) 写回；
- 但它的"保护用户编辑"判据是 metadata.source == f"task:{task_id}" ——
  **从来没有人写过这个标记**（全仓只有判据、没有赋值）。后果：项目第一次回写后
  就有轨道了，之后每次中间回写都命中"项目已有用户时间线"被跳过 →
  **时间轴只在第一次更新，直到任务结束才再动一次**。续跑任务更严重（项目里本来就有轨道）。

修法（services/task_project_sync.py）：判据改成**内容指纹**

- 写入时打标：metadata.source = f"task:{task_id}" + metadata.agent_sig = sha256(tracks)；
- 中间回写前比对该指纹：与项目里当前 tracks 一致 → 最后动它的是 agent → 可以继续覆盖；
  不一致 → 用户改过 → 跳过（保护编辑）；
- save() 会走一次 schema 归一化，指纹以**落盘后重新读出的内容**为准，否则下次比对必然失败。

实测（临时项目，不碰用户项目）：

| 步骤 | 结果 |
|---|---|
| 第 1 次增量回写（2 片段） | 写入 |
| 第 2 次增量回写（5 片段） | **写入**（旧实现这里会被跳过） |
| 用户在编辑器改过后再增量（9 片段） | 跳过（轨道名保持"用户改过的轨"） |
| 任务收尾全量回写 | 覆盖（9 片段） |

前端同时补了两条路（pages/EditorPage.tsx）：

1. **事件驱动**：收到任务事件 rtifact（detail.kind === "timeline"）立刻拉项目刷新，
   不再等 4 秒；seq 去重、提示 1.5s 节流。
2. **轮询兜底**：除了 	askStore 里的任务在跑，equirementsStatus === 'pipeline_running'
   也会启动 4s 轮询（以前任务没进 store 时轮询根本不启动）。
   两条路都只在"轨道数 / 片段数变化"时套用，避免冲掉用户正在拖的片段。