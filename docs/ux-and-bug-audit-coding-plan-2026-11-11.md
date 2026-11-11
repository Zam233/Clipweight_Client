# 前后端缺陷与体验优化 Coding Plan

> 依据：[代码审计 PRD](ux-and-bug-audit-prd-2026-11-09.md)；适用前端 `J:\Clipweight-Client` 与后端 `J:\Clipwright`。这是**待实施的施工计划**，不宣称缺陷已修复。PRD 行号指审计当时快照；开工前按当前分支复核。本文不直接修改两仓代码，不自动提交/推送。

## 0. 基线、范围与执行纪律

- 以 PRD 的**全部编号**为输入：B/F/P/S/T/E/M/TL/PL/BE/KK/X；§5A～5F 是后补审计，不能只按 PRD §7 的四批建议施工。`B-06` 与 `BE-01` 同一上传入口，`KK-02/05/06` 同一收口终态根因，合并实现但验收逐条留痕；X 为横切设计原则，不重复计缺陷数。PRD §0 的 12/20/9 是早期摘要，**不作为全量计数或进度分母**；含“其余收尾”的编号是容器，须逐项打勾。
- 当前前端工作树已有大量用户改动，源 PRD 也尚未跟踪；不得清理、覆盖、暂存或提交它们。每个实施包开工记录两仓 HEAD/分支/工作树，先辨别是否已有并行修复；只做本包最小变更。后端在另一仓库，当前会话的写权限仅覆盖前端工作区；实施后端包前须在后端仓库取得合法写权限，**不得绕开 sandbox**。
- 跨仓接口先固定请求/响应/事件契约，再做后端与前端兼容适配；不得把测试 mock 作为生产门禁。每项记录 `复核证据 → 复现用例（先红）→ 变更 → 回归（转绿）→ 人工走查 → PRD 编号/提交或 PR 链接`。无证据/无法复现的线索标 `待验证`，不得擅自标已修。
- 不能突破既有不变量：`done` 才映射 `pipeline_done`；任务及 run 身份隔离；每任务一条共享 SSE 且终态关流；`task_end.detail.completed/unfinished` 存在；接口/模型字段过 `asText/textList`；插件能力与权限不硬编码在 agent，UI 插件不能获得宿主任意 API 凭据；工作区目录树是文件存在性的权威；`capped` 独立于 `done`，不计成功率。

### 0.1 已抽核的现状（不是逐项全量复核）

- 前端自动启动 hook 会清空自身依赖的 topic，而 effect cleanup 改变 `cancelled`：`src/features/agent/useRequirementsAutoStart.ts:21-33,145-149`（E-01）。
- 项目切换快照只取部分字段，且 ref 没有项目键：`src/pages/EditorPage.tsx:105-152`；首页在创建前写入启动字段且启动时重新读旧 voice prefs：`src/pages/HomePage.tsx:470-507`（E-02/03/04、F-01）。
- `loadEditorPrefs()` 返回值缺三个设置，而读者从返回值取：`src/stores/settingsStore.ts:53-85,106-140`（E-07）。
- `setTimeline` 无条件清 dirty、history 恢复调用它：`src/stores/timelineStore.ts:118-125`、`src/stores/historyStore.ts:97-99`（TL-01/03）；slide 已有测试但未覆盖短右邻居：`src/stores/timelineStore.test.ts:365-385`（TL-02）。
- iframe call 与快捷键分别将插件 endpoint 直通宿主客户端：`src/features/plugins/PluginBundleFrame.tsx:71-98`、`src/features/plugins/usePluginShortcuts.ts:36-58`（PL-01/02）；iframe 的 source/origin 校验不是**授权**。切勿把“限制为 `/api/` 前缀”当作足够防护。
- 会话时间线只在条目数量变化时跟随，顶部加载无锚点：`src/features/sessionTimeline/SessionTimeline.tsx:449-470`；task store 裁剪后不更新 oldest 游标、start 未检查 refused：`src/stores/taskStore.ts:280-305,340-385`。
- 后端抽核：`J:\Clipwright\clipwright\services\requirements_service.py:3443-3453,3498-3539,3568-3613` 的取消异常继续写“已停止”、watcher 释放未绑定任务归属且超时只记日志；`J:\Clipwright\clipwright\services\agent_kernel.py:1910-1919,1959-1968` 的主预算按总费用比较、收口 finish 优先算 achieved；`J:\Clipwright\clipwright\api\requirements.py:418-432` 的附件整读与错误归一 500；`J:\Clipwright\clipwright\api\task.py:93-121` 的异常 task_end 字段缺失、回写异常静默。均仍需先写失败复现并查实际调用链；不是已实施结论。
- 其余后端及子审计项按 PRD 证据定位，下面只给施工入口；各包先重读当前代码、已存测试和行为再确定最小补丁。既存计划 [Agent 终止机制 devplan](agent-termination-devplan-2026-11-02.md) 的历史“已落地”指旧目标，不等于这份审计的 KK 缺陷已解决。

