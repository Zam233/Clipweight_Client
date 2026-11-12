# 前后端缺陷与体验优化 PRD（代码审计版）

日期：2026-11-09　范围：前端 `J:\Clipweight-Client\src`、后端 `J:\Clipwright\clipwright`
方法：**只读代码**（不参考既有 md 文档），每条结论都附带逐行读过的证据。
本 PRD 只描述问题与验收口径，不包含实现。

---

## 0. 摘要

| 级别 | 含义 | 条数 |
|---|---|---|
| P1 | 功能失效 / 结果与用户操作不符 / 状态错乱 | 12 |
| P2 | 体验明显受损、误导性文案、性能浪费 | 20 |
| P3 | 打磨项、死代码、一致性 | 9 |

优先处理三组：
1. **会话状态竞态（B-01～B-04）**：停止→续跑会被旧 watcher 改回 `plan_ready`，并出现重复说明。
2. **创作页配音选择被覆盖（F-01）**：插件里选的音色在点「开始创作」时被 localStorage 旧偏好覆盖。
3. **会话时间线滚动与流式跟随（T-01、T-02）**：上滑加载历史会连锁触发并跳位；流式思考不会自动跟随到底部。

---

## 1. 后端（会话状态与上传）

### B-01 · P1 · 旧任务 watcher 会把新任务的会话状态改回 `plan_ready`
- **证据**：`services/requirements_service.py:3498-3538`（`watch_task_session` 每 2s 轮询，见终态即调用释放）；`:3568-3613`（`_release_session_after_task` 无条件 `_persist(session_id, new_status, …)`，只有"状态与最后一条消息都相同"才跳过）。
- **现象**：用户点停止（任务 A 被取消）后 2 秒内又说一句话，`_continue_as_task` 拉起任务 B、会话进入 `pipeline_running`；随后 A 的 watcher 看到 A 已终态，把会话写回 `plan_ready`。前端据此恢复输入框，但 B 仍在跑——用户可以重复发起任务，运行条/停止按钮消失。
- **根因**：释放前没有校验"会话当前绑定的活任务是否仍是本 watcher 的 task_id"。
- **验收**：释放前若 `_live_task_id(session_id)` 不等于本任务（且非空）则直接返回；补并发用例：A 取消 → B 启动 → A watcher 触发，会话保持 `pipeline_running`。

### B-02 · P1 · 用户停止后会话里出现两条说明
- **证据**：`stop_task` 写入"已按你的要求停止任务…"（`:3456-3471`）；随后 watcher 再写"任务没跑完（cancelled），规划书还在…"（`:3596-3608`），幂等判断只比较内容是否相同（`:3601`），两条文案不同。
- **现象**：消息流和时间线连续出现两条助手消息，第二条把"用户主动停止"描述成"任务没跑完"，与 `user_stopped` 语义冲突，也会被 `context_loader` 一并带入下一轮上下文。
- **验收**：会话最后一条已带 `metadata.user_stopped=true` 且 `task_id` 相同时，watcher 不再追加说明，只做状态校正。

### B-03 · P1 · 取消失败仍向用户宣称"已停止"
- **证据**：`:3443-3453` 中 `kernel.cancel(live)` 抛异常只记 warning；`:3456-3487` 仍写"已按你的要求停止任务"并返回 `stopped: True`。
- **现象**：任务其实还在跑（继续计费、继续写时间线），但 UI 回到可输入状态，用户再发消息会和仍在跑的任务冲突。
- **验收**：取消失败时返回 `stopped:false` + 可读错误，会话状态不变；前端运行条显示"停止失败，可重试"。

### B-04 · P1 · 重启后卡在 `planning` 的会话不会被放开，且遗留"进行中"条目
- **证据**：`release_stale_pipeline_sessions`（`:519-584`）只查询 `status == "pipeline_running"`（`:539`）；同一函数写时间线时没有 `close_open("interrupted")`（`:575-581`），而另两条释放路径都有（`:3474`、`:3561`、`:3616`）。
- **现象**：规划书派发中途重启，会话永远停在 `planning`；时间线里的思考/工具条目永远显示"进行中…"。
- **验收**：扫描范围包含 `planning`；释放时统一 `close_open("interrupted")`。

### B-05 · P2 · watcher 超时后不释放会话
- **证据**：`:3513` 循环 3600×2s ≈ 2 小时，`:3539` 超时仅打日志即返回。
- **现象**：超长任务结束于第 2 小时之后，会话状态要等下一次周期扫描（且该扫描只看本进程内存）才可能被修正。
- **验收**：超时退出前若任务已终态则执行一次释放；或改为订阅任务终态事件而非轮询。

### B-06 · P2 · 需求附件上传先整读进内存再判大小，错误信息被吞
- **证据**：`api/requirements.py:418-420`（`await file.read()` 后才比较 20MB）；`:430-432` 所有异常统一返回 500「会话处理失败，请稍后重试」。
- **现象**：传一个大文件时，后端先把整个文件读进内存再拒绝；解析失败（如损坏的 docx/pdf）时用户只看到"稍后重试"，不知道是文件本身的问题。
- **验收**：按块读取并在超过上限时立即 413；解析类错误返回 422 + 具体原因（文件名、格式）。

---

## 2. 前端 · 首页「开始创作」

### F-01 · P1 · 插件配音里选的音色会在启动时被旧偏好覆盖
- **证据**：`pages/HomePage.tsx:361-372`（插件回传 `voice_id/auto_dub` 写进 `projectStore`，但不写 `clipwright_voice_prefs`）；`launch()` `:500-507` 又从 localStorage 读出旧偏好并 `setVoiceId / setAutoDub`。
- **现象**：装了 `create.dub` 插件的用户选了音色 B，启动后管线用的是上次内置下拉里存的音色 A（或在插件里关掉自动配音后被重新打开）。
- **验收**：启动时以当前表单状态（`voicePick` / `autoDubPref` / 插件值）为准，localStorage 只做初始回填。

### F-02 · P1 · 创作表单里显示的是上一个项目的工作区素材
- **证据**：`:191` 取 `projectStore.projectId`（跨页面保留）；`:1294-1295` 只要有 projectId 就渲染 `WorkspaceMaterialsPanel`。新项目要到 `launch()` 里 `projectApi.create` 后才会改 projectId（`:524`）。
- **现象**：从编辑器回到首页点「开始创作」，04 工作区里列出的是上一个项目的 materials，用户会以为素材已经带进来了，或者误往旧项目里丢文件。
- **验收**：创作表单处于"新建"状态时不显示旧项目的面板，只显示"启动后会创建工作区"的说明。

### F-03 · P1 · 文稿预判结果可能晚到并覆盖当前状态
- **证据**：`:230-244`：清理函数只 `clearTimeout`，已发出的 `predictScript` 请求没有取消或丢弃标记，返回后无条件 `setPrediction`。
- **现象**：粘贴长文稿后马上清空或替换，几秒后仍会弹出旧文稿的"智能预判"卡片。
- **验收**：请求带代际或 AbortController，过期响应丢弃。

