# 前端 MotionSpec Coding Plan

> 状态：执行计划；除“当前审计事实”外，本文所有 CP、接口、组件、测试和验收均为**待实现**，不表示已完成或 API 已存在。  
> 范围：`J:\Clipweight-Client` 前端 MotionSpec 接入；不包含后端实现，但前端解锁依赖后端契约、compiler 与能力快照验收。  
> 原则：先只读和 fail-closed，再开放逐项验证的编辑能力；浏览器不调用 LLM、不执行 `mg_html`，最终成片以后端渲染为准。

## 1. 当前审计事实（已核对）

1. 当前前端仅消费 `clip.metadata.mg_def`（兼容 `mg_spec`）绘制 Canvas display-list，并非 MotionSpec 原生编辑器；`mg_html` 不执行。属性面板的 MG 信息也只是只读摘要。
2. 通用 KeyframeEditor 在 `src/features/properties/PropertiesPanel.tsx` 中，操作 `clip.keyframes`，时间为 `[0,1]` 归一化；通用 Bezier 约定把曲线写在结束帧。MotionSpec 使用秒级 `[0,duration_sec]`，easing 作用于起始帧到下一帧。二者必须经显式适配器隔离，不能直接复用数据格式。
3. 后端 `/api/text-animation/validate-spec`、`/author`、`/compile` 当前不存在（前后端 PRD 均列为待新增）；下文接口调用均是**待实现契约**，不得假定已有 endpoint、响应或鉴权行为。
4. `PreviewPanel` 对缺少 MGDef 的动画可能落回普通文字绘制；MotionSpec clip 若缺失/失效编译产物，必须阻止这种误导性回退。
5. `src/features/preview/previewFidelity.ts` 对 MotionSpec 只识别 `unsupported` / `preview_supported === false`，未完整识别 `approx`、缺失 preview ops、逐原语支持与绘制差异。
6. `timelineStore.updateClip` 只更新 timeline/dirty，不自动建立 history；当前调用方自行 `pushState`，不能把 `updateClip` 当成事务或撤销保证。
7. style pack 已有部分 UI（`PropertiesPanel.tsx` 拉取 `/api/text-animation/style-packs` 并应用到 clip 字段）；asset pack 没有 UI。两者均不等于 MotionSpec pack 引用、原子更新或资源 resolver 已接通。
8. 指定审计路径 `src/services/api.ts` 不存在。API 实现实际采用 `src/services/api/` 目录（含 `client.ts`、`index.ts`、`sseStream.ts` 等）；MotionSpec API 应按现有模块模式新增 `src/services/api/textMotion.ts` 并从 `index.ts` 导出，具体文件仍待实现。
9. 指定通用 `KeyframeEditor` 未发现独立文件，相关实现嵌在 `PropertiesPanel.tsx` 的 `KeyframeEditor`；计划要求先拆/适配，不声称其已有 MotionSpec 支持。

## 2. 交付策略与硬约束

- **阶段门禁**：CP-0 审计/契约冻结 → CP-1 类型/schema/adapter → CP-2 预览原语与 fidelity → CP-3 PreviewPanel 安全分支 → CP-4 API/任务交互 → CP-5 原子事务/history/持久化 → CP-6 属性编辑器 → CP-7 通用编辑器适配 → CP-8 packs → CP-9 timeline markers、flags、整体验收。
- 即使章节描述最终 UI，第一阶段也只上线只读摘要、状态、错误定位和真实成片对照。能力不在服务端能力快照中、schema 未对账、compiler/MG validator/Canvas 抽帧未通过时，控件隐藏或禁用并展示原因。
- 明确首发可交付切片：CP-0/1 的读取 schema 与摘要、CP-3 的只读状态分支、错误呈现和 legacy 识别；不依赖 author/compile 编辑 API。可信预览必须待 CP-2 原语验证及有效编译产物绑定通过后单独开关。任何 CP 若依赖未实现的后端端点，只能以 mock 契约测试开发，不可计入集成验收/发布完成。
- 前端轻量校验仅用于输入反馈。提交与导出必须由后端复验；无能力快照、版本不匹配、未知字段/资源、校验失败、409、超时或取消均 fail-closed，保留 last-known-good。
- 不得把 MotionSpec 写入 `clip.keyframes`；不允许固定 `exact`；不允许缺失 MGDef 时显示白字、默认 fade、旧模板或其他 legacy 兜底。只有明确来源标识的旧 clip 才走只读 legacy 路径。
- 所有阶段状态与错误须可追踪到 clip、spec hash、schema/compiler/capability 版本；模型/接口文本进入 React 节点前按项目约定做安全文本化。

## 3. CP-0：契约冻结与基线

**状态：待实现。**

- 建立前端与后端 §25–28 对账表：v1 schema 字段/关闭未知字段规则、能力快照版本、字段可编辑集合、MG validator 白名单、Canvas 原语矩阵、错误响应、版本并发、任务查询/SSE/取消、资源 ID 契约。
- 对前端仓库确认真实 API 目录结构：复用 `src/services/api/client.ts` 的请求/错误约定，在 `src/services/api/textMotion.ts` 新增专用 client；不要创建或引用不存在的 `src/services/api.ts`。核对 `src/services/api/index.ts` 导出模式及 `src/services/api/sseStream.ts` 的 SSE 约定。
- 记录初始验证基线：`npx tsc --noEmit`、`npm run test`、`npm run build`；本计划不预设测试已通过。补充现有 `src/stores/timelineStore.test.ts`、PreviewPanel/PropertiesPanel 测试文件的实际位置探测，缺失时新增专用测试。
- 与后端共同冻结只允许候选原语清单。依据后端 PRD §25–26，初始候选仅在逐项验证后考虑：单 text layer、显式静态 style/layout、2D 数值 transform/opacity、严格命名 easing、至少两帧线性插值。不能因为此列表写入计划就启用它。
- 产出：契约版本决议、端点草案、前端能力矩阵和测试夹具。任何一项未达成，后续只读，不进入编辑器开放。
- 出口条件：前后端负责人确认一份机器可读契约来源（版本化 JSON Schema 或等价生成物）、API 请求/响应样例、capability 快照样例与错误码表；CI 有 schema/字段/能力/错误码对账检查。只写文档或以 TS 手写类型代替契约冻结不算通过。
- 同步确认接口现状：PRD 声明 capabilities/style-packs/asset-packs 列表已存在，但需运行时核验其真实路由、响应形状、鉴权与版本字段；只有不存在/不符的端点列入后端新增项，不重复造列表 API。