## 1. 先定契约与产品决策

| 决策 | 默认实施口径（需产品确认者在施工前确认） | 门禁 |
|---|---|---|
| P-02/03 | 画布单击只做选中/取消选中；播放走显式按钮与空格，双击文字不改变播放态 | 预览交互 E2E 固定。若要保留单击播放，先定义双击判定延迟和空白处语义 |
| F-05 | 离线演示只在 `allowDemoFallback=true` 且确为网络故障时进入，常驻“演示·不保存”标识；401/403/4xx 永不静默降级 | 后端正常而创建失败必须保留输入、不导航 |
| T-08 | 当前生成中的思考默认展开，完成历史默认折叠；用户手动展开状态保留在当前会话 UI | 新条目状态改变时不抢用户手动操作 |
| TL-01/03 | `setTimeline` 必须区分 `server-hydrate` 与 `local-edit`；落盘版本/快照是 dirty 比较基线，异步保存只能确认自己提交的版本 | 旧项目载入不误标 dirty；撤销/导入后不误清 |
| TL-06/07 | 波纹删除对“窗口内未删除片段”的裁切/移动/拒绝策略，以及嵌套跨轨映射须先定样例与持久化契约 | 没有确定行为前不能靠单个时间偏移实现 |
| PL-01/02 | 默认拒绝插件发起的任意宿主 API；后端定义 per-plugin、per-endpoint、per-method 的授权策略与签名/启停绑定；只给明确批准的只读 GET 和具体可枚举动作，危险操作拒绝或用户显式逐次确认 | 客户端白名单只是防误用，服务端仍强制权限与资源归属；相对路径、编码、查询与大小写规范化后再比对 |
| KK-07 | `cost_unknown` 不当作零费用释放预留，状态保留 unknown 并显式披露账单不确定；需与账单来源协商结算策略 | 不可伪装成 0 或重复计费 |

## 2. 交付分组（按依赖而非页面罗列）

依赖图：`G0 复核/测试夹具 → G1 安全与任务终态/取消 → G2 首页启动/项目隔离 → G3 时间线持久化/不变量 → G4 预览/会话可用性 → G5 素材/工作区/插件设置 → G6 P3 收口与全链路验收`；这是发布验收顺序，不是要求所有包串行。G1 与 G2 可并行；G3 的数据不变量先于复杂 UI；G4/G5 可按前端子域并行。每个 W 是工作流/验收单元，**不是一张巨型 PR**：按下表的最小切片拆 PR，后端跨仓变更采用兼容契约+前端消费的成对 PR。推荐先做阻断级的 W01 安全封口，再并行 W02/W05/W07；**W11 的 M-01/02 与 W12 的 PL-03 也是白屏类 P1，应和首批并行，不等后续 G5**。W03/W04 后端契约稳定后联调 W09，数据不变量 W07/08 通过后才合并 W10 的复杂交互。

