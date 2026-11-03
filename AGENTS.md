# Clipwright / 帧艺 — AI Agent 项目地图

## 快速入口

| 用途 | 文件 |
|------|------|
| 项目总览 | [README.md](README.md) |
| 架构设计 | [docs/structure.md](docs/structure.md) |
| Agent 工作流 | [docs/workflow.md](docs/workflow.md) |
| API 参考 | [docs/api_reference.md](docs/api_reference.md) |
| 开发指南 | [docs/development.md](docs/development.md) |
| 修复与功能补全计划 | [docs/fix-and-feature-plan.md](docs/fix-and-feature-plan.md)（§10 执行进度） |
| **全量缺陷审计与派工计划（2026-09-10）** | [docs/audit-fix-plan-2026-09-10.md](docs/audit-fix-plan-2026-09-10.md)（P0×5 / P1×37 / P2×54 / P3×15 + 待验证×11，含证据与验收标准） |
| **插件化开发方案（2026-09-10）** | [docs/pluginization-plan-2026-09-10.md](docs/pluginization-plan-2026-09-10.md)（统一贡献契约 + Provider 化 + 前端 Slot 化，含契约骨架与里程碑） |
| 前后端对账 | [docs/frontend-backend-parity.md](docs/frontend-backend-parity.md) |
| 项目上下文 | [CLAUDE.md](CLAUDE.md) |

## 一键启动

```powershell
scripts\start.ps1        # 检查依赖 → 启动 MongoDB → 后端(8080) → 前端(5173)
scripts\stop.ps1         # 停止全部
```

- 后端：`uvicorn clipwright.main:app --port 8080`（`CLIPWRIGHT_PORT=8080`，见 `.env.example`）
- 前端：独立仓库 `J:\Clipweight-Client`（`npm run dev`，vite 5173；`/api` 代理 → 8080，`/srv` 代理 → 账号服务 8090）
- 账号/市场服务：`K:\Clipwright Server` 独立仓库，端口 8090 —— `scripts\start.ps1` 会自动拉起（首次自动生成 `.env` 与随机 JWT secret；目录可用 `$env:CLIPWRIGHT_SERVER_DIR` 覆盖，端口用 `$env:CLIPWRIGHT_SERVER_PORT`）

## 项目结构（monorepo）

```
J:\Clipwright
├── clipwright/       # 后端（Python FastAPI）
│   ├── agents/       # 7 个 Agent（需求→结构→素材→剪辑→动画→音频→质检）
│   ├── api/          # 33 个 API 路由文件
│   ├── services/     # 30+ 后端服务
│   ├── tool/         # 44+ 原子能力工具
│   ├── skill/        # 4 个可组合技能
│   ├── animation/    # 动画系统（37+ 动画编目）
│   ├── category/     # 4 个内置类型插件
│   ├── plugins/      # 第三方插件系统（签名/权限/依赖/启停/错误通道/配置迁移）
│   ├── schema/       # 11+ 数据模型
│   ├── rag/          # RAG 知识库
│   └── persona/      # Persona 配置系统
├── plugins/          # 内置第三方插件目录（diagram_style 等）
├── docs/             # 20+ 文档
└── scripts/          # start/stop/check_env 一键启动脚本
```

## 核心不变量

1. **7 个 Agent**：RequirementsAgent → StructureAgent → MaterialAgent → EditAgent → AnimationAgent → AudioAgent → QualityAgent
2. **44+ 个 Tool**：原子能力层，通过 ToolRegistry 注册
3. **4 个 Skill**：可组合的高级能力，通过 SkillRegistry 注册
4. **33 个 API 路由组**：每个路由文件对应一组端点（225 条路由）
5. **30+ 个 Service**：业务逻辑层
6. **11+ 个 Schema**：Pydantic v2 数据模型
7. **4 个内置 Category Plugin**：知识区长片、鬼畜快剪、数码评测、Vlog 日常
8. **五层架构**：原子能力层 → Agent 编排层 → 类型插件层 → Persona 配置层 → 用户接口层
9. **Persona 配置不直接调用原子能力**：必须经过类型插件层翻译
10. **实时链路为 SSE-only**：pipeline trace / requirements chat / render queue 流；WebSocket 已移除
11. **Agent 不写死工具名**：业务 Agent 通过**语义能力名**（`frame_check` / `video_trim` / `pv_audit` …）经
    `clipwright/tool/capabilities.py` 在调用时刻解析到具体工具；插件给工具声明 `capability` 即可接管，
    装卸/配置变化下一次调用立即生效。