## 4. CP-1：类型、Schema 与 adapter

**状态：待实现。**

新增：

- `src/features/textMotion/types.ts`：版本化 `MotionSpec`、`MotionLayer`、`MotionKeyframe`、`Easing`、`MotionTrack`、`MotionPath`、`MotionEffect`、Camera、能力快照、错误定位、编译产物与任务状态类型。字段以双方冻结 schema 为准，明确 `spec_id`、`requires`、Layer `mask` 等后端必填/合法字段，不照搬旧 PRD 草案中不完整的 TS 片段。
- `motion_spec_hash` 只由服务端对规范化 spec 计算并返回；前端不得自算后冒充权威 hash。前端可计算 draft fingerprint 用于本地缓存/乱序防护，但不能写入权威 hash 字段。产物绑定需核对 spec hash、schema/compiler/capability 版本；缺任一绑定信息即按失效处理。
- `src/features/textMotion/schema.ts`：编辑期轻量校验，拒绝 NaN/Infinity、越界时间、非法 easing 参数、超限路径点/层/帧、未知字段和未声明能力；错误包含 `layer_id/field/time`。前端校验规则由契约生成或 CI 对账，权威仍为后端 validator。
- `src/features/textMotion/adapter.ts`：metadata 提取、版本化读写、能力差异、预览状态派生、`specSeconds <-> normalizedUI` 转换。转换处理零时长、精度量化、clip duration 不符和不可映射值；不得修改 legacy `clip.keyframes`。
- 对 `clip.text`、MotionSpec text layer `content`、clip duration 与 `spec.duration_sec`、样式包默认值与显式 `layer.style` 定义同步策略。未实现原子同步时，相关编辑必须拒绝并提示，不能静默覆盖；时长变更不允许简单截断关键帧。

测试：新增 `src/features/textMotion/schema.test.ts`、`adapter.test.ts`，覆盖字段契约、未知字段/能力拒绝、NaN/Infinity、版本往返、秒与归一化映射、零时长、浮点量化及旧 keyframes 不变。

## 5. CP-2：mgRenderer 预览原语与 fidelity

**状态：待实现；按原语逐项开放。**

- 修改 `src/features/preview/mgRenderer.ts`：针对 MotionSpec 编译产物逐项审计并实现/明确不支持 3D transform、blur、clip、mask、easing。不得仅因 MGDef/HTML 能生成就宣称 Canvas 支持。
- 3D（translate_z、rotate_x/y、perspective）若 Canvas 2D 无等价实现，标 `unsupported`，不静默投影成 2D；clip/mask 若形态/边界未支持同样不绘制并记录原因。blur 必须核对 Canvas filter 的性能和与后端效果差异，不能伪称精确。
- 修正 MotionSpec easing 归属：MGRenderer 目前在区间解析中可读 `next.easing || prev.easing`；冻结契约规定 easing 在起始帧，改为读取当前区间起始帧并处理最后帧 easing 忽略。未知 easing 必须拒绝或 unsupported，不退线性后继续伪装可用。
- 将逐项结果与 `preview_ops`、MG 属性白名单和能力版本比对；renderer 输出结构化 `FidelityReport`，包含 `exact | approx | unsupported`、缺失 ops、未知原语/属性/效果、阻断资源和可读原因。`exact` 只能在像素及时序阈值的自动对照证明后针对具体原语开放；常规界面仍保留“近似预览”说明。
- 图片/字体/纹理只接受受控 `asset_id` resolver 回执，浏览器不得按 MotionSpec 任意 URL/路径请求。未知资源明确不可用。

测试：`src/features/preview/mgRenderer.motionSpec.test.ts`（新建）对 2D 基本属性、3D/blur/clip/mask、起始帧 easing、未知 easing、资源拒绝和 fidelity 分类做逐原语断言；保存 Canvas 抽帧 fixture，与后端渲染抽帧比较。

## 6. CP-3：PreviewPanel 分支与失败安全

**状态：待实现。**

- 修改 `src/features/preview/PreviewPanel.tsx`，抽出可单测的 MotionSpec clip 解析/预览状态分支，优先级如下：
  1. 存在 MotionSpec 标识：只消费 hash/version 一致且经验证的 `mg_def` / `preview_ops`；缺产物时显示“待编译”，失效显示“编译产物失效”，失败/不支持显示结构化错误或上次可信画面，绝不进入普通文字绘制。
  2. 无 MotionSpec 且来源标识明确为旧 MG clip：继续旧 `mg_def` 绘制并标记 legacy/read-only。
  3. 无 spec 且为普通文字 clip：走既有普通文字路径并显示无 MotionSpec 来源提示（按产品状态设计，不把所有字幕强制判错）。来源不明的 animation clip 不猜。
- clip 切换、项目刷新、请求乱序时用 AbortController/generation token 作废过时 compile；缓存键包含规范化 spec hash、compiler/schema 版本、能力版本和 preview ops 版本。编辑中不按帧请求后端；小 spec debounce compile，大 spec 在拖动结束/暂停后编译。
- 预览层、属性面板与 timeline 共用同一状态/错误选择器，避免一处提示 unsupported、另一处仍画白字。

测试：`src/features/preview/MotionSpecPreview.test.tsx`（新建）覆盖合法产物、缺 MGDef/ops、hash/版本不符、compile 错误、unsupported/approx、取消/乱序、legacy 明确识别和普通文字独立分支；确认不访问 `mg_html`。

## 7. CP-4：API client、作者任务、SSE、409 与取消

**状态：所有 MotionSpec 路由待新增；当前不得接线为“已有 API”。**