| 工作流 | 优先级与先决条件 | 首批可独立合并的切片；粗估工程量（人日，含单测，不含人工验收） |
|---|---|---|
| W00 | 阻断；开工先行 | 逐项追踪与可控时序 fixture；1–2 |
| W01 | 安全 P1；W00 | 关闭任意代理调用 → 后端受限代理+契约 → 两个前端入口共用门禁；4–7 |
| W02 | 任务 P1；W00 | stop 失败口径/owner CAS → watcher/扫描 → 子 run cancel 与 merge 栅栏 → 前端反馈；5–8 |
| W03 | 账本 P1；W00，终态契约与 W02 对齐 | main budget → capped 单点终态 → replay/unknown 记账 → 统计/记忆；5–8 |
| W04 | API P1/P2；W00 | 上传 413/422 → task_end/回写 → render 排队取消 → trace/duplicate；4–7 |
| W05 | 启动 P1；W00，既有创建接口契约稳定 | prefs/voice 修复 → pendingLaunch 信封 → auto-start/跨项目 → 预测代际；4–7 |
| W06 | 首页 P2；W05 的状态语义 | 启动结果与演示门禁 → 摘要/编号/选项/文案；2–4 |
| W07 | 数据丢失 P1；W00 | dirty 版本语义 → undo/redo → 导入/代理切换与 autosave；3–5 |
| W08 | 时间线 P1/P2；W07，TL-06/07 产品口径 | slide 极值/锁轨 → trim/命中 → ripple/nested → keyframes/手柄；5–9 |
| W09 | 流式 P1/P2；W00，W02 的终态契约 | task 游标/拒绝 → 时间线滚动/跟随 → 按钮/错误 → E-05/06 复核；4–7 |
| W10 | 预览 P1/P2；W07/08 与交互决策 | 导帧等待 → 单/双击语义 → 渲染性能/全屏；3–6 |
| W11 | 素材 P1/P2；M-01/02 可立即做，其余依赖 W05 项目隔离 | 数据归一化/代际 → 上传刷新/反馈 → AI 轨/配音；4–7 |
| W12 | 插件 P1/P2；PL-03 可立即做，其余安全接口依赖 W01 | layout 文本边界 → enable/API 错误 → Providers/Voice；3–5 |
| W13 | 服务端 I/O P2/P3；W04 请求语义 | zip/缩略图 → SSE/持久化 → 参数校验与索引；3–6 |
| W14 | P3/待验证；相关 W 完成 | 按容器子项拆 1–2 天 PR；总量只在 W00 复核后估算 |

工程量是排期占位而非承诺，不能把这些相加当交付日期：有重叠项、跨仓联调和待验证项。每张切片 PR 必须只有一个主不变量/同根缺陷族，附对应失败复现与验收；后续切片不可因上一个包“绿色”而跳过自身回归。

### G0 · 复核与回归夹具（先做，不算修复）

- W00：建立一张逐项追踪表（PRD 编号、优先级、现状/复现、实现包、测试、人工验收、结果/链接）；特别重读 §5A E-05/06、§5B～5F 子审计 P2/P3 和 `KK-09` 的待复现。已修复、误报、重项要附代码/测试证据并标状态，而非直接删号。
- 可控时序夹具：后端现成的 `tests/test_agent_kernel.py`、`tests/test_agent_run.py`、`tests/test_task_api.py` 可扩展软着陆/单 run 取消/任务 API 用例，但当前未见上述跨层时序覆盖；新增用例必须测试取消与阶段完成同一事件循环交错。前端 deferred promise、项目切换 epoch、scrollHeight/scrollTop 模拟、`HTMLMediaElement.seeked`、renderHook StrictMode。现有 `EditorPage.test.tsx` **mock 掉了** `useRequirementsAutoStart`，不能证明 E-01 已覆盖；须新增 hook 真实 effect 测试。`src/features/sessionTimeline/` 暂无对应单测，先建滚动/订阅测试。所有回归优先写失败复现而非凭肉眼改代码。
- API 对账：建立 `stop` 返回、`task_end.detail`（成功/失败/取消/capped）、`resume.refused`、`workspace`/上传错误形状与插件调用权限的兼容 fixtures；前后端版本不同步时容忍旧字段，但**不把未知值当成功**。