12. **工具自声明权限档位（2026-10-31 迁移完成）**：每个 Tool 类自己写 `capability` / `capability_priority` /
    `permission_tier`（`read|write_local|costly|dangerous`）/ `dry_run_capable`；引擎侧
    `capability_matrix.TIER_MAP` 已清空并**必须保持为空**（有值即为写死的旧接线）。能力缺失时
    `call_tool` 返回 `ToolStatus.NOT_FOUND`，不抛异常。
13. **渲染边界必须收口**：凡是显示**模型输出 / 接口响应 / 事件 `detail`** 的字段，不得直接 `{field}`，
    一律过 `src/lib/render.ts` 的 `asText`（列表用 `textList`）。TS 只保证声明，保证不了运行时形状 ——
    已经因为 `{"name": …}` 当子节点抛出 `Objects are not valid as a React child` 把整页打崩过一次。
14. **会话状态只由任务终态驱动，且必须有兜底**：任务 `done` → `pipeline_done`，其它终态 → `plan_ready`。
    任务不在内存（重启/被淘汰）时**不许空等** —— `watch_task_session` 连续 5 次取不到即释放，
    另有 `release_stale_pipeline_sessions()` 周期扫存量（实测一次放开 34 个卡死会话）。中止后用户再说一句，
    `_continue_as_task` 重新拉起主 agent，并把「本轮指令 / 会话对话 / 上一轮工具·技能·子 agent 轨迹」
    装进新任务上下文（见 [docs/agent-continuation-and-context-2026-10-31.md](docs/agent-continuation-and-context-2026-10-31.md)）。
15. **任务数据源按 taskId 原子切换**：`taskStore` 的 `activeTaskId` 先于 `task` 生效；切任务必须同批清空
    `events/lastSeq/oldestLoadedSeq/seqGap/runEvents`，异步水合与翻页按「taskId + 代际」丢弃过期响应。
    `seq` 只在单个任务内单调，**禁止跨任务比较**。`/proceed` 拿到新 Task 后必须 `load(taskId)`，
    否则轨迹/暂停取消/子 Agent 列表仍会指向上一轮 `plan_only` 任务。
16. **run 身份与归属分离**：`idem_key` 只负责结果复用；每次真实执行（含显式重放、降级重跑）都必须有
    独立的 `run_id` 与递增 `attempt`。所有 run 详情/追问/重放入口必须校验 `run.task_id === task_id`，
    任务 owner 校验不能替代 run 归属校验。
17. **SSE 生命周期必须收敛**：一个 task 只维护一条共享流（引用计数与 handle 同记录），最后一个订阅者
    卸载才关闭；收到 `task_end` 主动 close，终态任务不再建流；恢复先 REST 水合、再带 `since_seq` 接流。
    `task_end.detail` 必须带 `completed/unfinished`，前端缺省时保留已有 `finish`，不得用空数组覆盖。

18. **阶段输入：相对路径与 artifact 引用都是一等公民**（2026-11-02）：工具收到的相对路径按
    **任务工作区根**解析（`read_file` / `list_dir` / `write_file` / `read_artifact` 都接受
    `workspace_root` / `project_id`），`ToolRegistry` 的通用校验只拦绝对路径；
    `stage_inputs.resolve_refs()` 在装配前把 `{artifact|path}` 引用换成真实内容（否则
    `EditInput.candidate_clips: list` 会抛 `ValidationError`，edit 永远起不来）。**续跑任务必须先
    `seed_blackboard(prev, new)`** 继承上一轮黑板（script_skeleton / candidate_clips / timeline…），
    否则新任务黑板是空的 → 「阶段 edit 缺输入」。缺键回报必须**每个字段一条 needs**，不能拼成一个字符串。
    详见 [docs/agent-stage-input-and-template-fixes-2026-11-02.md](docs/agent-stage-input-and-template-fixes-2026-11-02.md)。

