# Agent 管线全量审�?报告 (Agent Pipeline Audit)

> 编码修复说明（P3-03）：本文档曾因 GBK/UTF-8 双重编码损坏，已按逆链还原；
> 少量生僻字符以 U+FFFD 呈现，不影响阅读。

> 计划：`.omo/plans/clipwright-agent-pipeline-audit.md`
> 状�?�：实现完成（Wave 0-2 全部 31 �?���?todo 已交付；�?终验�?wave 进�?�?��提交哈希在最终验证后补全�?
## 摘�?

�?Agent �?��驶与管线编排做全量�?计修复：**21 �?Bug（B1-B21�? 10 项效率问题（E1-E10�? 12 项灵活�??实用性缺口（G1-G12，其�?9 项本期实现，3 项�? backlog�?*，�?盖前后�?两仓。修复后：�?线不再重复执行质�?、�?阅反馈能真�?驱动规划书重做�?�从首页�?��不再丢失文�?/音色/配音、�?线完成后对话不再永久禁用、配音�?真�?传入管线做时间�?齐�?�LLM 调用有重试�?��?觉识�?��缓存、SSE 重连�?��、取消�?线可用�?��?阅�?图有"不满意→重做"入口�?
## 范围

**In（本期）**：B1-B21 全部；E1-E10（E1=B1 合并）；G2、G4 子集、G5、G6、G7、G8、G9、G10�?**Out（backlog，Must-NOT-Have�?*：G3 真流式�?�G11 BGM 素材源�?�G1 空白区域�?部调用�?�G4 百分比重构�?�G12 by-path 白名单扩展�?�新�?��方依赖�?�时间线 JSON 契约变更、破坏�??API �?��变更�?
## Bug 清单 (B1-B21)

| # | 位置 | �?? | 证据 | �??状�??| 测试 | 提交哈希 |
|---|------|------|------|:--------:|------|:--------:|
| B1 | `services/pipeline_v2.py` | Quality Agent 每�?线重复执行（DAG �?+ �?���?���?头）�?�?���?次完整质�? | `_run_inner` �?�� while �?���?头无条件 `_run_agent("quality", �?`，�??DAG 执�?组已�?quality | 🔄 �??�?| `test_pipeline_v2_quality_once.py` | b0b42a0 |
| B2 | `src/features/agent/AgentPanel.tsx` | SSE �?��重连缺陷：不 close、双连接风险�?5 次停�?守卫失效 | BottomBar `es.onerror` L647-669 | 🔄 �??�?| `AgentPanel.test.tsx` (U5 更新) | 7bf9412 |
| B3 | `api/pipeline.py` `retry_agent` | retry 全量重跑（声称从失败 agent 恢�?，实�?V1 全量）；前�?零调�?| L213-244 `_orchestrator.run` 全量 | 🔄 �??�?| `test_pipeline_v2_retry_from_agent.py` | 8dbe203 |
| B4 | `api/pipeline.py` `regenerate_scene` | 场景重生成按索引位置替换，结构不�?致即错位；不注入规划书；前�?零调�?| L247-292 | 🔄 �??�?| 替换/移除测试 | 8dbe203 |
| B5 | `api/pipeline.py` `run_single_agent` | `/step/{agent}` 假单步（跑全管线再抽结果）；前�?零调�?| L320-336 | 🔄 �??�?| deprecated �?�� | 8dbe203 |
| B6 | `services/requirements_service.py` chat | 规划书反馈闭�?��裂：反�? �?�?gathering �?�?��生成�?�?| plan_ready 分支非确认路�?| 🔄 �??�?| `test_requirements_plan_feedback.py` | 8f9b087 |
| B7 | `ReviewPanel.tsx` vs `api/requirements.py` | 超时�?��前后�?���?致；SSE max_wall=7200s < 后�?超时 | ReviewPanel L119 vs proceed L229 | 🔄 �??�?| ReviewPanel 单测 | 2af9957 |
| B8 | `pipeline_v2._persist_state` | �?���?dict/list 存成字�?�?�?Mongo 形状漂移 | L908-910 | 🔄 �??�?| `test_pipeline_v2_persist_shape.py` | b0b42a0 |
| B9 | `pipeline_v2._run_registry` | 运�?注册表无界�?�?| L50-52 | 🔄 �??�?| `test_pipeline_v2_registry_bound.py` | b0b42a0 |
| B10 | `src/services/api/*.ts` | 前�?死代�?�?��线：retry/regenerateScene/step/runV2/predictScript/predictMaterial 零调�?| 全仓 grep | 🔄 �??�?| tsc 0 errors | 543907c |
| B11 | `useRequirementsAutoStart.ts` | topic 消费过早：init 前清空，非�?线错�?��失�?��? | L31 | 🔄 �??�?��并入 B15�?| �?| fd67f55 |
| B12 | `pipeline_v2._build_input("audio")` | V2 忽略前�? voice_id/auto_dub（硬编码 auto_dub=True、voice_id 仅取 persona�?| L683-692 | 🔄 �??�?| `test_pipeline_v2_audio_config.py` | b0b42a0 |
| B13 | `api/pipeline.py` | V1 同�?�?�� `/run`、`/run-v2` 前�?零使�?| 前�? grep | 🔄 �??�?| deprecated �?�� | 8dbe203 |
| B14 | `ReviewPanel.tsx` sendFeedback catch | 请求失败�?律谎�?（�?线模式）已�?录反�? | L94-98 | 🔄 �??�?| `ReviewPanel.test.tsx` | fd67f55 |
| B15 | `useRequirementsAutoStart.ts` | �?user 消息冗余 | L36、L59 | 🔄 �??�?| `useRequirementsAutoStart.test.tsx` | fd67f55 |
| B16 | `EditorPage.tsx` + `HomePage.launch` | 【重大�?�launch 参数�?resetProject() 清空且未恢�? | EditorPage L46-68 | 🔄 �??�?| `EditorPage.test.tsx` | d54d591 |
| B17 | `AgentPanel.tsx`/`ReviewPanel.tsx` | 【重大�?��?线完成后�?求�?话输入�?永久隐藏（status �?pipeline_running，无复位�?| AgentPanel L352 | 🔄 �??�?| `AgentPanel.test.tsx` | 7bf9412 |
| B18 | `EditorLayout.tsx` | Agent 面板宽度不可调：panels.agent �?divider �?onMouseDown/onPointerDown | L204 | 🔄 �??�?| `panel-divider.spec.ts` �?vitest | c099281 |
| B19 | `useBackendHealth.ts` | 后�?健康�?查一次�?�（无轮�?心跳�?| 全文�?| 🔄 �??�?| `useBackendHealth.test.tsx` | 7bf9412 |
| B20 | `api/project.py` `create_project` | ProjectCreateRequest.agent_state �?���?| L78-89 | 🔄 �??�?| `test_project_agent_state.py` | 66a5202 |
| B21 | `DubView.tsx` + `useRequirementsAutoStart.ts` + `projectStore` | 【重要�?�配音�?�?��：DubView �?�� state，setDubSegments 零调�?��autoStart extra 不传 dub_segments | DubView L24；autoStart L46-53 | 🔄 �??�?| `DubView.test.tsx` | fd67f55 |