### G1 · 安全、会话归属与 kernel 终态（阻断级）

**W01 插件代理授权（PL-01/02）**。前端 `PluginBundleFrame.tsx`、`usePluginShortcuts.ts` 提取统一 `authorizePluginCall`/请求桥；在注册、调用两个时点规范化 endpoint/method，并携带 pluginId 与贡献 id；禁止跨源 URL、`..`、编码绕过、未列端点、DELETE/PUT/PATCH 等未经授权方法。**不能让插件调用继续借普通宿主令牌直达任意业务 API**：后端提供插件专用代理端点，按服务端可信的 pluginId/manifest/启停/签名配置执行 per-plugin、per-method、per-route 允许列表与资源归属检查；普通宿主 API 原有权限不因该代理放宽，不能信 iframe 自报身份。功能不可兼容时先**关闭 iframe call/shortcut 写操作**，再以契约逐一启用。测已批准 GET、未知端点、变体路径、未签名/被禁用插件、危险方法、伪造消息、插件切换后的过期回包；拒绝有稳定错误码且不向目标业务端点发请求。

**W02 会话状态 owner 与停止（B-01/02/03/04/05，KK-03/08；关联 E-01）**。后端 `requirements_service.stop_task/watch_task_session/_release_session_after_task/release_stale_pipeline_sessions`：一次确认活任务 A → cancel 成功才记 `user_stopped` 与 `stopped:true`；异常保留 running、不伪造说明；释放须在**同一会话级原子临界区/条件写**中核对绑定 task id 与状态（读出后再无条件 `_persist` 仍可被 B 插队），A watcher 不得释放 B；`_release_session_missing_task` 也须同一归属校验，`_live_task_id()` 只找非终态任务，不能单独证明旧任务仍拥有会话；`stop_task` 的“无活任务”路径也须重新核对当前绑定的任务/会话状态，不得在新任务启动后把 B 放开；同一 A 已有 `user_stopped` 只校正状态不新增第二条；重启扫描覆盖 `planning`/`pipeline_running`，但仅在确认当前会话无有效活任务/派发租约后释放并 `close_open('interrupted')`，不能误放开仍在进行的 planning；超时退出终态再查一次或接事件，不能静默悬挂（当前 3600×2s=2 小时，日志误写“一小时”）。`agent_kernel.cancel` 延伸取消本 task 的在飞 `_LIVE` 子 run，可复用 `agent_run` 的按 run 取消入口，但须按 task_id 过滤；明确“已接收停止”与“已确认全部子任务停止”的响应语义：await/隔离取消结果，未确认不可谎称完全停止；`stage_merge` 在写黑板前校验取消 epoch/run 归属；两处 finish 都写 `user_cancelled`。前端运行条区分 `stopped:false` 的可重试错误。测试矩阵：A 停 → B 起 → A watcher；并发 A/B；cancel 抛错；重复 stop；planning 重启；超时前后终态；子 run 取消中竞态且不能追加黑板或继续发起付费调用，**已实际发生的费用仍据实记账**；cancel 成功只一条消息。**先约束状态 owner，再修 UI 读状态**。