### F-04 · P2 · 启动摘要在"自动配音"模式下显示"无配音"
- **证据**：`:1319`：`mode === 'voiceover' ? (audio ? '已上传配音' : '无配音') : '画面优先'`；而 `:170-173` 中"自动配音 + 已选音色"也会进入 `voiceover`。
- **现象**：用户选了音色、开了自动配音，启动前的摘要却写"无配音"，让人怀疑设置没生效。
- **验收**：三态文案：已上传配音 / 自动配音（音色名）/ 画面优先。

### F-05 · P2 · 非网络错误时「空项目」静默变成本地演示项目
- **证据**：`openBlank()` `:580-585` `catch { /* fall through */ }` 后直接创建本地 id 并跳转；而 `launch()` 已对非网络错误做了报错（`:547-558`）。同样，网络断开时两处都忽略 `allowDemoFallback` 开关（`:563-567`、`:588-591`；该开关默认 false，见 `stores/settingsStore.ts:140`）。
- **现象**：鉴权失败/校验失败时用户进入一个不会保存的编辑器，以为在正常工作。
- **验收**：`openBlank` 与 `launch` 同口径；离线回退受 `allowDemoFallback` 控制，进入演示项目时编辑器要有常驻标识。

### F-06 · P2 · 工作区创建失败没有任何用户提示
- **证据**：`:540-542` 只有 `console.warn`。
- **现象**：项目建好了，但工作区没建出来；用户在编辑器里上传素材/找 materials 目录时才发现问题，且不知道原因。
- **验收**：失败时 toast 提示并在编辑器资源面板给出"重建工作区"入口。

### F-07 · P2 · 步骤编号混乱
- **证据**：`:1031`「03 配音与字幕」→ `:1247`「04 工作区」→ `:1305` 注释「03.5 创作提示词」（组件无编号）→ `:1314`「04 启动」；素材源步骤编号为空（`:1005`）。
- **现象**：有两个"04"，创作提示词位于工作区之后，顺序与编号对不上。
- **验收**：步骤按视觉顺序连续编号，可选步骤标注"可选"。

### F-08 · P2 · 「风格」步骤永远显示已完成
- **证据**：`:133` `pluginId` 默认 `'knowledge_longform'`；`:375` `style: Boolean(personaId || pluginId)`。
- **现象**：用户什么都没选，02 就打了勾；类型列表加载失败（`plugins` 为空）时同样打勾，摘要直接显示原始 id（`:1320`）。
- **验收**：未显式选择时显示"使用默认：知识区长片"；类型列表为空时显示加载失败与重试。

### F-09 · P2 · 一键填入预判只做了一半，且写死类型映射
- **证据**：`applyPrediction` `:388-407` 注释说会覆盖时长，但实现只设置了 `pluginId`；映射表写死 4 个内置 id。
- **现象**：卡片上展示了"预估时长"，点"一键填入"后时长没变化；用户自定义类型永远匹配不到。
- **验收**：按钮文案与行为一致；类型匹配改用后端返回的类型 id 或类型列表的名称匹配。

### F-10 · P2 · 文案与事实不符
- **证据**：`:65`「六 Agent 管线」、`:1438`「六 Agent 管线与渲染队列已就绪」（实际 7 个）；`:1429` 解析失败时回落显示 `localhost:8000`（后端默认端口 8080）；`:1159` 提示只支持 wav/mp3/m4a，而 `:1148` `accept` 还包含 `.mp4`。
- **验收**：文案以实际配置为准；端口显示读取真实 baseURL，失败时显示"未知"。

### F-11 · P2 · 暴露尚未实现的选项
- **证据**：`:1365`「循环填充（渲染待支持）」可被选择并随任务下发。
- **现象**：用户选了，成片里没有效果。
- **验收**：未支持的档位禁用或隐藏。

### F-12 · P3 · 首屏"演示数据"闪烁与无关信息
- **证据**：`:123` `dataMode` 初始为 `'demo'`，接口返回前首页徽标显示"演示数据"、空项目区显示"后端未连接"文案（`:733-738`）；页脚展示编辑器快捷键和 "v0.1.0 · Phase 5"（`:1473-1481`）；首页与创作页重复同一套标题（`:675-681`、`:822-828`）。
- **验收**：加载中显示骨架屏；页脚去掉编辑器快捷键；创作页去重标题。

### F-13 · P3 · 死代码
- **证据**：`RulerStrip`（`:1662-1682`）无引用；`:1684` 注释也说明已不用。

---

## 3. 前端 · 编辑器预览

### P-01 · P1 · 「导出当前帧」导出的可能是上一帧
- **证据**：`features/preview/PreviewPanel.tsx:799-835` 离屏重绘调用 `drawClipToPreview(...)` 时没传 `playing`，走"暂停分支"：`seekVideo` 后立即 `drawCover`（`:1207-1213`）；seek 是异步的，这一帧画的是 seek 前的画面。
- **现象**：拖到某一帧点导出，PNG 和监视器看到的不一致（视频层落后）。
- **验收**：导出前等待所有活跃视频的 `seeked`（或 rVFC）后再绘制；有素材未就绪时提示而非导出占位图。

### P-02 · P1 · 双击编辑文字会先播放再暂停
- **证据**：单击即 `togglePlay()`（`:476-481`），双击会触发两次 pointerup，然后才进入 `handleDoubleClick`（`:849`）。
- **现象**：双击字幕时画面先播放/暂停闪一下，播放头可能已经移动，打开的不是用户双击时那一条文字。
- **验收**：单击播放要延迟到双击判定窗口之后，或改为只在播放按钮/空格切换播放。

### P-03 · P2 · 单击画布切换播放与选中/取消选中冲突
- **证据**：同上 `:476-481`；没有命中手柄时，任何单击都会切播放。
- **现象**：用户想点空白处取消选中，结果视频开始播放。
- **验收**：画布单击优先做选中/取消选中；播放由按钮或空格控制（或提供设置项）。

### P-04 · P2 · 变换手柄位置与画面不一致（有关键帧时）
- **证据**：`drawTransformOverlay` 用 `getClipTransform(target)`（`:1438`，仅静态 metadata）；实际绘制用关键帧插值后的 `tf`（`:1582-1591`）。
- **现象**：带位置/缩放关键帧的片段，手柄框停在原位，画面在别处；拖手柄改的是基础值，效果和预期不符。
- **验收**：手柄使用与渲染相同的插值结果；有关键帧时拖动应写入当前时刻关键帧或给出提示。

### P-05 · P2 · 按下手柄即产生撤销点
- **证据**：`:381` 在 pointerdown 时 `pushState`，未判断是否发生移动。
- **现象**：误点手柄后 Ctrl+Z 什么也没变化，需要多按一次。
- **验收**：仅在实际发生位移后入栈。