## 效率�??清单 (E1-E10)

| # | 位置 | �?? | �??状�??| 测试 | 提交哈希 |
|---|------|------|:--------:|------|:--------:|
| E1 | `pipeline_v2.py`�?B1�?| quality 双跑�?1 次完整质�?/管线 | 🔄 �??�?| `test_pipeline_v2_quality_once.py` | b0b42a0 |
| E2 | `requirements_service._generate_plan` | 同一�?报重复确认重复跑 StructureAgent，未复用 raw_scenes | 🔄 �??�?| `test_requirements_plan_feedback.py` | 8f9b087 |
| E3 | `services/llm.py` | 管线 Agent LLM 调用无重试；transient 失败 �?�?��全链�?���?| 🔄 �??�?| `test_llm_retry.py` | 0f1d620 |
| E4 | SSE stream | �?��重连全量重放�?000 �?�?MB�?| （接受现状，非本期） | �?| �?|
| E5 | `_handle_gathering`/`_generate_plan` | 每条 chat 消息 RAG �?�?+ Persona 上下文序列化，结果每消息丢弃 | 🔄 �??�?| `test_requirements_session_cache.py` | 8f9b087 |
| E6 | `services/trace.py` | 每�? get_events 全量过滤 + trim 复制 | 🔄 �??�?| `test_trace_since.py` | 0f1d620 |
| E7 | `agentStore.addLogEntry` + `LogPanel` | 日志每�?追加 O(n) 复制 + 无上�?DOM 渲染 | 🔄 �??�?| `agentStore.test.ts` | c099281 |
| E8 | `animation_agent._build_image_semantic_index` | 每图 1 次�?�?LLM、无缓存 | 🔄 �??�?| `test_vision_cache.py` | 0f1d620 |
| E9 | `services/vision.py` | 视�?识别无结果缓�?| 🔄 �??�?| `test_vision_cache.py` | 0f1d620 |
| E10 | `material_agent._validate_via_vision_llm` | 视�?校验每�?��??1 次�?模�?�调�?���?URL→score 缓存 | 🔄 �??�?| `test_material_vision_cache.py` | 0f1d620 |

## 灵活�?实用性缺口清�?(G1-G12)