**W03 kernel 收口与预算（KK-01/02/04/05/06/07；KK-09 的 success-rate、cleanup/blocked/报告项）**。在 `_gate_hit` 比 `escrow.main_spent_usd` 与 main_budget；收口模式判定先于 `tool_loop_completed→achieved`；同一 `terminal_reason` 单点派生 `TaskStatus`、finish、task_end、情景记忆和 evaluation，不许 capped=done。replayed quality 结果按 run_id/attempt/账单键幂等计费；`cost_unknown` 单独状态。取消任务从成功率分母排除（先确认指标产品口径），每个 task 终态/异常清 `_PROGRESS/_REPEAT_FAILS`，结构性 blocked 只在 blocker 连续达阈值触发。检查 ok 路径收口报告与 deliverable_status（不能从“模型正常结束”推断已交付）；旧 checkpoint/reason 兼容。测试：main 0.8+quality 0.1、main_budget 0.9 不触闸；主预算超才进收口；收口正常 finish=capped；回放两次账只算一次；unknown/取消/失败/capped 的状态、报表、记忆与分母一致。`KK-09` 的死代码清理/配置空串仅在有独立复现后做。

**W04 服务端契约、上传和运行可靠性（B-06=BE-01，BE-03/04/05/06/07/08）**。需求上传 20 MiB 限制：先检查可信 size（若提供），仍逐块限定累计读取/写临时文件，超过 413 并清理；损坏格式 422 `{filename,format,reason}`，内部异常 500 脱敏；既有解析器若必须 bytes，只能在限流后读，峰值受 20 MiB 控制。`task.py` 的所有 `task_end` 分支填 completed/unfinished，并让异常路径的 Task 终态/finish/checkpoint 与事件一致；timeline 回写与成功结论的先后次序明确：优先在发布最终成功事件前回写/验证，失败记 error 并发布一致的非成功或部分交付结论；若必须异步补偿，定义可追踪的纠正事件，不能先宣称“已完成”后静默失败。排队 render 取消立即清队列与幂等键；/render/start 4xx 归因；pipeline trace `since_seq` 与 disconnect；duplicate owner 失败回滚/不返回无主副本（BE-08 须按已剥离账号系统后的本地 token/兼容层重新评估影响与优先级）。BE-02 大媒体 zip 在 G5 合入；各自写 API/事件测试和断线、429/413/422、异常清理用例。

### G2 · 首页到编辑器无损启动（高优先级）

**W05 原子启动信封（E-01/02/03/04，F-01/02/03，E-07）**。`HomePage.launch/openBlank` 成功创建项目之后才提交项目绑定的 `pendingLaunch={forProjectId,nonce,topic,script,voiceId,autoDub,dryRun,workspace...,creative...,shot...,cutOnBeat...}`，失败留草稿但不污染全局待启动字段；仅文稿无选题时也必须构造明确的启动意图，不能因 `topic=''` 跳过自动启动；本地演示也必须显式项目归属。`EditorPage` 消费时校验 projectId+nonce，StrictMode 只消费一次，组件内 A→B 重置/重新采集且异步返回按代际丢弃；`projectStore.resetProject()` 由单一 INITIAL 生成，恢复字段与 `pendingLaunch` 字段清单做契约测试；`useRequirementsAutoStart` 消费 topic 时不能自触发 cleanup，项目切换/卸载要取消 A 的写入；busy 必须由当前项目/请求代际清理，旧 A 的 finally 不得把 B 的 busy 清掉，首轮成功/失败都有终态。插件音色/autoDub 以当前受控表单值为权威，localStorage 仅初始化；新建表单不拿旧 projectId 显示/写入素材。预测请求加 Abort/epoch，清空或换稿丢过期结果。设置偏好从原始 editorPrefs 读出并校验 fps/res/autoSave；新建空项目应用读回值。测试：StrictMode hook、A→B、失败后 openBlank、旧 voice pref 不覆盖、全部开关逐项保留、预测逆序完成、settings 写→重建 store→读。

**W06 首页可见结果（F-04～F-12）**。配音摘要三态；项目/工作区创建失败分别可见 toast 与“重建工作区”入口；离线回退遵循 §1；步骤连续编号+可选状态、默认风格与类型加载错误/重试、一键预测的类型匹配及时长生效或更名、7 Agent/真实 baseURL/格式文案、未支持的循环填充禁用、首屏 loading 不伪装 demo。测试 HomePage 交互/失败路径与浏览器刷新；F-13 延后清理。