- 在 `src/services/api/textMotion.ts` 增加 typed client，并在 `src/services/api/index.ts` 按现有模式导出。复用 `src/services/api/client.ts` 的 base URL、鉴权、错误解码与请求取消约定；任务 SSE 复用/扩展 `src/services/api/sseStream.ts`，不另造不兼容的流实现。
- 待后端新增并经联调确认的契约：
  - `GET /api/text-animation/capabilities`：能力、schema/compiler 版本、支持字段、Canvas fidelity 原语、feature ID；已有 PRD 声明该列表接口，但上线前仍需核对真实响应与版本。
  - `GET /api/text-animation/style-packs`、`GET /api/text-animation/asset-packs`：PRD 声明已有列表接口；UI 仍需校验响应契约、权限和 pack/version/hash。
  - `POST /api/text-animation/validate-spec`：待新增；提交 clip、base revision/hash、schema/capability version、draft spec；只校验不落盘，返回定位 errors/warnings、版本及可提交状态。
  - `POST /api/text-animation/compile`：待新增；验证后编译、不落盘、不调用 LLM，返回 spec hash、compiler version、mg_def、mg_html（只作为后端产物，不在浏览器执行）、preview_ops、fidelity inputs 与错误。编译响应必须明确它是 draft 产物、绑定的 draft/spec fingerprint 和版本；绝不能直接改 `timelineStore` 或服务端 clip。
  - `POST /api/text-animation/author`：待新增 Agent 任务入口，不是浏览器直接调模型/插件。启动回执至少含 task_id、clip_id、revision/幂等键；任务状态查询/SSE 订阅和取消 endpoint 均待后端定义实现，鉴权、归属、超时、终态、进度、成本/重试也须冻结。
  - 条件提交/保存事务 endpoint：待新增并定稿；使用 `If-Match` 或 base revision/hash 原子替换 spec/hash/版本/编译产物/provenance。版本冲突返回 409，错误响应保留 draft。
- 客户端统一处理网络错误、结构化错误码、任务终态、可重试标记；409 保留当前草稿并提供“重新载入/比较”路径，不自动覆盖。取消 author 必须等后端取消回执；本地 AbortController 仅断开请求，不宣称任务已取消。
- author UI 显示 pending/等待/进度/task id/成功/失败/取消回执和重试成本。后端 PRD 单次 author 最长 300 秒是服务端目标契约，前端不得把 60 秒通用 Axios timeout 当 author 业务超时；任务启动/查询走短请求，长执行只订阅 SSE/轮询状态。服务端必须给出 started_at、deadline/timeout 终态、attempt 与总预算；刷新后按服务端状态恢复。外层至多三轮、author 内 JSON repair 至多一次及 `text_generation` + author 的总调用成本需在契约中显式呈现；预算/幂等未落实前不提供无约束重试按钮。
- 固定客户端状态机：`idle → validating → compiling → ready_to_commit → committing → committed`；author 为独立的 `authoring → succeeded|failed|cancel_requested → cancelled|timed_out` 子流程。任一失败回到可编辑 draft，不能改变 committed bundle。仅 `ready_to_commit` 可发条件提交；提交响应须回传最终 revision/hash/产物版本。SSE 事件至少带 `task_id, seq, status, timestamp`，重复/乱序按 seq 丢弃，重连用服务端确认的 cursor/since 参数补事件；终态主动关闭流，补状态快照后再重连。当前 `connectSseStream` 不支持 last-event cursor/主动 abort signal，若 author 契约要求断点续传须先扩展并回归现有 SSE 使用方，不能默认它已经提供该能力。
- `validate`/`compile` 结果与 draft fingerprint 一致且版本未变才可进入 `ready_to_commit`；用户继续编辑、换 clip、切项目、能力快照更新时清空旧结果并取消/忽略请求。`commit` 只能提交与验证/编译同一 draft 的结果。

测试：`src/services/api/textMotion.test.ts` mock API 覆盖 schema 错误、409、超时、Abort、任务归属/状态、SSE 重连与终态、幂等键；不得调用真实 LLM。

## 8. CP-5：timelineStore 原子事务、撤销与序列化迁移

**状态：待实现；禁止以多次 `updateClip` 拼成伪原子提交。**

- 在 `src/stores/timelineStore.ts` 增加明确事务入口，例如 `commitMotionSpecTransaction(clipId, expectedRevision, committedBundle)`：先验证当前 clip revision/hash，再单次状态替换 spec、hash、schema/compiler/capability 版本、mg_def、preview_ops、fidelity、author provenance；检查失败不修改 state。接口名称最终遵守 store 现有设计。服务器条件提交成功是持久化线性化点；本地 store 的单次 set 只保证 UI 原子切换，不等同服务器事务。提交服务端成功但本地更新失败时必须重新 hydrate 服务端 clip，禁止回滚服务端已提交版本或继续显示旧版为当前权威。
- history 快照需在调用事务前由统一命令/事务层生成一次，提交后一次 undo 可还原整个 bundle。拖动过程只改局部 draft；pointerup/blur 才验证、编译、提交一个 undo。取消、409、编译失败不建 history、不污染 last-known-good。`updateClip` 本身不自动建 history 的现状必须保留为已知边界，避免误以为已经解决。
- 定义服务器与本地 undo 的边界：本地 undo 只能恢复编辑器当前历史快照；若服务端提交已成功，undo 也是新的带 `If-Match`/base revision 的服务端提交，失败或 409 时保留当前权威版本并显示冲突，不能只本地回滚而让刷新后复活。服务端版本恢复只在后端提供明确历史版本 API 时开放；不能将本地撤销描述成服务端版本回滚。
- 项目刷新/切换期间取消 draft 请求并禁止旧项目响应写入新项目；若保存中切换项目，保留任务归属并等服务端终态或主动取消，不能仅依赖组件卸载中止 HTTP。
- 统一处理保存、刷新、项目导入/导出、history restore：序列化不丢未知但受 schema 拒绝的字段；旧版本只读提示，不自动迁移/改写 spec；新字段版本迁移需显式、可重复、可回滚。缓存失效按 spec hash/compiler/capability 版本触发。
- 文本/时长/样式更改作为同一事务的输入。若后端无同步编译与原子提交契约，则禁用会破坏 spec 一致性的相应字段或拒绝提交。

测试：扩展 `src/stores/timelineStore.test.ts`，覆盖成功原子替换、revision/hash 不匹配无副作用、撤销/重做全 bundle、保存刷新往返、失败保留旧产物、取消不入 history、旧 spec 只读和迁移幂等。