19. **判断交给模型、能力交给插件，都不许写死在 agent 里**（2026-11-02）：
    - **判断**：「这场要不要联网找事实」交给模型——能力 `fact_need`（插件 `web_media` 提供，
      一次批量调用；`animation_fact_judge=llm|heuristic|off`）。正则只能作为 offline 回退实现，
      且必须收在插件里，不得散布到 agent。
    - **能力**：抓网页 / 解析 HTML / 抽图 / 落盘素材 / 事实判断都属于**插件**（`plugins/web_media/`：
      工具 `web_images`、`fact_need`；纯函数落在插件内部 `html_images.py`），**不要**沉到
      `clipwright/services` 或内置工具里。agent 只允许 `call_tool("<能力名>")`；
      **禁止**在工具不可用时直连 `WebSearchService` / `WebFetchService` 当后门。
      能力缺失是一等状态（如实跳过 + 日志），不是异常分支。
    - 注意：解析能力前必须已完成 `settings_store.apply_all(settings)`（启动顺序），
      否则 `enable_web_search` 等覆盖还没生效，`resolve()` 会给出与实际执行不一致的结果。
    详见 [docs/animation-capability-migration-2026-11-02.md](docs/animation-capability-migration-2026-11-02.md)。

20. **「停止」必须由后端真中止并留痕**（2026-11-02）：任务运行期前端隐藏 composer，用户唯一
    的中止手段是运行条上的停止按钮 → `POST /api/requirements/{session_id}/stop`。后端
    `RequirementsService.stop_task()` 一次做三件事：`kernel.cancel()` **打断协程**（只改状态会让
    阶段跑满墙钟）、会话回 `plan_ready`（前端据此把编辑框/附件/发送原样恢复）、消息流与时间线
    各写一条 `metadata.user_stopped=true` 的说明（`context_loader` 带进下一轮上下文，主 agent
    才知道是**用户主动喊停**而不是异常终止）。**没有活任务时必须 `stopped=false` 且不伪造说明**。
    与 `watch_task_session` 的分工：后者管"任务自己结束"，前者管"人要它结束"，只有前者写
    `user_stopped`。详见 [docs/agent-stop-control-2026-11-02.md](docs/agent-stop-control-2026-11-02.md)。

21. **终止机制：软着陆 → 收口 → capped，判定单点、原因编码**（2026-11-02 用户裁定，devplan 已全部落地）：
    - **撞上限 ≠ 收尾**。`agent_kernel._gate_hit` 撞到结构上限（`Goal.max_rounds`=600 / 4000 次调用）、
      显式预算、金额耗尽、连续 6 次无进展时，先 `_enter_closeout()` 进**收口模式**：工具面按
      `permission_tier` 收成只读（71→25 个，`build_tools(closeout=True)`），系统提示词换成
      `_CLOSEOUT_BLOCK`（到上限不是停止交付的理由、不许声称未验证的事已完成），收口窗口独立
      （8 轮 / 128 次收尾调用 / 600s）。
    - **capped 是第三类终态**：`TaskStatus='capped'`，既不算 done 也不算 failed；会话映射
      `plan_ready`（只有 done 才 `pipeline_done`），`evaluation` 把它从成功率分子/分母里排除并单列
      `capped_count`。旧 `finish.reason` 字符串继续产出（暂不停用），新代码只读 `terminal_reason`。
    - **清单必须有内容**：`_write_closeout_report()` 落 `reports/agent-closeout.json`，模型收口失败时
      由 `_closeout_evidence()` 从黑板/台账**确定性**生成 `completed/unfinished`，不许空数组。
    - **质量预算托管（escrow）**：`budget_usd` 非空时任务创建即冻结 `20% / floor 0.05 / cap 2.00`
      （且不超总额一半），主 agent 金额闸只看 `budget - reserve`；质量阶段派发是收口期**唯一**被
      放行的付费通道，余额用尽即收回；结算只在 `_on_tool_call` 一处发生，`usage.cost_usd` 仍是账单
      总和（主 + 质量），绝不双计。`budget_usd=null` 时 escrow 恒 `disabled`，不凭空造上限。
    - **目标语义**：`Goal` 携带完成标准、轮次、blocker 指纹；同一 blocker 连续 3 轮才允许 `blocked`
      且必须写 `blocked_reason`；续跑任务通过 `previous_terminal_reason / blocker_code / closeout_status`
      继承上一轮为什么结束（`context_loader._instruction_digest`）。
    详见 [docs/agent-termination-devplan-2026-11-02.md](docs/agent-termination-devplan-2026-11-02.md)
    与 [docs/agent-termination-prd-2026-11-02.md](docs/agent-termination-prd-2026-11-02.md) §15。