### G3 · 时间线数据不变量与持久化

**W07 dirty/历史（TL-01/03）**。`timelineStore.setTimeline` 的 server hydrate 与 local replace 分开（调用方 `historyStore.swapTimeline`、JSON 导入、代理切换显式选来源），保存成功只清“同版本”的 dirty；撤销回到落盘快照可清，撤销到不同快照保持 dirty，失败保存不清；挂在 autosave 的持久化语义不要只看曾调用过 `setTimeline`。扩展 `timelineStore.test.ts`、`historyStore.test.ts`、`EditorToolbar.test.tsx` 和离开/刷新集成。

**W08 编辑约束（TL-02/04/05/06/07/08/09/10/11/12；P-04/05）**。先修 `slideClip` 正向按 next 可缩时长、反向按 prev 可缩时长，所有邻接保持 >=0.1s；`TimelineEngine` 投放与 store 最终写入双层拒绝 locked/hidden（隐藏轨永不自动选），属性/删除/切分、键盘命中同口径；面板起止与画布共用 trim 边界。波纹删除与嵌套往返先落实 §1 的跨轨契约再各做模型测试。关键帧手柄和渲染用同一个时刻插值，拖动选择“写当前关键帧或拒绝并提示”不得静默改基础值；只有真实位移入撤销栈。keyframes 缺省 `[]`，模块监听用 effect 清理，Bezier 坐标按实际 rect 转 SVG viewBox。测试 A(10s)/B(1s)/C(1s) 右移极值、锁/隐藏/跨轨/撤销、DPR=2 与缩放、缺省 keyframes；最后处理 TL-13 单项。

### G4 · 流式 UI 与预览

**W09 任务与会话时间线（S-01～06，T-01～08；E-05/06 中 SSE 线索先复现）**。`taskStore.start` 处理 `refused`；400 事件裁剪同时维护 `oldestLoadedSeq/hasEarlierEvents`，历史翻页对 `runEvents` 按 taskId+seq 去重，不跨任务比较；`replan` 后按 epoch+activeTaskId 丢弃旧响应；列表错误/任务错误分槽、成功清理，inject 给确认。SessionTimeline 顶部请求用同步 in-flight ref 防重复，记录 scrollHeight/Top 并在布局后补偿；仅用户接近底部时跟随最后内容增长，用户上滑不抢位置；批准/回答提交后锁定按钮；状态词映射+asText、重连空态、加载更早、思考折叠分别覆盖。E-05、E-06 的 tab/SSE/stream 状态需先测 mount/unmount 与重复事件，再决定是否上移连接所有权；`useSessionTimeline` 的 `_subs` 只有计数、首订阅者 cleanup 直接 `_subs.delete(sessionId)`，必须以多个消费者/切换 retryTick 的可控用例验证是否提前关流和双连接。测试 400+ 裁剪→翻页无洞、A/B 任务逆序返回、连续 3 次 scroll 只一请求、prepend 锚点稳定、同一条流式 delta 在底部跟随但离底不跟随。

**W10 导帧与预览（P-01～09）**。导帧以导出目标时刻构造快照，等所有必需视频 `seeked`/rVFC（设置超时/跨项目取消）再 compositing，视频未就绪绝不出占位 PNG；canvas pointer 行为按 §1；关键帧与撤销见 W08。音频同步从 React 每帧订阅移到既有 rAF 与 store getState（独立时间码小组件），全屏把 mini toolbar 包在 fullscreen 容器；电平表暂停降频/停止，切回标签显式提示。测双击不播放、拖帧导出确是指定帧、超时错误、60s 长时间线播放采样/重渲染次数、全屏键鼠可用。

### G5 · 工作区、素材、设置与剩余服务端体验