## 9. CP-6：PropertiesPanel MotionSpec 编辑器

**状态：只读先行；编辑字段按能力快照逐项待解锁。**

- 修改 `src/features/properties/PropertiesPanel.tsx`，为 text clip（不仅 `kind=animation`）加入 MotionSpec 区块；把只读 MGSpecSection 与 MotionSpec 状态分开展示，不把 MGDef 当 spec。
- 概要展示 provider/model、spec hash 前 8 位、schema/compiler/capability 版本、author 状态、fidelity、编译状态、结构化错误和只读/可编辑原因。重新生成按钮只启动后端 Agent author task，不调用模型；“恢复上次生成”只有服务端确有版本记录时才出现。
- Keyframes：逐层/属性展示时间秒值；首批只在能力表开放后编辑经证实的白名单属性。easing 提供 linear/named/cubic-bezier/steps/hold/spring 的类型化 UI，但未开放能力必须禁用；spring 参数、采样预览属于待能力门禁，不因控件存在就可保存。
- Tracks、Path、Camera、Text Stagger、Effects、JSON 均按独立 capability gate 懒加载/禁用。path 与 track 同属性同时间窗冲突要显示 layer/property/time 并拒绝；group/parent、3D、mask、plugin effect 等默认不开放，直到完整证据通过。
- JSON 面板默认只读；可编辑开关必须等 schema 闭合、validate/compile/commit 事务与错误行定位均完成。永不接受 HTML/JS/CSS/Shader 文本或任意 endpoint。
- Style pack 选择必须应用为默认值且保留 `layer.style` 显式覆盖；从 clip 字段输入造成 spec 内容/样式/时长不同步时拒绝或走同一事务。Asset pack UI 归 CP-8。

测试：新增 `src/features/properties/MotionSpecSection.test.tsx`、`MotionSpecKeyframeEditor.test.tsx`、`BezierEasingEditor.test.tsx`、`SpringEditor.test.tsx`、`MotionSpecPathEditor.test.tsx`、`MotionSpecCamera.test.tsx`、`MotionSpecError.test.tsx`；按阶段逐个创建，不允许以占位测试宣称覆盖。使用真实服务能力快照 fixture，测试 unavailable 控件禁用和错误文本安全渲染。

## 10. CP-7：KeyframeEditor 显式适配器

**状态：待实现。**

- 当前通用 `KeyframeEditor` 位于 `src/features/properties/PropertiesPanel.tsx`，面向 `clip.keyframes`。先抽取可复用交互/展示部件到 `src/features/properties/KeyframeEditor.tsx`（若代码结构核对后更合适），保留 legacy props 与行为，再提供 MotionSpec adapter 接口，不共享持久化类型。
- 适配：spec 秒 ↔ UI 归一化；UI 第 `i+1` 帧的旧 easing 读作 spec 第 `i` 帧 easing；写回反向映射；spec 最后一帧 easing 忽略且不可编辑。规定零时长、端点、重复时间、拖动精度与越界策略；round-trip 后 spec 秒值/easing 语义不变。
- `BezierCurveEditor.tsx` 保持纯曲线控件，通过 wrapper 将 `cubic-bezier` 映射成现有 `BezierHandles`；不要改变已有 legacy 结束帧语义。MotionSpec wrapper 标记显示的区间是起始帧→下一帧，pointerup 才提交事务。
- 拖拽预览可更新本地 draft 并触发防抖 compile；取消/切 clip 清掉 timer 与请求；不能逐帧提交 store/history。

测试：`src/features/properties/KeyframeEditor.motionSpec.test.tsx` 覆盖双向映射、首/末帧、浮点边界、持续拖动一个 undo、取消无写入；已有 `BezierCurveEditor` 覆盖通过 wrapper 回归确认 legacy 不变。

## 11. CP-8：Asset pack / style pack UI 与资源安全

**状态：style pack 有部分现有 UI；MotionSpec 集成及 asset pack UI 均待实现。**

- 在 `PropertiesPanel.tsx` 拆出 pack 控件到 `src/features/textMotion/` 或 properties 子组件，改用 CP-4 typed API 而非组件内裸 `fetch`。Style pack 列表/错误/加载状态可见，保存 pack id/version；应用只填默认值，不覆盖 spec 明确的 layer.style。应用动作必须纳入 MotionSpec 原子事务或在 spec 未同步时禁用。
- 新增 Asset pack UI：按能力快照列出可用 pack/font/texture asset id、版本、hash、授权状态；MotionSpec 仅持 `asset_id`/pack version/hash，不允许路径、URL、`..` 或内联二进制。使用服务端受控 resolver；资源缺失显示 `MOTION_ASSET_UNAVAILABLE`（错误码需与后端对齐），不得静默跳过。
- pack 卸载/禁用影响新生成与新引用；已有 spec 如可确定性使用已缓存/受控资源则继续，否则显式 unavailable，不能重解释或自动移除引用。

测试：新增 `src/features/textMotion/packs.test.tsx`，覆盖列表失败、pack 版本更新、style override 优先级、asset_id 解析、非法 URL/path 拒绝、pack 缺失提示及不破坏现有 spec。

## 12. CP-9：Timeline markers、Feature flags 与整体验收

**状态：待实现。**