22. **预览是「连续解码 + 单一时钟 + 统一合成」，动画只消费结构化 spec**（预览 devplan 2026-11-02 全部落地）：
    - **播放头时钟**：`PreviewPanel` 用**绝对时间锚点**（起播打 `(墙钟, 时间线, 速度)`，每帧用绝对差算位置；
      外部 seek/变速/回绕才重打锚点）。**禁止**逐帧累加，也**禁止**截断 `dt`——旧实现
      `Math.min(dt, 1/15)` 会在卡顿时丢掉墙钟时间，看起来像慢动作。
    - **视频帧供给**：播放中**不再每帧 `seekVideo`**（seek 异步，`drawImage` 拿到的是上一帧，
      这正是"一帧一帧"的成因），只画元素当前已解码帧，漂移 >250ms 才纠一次；暂停/拖动仍走精确 seek。
    - **解码池**：`mediaManager.setActiveVideos(ids,{budget,rates})` 决定"谁真的在解码"，同时活跃
      **≤2 路**（主画面 + 叠化），其余 `pause()` 保留最后一帧；`registerTimeline()` 注册的元素
      `preload` 一律 `metadata`，**禁止**全量 `auto`（整条时间线几十路解码会把硬解器打满）。
    - **MG 动画预览**：只消费 `clip.metadata.mg_def`（结构化 JSON，元素/可动画属性白名单对齐后端
      `mg/validator.py`）→ `mgRenderer.ts` 画 canvas display-list；**禁止执行 `metadata.mg_html`**
      或任何模型生成的 HTML 进主文档，外链图片一律拦截。浏览器渲染与后端成片必然有差异，
      预览头常驻「近似预览」，真有差异时由 `mgFidelity.ts` 挂「N 处差异」角标，**最终成片以后端渲染为准**。
    - **资源库单一真相**：工作区目录树（`GET /api/workspace/{id}/media-tree`）是文件存在性的唯一真相；
      旧素材库 `assets/files` 只做**只读清单 + 用户显式迁移**（`legacy-assets` / `legacy-import`，
      复制不移动、SHA256 去重）。上传一律 `workspaceApi.upload` → `materials/<kind>/`，
      流式分块写 `.part` 后原子替换，2 GiB 上限、同名 409（覆盖需显式 `overwrite=true`）。
    详见 [docs/frontend-preview-and-library-prd-2026-11-02.md](docs/frontend-preview-and-library-prd-2026-11-02.md)
    与 [docs/frontend-preview-and-library-devplan-2026-11-02.md](docs/frontend-preview-and-library-devplan-2026-11-02.md)。

