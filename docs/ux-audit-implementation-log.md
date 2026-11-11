# UX 与缺陷审计 · 实施追踪台账

> 依据：[PRD](ux-and-bug-audit-prd-2026-11-09.md) · [Coding Plan](ux-and-bug-audit-coding-plan-2026-11-11.md)
> 本文件逐项记录 W00–W14 的实施证据。状态：`待办` / `复现红` / `已改待验` / `已验` / `有反证关闭` / `延期`。

## 0. 基线（W00）

| 项 | 值 |
|---|---|
| 前端仓库 / 分支 | `J:\Clipweight-Client` / `fix/zam_ux_and_debug` |
| 后端仓库 / 分支 | `J:\Clipwright` / `feat/zam_remove_account_system`（**只读复核**；另有他人未提交改动） |
| 基线验证 | `npx tsc --noEmit` 通过；`npm run test` → 140 文件 / 1224 passed / 5 skipped（2026-11-11 开工前） |
| 当前验证 | 前端 `npx tsc --noEmit` 通过；`npm run test` → **153 文件 / 1334 passed / 5 skipped**；`npm run build` 成功。后端定向 pytest → **113 passed**；`import clipwright.main` exit 0 |
| 提交状态 | 前端 `fix/zam_ux_and_debug` 已推送（累计 16 次提交，含第八轮 P3）；后端 `feat/zam_remove_account_system` 已推送（累计 5 次提交，含第八轮 BE-09）；两仓工作树干净 |
| 工作树 | 两仓均有大量未提交改动（前端为 P2-xx 批次、后端为账号剥离批次）。**不清理、不暂存、不提交**；每包只做最小插入式 edit |
| 沙箱 | 会话初期 Windows 沙箱 esbuild spawn EPERM；后切 danger-full-access，测试可运行 |

### 复核纪律

- PRD 行号为 2026-11-09 快照；每包开工先重读当前代码与既有测试。
- 每个缺陷：先写失败复现用例（红）→ 最小修改（绿）→ 定向 vitest + tsc → 记录。
- 「待复核」线索（E-05/E-06、KK-09、BE-09 部分）不擅自标已修；需复现用例或反证。
- 跨仓契约（PL-01/02 插件代理、B-01～03 会话归属、BE-03 task_end）需后端配合；前端侧先做「默认拒绝」的安全收口，不伪造后端已授权。

## 1. 工作流进度

| 包 | PRD 编号 | 状态 | 责任人 | 证据 / 备注 |
|---|---|---|---|---|
| W00 | — | 进行中 | 主会话 | 本台账；基线测试已记录 |
| W01 | PL-01/02 | 已验（前端收口） | 主会话 | 统一门禁 `pluginApiGuard.ts`；iframe call / shortcut / layout button / overlay 四入口全部接入 |
| W02 | B-01～05, KK-03/08 | 已验（代码+定向回归） | 主会话 | 停止失败不再谎称已停止、A watcher 不释放 B、重复说明抑制、planning 扫描、超时补释放、取消在飞子 run、两路 terminal_reason 一致 |
| W03 | KK-01/02/05/06/09 | 已验（代码+定向回归） | 主会话 | 金额闸比 main_spent、收口 finish=capped、status 由 terminal_reason 派生、取消不计成功率 |
| W04 | B-06≈BE-01, BE-03/04 | 已验（代码+定向回归） | 主会话 | 分块上传 413/422、异常 task_end 两清单、回写失败可见 |
| W04b | BE-05/06/07/08 | 已验 | 主会话 | 排队取消清理、render 参数提交时字段级 422、trace since_seq 续传 + 断连检测、duplicate owner 写失败回滚删除副本 |
| W12b | PL-12（缓存键/演示配置/恢复默认反馈） | 已验（子集） | 主会话 | usePluginSlots 读写缓存键统一；ModelsPage 离线不再伪造模型名；恢复默认错误已可见（复核确认）；dict/list 输入与 provider 名属于 ConfigValueInput/已有门面，未重复改 |
| W05 | E-01～04/E-07, F-01/F-02 | 已验 | 主会话 | 启动信封/跨项目快照/reset 全覆盖/音色不被旧偏好覆盖/新建态不显示旧项目素材；F-03 待办 |
| W06 | F-03～F-12 | 已验 | 主会话 | 预判代际、配音三态、步骤编号、默认类型如实标注、预判时长生效、Agent 数与端口文案、未支持选项禁用、首屏不闪演示数据、离线回退受开关控制、工作区失败可见 |
| W07 | TL-01/03 | 已验（store 层） | 子代理 | `setTimeline` 来源区分 + 落盘基线；10 个新用例红→绿 |
| W08 | TL-02/04/05/09/10/11/12（+TL-13 dispose） | 已验（子集） | 主会话接手 | slideClip 钳制、锁/隐轨投放拒绝、跳转与命中跳过、锁轨写入守卫下沉 store、keyframes 缺省不崩、pointer 监听不叠加、Bezier DPI（复核已正确）；TL-06/07/08 未做 |
| W09a | S-01～06 | 已验 | 主会话（接手失败子代理） | start 检查 refused、窗口游标同步、runEvents 合并、replan 代际、错误分槽、inject 反馈 |
| W09b | T-01～08 | 已验（存在） | 子代理 | SessionTimeline UI，12 例 |
| W10 | P-01（P-02/03～09 未做） | 部分已验 | 主会话 | 导出帧等待 seeked；其余预览项未做 |
| W11 | M-01～08 | 已验 | 主会话接手 | 归一化、asText 收口、reload 代际、目录树刷新、上传进度、AI 结果按 kind 入轨、配音空段守卫与重试；M-09 未做 |
| W12 | PL-03/04/06/07/08/09/10 | 已验（子集） | 主会话 | 文本边界 + enable 以服务端为准 + 401/503/422 + provider 去硬编码 + 删除二次确认 + PluginsPanel 字段收口；PL-11/12 未做 |
| W13 | BE-02/09 | 待办 | 后端待授权 | 后端 I/O |
| W14 | P3/待验证收尾 | 待办 | — | 逐子项 |