- 在现有 Timeline marker 基础上为 MotionSpec keyframe 添加独立可视标记/轨道层：不将 spec keyframe 写到 `clip.keyframes`。第一阶段标记只读、可选择/定位；拖动 keyframe 属后续能力，只有 CP-5 原子事务及编辑能力 gate 通过后才开放。多个 layer 有稳定区分色/图例；缩放时密度聚合，选中标记将对应 layer/property/time 定位到 PropertiesPanel。开放拖动后只更新草稿并由 CP-5 单事务提交。
- 复用并扩展三个前端 flags：`VITE_TEXT_MOTION_SPEC_UI`（只读摘要/状态）、`VITE_TEXT_MOTION_SPEC_PREVIEW`（安全消费已验证产物）、`VITE_TEXT_MOTION_SPEC_EDITOR`（事务闭环后编辑）；缺省关闭。Flag 之间设依赖，editor 不可绕过 preview/transaction gate。关闭 editor 时可显示只读 JSON；关闭 preview 时仍不能对 spec clip 走白字 fallback。
- 阶段发布：A 只读；B 可信预览；C 冻结 v1 子集编辑；D 按证据逐项扩展。每阶段使用独立 flag、灰度比例和回滚责任人；发布记录保存前后端版本、capability snapshot、样例 clip、告警阈值及回滚演练结果。默认开启须另经真实成片、长任务、成本/延迟和刷新恢复门禁，不由计划自动触发。
- 最终 E2E：选中 text clip → 只读概要 → 在开放能力内编辑 → validate → compile → 原子保存 → 预览 → 刷新重载 → undo/redo → author cancel/409/失败恢复。多时点抽帧与后端成片对照，记录环境、版本、容差及 provider 实际成本。702 秒任务验收作为后端/端到端阶段门禁，不以短片单测替代。

测试：新增 `src/features/timeline/` MotionSpec marker 单元/组件测试及端到端用例（沿用仓库 E2E 框架真实位置）；对 flags 做组合矩阵和刷新验证。现有 `src/features/timeline/engine/TimelineEngine.markers.test.ts` 是时间线普通标记测试，不代表 MotionSpec marker 已覆盖。

## 13. 测试矩阵

| 层级 | 待实现测试/真实位置 | 必须覆盖的结果 |
|---|---|---|
| 类型/schema | `src/features/textMotion/schema.test.ts` | 必填、未知嵌套字段、能力缺失、NaN/Infinity、边界、版本对账；轻量校验不得替代服务端校验 |
| Adapter | `src/features/textMotion/adapter.test.ts` | 秒/归一化双向、起始帧 easing、最后帧忽略、旧 keyframes 不变、spec/hash metadata 提取 |
| Renderer/fidelity | `src/features/preview/mgRenderer.motionSpec.test.ts`、`previewFidelity.motionSpec.test.ts` | 3D/blur/clip/mask/easing/ops 原语矩阵，approx/unsupported/缺 ops 与 blocked resource |
| Preview | `src/features/preview/MotionSpecPreview.test.tsx` | 缺产物/错 hash/版本/compile 失败无白字，无 mg_html 执行，legacy/普通 text 分流、取消乱序 |
| API/SSE | `src/services/api/textMotion.test.ts` | schema/compile/author 任务、SSE、取消回执、超时、409、幂等与错误码；mock 服务，不调用真实 LLM |
| Store/history | `src/stores/timelineStore.test.ts` | 原子写/失败无写、undo/redo、一手势一历史、取消不入历史、序列化/迁移/刷新 |
| Properties | `src/features/properties/*MotionSpec*.test.tsx` | 只读先行、capability gate、字段同步拒绝、错误定位、JSON 安全、easing/path/camera/stagger 控件 |
| Packs | `src/features/textMotion/packs.test.tsx` | style 显式覆盖、asset_id 受控解析、卸载和缺失错误、非法路径拒绝 |
| Timeline | `src/features/timeline/` MotionSpec marker tests | 多 layer、缩放聚合、marker 与 `clip.keyframes` 隔离、拖动单事务 |
| 集成/E2E | 仓库实际 E2E 目录（CP-0 定位） | 编辑→validate/compile→原子保存→刷新→undo/redo；409/取消/失败；旧 clip 兼容；多时间点与最终成片比对 |
| 性能/资源 | `mgRenderer.motionSpec.test.ts`、Playwright/E2E 性能用例（目录由 CP-0 定位） | compile 不在播放帧循环；拖动期间仅本地 draft，pointerup 后 debounce；缓存按 hash/版本命中；测量 1080p 与最大允许 spec 的帧耗时、内存/缓存增长和取消收敛，超过预算关闭对应能力 |
| 可访问性/可恢复性 | MotionSpec 属性面板组件测试 + E2E | 键盘可访问只读状态、错误/任务进度有可读标签；切换/刷新/重连后不丢已提交版本、不把 pending 误报成功 |
| 回归 | `npx tsc --noEmit`、`npm run test`、`npm run build` | 前端类型、全测试与生产构建通过；基线与新增结果分别记录 |

## 14. 依赖顺序与并行边界

1. CP-0 冻结 schema、API、能力快照和错误契约；未完成不得写可保存编辑 UI。
2. CP-1 adapter/schema 与 CP-2 renderer/fidelity 可在契约冻结后并行；CP-2 的每个原语都需要后端 compiler/MG validator 对应证据。
3. CP-3 依赖 CP-1、CP-2 的状态模型；CP-4 后端路由可与只读 CP-3 并行开发，但前端 client 只使用正式契约，不 mock 出“已存在”假接口。
4. CP-5 依赖 CP-1、CP-4 的版本/提交契约；先落原子 store/history 再开放任何可写 UI。
5. CP-6、CP-7、CP-8 依赖 CP-5 和服务端 capability snapshot；先只读，逐能力开关。
6. CP-9 与全量 E2E 依赖前述闭环。任何 P0 失败即停止扩展能力，关闭相关 flags 并保留只读诊断。

## 15. Definition of Done（全为待实现验收）

