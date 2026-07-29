# ClipWright Optimization — Stage Log

## Stage 9: 功能缺口补齐（前后端 API 对齐）
**Timestamp**: 2026-07-29T17:10:00+08:00

- Fix: PersonaDetailPage「保存人格」静默失败 — personaApi.update 端点错误 `/update/{id}` → `PUT /api/persona/{id}`；保存失败现显示错误提示
- Fix: personaApi.remove 端点错误 `/delete/{id}` → `DELETE /api/persona/{id}`；移除指向不存在端点的死方法 analyze()
- + 后端新增 `DELETE /api/persona/{persona_id}` 端点（前端删除能力此前完全缺失）
- Fix: WebhooksPage 整页调用不存在端点（subscriptions/subscribe/unsubscribe/test/{event}）→ 全部映射真实 API（list/register/DELETE/toggle/test/events）；移除误导性 DEMO_SUBS 假数据回退；事件类型改从后端 /events 动态获取；新增启用/禁用切换与错误提示
- Fix: ExportPage 渲染进度从不更新 — SSE 监听命名事件但后端发未命名 data 消息 → 改 onmessage 解析 {type}（progress/completed/failed/timeout）+ JSON.parse 保护
- + ExportPage 刷新后从 GET /api/render/queue 恢复在途任务并重挂进度流（renderApi.listQueue）
- + RenderProgress 类型补充 'queued' 状态（与后端一致）

## Stage 8: 终审与交付验收
**Timestamp**: 2026-07-29T16:30:00+08:00

- 审计 agent 两轮独立审计：第一轮发现 1 致命 + 4 高危（遍历遗漏端点/静态挂载/SSRF/任务引用），全部修复
- 第二轮复核确认原 6 项修复有效，追加发现并修复：
  - Fix: voice clone audio_path 任意文件读（base64 外泄通道）→ 白名单校验
  - Fix: voice synthesize output_path 任意文件写 + mkdir → 强制 TTS 输出目录内
  - Fix: preprocess submit/batch-submit 任意路径喂 ffmpeg/whisper → 白名单
  - Fix: SSRF 判定改 is_global（覆盖 CGNAT 100.64/10）
  - Fix: 媒体 ?token= 校验后从 query string 抹除（防访问日志/Referer 泄露）
  - Fix: TimelineEngine wheel 监听器泄漏（dispose 移除 + disposed 守卫）
- + docs/security.md 补充残余风险说明（DNS rebinding、媒体令牌）
- 验收基线：
  - 前端：tsc 0 错 / lint 0 错 106 警告 / vitest 58 passed / playwright E2E 5 passed / build 成功
  - 后端：pytest 296 passed + RAG 14 passed / 1 skipped（isobase 离线不可装）/ 0 failed
  - 安全测试：19 项回归用例全部通过

## Stage 6: 性能优化与后端审计遗留项
**Timestamp**: 2026-07-29T15:45:00+08:00

- + historyStore/timelineStore/timelineDiff 深拷贝 JSON→structuredClone（大时间线快数倍）
- 进行中：proxy/asset 路径与上传加固（security.py 统一白名单 assert_allowed_path）

## Stage 5: E2E 无头浏览器测试基础设施（完成）
**Timestamp**: 2026-07-29T14:50:00+08:00

- Fix: 全量清查并修复 API 服务中遗留的 8080 兜底端口（pipeline/render×4/requirements/voice/project×2）→ 8000
- Fix: HomePage 后端状态文案硬编码端口 → 动态读取 baseURL host
- + Playwright 配置（chromium + vite webServer 自启动）
- + e2e/helpers.ts：后端 API 全拦截 mock（正则限定路径前缀，避免误拦 Vite 模块）
- + 5 个冒烟用例全部通过：首页加载/健康状态/项目列表/编辑器四面板/加载失败回退
- + vitest.config.ts 排除 e2e/ 目录
- 基线：npm run test:e2e → 5 passed (chromium headless)

## Stage 4: 前端审计高危项修复（交互/崩溃/内存/性能）
**Timestamp**: 2026-07-29T14:35:00+08:00