## 2. 编号 → 责任映射

见 coding plan §3「编号追踪索引」。此处仅记**实际结果与证据链接**；容器编号（如 `M-09`、`TL-13`、`PL-12`、`BE-09`、`KK-09`、`E-06`）须逐子项单独打勾，不能整条算完成。

## 3. 变更与验证记录
（每包完成后追加：`PRD 编号 / 文件 / 失败用例名 / 红→绿 / tsc / 人工验收 / 剩余风险`）

- W00 基线：`npx tsc --noEmit` exit 0；`npm run test` exit 0（140 files / 1224 passed / 5 skipped）。未修改业务代码。
- W01 / PL-01+PL-02（前端默认拒绝收口）：
  - 新增 `src/features/plugins/pluginApiGuard.ts`：`normalizePluginEndpoint` 拒绝外链/协议相对/反斜杠/query/fragment/`..`/百分号编码绕过，仅接受 `/api/` 站内绝对路径；`authorizePluginCall` 只允许 GET/POST 且端点必须在 `PLUGIN_ALLOWED_ENDPOINTS` 白名单（按路径+方法枚举，不含通配）；`pluginCallNeedsConfirm` 标记可写端点。白名单仅登记仓库内置插件实际声明的 3 个端点。
  - 四个插件驱动的入口全部接入：`PluginBundleFrame.tsx`（postMessage call）、`usePluginShortcuts.ts`（快捷键）、`PluginLayoutRenderer.tsx`（声明式按钮）、`overlayActions.ts` + `useInstallableDependency.ts`（浮层 probe/install）。拒绝时回稳定错误码、不发宿主请求；可写快捷键端点加 `window.confirm` 逐次确认。
  - 红→绿：`pluginApiGuard.test.ts` 10 例；`PluginBundleFrame.test.tsx` 新增 4 例恶意 iframe（合法 `e.source`+origin 下打 `/api/project/abc` DELETE、未登记 POST、编码穿越、白名单 GET 放行）——修复前 3 红；`usePluginShortcuts.audit.test.tsx` 5 例——修复前 4 红；`PluginLayoutRenderer.test.tsx` 新增 2 例；`AppOverlayHost.test.tsx` 新增 1 例。
  - `npx vitest run src/features/plugins` → **8 files / 66 passed**；现有 `b6-fixes` / `AppOverlayHost` / `usePluginSlots` 全绿。
  - **剩余风险（必须后端配套）**：前端白名单不是授权边界。后端需提供插件专用受限代理端点，按服务端可信 pluginId/manifest/启停/签名做最终权限与资源归属裁定；在此之前普通宿主 API 仍可能被**绕开前端**直接调用（但插件 iframe/贡献已无法借宿主凭据自动发起）。跨仓契约未落地前 W01 只算「前端收口」，不算 PRD 完全关闭。