### P-06 · P2 · 播放中整块预览面板每帧重渲染
- **证据**：`:52` 组件订阅 `currentTimeSec`；`:160-211` 音频同步 effect 依赖 `currentTimeSec`，每帧都执行并遍历音频片段；`:891` 时间码也随之刷新。合成本身已在独立 rAF 中读取 store（`:652-674`）。
- **现象**：播放时 React 每帧重渲染整棵工具栏（含 Tooltip/Slider），长时间线上可见掉帧。
- **验收**：音频同步移入 rAF 循环；时间码单独小组件订阅。

### P-07 · P2 · 全屏后没有任何控件
- **证据**：`:791` 只对 `wrapRef`（画布区域）`requestFullscreen`，头部工具栏与时间码不在其中。
- **现象**：全屏后无法暂停、调音量、看时间码，只能按 Esc 退出。
- **验收**：全屏容器包含一条自动隐藏的迷你控制条。

### P-08 · P3 · 音量电平表常驻 rAF
- **证据**：`AudioLevelMeter` `:1838-1862` 无论是否播放都每帧重绘。
- **验收**：暂停时停止循环或降频。

### P-09 · P3 · 标签页切回后不恢复播放、也无提示
- **证据**：`:328-338` 隐藏时暂停，返回时不提示。
- **验收**：可接受现状，但建议在监视器上显示"因切换标签页已暂停"。

---

## 4. 前端 · 任务运行态（taskStore）

### S-01 · P1 · 「开始」遇到 409 拒绝时被当成成功
- **证据**：`stores/taskStore.ts:378-385` `start()` 调 `taskApi.resume` 后直接 `load`，不看 `res.refused`；而 `resume()` 已处理（`:396-404`）。
- **现象**：对已结束的任务点开始，界面没有任何提示，像是点了没反应。
- **验收**：与 `resume` 同样展示拒绝原因。

### S-02 · P1 · 事件窗口裁剪后"加载更早"会留下空洞
- **证据**：`applyEvent` 把 `events` 截到 400 条（`:340`），但 `oldestLoadedSeq` 不随之更新；`loadEarlierEvents` 以 `oldestLoadedSeq` 为 `beforeSeq`（`:282-289`）。
- **现象**：长任务运行中点"加载更早"，拿回的是比窗口最早条目还早得多的一段，中间被裁掉的那段永远看不到，且不会显示缺口提示。
- **验收**：裁剪时同步更新 `oldestLoadedSeq` 与 `hasEarlierEvents=true`。

### S-03 · P2 · 翻页加载的历史不进入子 Agent 窗口
- **证据**：`loadEarlierEvents` 只合并到 `events`（`:296-305`），不处理 `runEvents`。
- **现象**：刷新后进入一个长任务，较早启动、仍在运行的子 Agent 不出现在列表里，翻页后也不会出现。
- **验收**：历史中的 `agent_run_*` 同步合并进 `runEvents`（按 seq 去重排序）。

### S-04 · P2 · `replan` 不校验当前任务
- **证据**：`:428-435` 返回后直接 `set({ task: res.task })`，没有 epoch / activeTaskId 检查。
- **现象**：点了重新规划后马上切到另一个任务，返回结果会把当前视图换成前一个任务。
- **验收**：与 `load` 一致的代际校验。

### S-05 · P2 · 错误状态不会自动清除且不区分任务
- **证据**：`pause/resume/cancel/inject/loadList` 失败都写同一个 `error`（`:382-444`），只有 `load/createTask` 会清空。
- **现象**：任务列表刷新失败一次后，任务视图一直挂着一条红色错误，哪怕后续操作都成功了。
- **验收**：每个操作开始时清除自身错误；列表错误与任务错误分开。

### S-06 · P3 · 插话（inject）无成功反馈
- **证据**：`:420-426` 成功时不更新任何状态。
- **验收**：成功后输入框清空并显示"已发送给主 Agent"，直到对应事件到达。

---

## 5. 前端 · 会话时间线

### T-01 · P1 · 滚到顶部加载历史会连锁触发并跳位
- **证据**：`features/sessionTimeline/SessionTimeline.tsx:461-470`：`scrollTop <= 24` 时每次 scroll 事件都把 `visible` 加 120 并在 `hasMore` 时请求；内容插入顶部后没有保持滚动锚点，`scrollTop` 仍为 0，下一次 scroll 继续触发。
- **现象**：上滑到顶部后列表一口气展开几百条，视野跳到最早的记录，用户找不到刚才看的位置。
- **验收**：加载前记录 `scrollHeight`，插入后补偿 `scrollTop`；加载中不重复触发。

### T-02 · P1 · 流式思考/正文不会自动跟随到底部
- **证据**：`:455-459` 自动滚动只依赖 `items.length` 与 `visible`；同一条目内容增长（thinking delta 合并为一条）时长度不变。
- **现象**：主 Agent 在思考时，用户停在底部也看不到新内容，需要手动滚动。
- **验收**：在底部时，最后一条内容长度变化也触发跟随。

### T-03 · P2 · 授权/提问提交后按钮仍可点
- **证据**：`ApprovalButtons` `:120-148`、`QuestionActions` `:165-223` 成功后只设置提示文字，按钮仍然渲染且可用，直到服务端写回 answer 条目。
- **现象**：网络慢时用户重复点击，可能对同一条授权先"授权"再"拒绝"，或重复回答。
- **验收**：提交成功后锁定该条目的所有按钮，仅保留结果。

### T-04 · P2 · 原始枚举值直接展示给用户
- **证据**：`:108` 授权状态（pending/approved）、`:109` `risk=high`、`:256` 工具状态（ok/error/dry_run）、`:281` 阶段状态、`:359` 兜底行显示原始 `type`。
- **现象**：中文界面里夹着英文枚举和内部类型名。
- **验收**：统一状态映射表；未知值显示"其他"并在 title 里给原值。

### T-05 · P2 · 部分字段未走渲染边界
- **证据**：`:291` 问题文本、`:244-245` 工具名、`:256` 状态用 `String(...)` 而非 `asText`。
- **现象**：后端字段若是对象，会显示 `[object Object]`。
- **验收**：模型/接口字段一律经 `asText`（与项目约定一致）。

### T-06 · P2 · 空态判断不准确
- **证据**：`EmptyState` `:372-403`：`link === 'retry'`（重连中）没有分支，会落到"这个会话还没有记录：发一条消息就会有内容"。
- **现象**：网络抖动时用户被告知会话为空。
- **验收**：重连中显示"正在重连…"。

### T-07 · P3 · "加载更早"按钮文案出现"还有 0 条"
- **证据**：`:511`：`hidden === 0` 但 `hasMore` 为真时显示"还有 0 条，服务端仍有更早记录"。
- **验收**：本地无隐藏时只显示"加载更早记录"。

### T-08 · P3 · 思考默认全部展开
- **证据**：`ThinkingRow` `:66` 默认 `open=true`，每条最大 240px。
- **现象**：多轮之后历史思考占满屏幕，正文被挤到很远。
- **验收**：仅当前流式中的思考默认展开，已完成的默认折叠。

---