23. **提示词只有一处：`clipwright/prompts.py`**（PRD W4，2026-11-02）：
    - 模块级提示词常量（7 个 agent 的系统提示、kernel/loop 的规划·收口·常规提示、MG 生成约束）
      **一律从 `clipwright/prompts.py` 导入**；原模块保留**同名别名**（`from clipwright.prompts import X as 旧名`），
      调用点一行不改，避免大面积 diff。
    - **搬运必须逐字不变**：迁移后要用"值快照对比"证明每个符号字符串与搬运前完全相同
      （累计 **26 常量 + 8 builder / 常量 10314 字符**，五批全部差异 0）；不许顺手改标点或换行。
      动态 prompt 的验证用**运行时捕获**（stub `LLMService.ask`，改动前后各跑一次真实路径比对
      实际发出的 prompt），比只比常量文本更硬。
    - 需要运行时数字的提示用**参数化函数**（如 `prompts.build_budget_note(remaining, max_turns, used)`），
      文案留常量、数字由调用方传参；**禁止**再把长文案写回 f-string 内联。
    - 覆盖顺序（PRD 裁定）：全局 `prompts.py` < Category < Persona < Skill < 插件；下游覆盖走既有
      persona/插件注入机制，**不要**在 `prompts.py` 里读配置或做业务判断。
    - 详见 [docs/property-panel-and-prompt-extraction-prd-2026-11-02.md](docs/property-panel-and-prompt-extraction-prd-2026-11-02.md) §7。

24. **Provider 表单由后端 schema 驱动，前端不写死厂商字段**（2026-11-02，B1-T6）：
    - `ProvidersPage` 的 provider 配置字段来自 `providersApi.schemas()` →
      `GET /api/providers/schemas`（插件在 manifest 里声明的 `config_schema`）；
      用 `schemaFor(schemas, kind, provider)` 取当前 provider 的声明，**没有声明才回落到
      内置字段**（`base_url`/`api_keys` 那套）。
    - `config_schema` 里 `secret: true` 的字段：输入框用 `password`，读回是**掩码**，
      原样回传即「保留旧值」（与 `api_keys` 同一语义，服务端 Fernet 加密落盘）。
    - 未知控件类型/未知能力键**不许静默丢弃**：控件未知就给可读错误，能力键未知只在
      表单下方列出来（`unknown_capability_keys`）。
    - 不允许为某个具体厂商写专属分支（如 `if provider === 'cosyvoice'`）。

## 鉴权三模式

`CLIPWRIGHT_ACCOUNT_VERIFY_MODE = off | token | jwt`（默认 off）。jwt 模式本地验签共享密钥，中间件写 `request.state.user_id/user_role`；前端 access token 仅内存 + refresh 走 Server httpOnly cookie（`cw_refresh`）。

## 本期改进（P8–P10 摘要）

- **主/子 Agent 运行态收口（2026-11-01）**：任务切换按 taskId 原子清游标并加请求代际；确认实施后切到新生产
  Task；SSE 共享引用计数 + 终态主动关闭 + `since_seq` 续传；子 Agent 详情自己订阅；`runEvents` 独立保存
  `agent_run_*`；run 归属/重放身份/结束事件契约前后端对齐。详见
  [docs/agent-runtime-frontend-prd-2026-10-30.md](docs/agent-runtime-frontend-prd-2026-10-30.md) 第 16 轮。
- **工作区（本期已落地）**：首页「一句话出片（主 Agent）」与 `/task` 启动页已下线，主 Agent 改由「新建制作」承载（`requirements/proceed` 双轨：`agent_mode=on` → Task）；「新建制作」新增 04 工作区（工程/素材/下载/成片同根，`materials/` 唯一用户写入区）＋自动索引与视觉解读。见 [docs/workspace-prd-2026-10-24.md](docs/workspace-prd-2026-10-24.md)。
- **配音与字幕（本期）**：上传配音入口始终可见（旧实现被 `mode` 派生自我隐藏，用户根本没有上传入口）；
  上传配音的字幕对齐从 `sfx` 分支里移出、**默认执行**（实测时间；段数不一致按配音时长等比；样式继承）；
  不上传时用自动配音生成旁白，字幕按 TTS 句级时间戳对齐。见 docs/voice_tts.md。
- **能力解析层（本期）**：`tool/capabilities.py` + `BaseAgent.resolve_tool/call_tool/call_skill/tool_schemas/run_tool_loop`；
  Material/Edit/Animation/Audio/Quality 的硬编码工具名全部改为能力解析；Tool/Skill 列表实时读取。