- W07 / TL-01+TL-03（撤销/导入/代理切换后 dirty 被误清）：
  - `timelineStore.ts` 的 `setTimeline` 增加 `source?: 'server'|'local'|'history'` + 模块级 `savedTimeline` 落盘基线；`local`→dirty=true，`history`→与基线引用比较，`server`/缺省→清脏并记基线；`markSaved` 更新基线，`resetTimeline` 清基线。`historyStore.swapTimeline` 显式传 `history`；`EditorToolbar` 的 JSON 导入与代理切换成功分支传 `local`。保留了该文件已有 P2-42/P2-43 未提交改动。
  - 红→绿：改动前 8 个新用例全红 / 72 存量全绿；改动后 `npx vitest run` 三个文件 → 80 passed；`npx tsc --noEmit` exit 0。复跑 E-07 合入后 4 文件 88 passed。
  - **残留风险**：`TimelineDiffView.tsx`（acceptAll/mergeSelected）与 `EditorPage.tsx` restoreDraft 等仍调用不带 source 的 `setTimeline`，按缺省 server 语义会误清 dirty——需在 W05/W14 补为 `local`。autosave 的 dirtyRef 与 store isDirty 仍是两套状态，离开/刷新集成未补测。
- W05 / E-07（自动保存 / 默认帧率 / 默认分辨率刷新失效）：
  - `settingsStore.ts` 的 `loadEditorPrefs()` 现在返回并校验三项（autoSave 布尔、fps 1–240、分辨率 16–7680），读取端改为直接读 `prefs.*`；删去从返回值取不存在键的旧代码。
  - 红→绿：`settingsStore.test.ts` 新增 3 例（写入→resetModules 重新加载→读回、默认值、损坏值收敛）；修复前 1 红，修复后 8 passed。注意 `migrateLocalPrefs` 在模块加载时已做钳制，损坏值用例按「合法钳制结果」断言而非硬编码默认。
- W05 / E-01（自动启动自我取消、永久转圈）：
  - `useRequirementsAutoStart.ts`：effect 依赖改为 `[ready, projectId]`，topic 在 effect 内从 store 读一次；取消判定从 `cancelled` 改为「卸载 或 projectId 变化」的 `stale()`。消费 topic 不再触发自身 cleanup。
  - 红→绿：新增 `useRequirementsAutoStart.audit.test.tsx` 3 例。**已做反向验证**：把依赖临时改回 `[ready, requirementsTopic]` 并使流程提前返回 → 2 例红；恢复修复 → 3 例绿。
- W09a / S-01～S-06（taskStore）：
  - `start` 检查 `res.refused`（与 resume 同口径）；`applyEvent` 裁剪到 400 条时同步 `oldestLoadedSeq` 并置 `hasEarlierEvents=true`；`loadEarlierEvents` 把历史 `agent_run_*` 按 seq 去重并入 `runEvents`；`replan` 加 epoch+activeTaskId 代际校验；新增 `listError` 与 `error` 分槽、各操作开始时清自身错误；`inject` 成功后写 `injectedAt/injectedText` 供 UI 反馈。
  - 红→绿：`taskStore.events.test.ts` 新增 3 例（裁剪后游标=51、未裁剪不误标、翻页并入 runEvents）。12 个 task 相关测试文件 100 passed。
- W08 / TL-02+TL-04+TL-09（子代理部分完成，主会话接手修正）：
  - `timelineStore.slideClip` 钳制改为「右移受 next 可压缩量、左移受 prev」；`TimelineEngine.dropAssetAt` 拒绝 locked/hidden 投放并 toast 反馈、`sameKindTracks` 过滤锁/隐轨；`jumpToNextEdit/jumpToPrevEdit` 跳过 hidden/locked；`dispose` 清 feedbackTimer（TL-13 子项）。
  - 子代理留下的 `TimelineEngine.dropGuards.test.ts` 因 `vi.mock` 工厂引用未提升的 `toast` 而整套无法加载 → 改用 `vi.hoisted` 修复；5 例绿。
  - `timelineStore.test.ts` 补 TL-02 回归 2 例（A10/B1/C1 大幅右移、对称左移），全 56 passed。
  - **未做**：TL-05（锁轨片段仍可被属性面板/删除/切分编辑）、TL-06 波纹删除跨轨、TL-07 嵌套序列、TL-08、TL-10、TL-11、TL-12、P-04/P-05。
- W11 / M-01+M-04（子代理失败，主会话接手）：
  - `services/api/asset.ts` 新增并导出 `normalizeMaterialAsset`（tags 非数组→[]、metadata 非对象→{}、detail→字符串），`getMaterialAsset` 返回归一化结果；`MaterialAsset` 类型补 `detail?`。
  - `AssetPanel.MaterialDetail` 改为导出组件并在渲染边界归一化（不再直接 `.length` / `Object.keys`），补标题与描述展示。
  - `WorkspaceMediaTree` 订阅 `assetStore.refreshCounter`，上传后目录树自动刷新。
  - 红→绿：接手时 3 个测试文件（子代理留下的红用例）tsc 报错 + 2 例失败；实现后 `asset.normalize.test.ts` 9 + `MaterialDetail.dirty.test.tsx` 3 + `WorkspaceMediaTree.refresh.test.tsx` 1 全部通过，tsc 干净。
  - **未做**：M-02（WorkspaceMaterialsPanel 字段 asText 收口）、M-03（reload 代际守卫）、M-05（上传进度）、M-06（AI 结果入轨 kind）、M-07（DubView 空段）、M-08。