## 5A. 前端 · 编辑器启动链路与需求对话（补充审计，已逐条核对代码）

### E-01 · P1 · 从首页进入编辑器后，需求 Agent 自动启动会"自我取消"，转圈不停
- **证据**：`features/agent/useRequirementsAutoStart.ts:33` 在 effect 内同步 `setRequirementsTopic('')`；依赖数组含 `requirementsTopic`（`:149`）→ 触发重渲染 → 上一轮 cleanup 置 `cancelled=true`（`:148`）；新一轮因 `autoStartedRef` 直接返回（`:26`）。异步流程在 `init` 返回后 `if (cancelled) return`（`:70`），`finally` 里 `if (!cancelled)` 不清 busy（`:145`）。
- **现象**：会话 id 未写入，`requirementsBusy` 永远为 true；用户只看到自己的首条消息和一直转的圈。
- **验收**：消费 topic 不触发自身 cleanup（依赖只留 `ready`，或取消判定改为"项目 id 已变化"）；补 renderHook 用例断言 busy 最终为 false、session 已写入。

### E-02 · P1 · 首页勾选的 dry-run / 工作区开关 / 创作提示词等在进编辑器时丢失或串项目
- **证据**：`pages/EditorPage.tsx:125-141` 快照只收 13 个字段，不含 `dryRun`、`workspaceAutoIndex/VisionIndex/Root`、`creativePrompt/Avoid`、`cutOnBeat/beatBpm`、`shotFloorPolicy/shotCapPolicy`；`:150` 随即 `resetProject()`。而 `stores/projectStore.ts:163-189` 的 reset 会清 `dryRun` 与工作区字段，却**不重置** `creativePrompt/creativeAvoid/cutOnBeat/beatBpm/shot*Policy/personas`。
- **现象**：两类相反的错：
  1. 用户勾了"仅预览 dry-run"或关了"视觉解读"，进编辑器后被重置回默认 → 多花一整轮生成成本。
  2. 上一个项目的创作提示词、踩点、镜头策略不被重置，悄悄带进下一个项目。
- **验收**：reset 用单一 `INITIAL` 常量；启动参数用独立 `pendingLaunch` 对象整体传递并在消费后清空；补用例覆盖每个首页开关。

### E-03 · P1 · `pendingReqRef` 只采集一次，同一路由组件内切项目会复用旧启动参数
- **证据**：`EditorPage.tsx:125` `if (pendingReqRef.current === null)`——注释为兼容 StrictMode；但 `/editor/A → /editor/B` 时组件不卸载，ref 不会重置。
- **现象**：B 沿用 A 的 `pendingTopic`：清掉 B 的草稿，并对 B 自动发起 A 的需求会话。
- **验收**：ref 记录 `{ forProjectId, data }`，projectId 变化时重新采集。

### E-04 · P1 · 首页启动失败后残留 store 数据，随后点「空项目」会意外启动需求会话
- **证据**：`HomePage.tsx:477-499` 在创建请求前就写入 `requirementsTopic` 等；非网络错误分支 `:552-558` 直接 return 不回滚；`openBlank()`（`:570-592`）不清 requirements 字段。结合 E-01 的快照逻辑，EditorPage 会把残留 topic 当成 pendingTopic。
- **验收**：请求成功后再写 store，或失败分支/`openBlank` 统一重置 requirements 字段。

### E-07 · P1 · 「自动保存 / 默认帧率 / 默认分辨率」三项设置刷新后失效
- **证据**：`stores/settingsStore.ts:53-86` 的 `loadEditorPrefs()` 返回对象里没有 `autoSave`、`defaultFps`、`defaultResolution`；`:108-110` 却从这个返回值里读取这三项，结果恒为 `undefined`，于是 `:122` 永远回落 `autoSave=true`，帧率/分辨率也回落默认值（对比 `:113` 的 `allowDemoFallback` 是直接读 localStorage，所以它是好的）。
- **现象**：用户关掉自动保存、或把默认分辨率改成 1080×1920，刷新页面后全部恢复默认；新建空项目仍是 1920×1080@30。
- **验收**：三项改为直接从原始 `editorPrefs` 读取（或在 `loadEditorPrefs` 中返回并校验范围）；补"写入 → 重新加载 store → 读回"的用例。

### E-05 · P2（待复核） · 切换副驾驶标签会中断正在流式的回复与管线 SSE
- **线索**（子审计报告，未逐行核对）：`features/copilot/CopilotDock.tsx` 仅挂载当前标签；`AgentPanel.tsx` 卸载时 `cancelInFlight()` 并关闭 EventSource，`lastSeq` 为局部变量，重连后全量回放。
- **现象**：切到「轨迹」再切回，正在生成的回复显示"已停止生成"，输入草稿丢失，日志重复。
- **验收**：先写复现用例（切 activeId 统计 abort / close 次数），确认后把 SSE 与进行中请求上移到常驻层。

### E-06 · P2（待复核） · 其它子审计线索
以下条目由子审计提出、尚未逐行核对，列入复核清单：
- 上一个项目的 `pipelineId` 未随 `resetPipeline()` 清除，可能把旧管线 diff 弹到新项目（`AgentPanel.tsx`、`EditorPage.tsx:152`）。
- 多标签同步用"1 秒内的事件视为自己发的"过滤，可能把其他标签页事件也过滤掉（`EditorPage.tsx` tabSync 回调）。
- `pagehide` 与 `beforeunload` 都挂 flush，关页时可能发两次 keepalive PUT。
- 会话时间线订阅清理直接删除计数，多订阅者时可能提前断流（`useSessionTimeline.ts`）。
- `sseStream.reconnect()` 未清理定时器与旧连接，可能出现双连接。
- 首页多处模型/接口字段未走 `asText`（选题建议、智能预判、人格 tone、音色名）；`detail` 为 422 数组时错误提示会直接作为子节点渲染。
- 恢复的流式消息残留 `streaming:true`，刷新后打字光标常驻。
- 一轮结束后"正在思考"条仍在转圈；`stageHint` 不清空。

---

## 5B. 前端 · 素材 / 工作区 / 媒体管理（子审计，关键条已逐行核对）

### M-01 · P1 · 「素材详情」对 tags / metadata 直接调用 `.length` / `Object.keys`，脏数据白屏
- **证据**：`features/assets/AssetPanel.tsx:822`（`data.tags.length`）、`:829`（`Object.keys(data.metadata)`）；上游 `services/api/asset.ts` 的 `getMaterialAsset` 对响应零校验直接返回。
- **现象**：后端返回缺 `tags`（非数组）或 `metadata`（非对象）时，点 AI 结果的「详情」整页白屏。
- **验收**：详情弹窗对 tags 非数组、metadata 非对象、detail 为 null 均正常渲染；tags 用 `textList` 兜底。