- [ ] MotionSpec schema 与后端 v1 JSON Schema/validator 同版本对账；`spec_id`、`requires`、Layer mask 等字段与嵌套未知字段规则一致。
- [ ] 能力快照贯通 author/validate/compile/PreviewPanel/PropertiesPanel；缺快照时不生成、不编辑、不宣称支持。
- [ ] MotionSpec 缺/错 hash、版本、MGDef 或 preview ops 时无普通白字/legacy/template 回退；保留 last-known-good 或明确错误状态。
- [ ] preview/render 逐原语同源验证；Canvas fidelity 不是固定值；所有未验能力被禁用并给出原因。
- [ ] validate/compile/author/任务查询/SSE/取消/提交 endpoint 均由后端真实实现并联调；本计划文档不视为路由存在证明。
- [ ] 409、取消、超时、编译失败、author 失败和请求乱序无半写、无覆盖旧产物；author 刷新后可恢复真实任务状态。
- [ ] spec 秒级时间与起始帧 easing 映射通过双向测试；不改写旧 `clip.keyframes`，最后帧 easing 不可编辑。
- [ ] 一次用户手势形成一个完整 MotionSpec history 事务；undo/redo 恢复 spec/hash/产物/provenance 同一版本。
- [ ] clip text/style/duration 不一致时要么同事务同步并重编译，要么明确拒绝；无静默覆盖/截断。
- [ ] pack 引用仅 asset_id，解析受控；style 显式值优先；未知或卸载资源明示错误。
- [ ] feature flags 默认关闭且可独立回滚；关 editor/preview 不造成旧内容损坏或误导回退。
- [ ] 自动化单测、组件测试、服务契约测试、E2E、前端类型检查和 build 通过；真实成片多时点抽帧、成本/延迟/长任务记录归档。
- [ ] 性能门槛经双方实测冻结并写入测试配置：播放期间零后端 compile 请求；拖动过程中不提交持久 store；pointerup 后请求 debounce；标准 1080p 预览帧预算以 30fps 的 33.3ms 为上限，记录 p50/p95/p99，超预算能力降为 approx/unsupported 或关闭，不以平均耗时掩盖长尾。最大 spec/层帧/路径采样上限必须由 capability snapshot 给出并做内存与取消压力测试。
- [ ] author 任务 UI 对长任务不依赖页面存活；SSE 中断可按 cursor 恢复或通过任务快照重同步；五次重连耗尽后的降级、手动重连及终态关闭均有自动化证据。

## 16. 风险、回滚与发布

| 风险 | 影响 | 预防与回滚 |
|---|---|---|
| 后端 schema/capability 与 TS 漂移 | 产生无法保存或静默忽略的 spec | 版本化契约/CI 对账；能力快照不可得即关闭 editor flag；保持只读 |
| 缺 MGDef 或错误状态回退普通文字 | 用户误以为动画有效 | PreviewPanel fail-closed 测试；立即关闭 MotionSpec preview flag，保留明确错误，不切换 legacy |
| 2D Canvas 近似 3D/blur/mask | 预览与成片不一致 | 原语矩阵 + 多时点抽帧；unsupported 不绘制，approx 常驻提示；回滚对应 primitive gate |
| 编辑/compile/保存部分成功 | metadata/hash/产物版本错配 | 后端条件原子替换 + 客户端 bundle 原子提交；失败沿用 last-known-good；关闭 editor flag |
| history/拖拽产生大量撤销项 | 用户无法恢复可信版本 | 草稿和提交分离、pointerup 单事务；失败则禁用编辑，回到只读 |
| 长 author 任务取消/刷新竞态 | 旧响应覆盖新 clip | task ownership、generation token、服务端取消回执、409 保留草稿；关闭 author UI，不伪报取消 |
| pack 不可用或任意资源路径 | 安全/渲染错误 | 只允许 asset_id + 受控 resolver；资源拒绝；关闭 pack 功能并显示 unavailable |
| 一次开放过多高级能力 | UI 复杂且无可靠语义 | capability gate 默认关闭，按冻结子集逐项验收；回滚到只读/有限 v1 |

回滚操作顺序：关闭 `VITE_TEXT_MOTION_SPEC_EDITOR` → 关闭 `VITE_TEXT_MOTION_SPEC_PREVIEW`（保留错误状态与只读信息）→ 需要时关闭 `VITE_TEXT_MOTION_SPEC_UI`。回滚不得删除或改写已保存的 MotionSpec；旧来源明确的 legacy clip 仍走既有只读兼容路径。

## 17. P0 / P1 / P2 落实矩阵

| 优先级 | 事项 | 计划章节/CP | 验收证据（均待实现） |
|---|---|---|---|
| P0 | MGDef 缺失、preview ops/fidelity 不实导致普通文字误导；起始帧 easing 与后端语义不同 | CP-2、CP-3、CP-9；§5–6、§13、§15 | spec clip 无有效产物不画白字；缺 ops/unsupported/approx 均显式；MGRenderer 起始帧 easing 单测及多时点抽帧 |
| P0 | spec/hash/版本/编译产物权威不清，编辑失败或并发可能半写 | CP-1、CP-4、CP-5；§4、§7、§15–16 | base revision/hash 条件提交、原子 bundle、409/compile/刷新乱序不覆盖 last-known-good，undo 恢复全 bundle |
| P0 | schema/能力/MG validator/Canvas 支持不一致，未支持功能可被误开放 | CP-0、CP-1、CP-2、CP-6；§3–5、§13、§15 | 能力快照 CI 对账；未知字段/能力/easing 拒绝；逐原语测试通过才开放；缺快照 fail-closed |
| P1 | validate-spec/author/compile 不存在；author 应为 Agent 任务并有 SSE/取消/超时/归属 | CP-0、CP-4、CP-6；§7、§13、§15 | 后端路由契约与鉴权/任务归属集成测试；SSE 恢复、取消回执、超时终态、重试预算真实可见 |
| P1 | 时间基/easing 适配器缺失，编辑旧 clip.keyframes 会破坏语义 | CP-1、CP-7；§4、§10、§13 | 秒与 normalized 往返；起始/结束帧映射逐段测试；旧 keyframes 快照不变 |
| P1 | text/style/duration 与 spec 不一致、style/asset pack 引用无闭环 | CP-1、CP-5、CP-8；§4、§11、§13 | 冲突要么原子同步重编译，要么明确拒绝；asset_id resolver/缺失错误；style 显式覆盖默认 |
| P2 | keyframes/tracks/path/camera/stagger/effects/JSON 编辑器及 timeline marker | CP-6、CP-7、CP-9；§9–12 | 按 capability 逐项组件测试；未开放不可选；冲突定位；高级 JSON 默认只读；marker 与旧 keyframes 隔离 |
| P2 | 完整长任务、真实成本/延迟、刷新/撤销/取消恢复及成片一致性 | CP-4、CP-5、CP-9；§13、§15–16 | 702 秒 E2E/任务门禁、多时点预览-成片像素与时序容差、刷新与历史恢复、真实成本记录；短片/单测不可替代 |
| P2 | feature flags、逐阶段发布与回滚 | CP-9；§12、§16 | flag 组合矩阵、默认关闭、回滚不损坏已存 spec，读-only 降级明确 |

