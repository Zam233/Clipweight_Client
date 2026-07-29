# ClipWright Optimization — Stage Log

## Stage 15: 状态栏增强 + 帧导出 + 片段启用/禁用
**Timestamp**: 2026-07-29T20:00:00+08:00

### 功能新增
- + 状态栏时间码/帧数切换按钮
- + 状态栏循环区域可视化
- + 预览面板「导出当前帧 (PNG)」
- + Clip 类型新增 `enabled` 字段 + createDefaultClip 默认值 true
- + PropertiesPanel 片段启用/禁用切换 (Eye/EyeOff) + history 支持
- + PreviewPanel 合成引擎跳过 enabled=false 的片段

### 审计确认
- tsc: 0 errors / vitest: 58 passed / E2E: 11 passed

### 评价
片段启用/禁用是专业编辑器标准功能，允许临时隐藏片段测试效果。可交付程度：高。

- - -

## Stage 15: 状态栏增强 + 帧导出
**Timestamp**: 2026-07-29T19:55:00+08:00

### 功能新增
- + 状态栏新增时间码/帧数切换按钮：点击可在 `HH:MM:SS.FF` 与 `帧 N / Total` 间切换
- + 状态栏显示循环区域：当 loopRegion 存在且循环开启时显示起止时间
- + 预览面板新增「导出当前帧 (PNG)」按钮：canvas.toDataURL 当前帧 → 浏览器下载

### 审计确认
- tsc: 0 errors / vitest: 58 passed / E2E: 11 passed

### 评价
状态栏信息密度和预览面板功能完备性均提升。可交付程度：高。

- - -
**Timestamp**: 2026-07-29T19:45:00+08:00

### 功能新增
- + 预览面板播放速度控制：点击速度按钮循环切换 0.5×/1×/1.5×/2×，RAF 播放循环实时应用速度倍率
- + previewStore 新增 playbackSpeed 状态 + setPlaybackSpeed action（范围 0.25-4）
- + PropertiesPanel 新增「混合模式」下拉选择器（normal/multiply/screen/overlay/darken/lighten 等 12 种）
- + Clip 类型新增 blend_mode 字段
- + PreviewPanel 画布合成应用 globalCompositeOperation 实现混合模式渲染

### 审计确认
- tsc: 0 errors
- vitest: 58 passed
- E2E: 11 passed

### 评价
新增播放速度控制和混合模式两项专业级视频编辑器功能。可交付程度：高。

- - -
**Timestamp**: 2026-07-29T19:15:00+08:00

### 新增 E2E 测试
- + `e2e/editor-features.spec.ts` — 6 个编辑器功能回归测试：
  - 工具栏基本 UI 验证（保存/导出/轨道按钮/状态栏）
  - Ctrl+S 快捷键触发保存请求
  - Ctrl+A 全选 + Escape 取消选择
  - V/C 工具切换不崩溃
  - 空格键播放/暂停不崩溃
  - Backspace 在无选中时不会触发浏览器后退

### 新增功能
- + `edlApi` 类型化 API 客户端（importEDL/importFCPXML/exportEDL/exportFCPXML）
- + EditorToolbar 新增「导入 EDL/FCPXML」按钮：选择 .edl/.fcpxml/.xml 文件 → 解析为 clips → 自动创建轨道并添加到时间轴（连接后端 parse_edl/parse_fcpxml）
- + edlApi 通过 index.ts barrel 导出

### 代码清理
- - 移除 TypeMakerPage/TemplatesPage/WebhooksPage/FontsPage/EditorToolbar/TimelinePanel 中未使用的导入
- - 移除 TemplatesPage 未使用变量 result

### 审计确认项
- tsc: 0 errors
- E2E: 11 passed（5 原始 + 6 新增）
- vitest: 58 passed
- ESLint: 0 errors
- Backend: 310 passed / 1 skipped / 0 failed

### 评价
E2E 覆盖从 5 项扩展到 11 项，新增了快捷键、工具切换、页面崩溃防护等回归测试。代码清理消除了阶段 10-12 引入的多余导入。可交付程度：高。

- - -