**W11 素材边界（M-01～08；F-06）**。详情 `tags/metadata/detail` 先归一化（不可数组/对象时安全缺省）；WorkspaceMaterials 所有不可信字段 `asText/textList`；面板与 AssetPanel 请求按 projectId+epoch 守卫；上传后目录树订阅 refreshCounter 或显式 invalidate，文件上传显示 per-file 进度/状态（若当前 API 不提供总进度，先保证逐文件完成/失败可见），取消/失败后回收状态；AI 结果按素材 kind 入轨，local_path 注册媒体；DubView 空段拒绝，时长口径与 projectStore 同源，音色/配音失败可重试。测脏对象不白屏、A/B 逆序、成功上传立即见文件、图/音正确轨、分段一致。

**W12 插件/设置/API 错误（PL-03～11，T-05/M-09 相关渲染边界）**。`PluginLayoutRenderer/Slot` 及 `PluginsPanel/TypeSpec/Persona` 的字段统一安全文本；enable 开关只在服务端确认成功后 ACTIVE；Providers 重命名按钮/Enter 同一受控提交，删除源/模型二次确认；401/503 与 422 多字段错误集中归一化并在页面显示但不暴露令牌；Voice provider 从 `available.provider_meta` 与 schema 派生，不再按厂商名写分支；显示元数据缺失时仅内置兜底，不猜能力。mock 接口返回 object/null/422 数组、失败启用、重命名与删除确认覆盖。

**W13 后端 I/O（BE-02/09）**。项目大媒体归档走流式 zip entry 写入，不对整文件 `read()`；同步 ffmpeg 挪线程池/任务；legacy sha 索引避免 O(n²)；render/workspace SSE 检断连、Mongo 写失败记录和重试/明确降级，恢复时不把旧非终态伪装活任务；render 参数校验提交时给 4xx；缩略图范围 4xx。每项用稀疏文件/假流模拟 2 GiB、断连、Mongo 异常、非法字段回归；关注磁盘、句柄与 `.part` 清理，不以大文件直接塞测试内存。

### G6 · P3 与非阻断收尾

**W14 逐项清单**：F-13 RulerStrip；P-08/09（若 W10 未做）；S-06；T-07/08（若 W09 未做）；M-09 含搜索计数、直渲染、插件 tab 按需挂载与稳定 key、AudioContext 关闭、图片跨源回退、扫描 SSE 完结关流、assetStore 死字段；TL-13 含空闲 rAF、双击 scrub、终点半开区间、timer 清理、淡入淡出约束、关键帧时间基明确；PL-12 含缓存键统一、演示配置提示或移除、恢复默认错误可见、dict/list 输入、人类可读 provider 名；BE-09 与 KK-09 逐项有单独测试/说明；F-12 重复标题/页脚。E-06 每条先复核：pipelineId、跨标签同步 1s 过滤、双 flush、订阅 refcount、reconnect 双流、首页文本边界、流式光标和 stageHint；确证则补为独立小 PR，否则附反证关闭。P3 不应掩盖 G1/G2 未通过的 blocker。

## 3. 测试、发布与验收门槛

**编号追踪索引**（W00 应落为逐子项记录，不以此简表替代）：`B-01～05→W02，B-06/BE-01→W04；F-01～03→W05，F-04～12→W06，F-13→W14；E-01～04/E-07→W05，E-05/06→W09/W14 先复核；S-01～06、T-01～08→W09；P-01～03/P-06～09→W10，P-04/05→W08；TL-01/03→W07，TL-02/04～12→W08，TL-13→W14；M-01～08→W11，M-09→W14；PL-01/02→W01，PL-03～11→W12，PL-12→W14；BE-02/09→W13，BE-03～08→W04；KK-01/02/04～07→W03，KK-03/08→W02，KK-09→W03/W14；X-01～05→各相关包的设计与验收`。标记 `W09/W14` 或 `W03/W14` 的容器须拆为唯一责任项，不能两边都算完成。