- **PV 引擎插件 v2**：双布局（`engine/` 包与上游 `_build/`）、契约内省（doctor）、结构化审计、
  带预算渲染、Timeline→project 桥、拍点/对齐；插件配置注入修复（`loader._inject_plugin_config`）。
  详见 [docs/pv-engine-plugin.md](docs/pv-engine-plugin.md)、[docs/pv-engine-known-gaps.md](docs/pv-engine-known-gaps.md)。

- **运营调度**：webhook 事件接线（pipeline/render 完成·失败，secret Fernet 加密落盘）、定时调度（interval/daily + Mongo scheduled_runs）、热点选题、脚本续写/改写、beat-sync、色彩匹配工具、参考成片风格模仿、dry-run 预览、管线诊断。
- **资产治理**：sha256 去重、used_count、素材巡检/违规检测（`/api/asset/governance/*`）。
- **Persona 治理**：复制/派生/导出/导入、知识库文档管理（删/改）、RAG 异步化、ChatForge 会话落盘、PersonaLearner 编辑事件接线（`/{persona_id}/learn`）。
- **插件治理**：manifest 签名（HMAC）+ 权限白名单、依赖解析、启停持久化、配置迁移、错误通道、reload 回滚、secret 加密、审计日志；前端 UI 控件集扩充（input/select/checkbox/slider）+ UI 预览 + 未加载插件预配置。
- **前端**：BGM 素材源、水印/特效工具接线、项目归档 zip、导出预设、dry-run 开关、账号会话（`/srv` 代理）。

### 历史改进（早期批次）

- **MG 动画质量深度改进**：`animation/mg/config.yaml` 重写专业动效设计原则提示词（easing 优先、预期动作、错峰 0.2-0.5s、粒子、光效扫过、逐关键帧 `easing` 字段）；`animation/mg_renderer.py` 支持新元素类型（`line`/`circle`/`ring`/`arc`/`bg`）与 `text_shadow`/`box_shadow`/`background`（渐变）/`letter_spacing`/`font_weight`/`transform_origin`/`line_height`/`height`/`border_radius`；`animation/mg/templates/` 内置 8 个专业模板（title_reveal/comparison_split/data_bars/timeline_progress/counter_up/flow_arrows/quote_card/mindmap）；`agents/structure_agent.py` 强化 `mg_dynamic` 标记引导；`animation/mg/generator.py` 新增 LLM 自批判闭环（score < `critique.min_score` 时带批判反馈修复一次，LLM 失败静默跳过）。
- **字幕样式字段**：`schema/timeline.py` Clip 新增 11 个可选样式字段——`font_weight`/`font_italic`/`letter_spacing`/`stroke_width`/`stroke_color`/`shadow_x`/`shadow_y`/`shadow_color`/`shadow_blur`/`glow_color`/`glow_width`；`services/render.py` drawtext 双通道实现发光，支持描边/阴影/粗体渲染；`services/subtitle.py` 新生成字幕 clip 统一默认样式（font_size=48、font_color=#ffffff、text_align=center）。详见 `docs/api_reference.md`「字幕样式字段」。
- **新端点 `GET /api/pipeline/runs`**：列出最近管线运行记录，返回 `[{id, topic, status, duration_ms, started_at, agents[{agent,start,dur,status}]}]`，供 Pipeline 管理页展示真实运行数据。

## 常用工作流

### 新增一个 Tool

1. 在 `clipwright/tool/` 下创建工具文件，继承 `BaseTool`
2. 实现 `execute()` 方法和 `to_llm_tool()` 方法
3. 在 `tool/__init__.py` 的 `register_builtin_tools()` 中注册
4. 更新 `docs/api_reference.md` 工具列表

### 新增一个 Skill

1. 在 `clipwright/skill/` 下创建技能文件，继承 `BaseSkill`
2. 实现核心逻辑和 `to_llm_tool()` 方法
3. 在 `skill/builtin.py` 的 `register_builtin_skills()` 中注册
4. 更新 `docs/api_reference.md` 技能列表