## 18. 执行记录模板

每个 CP 合并/验收时追加一条记录（本文当前不包含已完成记录）：

- CP：`CP-n`
- 状态：待实现 / 进行中 / 阻塞 / 已验收
- 涉及文件：实际路径
- 契约版本：schema / compiler / capability
- 测试命令及结果：逐项记录，不引用历史基线冒充本次结果
- 未开放能力及原因：列出 capability/原语和待补证据
- 回滚 flag / 操作：明确到 flag


## 19. 执行记录（2026-11-18，feat/zam_text_motion_frontend）

- CP-0：契约/现状审计完成；真实 API 目录确认为 `src/services/api/`，三个 MotionSpec 路由仍不存在；
- CP-1：已新增 `src/features/textMotion/types.ts`、`schema.ts`、`adapter.ts`，覆盖 schema/时间/easing 适配与 metadata 提取；
- CP-3：`PreviewPanel` 对 `motion_spec` clip 的缺产物/非法 spec 已 fail-closed，不再落普通文字；
- `previewFidelity` 增加 approx / MotionSpec 待编译提示；
- 测试：`src/features/textMotion/*.test.ts` 6 passed，相关 preview 测试 16 passed；`tsc --noEmit`、`npm run build` 通过；
- 尚未开始：CP-2 Canvas 原语补齐、CP-4 typed API/author 任务、CP-5 原子事务、CP-6–9 编辑器和 timeline markers；
- 提交：`f6f4794`。


### CP-2 首轮执行（2026-11-18）

- `mgRenderer` 已：
  - MotionSpec 起始帧 easing（含 `cubic-bezier(...)` 字符串）；
  - blur / clip_inset / mask 的 Canvas 近似；
  - 3D `translate_z/rotate_x/y/perspective` 记入 `unsupportedProps`，不静默声称支持；
  - `MgFidelity` 增加 `unsupportedProps/approxProps` 并参与 `fidelityHasIssue`。
- 新增 `mgRenderer.motionSpec.test.ts`；
- 本轮验证：tsc 通过，textMotion + preview **159 passed**；
- 尚未完成：CP-3 预览 props 按钮、CP-4 API、CP-5 事务、编辑器。
- 提交：`0b0f9db`。


### CP-4/5/6/7/9 首轮执行（2026-11-18）

- CP-4：新增 `src/services/api/textMotion.ts` typed 契约（capabilities/style/asset/validate/compile/author/task/cancel），从 `src/services/api/index.ts` 导出；路由仍标为待后端实现，不在 UI 调用。
- CP-5：`timelineStore.commitMotionSpecBundle` 实现 hash 校验 + 单次 metadata 原子替换；新增两条测试。
- CP-6：PropertiesPanel 新增只读 `MotionSpecSection`：spec/provider/hash/compiler/fidelity/能力/校验错误/JSON；重新生成按钮禁用并标注 API 待接入。
- CP-7：adapter 已提供秒/归一化与起始帧 easing 映射；编辑器 UI 未开放。
- CP-9：新增 `src/features/textMotion/flags.ts`，默认关闭。
- 验证：`tsc --noEmit` 通过；textMotion/preview/store **223 passed**。
- 提交：`559a2d5`。
- 仍未完成：CP-2 原语矩阵抽帧、CP-4 真实后端联调、CP-5 服务端条件提交、CP-6 实际编辑/事务 UI、CP-7 编辑器、CP-8 asset pack、CP-9 timeline markers、E2E。


### CP-4/8/9 追加（2026-11-18）

- CP-4：新增 `src/services/api/textMotion.test.ts`，只 mock client，验证 typed 契约与不存在的 endpoint 走 contract，不接真实 UI/LLM。
- CP-8：PropertiesPanel 增加 asset pack 只读选择，写入 `asset_pack_id/asset_id`；style pack 仍走现有逻辑；尚缺服务端 resolver/错误 UI。
- CP-9：新增 `src/features/textMotion/markers.ts` 只读 marker 数据与测试，不写入 `clip.keyframes`，尚未接 timeline 画布。
- 验证：tsc、build 通过；textMotion/api 9 passed；提交 `4c0a2e9`。
- 仍未完成：CP-2 逐原语抽帧、CP-4 真实联调、CP-5 服务端条件提交、CP-6 可编辑面板、CP-7 编辑器 UI、CP-9 timeline 渲染与 E2E。


### CP-6 只读 layer/keyframe 追加（2026-11-18）

- PropertiesPanel MotionSpecSection 增加 layer 列表、keyframe 时间摘要、层类型/数量；
- 仍为只读；编辑按钮/动作受 API/事务门禁禁用；
- 验证：textMotion/preview/store 224 passed，tsc/build 通过；提交 `740ad7d`。


### CP-5/7 追加（2026-11-18）

- 新增 `migration.ts`：旧 MotionSpec 版本只读识别（不改写）、秒/归一化 keyframe 纯适配；
- 新增 `migration.test.ts` 覆盖版本只读与双向映射；
- 提交 `d313825`。
- 编辑 UI 仍需后端 validate/compile/author/条件提交接口，当前只读。


### CP-6/8 追加（2026-11-18）

- 新增 `draft.ts` 纯函数：keyframe 时间/数值增删改，只操作本地 draft，不写 store/hash；
- PropertiesPanel asset pack 增加加载失败错误态；
- 验证：textMotion/preview/store 228 passed，tsc 通过；提交 `1960919`。
- 编辑 UI 仍受后端 validate/compile/author/提交 API 阻断。


### CP-4/9 追加（2026-11-18）

- 新增 `authorTask.ts` 纯状态机：idle/authoring/succeeded/failed/cancel_requested/cancelled/timed_out、seq 乱序过滤；
- MotionSpecSection 受 `VITE_TEXT_MOTION_SPEC_UI` flag 门禁，默认不显示；
- 验证：textMotion/preview/store 230 passed，tsc/build 通过；提交 `5bf9877`。
- 真实 author API 仍不存在，状态机只做前端契约。


### 后端 API 接通（2026-11-18）