### 重构
- + 新增 `fontApi` 类型化 API 客户端（list/default/resolve/clearCache）
- + 新增 `webhookApi` 类型化 API 客户端（events/list/register/remove/toggle/test）
- + 新增 `typeMakerApi` 类型化 API 客户端（list/get/create/update/remove/preview）
- + 新增 `templateApi` 类型化 API 客户端（list/get/create/update/remove/apply）
- + personaApi 扩展 knowledge/RAG 端点（addKnowledge/ragQuery）
- + FontsPage 迁移到 fontApi
- + WebhooksPage 迁移到 webhookApi（替换 5 处裸 getApiClient 调用）
- + TypeMakerPage 迁移到 typeMakerApi（替换 7 处裸 getApiClient 调用）
- + TemplatesPage 迁移到 templateApi（替换 4 处裸 getApiClient 调用）
- + HomePage type-maker 调用迁移到 typeMakerApi
- + PersonaDetailPage knowledge/RAG 调用迁移到 personaApi
- - 消除 6 个文件中 20+ 处裸 getApiClient 调用
- 所有 API 客户端通过 index.ts barrel 统一导出

### 审计确认项
- tsc: 0 errors
- ESLint: 0 errors, 106 warnings
- vitest: 58 passed
- E2E: 5 passed
- Build: 成功
- Backend: 310 passed / 1 skipped / 0 failed

### 评价
补全了 font/webhook/typeMaker/template 四个新 API 客户端 + personaApi 扩展，共 25+ 类型化方法。6 个页面从裸 Axios 调用迁移到类型安全接口，全量测试通过。前后端 API 覆盖率达到核心路径 100%。可交付程度：高。

- - -

## Stage 11: 高级编辑器功能与交互打磨
**Timestamp**: 2026-07-29T18:40:00+08:00

### 功能新增
- + 帧精度微移：Shift+[ 左移一帧 / Shift+] 右移一帧（选中片段整体平移）
- + 帧精度修剪：[ 修剪入点（右剪一帧）/ ] 修剪出点（左剪一帧）
- + Ctrl+上箭头 上移轨道（选中片段移到上一轨道）
- + Ctrl+下箭头 下移轨道（选中片段移到下一轨道）
- + Backspace 删除片段（与 Delete 等效）
- 所有新操作均推送 history，支持撤销

### 测试基线
- 前端：tsc 0 错 / vitest 58 passed / E2E 5 passed
- 后端：pytest 310 passed / 1 skipped / 0 failed

### 评价
新增 6 项帧精度编辑快捷键，覆盖了 Premiere/DaVinci 核心剪辑工作流。编辑器已具备专业级键盘操作能力。可交付程度：高。

- - -

### Bug 修复（关键）
- Fix: AssetPanel 滥用 `useState` 执行副作用（违反 React Hooks 规则）→ 改为 `useEffect`
- Fix: TimelinePanel 本地 `window.addEventListener('keydown')` 与全局 KeybindingEngine 双重触发冲突（S/M/Delete 三键同时触发两个 handler，结果不一致）→ 移除本地监听器，统一迁入 KeybindingEngine.registerMany
- Fix: M 键双绑定冲突（全局 muted track vs TimelinePanel 本地 add marker）→ 全局静音改 Shift+M，M 统一为添加标记
- Fix: TimelinePanel handleDelete 缺少 history push → 补齐（与全局 Delete handler 行为一致）
- Fix: TimelinePanel handleSplitAtPlayhead 缺少 history push → 补齐
- Fix: EditorLayout drag 监听器内存泄漏（拖拽中卸载组件不清理 document listener）→ 添加 ref 追踪 + useEffect cleanup
- Fix: TimelinePanel canvas onDrop 双触发（container + canvas 各处理一次 drop）→ canvas onDrop 移除，仅 container 处理
- Fix: workspaceStore 布局加载无防护（malformed localStorage 数据导致 spread null 崩溃）→ loadLayout() 全面类型校验 + try-catch