- W12 / PL-03+PL-04+PL-07+PL-08：
  - `services/api/client.ts`：401/503 挂可读 `userMessage`；422 逐条拼 `loc.msg`（前 3 条）并挂 `errorDetails` 全量条目。
  - `PluginLayoutRenderer`：新增 `sanitizeLayout` 递归归一化展示字段 + `getValue` 把对象状态收成安全文本（`File` 原样保留）；`Slot.tsx` 的贡献 title 过 `asText`。
  - `PluginsPanel.toggle`：enable/disable 以服务端响应为准（`status`/`enabled`），成功后 `load()` 重新确认，不再无条件翻开关。
  - `ProvidersPage` 重命名：输入改为受控 `renameDraft`，确认按钮与 Enter 提交同一值。
  - 红→绿：`client.test.ts` 4 新例（401/503/多字段 422/脏 msg）×2 原例调整；`PluginLayoutRenderer.test.tsx` 2 新例；`PluginsPage.test.tsx` 2 新例。plugins 9 文件 77 passed、client 9 passed、PluginsPage 16 passed。
  - **未做**：PL-05 后续打磨、PL-06（删除源/模型二次确认）、PL-09（TTS provider 硬编码）、PL-10/PL-11（PluginsPanel/TypeSpec/Persona 字段收口）、PL-12。
- W09b / T-01～T-08（子代理完成，主会话复核）：
  - `SessionTimeline.tsx`：顶部加载 in-flight ref + scrollHeight 锚点补偿、跟随内容指纹、提交后锁定按钮、枚举中文化、`asText` 收口、重连空态、加载更早文案、思考默认折叠。
  - `SessionTimeline.test.tsx` 12 例绿。**副作用**：T-08 使历史思考默认折叠，`AgentPanel.test.tsx` 有 1 例断言思考正文可见 → 按新口径改为断言折叠摘要，48 passed。
- W08 / TL-05 与 W11 / M-02+M-03+M-05+M-06、W05 / E-02+E-03+F-01（第三轮补充）：
  - **TL-05**：守卫下沉到 store —— 新增 `timelineStore.isClipOnLockedTrack()`，`updateClip`/`removeClip`/`splitClip` 均在锁定轨上直接 no-op。UI 加 disabled 只是可读性，绕开 UI 也改不动。红→绿：4 例（update/remove/split 拒绝 + 解锁后可编辑），修复前 3 红，`timelineStore.test.ts` 60 passed。
  - **M-02**：`WorkspaceMaterialsPanel` 素材行与失败列表的 `rel/path/kind/status/tags/vision.summary/vision.tags/reason/sha256` 全部过 `asText`/`textList`。红→绿：2 例脏对象用例修复前直接抛 React child 错误（2 failed + 2 errors），修复后 `src/features/workspace` 13 passed。
  - **M-03**：`reload` 加代际号（`reloadGenRef`），切项目后丢弃旧响应。新增 p1 慢返回 / p2 先返回的乱序用例，6 passed。
  - **M-05**：`assetStore.uploadProgress` 拓宽为 `number | string | null`；上传循环逐文件写「i/N 正在上传：文件名」，跳过超限文件也有状态；渲染端按类型分别显示进度条或文本（`data-testid="asset-upload-progress"`）。不谎称字节级百分比。
  - **M-06**：`loadAssets` 加代际守卫；`addResult` 不再硬编码 video，按 `kind`/`type`/URL 扩展名（`guessKindFromUrl`）入对应轨；`local_path` 结果注册 `byPathUrl` 代理（旧实现漏了 → 预览出不来）。`registerUrl` 只接受 audio/image/video，其它 kind 跳过。
  - **E-02**：`projectStore.resetProject()` 补齐 `creativePrompt/creativeAvoid/cutOnBeat/beatBpm/shot*Policy/personas/reasoningEffort`；`EditorPage` 启动快照新增 dryRun/workspace*/creative*/cutOnBeat/beatBpm/shot*Policy 并在消 reset 后回填。
  - **E-03**：`pendingReqRef` 增加 `forProjectId`，`/editor/A → /editor/B` 时重新采集，不再复用 A 的 pendingTopic。
  - **F-01**：`HomePage.launch()` 以当前表单 `voicePick/autoDubPref`（及 store 已有 voiceId）为准，仅当表单没选过时才用 localStorage 兜底；插件选的音色不再被旧偏好覆盖。
  - **F-02**：`HomePage` 04 工作区在「新建」表单里不再渲染 `WorkspaceMaterialsPanel`（旧 `projectId` 跨页面保留，会显示上一个项目素材），只显示「启动后会创建工作区」说明。真实面板进入编辑器后由该项目工作区承载。
  - 新增 `projectStore.audit.test.ts` 2 例（reset 全覆盖）。`HomePage.test.tsx` 20 + `EditorPage.test.tsx` 6 全绿。