### M-02 · P1 · 工作区素材表多处后端字段未过 `asText`
- **证据**：`features/workspace/WorkspaceMaterialsPanel.tsx:331,332,335,342,350,355,304` 直接渲染 `m.rel||m.path`、`m.kind`、`m.status`、`m.tags.join(...)`、`visionText`、`f.rel — f.reason`。
- **现象**：`rel/tags/vision.summary` 实际为对象/数组时渲染报错，整块面板白屏（违反渲染边界约定）。
- **验收**：任一字段为 object/array 时该单元格显示 JSON 文本或空，面板不白屏。

### M-03 · P2 · 工作区 `reload` 无防过期，切项目时旧响应覆盖新项目
- **证据**：`WorkspaceMaterialsPanel.tsx:128-140`（`reload` 无 alive/代际守卫）、`:142`（仅依赖 `reload`）。
- **现象**：快速切换项目时，旧项目的状态/素材列表先返回、后到的结果覆盖新项目数据。
- **验收**：切项目后只渲染当前项目数据，过期响应被丢弃。

### M-04 · P2 · 上传成功后工作区目录树不自动刷新
- **证据**：`AssetPanel.tsx:167-168` 上传后 bump `refreshCounter` 并注释「让 WorkspaceMediaTree 重新拉一次」；但 `WorkspaceMediaTree.tsx:102` 的 effect 只依赖 `[projectId]`，不读 `refreshCounter`。
- **现象**：上传完成新文件不出现，用户要手动刷新或切项目才看到。
- **验收**：上传完成目录树立即出现新文件；或让树订阅 `refreshCounter`。

### M-05 · P2 · 大文件上传期间没有任何进度反馈
- **证据**：`AssetPanel.tsx:133-178` 循环内从不 `setUploadProgress`，仅在 `:177` 结尾 `setUploadProgress(null)`。
- **现象**：上传 2 GiB 级文件时进度条永远不出现，用户只能干等。
- **验收**：上传中显示进度或至少逐文件状态，结束复位。

### M-06 · P2 · 素材列表 / AI 匹配结果均有跨项目竞态与入轨类型问题
- **证据**：`AssetPanel.tsx:62-84`（`loadAssets` 无 alive 守卫，旧响应可覆盖新项目）；`:594-620`（`addResult` 硬编码 `normalizeClipKind('video')`，图片/音频结果也进 video 轨；`local_path` 结果只写 `local_path` 不 `registerUrl`，预览出不来）。
- **验收**：切项目后列表只反映当前项目；图片/音频进对应轨道；local_path 结果入轨后可预览。

### M-07 · P2 · 分段配音「加入时间轴」的空段与时点口径问题
- **证据**：`DubView.tsx:67-77`（`segs.length===0` 未提前 return，仍会 push 历史并建空音频轨）；`:78-96`（`fallbackDur = dubTotal/segs.length` 与前端 `projectStore.dubSegments` 的按段 3s 重估口径不一致）。
- **现象**：无可加段时按钮仍可点、无反馈；段时长缺省时轨道起止与已有 dubSegments 错位/重叠。
- **验收**：无可加段时按钮禁用或加轨前拦截提示；加轨后每段起止与 dubSegments 一致。

### M-08 · P2 · 音色列表 / 配音失败均无重试入口
- **证据**：`DubView.tsx:30,32-64` 的 `voiceApi.list().catch(()=>{})` 与 `handleConfirm` 的 catch 都静默或仅一行错误，无重试按钮。
- **验收**：加载失败或配音失败给出可点重试动作。

### M-09 · P3 · 若干收尾项
- `WorkspaceMediaTree.tsx:184-200`：搜索时目录仍显示原始 `d.count`，与过滤后文件数不符。
- `AssetPanel.tsx:436,437,645,707-712`：filename/kind/title/source/reason 直出未过 `asText`。
- `DubView.tsx:114`：音色下拉 `v.voice_name (v.provider)` 直出。
- `PluginPanel.tsx:38-48,84-109`：所有插件 tab 立即挂载并各自请求 UI，未懒加载；key 用派生前缀而非 pluginId。
- `mediaManager.ts:572-616`：`AudioContext` 只建不关，反复取波形累积解码资源。
- `mediaManager.ts:518-527,254,275`：缩略图/图片设 `crossOrigin='anonymous'`，后端无 ACAO 头时取不到、封面一直空。
- `WorkspaceMaterialsPanel.tsx:166-203`：扫描完成后 SSE 流保持打开直到卸载。
- `assetStore.ts:5,31`：`searchQuery` 字段从未被读写（AssetPanel 用本地 useState），死字段。

> 本节的 P1/P2 已抽验 4 条（M-01、M-03、M-04、M-05）行号与代码一致；其余沿用子审计结论，施工前按行号复读一遍即可。

## 5C. 前端 · 时间线引擎 / 属性面板（子审计，P1 已逐行核对）

### TL-01 · P1 · 撤销/重做后「未保存」标记被误清，编辑可能不落盘
- **证据**：`stores/timelineStore.ts:124`（`setTimeline` 无条件 `isDirty:false`）；`stores/historyStore.ts:98`（`swapTimeline` → `setTimeline`），`undo/redo/jumpTo` 都走它。
- **现象**：编辑后 Ctrl+Z，顶栏「未保存」消失、autosave 不再触发；刷新即丢失刚撤销出来的那步编辑。
- **验收**：撤销/重做/历史跳转后，若恢复的时间线与最后落盘内容不同，`isDirty` 保持 true。

### TL-02 · P1 · slide 前移的钳制用错邻居，可把相邻片段压成负时长
- **证据**：`timelineStore.ts:569`（`maxFwd` 取 `prev.duration_sec - 0.1`）、`:570`（`maxBack` 取 `next.duration_sec - 0.1`）、`:571-574`（`d` 的上下界用 `-maxBack` / `maxFwd` 分别夹 `deltaSec`）。语义是：片段时间线右移时压缩的是 next，左移时压缩的是 prev；但正向（右移）的 d 被 `maxFwd`（prev 的可压缩量）封顶，反向被 `maxBack`（next）封顶——两个钳制项恰好对调。
- **现象**：A(0s,10s)、B(10s,1s)、C(11s,1s)，把 B 大幅右移：d 被 prev 的 9.9s 放行，C 的 duration 变成 `1 - 9.9 = -8.9s`，出现负时长/重叠。
- **验收**：slide 任意方向拖动，邻居时长恒 ≥0.1s，绝不产生负时长/重叠；补 A/B/C 用例。

### TL-03 · P1 · JSON 导入 / 切换代理后状态栏显示「已保存」，但内容未写回后端
- **证据**：`features/timeline/components/EditorToolbar.tsx` JSON 导入与代理切换走 `setTimeline`，而 `setTimeline` 无条件 `isDirty:false`（同 TL-01 根因）。
- **现象**：导入 JSON 或切代理后不继续编辑就离开，改动丢失。
- **验收**：这类「前端替换时间线」的操作完成后 `isDirty=true`，直到 autosave 成功。