| # | 缺口 | �?��处置 | �??状�??| 测试 | 提交哈希 |
|---|------|---------|:--------:|------|:--------:|
| G1 | �?部重做名不副�?| 三�?点�?�?+ 反�?�?��（B6�? 审阅重做入口（G10�?| 🔄 �??�?| �?| 8f9b087 |
| G2 | 无取�?暂停管线 | **实现**：cancel �?��（协作式�? 前�?取消按钮 | 🔄 �??�?| `test_pipeline_cancel.py` | 2af9957 |
| G3 | 非真流式 | **Out（backlog�?*：llm.py `stream` 保持 False；`stream_chat` known-limitation 注释不动 | �?| �?| �?|
| G4 | 进度条非真实进度 | 部分：BottomBar 显示当前 Agent 活动（不做百分比重构�?| 🔄 �??�?| `AgentPanel.test.tsx` | 7bf9412 |
| G5 | 离线/在线混淆 | 离线�?�� + 周期性健康�?�?+ 区分�?���?执�?失败 | 🔄 �??�?| `useBackendHealth.test.tsx` | 7bf9412 |
| G6 | HomePage 无智能�?�?| 接线 predict-script | 🔄 �??�?| `HomePage.test.tsx` | 543907c |
| G7 | �?求�?话无参�?�文件上�?| 接线 upload | 🔄 �??�?| `AgentPanel.test.tsx` | fd67f55 |
| G8 | 会话恢�?仅靠 localStorage | 接线 getSession | 🔄 �??�?| `EditorPage.test.tsx` | d54d591 |
| G9 | PipelineAdminPage 假成�?+ �?? | 真实成本 + 重试按钮 | 🔄 �??�?| `PipelineAdminPage.test.tsx` | 543907c |
| G10 | 审阅视图�?不满意→重做"入口 | **实现** | 🔄 �??�?| `TimelineDiffView.test.tsx` | 543907c |
| G11 | BGM 仅建�?��真实配乐 | **Out（backlog�?*：AudioAgent �?metadata 建�?保持 | �?| �?| �?|
| G12 | �?��素材预�? 403 降级 | 文档化限制，记录不改 | 记录 | �?| �?|

## �??说明与取�?
- **B3**（retry 从失�?Agent 恢�?）：`PipelineOrchestratorV2.run_from_agent` 重建 result_data —�??�?`state.steps[]` 按执行顺序取�?�� agent 之前�?�?`status==completed` �?result 非空的�?骤，�?`_merge_agent_result` �?��重放；再执�?�?�� + 下游联动；无�?��前置结果 �?400�?- **B4**（regenerate-scene）：�?clip id �?��匹配替换（metadata.source_title/clip.text/start_sec �?近邻）；若实现成�?��限则移除�?�� + 前�?移除客户�?��数�??- **G2**（取消�?线）�?*协作式取�?*—�?�不强制�?�� in-flight LLM（asyncio.to_thread 不可取消），在下�?�?agent 边界生效；取消后 `state.status=CANCELLED` + 落库 + result �?cancelled + SSE `cancelled` 事件�?- **B7**：超时公式统�?�?`max(1800, audio×6, scene×360)`；SSE `max_wall` �?`extra_params.pipeline_timeout_sec` 动�?�化（回�?默�? 7200+600 余量）�??
## 测试与质量基�?
- 后�?基线：`python -m pytest tests/ -q` �?**858 passed**（�?划时 ~699，漂移后以实测为准）�?- 前�?基线：`npm run test` �?**225 passed**�?5 文件）�??- �?终验�?wave：后�?���?pytest + ruff；前�?tsc 0 errors + vitest 全绿 + build + lint + Playwright E2E（hermetic mock，路径锚定�?�?`/https?:\/\/[^/]+\/api\//`）�??- 手动联调点（QA 记录）：B16 首页�?�� �?�??实施 �?后�?收到 script_text/voice_id/audio_path；B17 管线完成后输入�?恢�?；B21 配音段进入�?划书场景对齐；G2 取消后�?线终�?cancelled�?
## 提交记录

> 完成后补全两仓提交哈希（后�?按�?�辑组�?�前�?�� wave 分组），并核�?`git log` 与下表一�?对应�?
| �?| 提交信息（前�?�?|
|----|------------------|
| 后�? | `fix(pipeline): run quality agent once per pipeline` · `fix(pipeline): preserve shared_data shape on truncation` · `fix(pipeline): bound run registry` · `fix(pipeline): honor frontend voice_id/auto_dub in v2` · `feat(pipeline): retry from failed agent (v2)` · `fix(pipeline): regenerate scene by clip id` · `refactor(pipeline): deprecate v1 sync endpoints` · `feat(requirements): regenerate plan from review feedback` · `fix(pipeline): align timeout formula and SSE max_wall` · `feat(llm): exponential backoff retry for transient errors` · `perf(requirements): cache RAG + persona context per session` · `perf(trace): index-based since query` · `perf(vision): cache image analysis by path+mtime` · `perf(material): cache vision validation scores` · `feat(pipeline): cooperative cancel endpoint` · `fix(project): persist agent_state on create` |
| 前�? | `fix(editor): restore launch params after resetProject` · `fix(agent): reset requirements status on pipeline finish` · `fix(agent): reliable SSE reconnect with hard cap` · `fix(agent): wire dub segments into requirements/pipeline` · `fix(agent): distinguish offline vs request failure + heartbeat` · `refactor(api): drop dead pipeline clients, keep wired ones` · `feat(home): script intelligence prediction` · `feat(agent): reference file upload in requirements chat` · `feat(editor): restore requirements session from backend` · `feat(admin): real cost + retry failed runs` · `feat(agent): rework request from diff review` · `perf(agent): cap log entries and collapse groups` · `feat(agent): show current agent activity in bottom bar` · `fix(layout): resizable agent panel divider` · `docs(agent): pipeline-agent audit report` |