- F-03～F-12（第四轮续，首页可见结果）：
  - **F-03**：`predict-script` effect 加代际号 + 内容指纹；换稿/清空后旧响应直接丢弃，不再弹过期预判卡片。
  - **F-04**：启动摘要配音三态（已上传配音 / 自动配音（音色名）/ 画面优先 / 无配音），不再在选了音色时写「无配音」。
  - **F-05**：`launch` 与 `openBlank` 的离线回退统一受 `allowDemoFallback` 控制；非网络错误显式报错并复位 `launching`，不静默滑进不会保存的本地项目；`openBlank` 失败/离线时清空 requirements 残留（E-04）。
  - **F-06**：工作区创建失败从 `console.warn` 改为 toast（含后端 detail 与「重建工作区」指引）。
  - **F-07**：步骤注释编号连续化（03.5 → 05，第二个 04 → 06）。
  - **F-08**：新增 `DEFAULT_PLUGIN_ID`；`stepDone.style` 不再因默认 pluginId 恒真；摘要如实显示「使用默认：…」或「类型列表加载失败」。
  - **F-09**：`applyPrediction` 新增 `durationOverride` 使「预估时长」真正生效；类型匹配优先用后端插件列表（含自定义类型），再回落内置关键词表。
  - **F-10**：Agent 数文案 六→七；后端地址读真实 baseURL，失败显示「未知地址」（不再写死 localhost:8000）。
  - **F-11**：`loop` 档位 `disabled` 并注明「暂未支持」。
  - **F-12**：`dataMode` 初值改 `'live'`（首屏不再闪「演示数据」）；页脚去掉 `v0.1.0 · Phase 5`。
  - 红→绿：`HomePage.test.tsx` 新增 4 例（F-08 摘要、F-04 配音态、F-03 过期预判丢弃、F-12 不闪演示数据）→ 24 passed（+`splitScript` 8 = 32）。
- F-13 / M-09 / BE-09（第八轮，P3 收尾）：
  - **F-13**：`HomePage` 的 `RulerStrip` 死组件（无引用，注释自认已被 HomeSidebar 替代）删除。
  - **M-09**：①`WorkspaceMediaTree` 目录行计数改为过滤后 `d.files.length`（旧 `d.count` 与搜索结果不符）；②`AssetPanel` 的 `asset.filename/kind`、`r.title/source/reason` 过 `asText`；③`PluginPanel` 插件 tab 改为**只挂载激活 tab**（旧实现全部 tab 立即请求 UI），tab key 从派生前缀改为 pluginId；④`assetStore.searchQuery` 确认死字段——移除 `setSearchQuery`，字段留占位注释。
  - **M-09 未做**：`mediaManager` AudioContext 关闭与 crossOrigin 项（涉及解码池/预览回归，需独立包验证）；`WorkspaceMaterialsPanel` 扫描 SSE 关流（当前卸载才关，属可接受行为，改动需重新验证事件不丢）。
  - **BE-09**：①`/render/thumbnail` 的 `time_sec` 加范围校验（数字、非 NaN/Inf、钳 [0,36000]，旧实现任意值拼进 ffmpeg 命令行）；②`project.py` 的 `get_thumbnail` 同步 ffmpeg 挪到 `asyncio.to_thread`（不再阻塞事件循环）；③`workspace.py` 事件 SSE 每轮 `request.is_disconnected()` 提前退出（旧实现断开后永远空转写 keep-alive）。
  - **BE-09 未做**：Mongo 挂掉静默失效、插件 sys.path 只加不除、preset 字段重复声明（结构性，留待后续）。
  - 回归：后端 7 个文件 **70 passed**；前端 tsc/全量/build 见下方验证行。
- KK-09 死代码与内存泄漏（第七轮续，用户要求 commit 前收尾）：
  - 全仓核对：`_finish` **零调用**（死代码），docstring 里混入代码文本（`self._reset_task_state(task.id)（M3 后不再按 steps…`）且不写 terminal_reason → 整体删除。
  - `_reset_task_state` 此前同样零调用（`_PROGRESS`/`_REPEAT_FAILS` 按 task_id 只进不出，长驻进程泄漏）→ 接入 `_record_task_metrics`（所有终态路径的唯一汇合点）。
  - 回归：`tests/test_agent_kernel.py` + 审计测试 32 passed；`py_compile`/`import clipwright.main` exit 0。