- Fix: WsClient 重连竞态（CONNECTING 未拦截致重复连接）+ 指数退避（3s→60s 上限）
- Fix: 删除 clip/track 后 selection 悬空引用 → removeClip/removeTrack/rippleDelete 同步清理
- Fix: playhead 首次加载卡 0（duration 未同步时被钳位）→ setTimeline 同步 duration/fps
- Fix: AgentPanel SSE 命名事件 JSON.parse 无保护 → 全部 safeParse
- Fix: AgentPanel 演示模式 setTimeout 链卸载后继续执行 → 定时器收集清理
- Fix: TimelineEngine 缺 pointercancel → 触屏/手势中断后拖拽状态卡死
- Fix: TimelineEngine canvas ctx / parentElement 非空断言崩溃 → 守卫
- Fix: PreviewPanel 播放时每帧重建 ResizeObserver（性能劣化）→ 持久 RAF + 变更检测
- Fix: PreviewPanel aspect 除零（height=0 白屏）+ 音频同步每帧遍历 → 节流 ~10fps
- Fix: imageCache 无上限 → LRU(64)
- Fix: mediaManager object URL 永不释放 → unregister/clear + 项目切换时调用
- Fix: EditorPage sendBeacon 兜底端口遗留 8080 → 8000
- + 新增 4 项 selection 联动回归测试
- 基线：tsc 0 错 / lint 0 错 / vitest 58 passed

## Stage 3: 后端安全与资源泄漏修复（审计致命项）
**Timestamp**: 2026-07-29T14:25:00+08:00

- Fix: `serve_video` 任意文件读取漏洞 → 白名单目录限制（致命）
- Fix: Persona 仓库路径遍历（可写/删任意目录）→ persona_id 全入口校验（致命）
- Fix: video_editor `project_id` 路径遍历 → 路由级 ID 校验守卫
- + 新增 `clipwright/security.py` 安全工具模块（ID 校验 / 路径包含检查）
- + 可选 API 令牌中间件（CLIPWRIGHT_API_TOKEN），令牌模式下 CORS 来源收紧
- Fix: pipeline SSE 连接泄漏 → 客户端断连检测
- Fix: `/api/pipeline/status` 恒定 404 → 实现真实状态查询
- Fix: pipeline retry/regenerate 对 dict 取属性致 AttributeError
- Fix: voice DashScope 全局 api_key 并发竞态 → 锁串行化
- Fix: task_queue `_tasks` 内存无限增长 → 完成任务定期清理；排序键 timezone 安全
- Fix: trace `_traces` 键集无界增长 → 上限 + 过期清理
- Fix: `execute_batch` 修改调用方 dict + 非字符串键 TypeError
- + 新增 `test_security.py` 安全回归测试（11 项）
- 基线：后端 pytest 287 passed / 15 skipped / 0 failed

## Stage 2: 后端测试可运行性与依赖修复
**Timestamp**: 2026-07-29T14:05:00+08:00

- Fix: `llm.py` isobase 改为惰性导入（ISOBASE_AVAILABLE 守卫），缺依赖时后端仍可启动/导入
- Fix: `test_llm.py` 增加 `pytest.importorskip("isobase")` 守卫
- Fix: pyproject.toml 补充缺失的核心依赖 `pymongo`（context.py 模块级导入但未声明）
- + pyproject.toml 新增可选 extras：openai / openai-whisper / faster-whisper（RAG 与 STT 可选功能）
- Fix: `embedder.py` base_url 三元表达式优先级歧义（加括号明确语义）
- Fix: `test_rag.py` 强制本地 sentence_transformer provider，测试不再依赖开发者 .env 的在线 API
- 基线：后端 pytest 283 passed / 1 skipped（RAG 7 项待 sentence-transformers 安装后验证）

## Stage 1: Critical Bug Fixes
**Timestamp**: 2026-07-29T13:45:00+08:00

- Fix: ESLint 9 flat config missing — `npm run lint` completely broken
- Fix: Default API/WS port mismatch (8080 → 8000) in client.ts, settingsStore.ts, WsClient.ts
- Fix: .env.example had wrong default ports (8080 → 8000)
- Fix: previewStore.setCurrentTime allows negative/out-of-bounds time
- Fix: Playback loop ignores loopRegion and isLooping settings
- Fix: historyStore.maxSize not synced with settingsStore.maxUndoHistory