| 关口 | 自动化证据 | 人工验收 |
|---|---|---|
| 任务/终态/安全（G1） | 后端 requirements/task/event contract/kernel/run replay 与插件权限测试；前端 PluginBundleFrame、shortcut、taskStore | 取消后无新付费调用/黑板写入（已发生费用据实披露）；插件越权无目标请求；A→B 无状态回退 |
| 首页/工作区（G2/G5） | HomePage、EditorPage、settingsStore、WorkspaceMaterialsPanel、AssetPanel、DubView 测试 | 新建、失败、离线/401、快速切项目、2 GiB 上传进度与刷新；提示和实际结果一致 |
| 时间线/预览（G3/G4） | timelineStore/historyStore/TimelineEngine/EditorToolbar/PreviewPanel 与 e2e/editor-interactions | 撤销后刷新仍保留、锁轨不可写、无负时长、导出帧与预览一致、双击文字不误播 |
| 流与任务（G4） | taskStore.events、sessionTimeline、e2e/session-timeline、e2e/unified-stream | 逆序返回不串任务/项目；历史加载不跳位，停止/失败/重连有可见反馈 |

执行命令（各仓独立、不要因一个仓通过就宣布全通过）：

```powershell
# J:\Clipweight-Client
npx tsc --noEmit
npm run test
npm run build
npm run test:e2e -- e2e/session-timeline.spec.ts e2e/editor-interactions.spec.ts e2e/home.spec.ts

# J:\Clipwright（由有权限的执行者运行）
python -m pytest tests/test_task_api.py tests/test_event_contract.py tests/clipwright/test_run_addressing_api.py tests/clipwright/test_agent_run_replay.py -q
python -c "import clipwright.main"
# 再跑本包新增的 requirements/kernel/render/workspace/plugin 相关测试；全量 pytest 若既有长跑卡住须记录停点与已通过项
```

- 每包附红→绿的测试名、相关事件/接口 fixture、构建结果、人工复现录屏或关键截图、剩余风险；失败命令不可写“通过”，新旧基线失败要分开。部署次序：插件授权后端先落/旧调用默认拒绝 → 前端使用同一策略；扩展型 task_end 字段先后端后前端，客户端在过渡期只读可识别字段；跨仓 PR 互链。取消链/账本变更建议灰度监控 `stop_error`、`late_merge`、`capped/done`、重复 charge、会话卡 running；有回滚预案，**不通过回滚恢复任意插件 API 调用**。
- 所有代码包完成后更新两仓对应 docs（API、前后端 parity、插件作者说明、运行态、工作区、预览），项目既有执行记录文档按其维护规则追加；这份计划只记录实现进度/证据链接，不用计划文本代替测试。

## 4. 完成定义与风险

- 编号覆盖率：W00 表中 PRD 所有编号（包括“其余收尾”的每个子项）均为 `已修并验收 / 有反证关闭 / 明确延期且获产品接受` 之一；待复核线索不能算已修。B-06/BE-01 等共根项保留两个验收条目。对所有 P1 强制代码级回归与跨仓契约验收；P2/P3 可按包分期，但交付报告不得笼统声称“PRD 全部完成”。
- 高风险并发：停止与新任务交错、取消在飞子 run、async 保存乱序、跨项目数据回流、双 SSE 订阅、流式上传取消清理。测试必须让两个操作可控地反序完成，不能只靠 `setTimeout` 的偶然时序。
- 安全/性能：授权拒绝默认；服务端拥有权限最终裁定；上传/归档以内存峰值、磁盘剩余与临时文件回收验收；预览导帧等待有超时且可取消，不锁主线程。时间线/项目真实数据先备份后做人工往返验证。
- 本计划未执行测试，也未解决 §1 的产品开放问题；若产品选择不同口径，先更新契约/用例再施工，不把默认建议冒充已授权决策。