- E-06 逐项复核（第七轮，PRD §5A 待复核清单）：
  - **线索 1（确认，已修）**：`resetPipeline()` 只清内存不清 `pipelineSession` 持久化 → 切项目刷新后旧 pipelineId 复活并重连 SSE。`agentStore.resetPipeline` 现在先 `clearPipelineId()`；回归用例：save → reset → `loadPipelineId()` 为 null（`agentStore.test.ts` 10 passed）。
  - **线索 2（不成立，关闭）**：tabSync 的 1s 过滤是**本地保存后广播 → 本标签自己收到**的回环抑制；BroadcastChannel 本就不投递给发送方页面，且事件带 `at` 时间戳与 projectId 过滤。核对 `tabSync.ts` + `EditorPage.tsx:694-713` 后确认无跨标签误滤路径。
  - **线索 3（确认，已修）**：`pagehide`+`beforeunload` 同一关页动作都会触发 → 双 keepalive PUT。`EditorPage` flush 加 `pageTeardownFlushed` 标记，一次关页只冲刷一次。
  - **线索 4（不成立，有测试佐证）**：`useSessionTimeline._subs` 首 cleanup 直接 delete 在当前**单调用点**（SessionTimeline.tsx:493）语义下不会提前断流（retryTick 重建走完整 teardown→重建）。新增双消费者测试证明：卸载一个不断流、全卸载才关流、下个消费者重建（`useSessionTimeline.subs.test.tsx`）。
  - **线索 5（确认，已修）**：`sseStream.reconnect()` 不清旧连接与挂起重连定时器 → 双连接双份事件。先 clearTimeout + es.close() 再 open；新增 `sseStream.reconnect.test.ts` 2 例（旧连接被关、挂起定时器被取消）。
  - **线索 6（确认，已修）**：HomePage 的候选选题 title/reason、预判卡四个字段、人格 tone/名称、音色名/provider 全部过 `asText`。
  - **线索 7（确认，已修）**：`restoreAgentState` 恢复的 `requirementsMessages` 统一把 `streaming` 收敛为 false（刷新残留打字光标）；回归用例加入 `agentStore.test.ts`。
  - **线索 8（确认，已修）**：终态时 `RequirementsView` 的忙碌条整体不渲染（`busyLabel` 在 `pipeline_done/idle` 置空），stageHint 残留不可见。**注意**：stageHint 是 RequirementsView 的本地 state，终态事件在 BottomBar 的流里——在 BottomBar 里 setStageHint 会踩错组件作用域（tsc 已验证），因此采用视图层收敛而非跨组件清除。
  - **E-05（维持观察）**：CopilotDock 按标签卸载确实会触发 cancelInFlight + SSE close，但两条路径均有恢复机制（`openSSE` 重挂即重连、lastSeq 按单调 seq 去重回放）；切标签丢草稿属低频且无用户实测报告。**维持「低优先级观察」，先不改架构**；若实测复现，再按 plan 把流上移常驻层。
  - 回归：`agentStore.test.ts` 10、`sseStream.reconnect.test.ts` 2、`useSessionTimeline.subs.test.tsx` 1、HomePage 32、AgentPanel 36 全绿。
- BE-08 / PL-12（第六轮）：
  - **BE-08**：`api/project.py` 的 duplicate——owner 补写失败不再 `except Exception: pass`；改为回滚删除无主副本并返回 500（删除失败也要留 error 日志）。账号系统剥离后 `owner_id` 恒 None，正常路径不写归属、无无主风险；多用户恢复时该分支才生效。
  - **PL-12**：①`usePluginSlots` 的 `useState` 初始化改读 `slot:${slot}`（与 `fetchSlotContributions` 写入键一致，旧实现裸 `slot` 永不命中、每次挂载多发请求）；②`ModelsPage.loadConfig` 离线时不再伪造 `qwen-max/bge-m3/bge-reranker` 假配置，只说明「无法读取」；③「恢复默认」失败写 `configError` 的路径复核确认已在配置弹窗可见（未重复改）。
  - 新增 `tests/clipwright/test_ux_audit_backend_r6_2026_11_12.py` 3 例（BE-08 源码级契约 ×2、PL-12 缓存键 node 检查 ×1）。
  - 回归：后端 9 个文件 → **94 passed**（含 `test_project_manager.py`/`test_project_archive.py`）；前端 `tsc` + **151 文件 / 1329 passed** + build 通过。