### TL-04 · P1 · 素材拖入锁定/隐藏轨道仍成功
- **证据**：`features/timeline/engine/TimelineEngine.ts:1088-1091` 只判 `kind === clipKind`，不判 `locked`/`hidden`；后续 `sameKindTracks` 分支同样不校验。
- **现象**：拖到锁定轨直接入轨；拖到隐藏轨用户看不到，却在导出里出现。
- **验收**：锁定轨拒绝投放并反馈；隐藏轨不成为投放目标。

### TL-05 · P2 · 锁定轨上的片段仍可被属性面板编辑、删除、切分
- **证据**：`features/properties/PropertiesPanel.tsx:107-122`（`batchUpdate/set` 直调 `updateClip`，store 的 `updateClip` 不查锁定）；`TimelinePanel.tsx:274-308` 的删除/波纹删除/切分同样绕过锁定。
- **验收**：锁定轨上的 clip，属性编辑与删除/切分入口禁用或 no-op。

### TL-06 · P2 · 波纹删除破坏跨轨同步
- **证据**：`timelineStore.ts:597-648` 只对 `c.start_sec >= winEnd` 的片段左移，落在窗口内但不属于删除组的其它轨片段不处理，跨轨声画错位。
- **验收**：被删窗口之后所有轨道统一左移；窗口内未删片段有明确处理。

### TL-07 · P2 · 嵌套序列折叠/展开丢轨道层级
- **证据**：`TimelineEngine.ts:782-840`（按来源 clip 各建一条子轨）、`:866-875`（展开时全部平铺到单一父轨），往返后跨类型混轨与重叠。
- **验收**：折叠/展开往返后 clip 回到各自来源轨道且不重叠。

### TL-08 · P2 · 属性面板改起点/时长无邻接钳制
- **证据**：`PropertiesPanel.tsx:306-317` 只 `Math.max(0, v)`，与画布拖拽的 `computeTrimGhost`/`trimClipStart` 钳制不一致。
- **验收**：面板与画布共享同一边界钳制，不产生单轨重叠。

### TL-09 · P2 · 键盘跳编辑点把隐藏/锁定轨算进去
- **证据**：`TimelineEngine.ts:815-837,792-807`（`jumpToNextEdit/jumpToPrevEdit` 遍历 `tl.tracks` 不跳 hidden）；`timelineStore.ts:894-900`（`findClipAtTime` 不跳 hidden/locked）。
- **验收**：隐藏轨不参与编辑点跳转与命中查询。

### TL-10 · P2 · 属性面板模块级全局指针监听不卸载
- **证据**：`PropertiesPanel.tsx:45-54` 在模块顶层注册 `window` 的 pointerdown/pointerup，无清理；HMR 会叠加监听。
- **验收**：改为有清理的 hook 或随应用生命周期卸载。

### TL-11 · P2 · 关键帧面板对 `keyframes` 缺省不一致（一处崩溃）
- **证据**：`PropertiesPanel.tsx:1141,1227,1282` 直接 `clip.keyframes.map/length`；而 `AnimationSection`（`:775`）用 `?? []`。旧项目/脏数据 keyframes 为 undefined 时崩。
- **验收**：keyframes 缺失按空数组处理，面板不崩。

### TL-12 · P2 · Bezier 控制点高 DPI 拖拽错位
- **证据**：`BezierCurveEditor.tsx:36-51,70-77` 假定 SVG 像素尺寸等于 viewBox `size`，未按 `getBoundingClientRect().width / size` 归一化。
- **验收**：任意 DPI/缩放下控制点精确跟随指针。

### TL-13 · P3 · 其余收尾
- `TimelineEngine.ts:149-166`：空闲仍 60fps 调度 RAF，不省电。
- `TimelineEngine.ts:295-311,44-45`：双击加标记前先触发一次 scrub 跳播放头。
- `TimelineEngine.ts:802-806` vs `timelineStore.ts:894-899`：命中测试与 `findClipAtTime` 对终点边界含/不含语义不一致。
- `TimelineEngine.ts:99-107`：`dispose()` 未 `clearTimeout(feedbackTimer)`。
- `PropertiesPanel.tsx:341-350`：淡入+淡出可超片段时长，无交叉约束。
- `snap.ts:98-106`：关键帧吸附用「time≤1 即归一化」的数值启发式，绝对 0.5s 会误判漂移。

## 5D. 前端 · 插件 / GenUI / 设置 / API 层（子审计，P1 已逐行核对）

### PL-01 · P1 · 插件 iframe 可借宿主凭据调用任意后端端点
- **证据**：`features/plugins/PluginBundleFrame.tsx:83-98` 的 `call` 消息把 `data.api.endpoint`/`method`/`body` 原样交给 `getApiClient().request`，无端点白名单、无方法限制、无二次确认。
- **现象**：插件沙箱内一段脚本即可用宿主的 API 令牌 POST/DELETE 任意 `/api/...` 端点（含删除项目、改配置等破坏性接口）。
- **验收**：仅允许声明式白名单端点（最少 GET + 可枚举 POST），其余拒绝并回包 error；白名单与插件 manifest 声明的权限一致。

### PL-02 · P1 · 插件快捷键可触发任意破坏性端点
- **证据**：`features/plugins/usePluginShortcuts.ts:40-59` 的 `action.endpoint`/`method`/`body` 直接进 `client.request`，无路径校验/方法白名单/二次确认。
- **验收**：endpoint 必须 `/api/` 前缀且 method 限于 GET/POST 白名单，破坏性方法需确认或拒绝。

### PL-03 · P1 · 插件 layout 的 label/title 直进 JSX，对象值整块白屏
- **证据**：`features/plugins/PluginLayoutRenderer.tsx:179,285,340,372,414`；`Slot.tsx:44,54` 的贡献 title 未校验。
- **验收**：label/title/content 渲染前统一 `asText()`（或校验 string），补对象字段回归用例。

### PL-04 · P2 · 插件启用失败开关仍翻成 ACTIVE
- **证据**：`features/settings/PluginsPanel.tsx:217-222` 无条件 `loaded:true`，未读 enable 返回。
- **验收**：失败不改 loaded，或成功后重新拉服务端状态再置位。

### PL-05 · P2 · ProvidersPage 重命名确认按钮丢弃新值
- **证据**：`pages/admin/ProvidersPage.tsx:682` 确认按钮读 `m.name`（旧值），仅 Enter 路径用了输入值。
- **验收**：重命名输入受控为 state，确认与 Enter 共用同一提交。

### PL-06 · P2 · 删除源/模型无二次确认
- **证据**：`ProvidersPage.tsx:177-191,624-625` 直接 DELETE。
- **验收**：删除前加确认，提示会解绑角色。

### PL-07 · P2 · 401/503 仅在 console.warn，用户无感知
- **证据**：`services/api/client.ts:35-39`。
- **验收**：401 给可读提示（检查 API 令牌），503 提示稍后重试。

### PL-08 · P2 · 422 归一化只取第一条 msg，丢字段路径
- **证据**：`client.ts:42-51` 取 `detail[0].msg` 单条。
- **验收**：逐条拼 `loc.msg`（前 3 条）或保留原始 detail 供页面拼接。