- 后端已实现 validate-spec/compile/author/commit；前端 `textMotionApi` 已有对应方法；
- PropertiesPanel 的 MotionSpecSection 支持本地 keyframe time/opacity 编辑，保存时依次 validate → compile → commit，再本地原子写 bundle；
- 409 显示冲突并保留草稿；
- 验证：前端 230 passed、tsc 通过；后端 4 passed。
- 仍缺：author UI 接线、tracks/path/camera 编辑、timeline markers、真实视觉 E2E。


### CP-4 author UI 接通（2026-11-18）

- MotionSpecSection 增加“重新生成 MotionSpec”、取消、状态/进度/错误显示；
- 仅调用后端 author 任务，不在浏览器调用 LLM；
- 成功后回填本地 draft，仍需 validate/compile/commit 才保存；
- 验证：230 passed、tsc、build 通过；提交 `18e69ea`。
- 仍缺：SSE 续传、tracks/path/camera 编辑、timeline markers、视觉 E2E。


### CP-6/7 编辑器追加（2026-11-18）

- keyframe 支持时间/opacity/起始帧 easing 下拉；
- 支持添加/删除 keyframe；
- 最后帧 easing 禁用；
- 仍走 validate/compile/commit 保存；
- 验证：textMotion/preview/store 231 passed，build 通过；提交 `27468d1`。
- 仍缺：tracks/path/camera、timeline marker 画布、SSE 续传/视觉 E2E。


### CP-9 timeline markers 接通（2026-11-18）

- `drawMotionSpecMarkers` 增加蓝色只读 keyframe 标记；
- `TimelineEngine.setMotionSpecMarkers` 与 TimelinePanel 接线；
- 不写入 `timeline.markers`，不参与拖动/持久化；
- 验证：textMotion/preview/store 231 passed，build 通过；提交 `e2fb617`。
- 仍缺：可交互 marker、tracks/path/camera、视觉 E2E。


### 高级 JSON 编辑 / PR（2026-11-18）

- MotionSpecSection 增加高级 JSON 编辑入口：解析 motion_spec/1 后进入本地 draft，保存仍走 validate/compile/commit；
- 前端 PR #17 已创建；
- 验证：231 passed、build 通过；提交 `300dc19`。
- 仍缺：tracks/path/camera 结构化控件、marker 拖动、SSE、视觉 E2E。


### author SSE / PR（2026-11-18）

- 后端新增 `GET /author/{task_id}/events`；前端 `watchAuthor` 使用共享 sseStream；
- MotionSpecSection 从轮询改为 SSE，并支持取消；
- 前端 PR #17 已创建，后端 PR #20 已更新；
- 验证：231 tests、tsc/build 通过；提交 `a580e55`。
- 仍缺：tracks/path/camera 结构化控件、marker 拖动、视觉 E2E。


### camera / marker 交互（2026-11-18）

- camera 结构化控件：scale/x/y/rotate 编辑；
- MotionSpec marker 点击：选中 clip 并 seek 到 keyframe；
- 验证：232 passed、build 通过；提交 `e2a4536`/`3314682`。
- 仍缺：tracks/path 专用控件、marker 拖动、完整视觉 E2E。


### SSE 续传（2026-11-18）

- 后端 SSE 增加 `id: seq` 与 `Last-Event-ID`；
- 前端共享 `connectSseStream` 由 EventSource 自动续传；
- author UI 已走 SSE，取消仍走 cancel endpoint；
- 前端 232 tests/build 通过。


### path 编辑（2026-11-18）

- MotionSpec 面板支持 path type 下拉与前两个点的 x/y 编辑；
- 修改进入本地 draft，保存仍走 validate/compile/commit；
- 233 tests、build 通过；提交 `2b71ce0`。
- tracks/effects 仍通过高级 JSON 编辑。


### tracks 编辑（2026-11-18）

- MotionSpec 面板支持 track 段 start/end 结构化编辑；
- effects 仍 JSON 编辑，仅显示数量；
- 234 tests、build 通过；提交 `57a4f46`。
- 仍缺 marker 拖动与视觉 E2E。


### 真实浏览器 E2E（2026-11-18）

- 打开 `http://127.0.0.1:5173/editor/proj_f4727a36c443`；
- 选中 `tc_e9831d60`（MotionSpec hash `e92586c2...`）；
- 在属性面板把首 keyframe time 从 `0.00` 改为 `0.10`；
- 点击“保存 MotionSpec”，完成 validate → compile → commit；
- 服务端 hash 变为 `70162e28...`，keyframe time 持久化为 `0.1`；
- 刷新页面后重新选中，hash 和 `0.10` 仍在；
- 截图：`docs/e2e/motion-spec-editor.jpg`。


### effects 编辑（2026-11-18）

- MotionSpec 面板显示 effects 类型并支持删除；
- 新增 effect 仍通过高级 JSON；
- 235 tests、build 通过；提交 `806d069`。


### 成片渲染抽帧（2026-11-18）

- 从已 commit 的 `mg_def` 生成 Hyperframes HTML；
- 在浏览器 seek 到 1s，截图：`docs/e2e/motion-spec-render.jpg`；
- 画面显示黄色「并非回应」，证明 commit 产物可独立渲染，不依赖 author/LLM；
- 预览端仍为近似预览。


### effects 新增（2026-11-18）

- 支持添加 glow / blur effect；
- 支持删除 effect；
- 其他参数仍 JSON 编辑；
- 236 tests、build 通过；提交 `dd4dcd0`。


### marker 拖动（2026-11-18）

- MotionSpec marker 支持拖动：拖动结束写回 `motion_spec` 的 keyframe time；
- 写入带 `motion_spec_draft=true`，不改 `motion_spec_hash`，必须保存/compile/commit 后才权威；
- 236 tests、build 通过；提交 `85735f1`。


### 预览/成片差异观察（2026-11-18）

- 在 62.65s（clip local 1s）预览截图里，视频底层与字幕可见，但 MotionSpec 黄色文字未出现；
- 同 clip 的 Hyperframes 成片 1s 抽帧显示黄色「并非回应」；
- 说明预览的 MG 绘制仍有差异/门禁问题，不能把“近似预览”当作已对齐；
- 已把 preview store 暴露到 DEV 调试入口，便于继续定位。