- BE-06/BE-07（第五轮）：
  - **BE-06**：`api/render.py` 新增 `_validate_render_params(params)`，在 `/render/start` 的 `_resolve_settings` 之后、入队之前校验 `fps/width/height/bitrate/audio_bitrate/pix_fmt/encoder`；非法时返回 **422 `{"errors": [...]}`** 并逐字段说明（旧实现要等进队列后才 failed）。`bitrate` 接受 `cqNN` 与 `1–5位数字+k/m`（含 `5M`）；`pix_fmt/encoder` 只允许安全字符集（顺带挡注入形态）。
  - **BE-07**：`api/pipeline.py` 的 task trace 流 `cursor` 改为从 `request.query_params["since_seq"]` 派生（旧实现写死 `cursor = 0`，断线重连全量重放），并在每轮循环 `await request.is_disconnected()` 时提前退出。
  - 新增 `tests/clipwright/test_ux_audit_backend_r5_2026_11_11.py` 9 例：合法/非法参数各字段、`5M` 大写 ABR、错误文本单行可读、since_seq 与断连的源码级契约断言。
  - 回归：后端 8 个文件 → **84 passed**；`import clipwright.main` exit 0。
- TL-10/11/12、PL-11（第五轮）：
  - **TL-11**：`PropertiesPanel` 新增 `safeKeyframes(clip)`（非数组/undefined → 空数组），替换全部 `clip.keyframes.map/.length`、`interpolateProperties(clip.keyframes,…)`、`clip.keyframes ?? []`。新增 `PropertiesPanel.keyframes.test.tsx` 2 例（undefined 与脏对象）。**该测试在只改 `.map/.length` 时仍红**（`keyframes is not iterable`），补上 `interpolateProperties` 两处后才转绿——说明测试确实抓到了遗漏点。
  - **TL-10**：`PropertiesPanel` 模块级 `window pointerdown/pointerup` 监听改为可替换句柄（`globalThis.__clipwrightPointerGuard`），模块重新求值（HMR）时先摘旧监听再加新的，不再叠加。
  - **TL-12**：复核 `BezierCurveEditor.handlePointer` 已用 `getBoundingClientRect().width/height` 归一化到 viewBox `size`，DPI/缩放不再错位；`BezierCurveEditor.test.tsx` 已按 132×132 矩形覆盖。**按「已正确」记录，不改代码**。
  - **PL-11**：`PersonaGalleryPanel` 的 `persona.version`/`persona_name`/`positioning ?? tone`/`knowledge_domains`/`cut_density_tier` 过 `asText`/`textList`（旧实现 `identity.knowledge_domains ?? []` 在非数组时会崩）。
  - 回归：`properties` + `settings` + `PersonaPage`/`PersonaDetailPage` 共 49 passed（含新增 2 例）。
- M-07/M-08、PL-10（第四轮续）：
  - **M-07**：`DubView.handleAddToTimeline` 在 `segs.length === 0` 时提前返回并提示，不再 push 历史/建空音轨；缺省段时长口径改为与 `handleConfirm` 一致的 3s（旧实现用 `dubTotal/segs.length`，与写入 projectStore 的区间错位/重叠）。
  - **M-08**：音色列表加载失败不再 `.catch(()=>{})`，记录 `voicesError` 并提供「重试」按钮；配音失败也提供「重试配音」。音色下拉的 `voice_name/provider` 过 `asText`。
  - **PL-10**：`PluginsPanel` 的 `p.id`/`description`/`health.issues`/`missing_dependencies`/`h.plugin_id`/`h.version`/`e.plugin_id`/`e.phase`/`e.message`/`e.details` 统一 `asText`/`textList`。
  - 红→绿：`DubView.test.tsx` 新增 3 例（空段不建轨、音色失败重试、配音失败重试）→ 5 passed；`PluginsPage.test.tsx` 16 + `TypeSpecEditor` 7 passed。
- BE-05 / PL-06（第四轮）：
  - **BE-05**：`api/render.py` 新增 `_release_cancelled_render(task_id)`；排队等待循环每轮检查 `status == "cancelled"` 并立即清理后退出，`_run` 开头的取消分支也调用它。旧实现在「排队后 cancelled」直接 `return`，早于清理 `finally` → 内存条目与 `_idempotency_render` 键永久残留 `/queue`。
  - **PL-06**：`ProvidersPage.removeSource/removeModel` 加 `window.confirm`，说明会解绑角色/模型不可用；取消则不发 DELETE。
  - 红→绿/回归：`ProvidersPage.test.tsx` 删除模型用例改为需确认（并新增「取消则不删」1 例）→ 26 passed；`py_compile` + `import clipwright.main` 通过；后端 66 passed。