### 新增一个 Agent

1. 在 `clipwright/agents/` 下创建 Agent 文件，继承 `BaseAgent`
2. 实现 `execute()` 方法
3. 在 `agents/__init__.py` 的代理列表中注册
4. 更新 `docs/structure.md` 和 `docs/workflow.md`

### 新增一个 Service

1. 在 `clipwright/services/` 下创建服务文件
2. 在依赖注入中注册
3. 更新 `docs/services_overview.md`

### 新增 API 端点

1. 在 `clipwright/api/` 下创建路由文件
2. 在 `main.py` 中注册路由
3. 更新 `docs/api_reference.md` 与 `docs/frontend-backend-parity.md`（§1 路由表 + §2 客户端矩阵）

## 文档维护规则

每次功能更新后，必须同步更新 `docs/` 中的相关文档。详见 [docs/README.md](docs/README.md) 的文档维护规则。
执行计划期间，`docs/fix-and-feature-plan.md` §10 每批追加执行记录，并同步 `J:\Clipweight-Client\docs\` 副本。

## 新增模块

| 文档 | 说明 |
|------|------|
| [素材系统](docs/material_system.md) | 多源素材搜索与检索系统 |
| [语音与 TTS](docs/voice_tts.md) | 声音克隆、语音合成与配音 |
| [动画系统](docs/animation_system.md) | 动画编目、渲染管线与 MG 动画 |
| [服务概览](docs/services_overview.md) | 全部后端服务层模块说明 |
| [需求分析 Agent](docs/requirements_agent.md) | Requirements Agent 设计与职责 |

## 验证清单

修改代码后，运行：
```bash
# 后端回归（工作目录 J:\Clipwright；用带依赖的解释器，如 py -3.14）
python -m pytest tests -q
python -c "import clipwright.main"

# 前端回归（工作目录 J:\Clipweight-Client）
npx tsc --noEmit
npm run test                     # 2026-11-01 基线：1125 passed / 5 skipped
npm run build
```

后端全量套件在本机曾于 53% 附近长时间无进展（既有长跑用例/环境问题）；至少跑
`tests/test_task_api.py`、`tests/test_event_contract.py`、`tests/clipwright/test_run_addressing_api.py`、
`tests/clipwright/test_agent_run_replay.py` 与 Agent/Kernel/Loop/Stage 相关文件。

## 文档与对应代码

| 文档 | 覆盖的代码模块 |
|------|---------------|
| [架构总览](docs/structure.md) | 全部五层架构 |
| [Agent 工作流](docs/workflow.md) | agents/, services/pipeline*.py, services/agent_bus.py |
| [API 参考](docs/api_reference.md) | api/ 全部 33 个路由文件 |
| [开发指南](docs/development.md) | tool/, skill/, plugins/, 开发规范 |
| [Persona 系统](docs/Persona.md) | persona/ 模块 |
| [素材系统](docs/material_system.md) | 素材源插件, material Agent |
| [语音与 TTS](docs/voice_tts.md) | services/voice.py, api/voice.py |
| [动画系统](docs/animation_system.md) | animation/ 全部 |
| [服务概览](docs/services_overview.md) | services/ 全部服务 |
| [需求分析 Agent](docs/requirements_agent.md) | agents/requirements_agent.py, services/requirements_service.py |
| [Agent 运行时前端 PRD](docs/agent-runtime-frontend-prd-2026-10-30.md) | `src/stores/taskStore.ts`、`src/features/task/*`、`src/features/copilot/*`、`src/features/agent/proceedResult.ts` |
| [会话时间线 PRD](docs/agent-session-timeline-prd-2026-10-31.md) | `src/features/sessionTimeline/*`、`src/stores/sessionTimelineStore.ts` |
| [中止续跑与上下文](docs/agent-continuation-and-context-2026-10-31.md) | `useRequirementsAutoStart.ts`、`requirements_service`、`context_loader` |