### PL-09 · P2 · TTS provider 默认值与兜底仍写死厂商名
- **证据**：`pages/VoicePage.tsx:15-21,38,302`；`stores/voiceStore.ts:46`（硬编码 `qwen_tts`）。
- **验收**：provider 默认空并强制从 available 选择；删厂商硬编码兜底。

### PL-10 · P2 · 插件 id/description/health.issues/missing_dependencies/plugin_id/message 等直渲染
- **证据**：`PluginsPanel.tsx:430,474-478,608,613,622,730,761,766`。
- **验收**：这些渲染点统一 `asText` 收口。

### PL-11 · P2 · TypeSpec/Persona 画廊的模型产物字段直渲染
- **证据**：`TypeSpecEditor.tsx:289,294,305,322`；`PersonaGalleryPanel.tsx:272-274,282,290`。
- **验收**：渲染前 `asText`/`textList`，数组字段过滤非字符串项。

### PL-12 · P3 · 其余收尾
- `usePluginSlots.ts:144-153`：初始 useState 用 `cache.get(slot)`，fetch 却写 `slot:${slot}` 键，缓存永不命中、每次挂载多发一次请求。
- `pages/admin/ModelsPage.tsx:41`：离线伪造 `qwen-max/bge-m3` 等演示配置，与真实配置混淆。
- `PluginsPanel.tsx:316-329,103-105`：恢复默认/清空错误/加载贡献失败静默无反馈。
- `ConfigValueInput.tsx:94-107`：dict/list 用 `JSON.stringify` 回显，字符串值会显示成带引号。
- `PluginLayoutRenderer.tsx:325,340`：alert 的 textField 非字符串时未 asText。
- `ProvidersPage.tsx:463`：provider 下拉显示裸 id，未用 `provider_meta.name`。

> 本节 P1（TL-01～04、PL-01～03）已逐行核对；其余沿用子审计行号，施工前按行号复读。

## 5E. 后端 · SSE / 渲染 / 工作区 / 插件加载器（子审计，关键条已逐行核对）

### BE-01 · P1 · 附件上传整读进内存再判大小，大文件可致 OOM
- **证据**：`clipwright/api/requirements.py:418-420`：`content = await file.read()` 之后才 `if len(content) > 20MB` 判 413；multipart 豁免全局 20MB 上限。
- **现象**：上传 1–2 GB 附件时后端内存瞬间被吃满，413 检查在整读之后才执行。
- **验收**：先查 `file.size` 或分块流式写盘，超限在读取前 413；大文件不造成内存骤增。

### BE-02 · P2 · 导出含大媒体文件的项目归档时整读进内存
- **证据**：`clipwright/api/project.py:434-435`：`mf.read()` 整读后 `zf.writestr`。
- **验收**：媒体走 `shutil.copyfileobj` 分块写入 zip。

### BE-03 · P2 · 任务失败/异常路径的 task_end 不带 completed/unfinished
- **证据**：`clipwright/api/task.py:105,111`：`emit(task_id, "task_end", …, {"error": ...})` 仅带 error 键；与 agent_kernel 正常路径（带 completed/unfinished）不一致。
- **现象**：任务报错/异常时，前端按契约读 completed/unfinished 读到空，终态卡在异常展示（违反「task_end.detail 必须带 completed/unfinished」约定）。
- **验收**：所有 task_end（含失败/异常/取消）恒带 `completed` 与 `unfinished` 键。

### BE-04 · P2 · 成片时间线回写失败被静默吞掉
- **证据**：`clipwright/api/task.py:116-121`：`sync_timeline_to_project(...)` 包在 `except Exception: pass`。
- **现象**：任务跑完但项目 timeline 仍为空/0 轨，用户看不到成片、导出按钮恒禁用，且无任何日志。
- **验收**：回写失败至少记 error 日志并向上报任务结论。

### BE-05 · P2 · 排队中被取消的渲染任务永久残留 /queue
- **证据**：`clipwright/api/render.py:596-598,736-739`：排队等待后 cancelled 直接 return，早于清理 finally；优先级等待循环（583-595）不响应取消，最长再等 1800s。
- **验收**：cancelled 排队任务立即清理内存条目与幂等键。

### BE-06 · P2 · /render/start 未知异常裸抛 500，无字段级 detail
- **证据**：`render.py:1366-1368`：`except Exception: logger.exception; raise`。
- **验收**：非法字段 4xx 带字段级 detail；异常统一脱敏转结构化错误。

### BE-07 · P2 · pipeline trace SSE 断线重连全量重放
- **证据**：`clipwright/api/pipeline.py:405-429`：`cursor = 0` 写死，无 `since_seq` 续传，循环无断连检测。
- **验收**：支持 since_seq 续传并每轮检测断连提前退出。

### BE-08 · P2 · 复制项目偶发变成无主项目
- **证据**：`project.py:592-594`：duplicate 后补写 owner_id 的 `except Exception: pass`。
- **验收**：owner 写失败返回 500/回滚，不返回无主副本。

### BE-09 · P3 · 若干收尾（沿用子审计行号）
- `render.py:44-45,53-54`：Mongo 挂掉时任务持久化/清理静默失效。
- `render.py:729-730,799-800`：终态同步 Mongo 失败无日志。
- `render.py:848-858`：刷新后订阅从 Mongo 恢复的非终态任务，SSE 推 "Task not found"。
- `plugins/loader.py:857-858`：插件配置迁移 import 失败裸吞。
- `plugins/loader.py:929-930,854-856`：插件根目录永久 append 进 sys.path，只加不除。
- `project.py:664-670`：GET thumbnail 在 async 内同步调 ffmpeg，阻塞事件循环。
- `workspace.py:445-459`：legacy-assets 列表随素材数 O(n²) 全盘 sha256。
- `render.py:1163-1181`：`preset`/`soft_subtitle` 同字段声明两次，语义混乱。
- `render.py:1411-1446`：缩略图 `time_sec` 无范围校验。
- `workspace.py:506-528`：workspace 事件 SSE 无断连检测。
- `requirements.py:421-423`：上传内存双份 + async 内同步写盘。
- `render.py:1172-1177` + `services/render.py:370-386`：非法 bitrate/encoder/pix_fmt 提交时不报 4xx，进队列后才 failed。

> BE-01、BE-03、BE-04 已逐行核对；其余沿用子审计行号，施工前按行号复读。

## 5F. 后端 · kernel 收口 / capped / 预算 escrow / cancel（子审计，P1 已逐行核对）

### KK-01 · P1 · 金额闸用「主+质量总账」对比「扣预留后的主预算」，质量一花钱主 agent 就被误封顶
- **证据**：`agent_kernel.py:1910-1911`：`task.usage.cost_usd >= self._main_budget(task)`；`_main_budget`（`:1612-1622`）返回 `escrow.main_budget_usd`（总额 − 质量预留）；而 `_sync_escrow`（`:1624-1630`）已算出 `escrow.main_spent_usd = cost_usd − quality_spent`，闸门却没用它。
- **现象**：质量阶段的花费被算进主 agent 账单，导致「主 agent 没超、只是质量花了钱」也触发「预算耗尽→收口」，任务被提前封顶。
- **验收**：金额闸改比 `escrow.main_spent_usd`（或 `cost_usd − quality_spent`）；主 agent 未超 main_budget 时不得因质量花费进收口。