- W10 / P-01（导出当前帧可能是上一帧）：
  - `mediaManager` 新增 `seekVideoAndWait`（等 `seeked` 且 readyState≥2，超时 1.5s 返回 false）与 `prepareFrameAt(clips, t)`（批量等待与目标时刻相交的可见视频）。
  - `PreviewPanel` 的「导出当前帧」改为异步：先 `await prepareFrameAt`，未就绪时 toast 提示并**不导出**（宁可不给也不给错图），就绪后才离屏合成与 `toDataURL`。
  - 新增 `exportFrameReadiness.test.ts` 2 例；`src/features/preview` 14 文件 144 passed；tsc 干净。
  - **未做**：P-02/P-03（单击/双击播放语义，属产品口径）、P-04/P-05（关键帧手柄与撤销点）、P-06～P-09。
- W12 / PL-09（TTS provider 硬编码）：
  - `VoicePage.useTtsProviders` 初始值改为空数组（原写死 `['qwen-tts','cosyvoice','minimax']`），一律从 `/api/providers/available` 派生；克隆弹窗的默认 provider 取列表第一项，取不到时显示「未获取到可用的 TTS provider」并在提交前拦截。
  - `voiceStore.cloneVoice` 默认 provider 由 `'qwen_tts'` 改为空串（显式由调用方传入，缺省交给后端）。
  - 既有 2 个「回落内置三项」用例按新契约改写为「如实为空」。`VoicePage.providers.test.tsx` 4 passed。
- 后端 W02/W03/W04（`J:\Clipwright`）：
  - `requirements_service.py`：stop 取消失败返回 `stopped:false`+`cancel_error` 且不改会话状态（B-03）；新增 `_still_owns_session()` 并接入 `_release_session_after_task` / `_release_session_missing_task`（B-01）；最后一条带 `user_stopped`+同 task_id 时只校正状态不追加第二条说明（B-02）；stale 扫描覆盖 `planning` 且 `close_open("interrupted")`（B-04）；watcher 超时前对终态任务补释放一次（B-05）。
  - `agent_run.py` 新增 `cancel_for_task(task_id)`；`agent_kernel.cancel` 调用它取消在飞子 run（KK-03）；run-loop aborted 分支保留 terminal_reason=user_cancelled 且不覆盖已有清单（KK-08）。
  - `agent_kernel._gate_hit` 金额闸改比 `escrow.main_spent_usd`（KK-01）；`_success_terminal_reason` 收口判断提到 `tool_loop_completed` 之前（KK-02）；`status` 改由 `terminal_reason` 派生（KK-05）；情景记忆 capped 归 failure（KK-06）；`evaluation._EXCLUDED_FROM_RATE` 加入 `cancelled`（KK-09）。
  - `api/requirements.py` 附件改分块读取、超限即时 413、解析类错误 422 带 filename/format/reason（B-06/BE-01）；`api/task.py` 异常路径 task_end 补齐 completed/unfinished 并同步 Task 终态，时间线回写失败记 error + warning 事件（BE-03/BE-04）。
  - 新增 `tests/clipwright/test_ux_audit_backend_2026_11_11.py` 12 例。**反向验证**：`git stash` 掉 agent_kernel 改动后 2 例红，恢复后 12 例绿。
  - 回归：`tests/test_task_api.py`、`test_event_contract.py`、`test_agent_kernel.py`、`test_agent_run.py`、`test_run_addressing_api.py`、`test_agent_run_replay.py`、新增审计测试、`test_audit_fixes_2026_11_10.py`、`test_requirements_image_upload.py` → **79 passed**；`python -c "import clipwright.main"` exit 0。
  - **未做**：BE-05（render 排队取消立即清理）、BE-06（/render/start 字段级 4xx）、BE-07（pipeline trace since_seq）、BE-08（duplicate owner 回滚）、BE-02/BE-09（zip 流式、ffmpeg 线程池、SSE 断连等）。

## 4. 未完成项与后续建议

PRD 全量仍未关闭。以下按优先级列出本轮**未做**的编号，建议下一轮继续：

| 优先级 | 编号 | 说明 |
|---|---|---|
| P2 | TL-06/07/08、P-02～P-09 | 波纹删除跨轨、嵌套序列、trim 钳制、预览单击/双击语义与性能（**需产品口径**，见 coding plan §1） |
| P3 | BE-09 部分未做（Mongo 静默失效、sys.path 只加不除、preset 字段重复）；M-09 的 mediaManager AudioContext/crossOrigin 两项 | 结构性或需独立回归包，留待后续 |
| 待复核 | E-05/E-06 | **E-06 已逐项核实并处理**（见下方记录）；E-05 维持「低优先级观察」——唯一中断路径已有 cancelInFlight 挽救逻辑与恢复流程，等用户实测再上移连接所有权 |

**W01 的跨仓尾巴**：前端已默认拒绝任意插件 API 调用，但后端「插件专用受限代理 + 服务端权限裁定」尚未实现。在此之前该项只能算「前端收口」，不能宣称 PRD 的 PL-01/PL-02 已完全关闭。