### 功能新增
- + Ctrl+S 保存快捷键（全局 KeybindingEngine）
- + Ctrl+C 复制选中片段到内存剪贴板
- + Ctrl+V 粘贴片段到播放头位置（自动寻找匹配轨道，深拷贝关键帧）
- + Ctrl+X 剪切片段（复制 + 删除）
- + Ctrl+A 全选时间轴上所有非锁定轨道片段
- + Escape 取消所有选择
- + V 键切换到选择工具 / C 键切换到剃刀工具
- + F 键定位到选中片段起始
- + EditorToolbar 新增「导出字幕 (SRT)」按钮：从时间轴收集所有 caption/text clip → 按时间排序 → 生成 SRT 文件下载
- + EditorToolbar 新增「复制」「粘贴」可见按钮（使用共享剪贴板，与快捷键 Ctrl+C/V 互通）
- + TimelinePanel 缩放/标记/波纹删除快捷键迁入全局引擎 (+/-/M/Shift+Delete)

### 测试基线
- 前端：tsc 0 错 / vitest 58 passed / E2E 5 passed / build 成功
- 后端：pytest 310 passed / 1 skipped / 0 failed

### 评价
本阶段修复了 8 个关键 Bug（键盘冲突、内存泄漏、历史记录不一致、布局崩溃），新增了 12 项高影响力 UX 功能（快捷键、复制粘贴、字幕导出）。编辑器核心交互稳定性与生产力显著提升。可交付程度：高。

- - -

## Stage 9: 功能缺口补齐（前后端 API 对齐）
**Timestamp**: 2026-07-29T17:10:00+08:00

- Fix: PersonaDetailPage「保存人格」静默失败 — personaApi.update 端点错误 `/update/{id}` → `PUT /api/persona/{id}`；保存失败现显示错误提示
- Fix: personaApi.remove 端点错误 `/delete/{id}` → `DELETE /api/persona/{id}`；移除指向不存在端点的死方法 analyze()
- + 后端新增 `DELETE /api/persona/{persona_id}` 端点（前端删除能力此前完全缺失）
- Fix: WebhooksPage 整页调用不存在端点（subscriptions/subscribe/unsubscribe/test/{event}）→ 全部映射真实 API（list/register/DELETE/toggle/test/events）；移除误导性 DEMO_SUBS 假数据回退；事件类型改从后端 /events 动态获取；新增启用/禁用切换与错误提示
- Fix: ExportPage 渲染进度从不更新 — SSE 监听命名事件但后端发未命名 data 消息 → 改 onmessage 解析 {type}（progress/completed/failed/timeout）+ JSON.parse 保护
- + ExportPage 刷新后从 GET /api/render/queue 恢复在途任务并重挂进度流（renderApi.listQueue）
- + RenderProgress 类型补充 'queued' 状态（与后端一致）
- Fix: TypeMakerPage 新建/复制/删除/编辑全为本地假操作（刷新即丢）→ 接入真实 CRUD（create/GET/PUT/DELETE）；内置类型禁止删除；编辑提交时同步 shot_params；移除 DEMO_TYPES 假数据
- Fix: TemplatesPage 只读 + 「渲染模板」死按钮 → 接入 list/create/delete；「应用为新项目」调 /{id}/apply 并自动创建项目跳转编辑器；卡片展示真实轨数/时长/标签；移除 DEMO_TEMPLATES
- Fix: PersonaDetailPage 知识库「上传并建立索引」死按钮 → 文件选择 → POST /knowledge → POST /rag/index → 状态反馈
- Stage 9 审计复核（第三轮）发现并修复 4 项：
  - Fix: ExportPage 本地/后端 task_id 不匹配 → 在线渲染进度永不更新（高）
  - Fix: PersonaDetailPage 保存时 parameter 缺 persona_id → PUT 恒 422（高）；ParameterLayer 类型补齐
  - Fix: TypeMakerPage 编辑时 shot_params 整体覆盖 → 转场配置静默重置（中）
  - Fix: RagSearch 读 data.results 但后端返回 chunks → 检索结果永不显示（低）
  - 去除知识库上传的冗余显式 /rag/index 调用（后端 add_knowledge_doc 自动索引）

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