### KK-02 · P1 · 收口后模型正常 finish 被判「成功(achieved/done)」，capped 分支是死代码
- **证据**：`agent_kernel.py:1965`（`gate_reason=="tool_loop_completed" → achieved`）排在 `:1967`（`soft_landing → capped`）之前；`status` 判定（`:1513-1515`）同样只认 gate_reason 白名单。
- **现象**：跑满预算进收口后，模型只要正常收尾，任务被记成 done 并计入成功率，capped 形同虚设——与「capped 是独立终态、不进成功率」的裁定相悖。
- **验收**：收口内 finish 判 capped（把 1967 分支提到 1965 之前），`status="capped"`；capped 不进成功率分子/分母。

### KK-03 · P1 · 停止只取消外层 run-loop，在飞的阶段子 agent 继续烧钱并写黑板
- **证据**：`agent_kernel.py:819-826`：`cancel()` 只 `handle.cancel()` 外层 `_TASK_HANDLES`；`agent_run.py:382-390` 的 `ensure_future(_dispatch(...))` 登记在 `_LIVE`，取消后仍独立跑完 `stage_merge` 写黑板。
- **现象**：点停止后阶段子 agent 仍在计费，取消后其产物仍被 merge 进黑板/时间线。
- **验收**：cancel 遍历并 cancel `_LIVE` 里在飞子任务，取消后黑板不再出现该阶段新写入。

### KK-04 · P2 · 质量幂等回放把 cost / 预留记两遍
- **证据**：`agent_run.py:323-338`；`agent_kernel.py:1112-1114,1853-1856`：回放返回带 cost_usd 的缓存结果，`_on_tool_call` 与 `_settle_quality_usage` 未判 `replayed` 再次累加。
- **验收**：回放（replayed=True）不重复计入 `usage.cost_usd` 与 `escrow.quality_spent_usd`。

### KK-05 · P2 · capped 任务状态页显示 done，与 terminal_reason 矛盾
- **证据**：`agent_kernel.py:1513-1515`：ok 路径 status 三元只认 gate_reason 白名单，未纳入 `TerminalReason.capped`。
- **验收**：terminal_reason=capped 时 status 同步为 capped。

### KK-06 · P2 · capped 结局被写进情景记忆当作「成功」
- **证据**：`agent_kernel.py:2025`：`_persist_memory` 用 `task.status in ("done",)` 判成功，capped 在 ok 路径 status=done 被误判。
- **验收**：收口/capped 记 kind="failure" 或不 pin 为成功。

### KK-07 · P2 · 质量阶段 cost 未知时 escrow 按 0 结算、released=全额 reserve
- **证据**：`agent_kernel.py:1115-1117,1854-1860`：`_settle_quality_usage` 只对 `cost>0` 累加，cost_unknown 被跳过却仍置 settled、released=reserve。
- **验收**：cost_unknown 的质量阶段不得结算为 released=全额 reserve，需标记 unknown 或保留。

### KK-08 · P2 · 两条取消路径的 finish.terminal_reason 不一致
- **证据**：`agent_kernel.py:835-840`（`cancel()` 写 `user_cancelled`）vs `:1250-1256`（run-loop aborted 分支用不带 terminal_reason 的 `TaskFinish(reason="cancelled")` 覆盖）。
- **验收**：两条路径都写 `terminal_reason=user_cancelled`，不互相覆盖。

### KK-09 · P3 · 其余收尾
- `evaluation.py:105-112`：用户取消的任务被算进成功率分母（`_EXCLUDED_FROM_RATE` 只排除 capped）。
- `agent_kernel.py:1973-1976,1930,1130`：`_reset_task_state` 定义后无调用，`_PROGRESS`/`_REPEAT_FAILS` 按 task_id 越积越多。
- `agent_kernel.py:1821-1824` + `agent_loop.py:530-533`：收口期「同一工具连续失败 3 次」被报 capped 而非 blocked。
- `agent_kernel.py:1979-1981,1979-2017`：死代码 `_finish`，docstring 里混入代码文本，且不写 terminal_reason。
- `agent_kernel.py:1316-1543`：ok 路径不写 `agent-closeout.json`、不校验 deliverable_status。
- `agent_kernel.py:1301 vs 1532`：terminal_reason 一处发字符串、一处发 `.value`，消费者要兼容两种形态。
- 待复现：`limits_from_settings`（`agent_kernel.py:649`）在 `pipeline_budget_usd` 为空串/非数字时透传字符串给 pydantic float，create 阶段可能抛异常。

> 子审计已否证三项（**勿修**）：`_closeout_evidence` 有兜底不返回空数组；`budget=null → escrow disabled` 正确；质量结算只在 `_settle_quality_usage` 单点发生。

## 6. 共性问题（横向）

| 编号 | 问题 | 涉及 |
|---|---|---|
| X-01 | 异步请求普遍只用 `alive` 标记或不处理过期，缺统一的"代际/AbortController"模式 | F-03、S-04、HomePage 多处 effect |
| X-02 | "失败只打 console"——用户不可见 | F-06、后端 `release_stale_pipeline_sessions` 写时间线失败 `pass`（`:580-581`） |
| X-03 | 内部枚举/英文值直出到中文 UI | T-04、预览性能浮层、任务状态 |
| X-04 | 文案与实际能力不一致（Agent 数、端口、支持格式、未实现档位） | F-09～F-11 |
| X-05 | 会话状态写入方多（stop / watcher / 周期扫描 / continue），缺"谁拥有当前任务"的单点判定 | B-01～B-04 |

---

## 7. 分批建议

| 批次 | 内容 | 说明 |
|---|---|---|
| 1 | B-01、B-02、B-03、F-01、F-02、S-01、S-02 | 状态错乱与操作结果不符，优先 |
| 2 | T-01、T-02、T-03、P-01、P-02、B-04、F-03 | 高频交互体验 |
| 3 | 其余 P2 | 体验打磨与文案 |
| 4 | P3 与死代码 | 收尾 |

## 8. 验收通用要求

- 每条修复附回归测试（并发类问题用可控时钟/fake kernel 复现）。
- 前端：`npx tsc --noEmit`、`npm run test`、`npm run build` 通过。
- 后端：至少跑 requirements / task / event contract 相关测试与 `python -c "import clipwright.main"`。

## 9. 开放问题

1. 画布单击是否保留"切换播放"？（P-02/P-03）建议改为单击选中、空格播放。
2. 离线时是否还允许进入演示编辑器？若允许，默认是否受 `allowDemoFallback` 控制？（F-05）
3. 历史思考默认折叠是否可接受？（T-08）
