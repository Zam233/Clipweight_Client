# 文字 MotionSpec 前端与编辑器 PRD

> 状态：现状审计 + 方案；除“当前代码已实现”明确标识外，下述设计与测试文件均为待实现目标
> 修订说明：独立审阅 P0/P1/P2 的收口要求见第 16–18 节；前文全部能力清单受后端冻结 v1 能力表约束，不能据此推断已接线。
> 目标分支：`feat/zam_text_motion_frontend`  
> 关联后端：`docs/text-motion-llm-spec-prd.md`、`feat/zam_text_motion_llm_spec`

## 1. 结论：是否已经完全适配

**没有。**

当前前端已经能“显示”文字动画，但还不能“理解、编辑、审计” MotionSpec。

| 能力 | 现状 | 结论 |
|---|---|---|
| 文字动画预览 | `PreviewPanel` 读 `metadata.mg_def` 绘制 | 可用，但只消费编译产物 |
| MotionSpec 类型 | 只有 `metadata: Record<string, unknown>` | 无类型 |
| MotionSpec 校验 | 无 | 未适配 |
| keyframe 编辑 | 有通用 `KeyframeEditor`，编辑 `clip.keyframes` | 不编辑 `metadata.motion_spec` |
| easing 编辑 | 有 `BezierCurveEditor`，但只对应 clip keyframes | MotionSpec 未接 |
| 路径 / camera / track | 无 | 未适配 |
| 逐字 / stagger | 预览可显示编译结果 | 不可编辑 |
| preview_ops | 只判断 `kind=mg_def` 和 `unsupported` | 未完整消费 |
| fidelity | 有 `previewFidelity` 角标 | 只有布尔级提示 |
| LLM author 状态 | 无 UI | 未适配 |
| error code | 无 MotionSpec 错误面板 | 未适配 |
| style/asset pack | PropertiesPanel 有 style pack 选择；asset 无 UI | 部分适配 |
| 刷新/重放 | clip metadata 随项目保存 | 可显示，但不能编辑 spec |

所以当前是“编译器产物预览”，不是“MotionSpec 原生编辑器”。

## 2. 目标

1. 前端显式识别 `motion_spec`；
2. 预览与成片共用同一份编译结果；
3. 编辑器可查看/编辑 MotionSpec 的主要字段；
4. keyframe 支持：
   - linear
   - named easing
   - cubic-bezier（曲线编辑器）
   - steps
   - hold
   - spring
   - path
5. 支持 tracks / camera / text stagger；
6. 展示 LLM author 状态、spec hash、provider、fidelity；
7. 错误可读、可定位、不可静默；
8. 不执行 `mg_html`，不调用 LLM 渲染。

## 3. 非目标

- 前端直接调 LLM 生成 MotionSpec（由 Animation Agent 负责）；
- 前端执行任意 HTML/JS/Shader；
- 本期不做完整 3D 场景编辑器；
- 不把 MotionSpec 变成任意 CSS 文本框。

## 4. 数据契约

### 4.1 clip metadata

```ts
type MotionSpecMeta = {
  motion_spec: MotionSpec;
  motion_spec_hash?: string;
  motion_spec_version?: string;
  motion_author?: {
    provider: string;
    model?: string;
    prompt_version?: string;
    attempt?: number;
    seed?: number;
  };
  text_provider_id?: string;
  fidelity?: 'exact' | 'approx' | 'unsupported';
  preview_ops?: PreviewOp[];
};
```

### 4.2 TS 类型

新增：

```text
src/features/textMotion/types.ts
src/features/textMotion/schema.ts
src/features/textMotion/adapter.ts
```

核心类型：

```ts
type Easing =
  | { type: 'linear' }
  | { type: 'named'; name: string }
  | { type: 'cubic-bezier'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'steps'; count: number; position: 'start' | 'end' | 'both' }
  | { type: 'hold' }
  | { type: 'spring'; stiffness: number; damping: number; mass: number; velocity: number };

type MotionKeyframe = {
  time: number;
  easing?: Easing;
  opacity?: number;
  translate_x?: number;
  translate_y?: number;
  translate_z?: number;
  scale?: number;
  scale_x?: number;
  scale_y?: number;
  rotate?: number;
  rotate_x?: number;
  rotate_y?: number;
  rotate_z?: number;
  blur?: number;
  clip_inset?: [number, number, number, number];
  mask?: { x: number; y: number; w: number; h: number };
};

type MotionLayer = {
  id: string;
  type: 'text' | 'shape' | 'line' | 'image' | 'group';
  content?: string;
  layout?: Record<string, unknown>;
  style?: Record<string, unknown>;
  text_motion?: { unit: 'char' | 'word' | 'line' | 'range'; stagger: number; order: string };
  keyframes: MotionKeyframe[];
  tracks?: MotionTrack[];
  motion_path?: MotionPath;
  effects?: MotionEffect[];
};

type MotionSpec = {
  schema: 'motion_spec/1';
  spec_id?: string;
  duration_sec: number;
  canvas: { width: number; height: number; fps?: number };
  requires?: string[];
  layers: MotionLayer[];
  camera?: { keyframes: MotionKeyframe[] };
  meta?: Record<string, unknown>;
};
```

### 4.3 校验

前端只做 **编辑期轻量校验**：

- time 范围；
- easing 参数范围；
- path 点数；
- 必填字段；
- 数值 NaN/Infinity；
- 不能修改文字内容时提示。

真正 schema/capability/质量校验仍以后端 `MotionSpecValidator` 为准。

## 5. API

### 5.1 已有

```text
GET /api/text-animation/capabilities
GET /api/text-animation/style-packs
GET /api/text-animation/asset-packs
```

### 5.2 需要新增

```text
POST /api/text-animation/validate-spec
POST /api/text-animation/author
POST /api/text-animation/compile
```

- `validate-spec`：前端保存前校验；
- `author`：由 Animation Agent/任务执行，不在 render；前端只发起“重新生成”；
- `compile`：返回编译后的 `mg_def`/`preview_ops`，用于编辑器即时预览。

约束：

- 前端不直接调用模型；
- `author` 必须返回 spec/hash/model；
- `compile` 不落盘、不调用 LLM；
- 失败返回结构化错误码。

## 6. 预览

### 6.1 渲染源

`PreviewPanel` 文字分支：

```text
1. 若 metadata.motion_spec 存在：
   - 使用后端编译的 mg_def / preview_ops
   - 不执行 mg_html
2. 若只有 mg_def：
   - 兼容旧 clip，继续 drawMgFrame
3. 若只有 motion_spec 没有 mg_def：
   - 显示“待编译”，调用 compile 或提示刷新
4. 无 spec：
   - 走旧逻辑，但显示“无 MotionSpec”角标
```

### 6.2 Fidelity

```ts
type PreviewFidelity = 'exact' | 'approx' | 'unsupported';
```

UI：

- `exact`：无角标；
- `approx`：“近似预览”；
- `unsupported`：“该 motion 不支持预览”，禁止伪装成白色文字；
- `preview_ops` 缺失：
  - 显示“预览指令缺失”，不静默；
- 错误码显示在时间线/属性面板。

### 6.3 预览性能

- 不允许按 MotionSpec 每帧调用后端；
- 使用编译后的 `mg_def` 前端 Canvas 绘制；
- 缓存 compiled spec hash；
- 编辑 keyframe 时 debounce compile；
- 大 spec 只在暂停/拖动结束时重编译。

## 7. 编辑器

### 7.1 入口

选择 text clip 后，PropertiesPanel 增加：

```text
文字动效
  ├─ 概要
  ├─ Keyframes
  ├─ Tracks
  ├─ Path
  ├─ Camera
  ├─ Text Stagger
  ├─ Effects
  └─ JSON（高级）
```

### 7.2 概要

显示：

- provider：`text-motion-llm`
- model
- spec hash 前 8 位
- `fidelity`
- `motion_spec_version`
- “重新生成 MotionSpec”按钮
- “恢复上次生成”按钮

重新生成：

- 不直接在浏览器调 LLM；
- 调用后端 `author`（或任务 agent）；
- 显示 pending/success/failure；
- 失败显示错误码；
- 不在失败时回退模板。

### 7.3 Keyframe 编辑

复用现有 `KeyframeEditor` 的交互，但数据源改为 `metadata.motion_spec.layers[]`：

- 时间轴添加/删除 keyframe；
- 属性快照：
  - opacity
  - translate
  - scale
  - rotate
  - blur
  - font_size
  - letter_spacing
- 每个 keyframe 独立 easing；
- 曲线编辑器：
  - 复用 `BezierCurveEditor`
  - 输出 `cubic-bezier`；
- easing 选择器：
  - 线性
  - 命名
  - 贝塞尔
  - 阶跃
  - 保持
  - 弹簧
- spring 参数：
  - stiffness/damping/mass/velocity
  - 实时预览采样结果（前端展示曲线）。

### 7.4 Tracks

- 每行一个属性；
- 每段 `start/end/from/to/easing`；
- 支持添加/删除段；
- 与 keyframes 冲突提示；
- 后端编译时 tracks 优先/合并规则显示说明。

### 7.5 Path

- 画布上拖拽路径点；
- 支持 line/polyline/cubic-bezier/arc/circle；
- 显示 progress 轴；
- 路径越界提示；
- “沿路径朝向”开关。

### 7.6 Camera

- 关键帧编辑：scale/x/y/rotate；
- 画布安全框；
- zoom 上限提示；
- 与字幕带冲突提示。

### 7.7 Text Stagger

- unit：char/word/line/range；
- order：forward/reverse/center/random；
- stagger 秒；
- seed；
- 预览逐字时间轴。

### 7.8 Effects

- blur
- glow
- rgb_split
- shadow
- 插件效果需显示 `plugin id` 与 fidelity；
- unsupported 不可选/不可保存。

### 7.9 JSON 高级编辑

- 只读/可编辑切换；
- schema 校验错误行；
- 保存前调用 `validate-spec`；
- 不允许注入 HTML/JS；
- 恢复按钮。

## 8. Timeline 编辑器

- 在 text clip 上显示 MotionSpec keyframe 标记；
- 拖动 keyframe 更新 MotionSpec；
- 多个 layer 的 keyframe 用不同颜色；
- 选中 keyframe 打开属性面板；
- 时间线缩放时保持标记密度；
- 不把 MotionSpec 写进旧 `clip.keyframes`（两者隔离）。

## 9. Store / History

- MotionSpec 存储在 `clip.metadata.motion_spec`；
- 修改必须走 timeline store 的 `updateClip`；
- 每次拖拽合并成一个 undo；
- 保存时写 `motion_spec_hash`；
- 切换 clip 时取消未完成 compile；
- `motion_spec` 变化使 preview cache 失效。

## 10. 错误与状态

### 10.1 状态

```text
idle
authoring
author_failed
spec_invalid
unsupported
compiling
ready
```

### 10.2 错误码

- `MOTION_SPEC_INVALID`
- `MOTION_SPEC_UNSUPPORTED`
- `MOTION_SPEC_WEAK`
- `MOTION_SPEC_MISSING`
- `MOTION_EFFECT_UNAVAILABLE`
- `MOTION_COMPILE_FAILED`

UI：

- 属性面板错误块；
- 时间线 clip 红色角标；
- 预览顶部提示；
- 不显示白字成片。

## 11. 兼容

- 旧 clip 无 `motion_spec`：继续用 `mg_def`；
- `motion_spec` v1 不可读：只读提示，不自动改数据；
- 编辑器不删除后端 metadata；
- 关闭 feature flag 时只显示只读 JSON。

## 12. Feature flags

```text
VITE_TEXT_MOTION_SPEC_UI=0|1
VITE_TEXT_MOTION_SPEC_EDITOR=0|1
VITE_TEXT_MOTION_SPEC_PREVIEW=0|1
```

### 阶段

1. **只读**：显示 spec/hash/fidelity/JSON；
2. **预览**：消费 compiled mg_def/preview_ops；
3. **编辑器**：keyframe/easing/tracks/path/camera；
4. **默认开启**。

## 13. 测试

| 测试 | 覆盖 |
|---|---|
| `textMotion.schema.test.ts` | 类型/校验 |
| `MotionSpecKeyframeEditor.test.tsx` | 增删/拖拽/easing |
| `BezierEasingEditor.test.tsx` | cubic-bezier |
| `SpringEditor.test.tsx` | spring 参数 |
| `MotionSpecPathEditor.test.tsx` | path 点 |
| `MotionSpecCamera.test.tsx` | camera |
| `previewFidelity.test.ts` | exact/approx/unsupported |
| `MotionSpecPreview.test.tsx` | mg_def/compile 分支 |
| `MotionSpecError.test.tsx` | 错误码 |
| e2e | 选中→编辑→预览→保存→刷新 |

## 14. 验收

- [ ] 选中 text clip 可看到 MotionSpec 概要；
- [ ] keyframe 可增删改，easing 支持 linear/bezier/steps/hold/spring；
- [ ] 曲线编辑器可编辑 cubic-bezier；
- [ ] tracks/path/camera/stagger 可查看并编辑；
- [ ] 预览使用编译产物，unsupported 不静默；
- [ ] 重新生成走后端 author，不在前端调 LLM；
- [ ] 刷新/重开项目后 spec 保留；
- [ ] 错误可定位；
- [ ] 旧 clip 兼容；
- [ ] 184+ 前端测试通过，新增测试通过。

## 15. 风险

- MotionSpec 参数多导致 UI 过载 → 默认折叠、只读优先；
- 前端轻量校验与后端 validator 不一致 → 保存前后端复验；
- 大 spec 导致 Canvas 卡顿 → 缓存 compiled 结果；
- path/spring 预览成本 → 采样缓存；
- LLM author 延迟 → pending 状态和重试；
- 3D 预览差异 → fidelity 标记。

## 16. 修订说明：现状、边界与 Schema

| 分类 | 当前代码已实现 | PRD 目标 / 尚未实现 |
|---|---|---|
| 预览/存储 | `PreviewPanel` 仅读 `metadata.mg_def` 用 Canvas `drawMgFrame`，不执行 `mg_html`；`timelineStore.updateClip` 可改 metadata 并标脏 | 不是 MotionSpec 预览或验证；缺 MGDef 时仍可能走普通文字绘制；保存/撤销事务未建立 |
| 编辑器 | PropertiesPanel 有 style pack、通用 Keyframe/Bezier 控件；`Clip.metadata` 为 `Record<string, unknown>` | MotionSpec 类型、原生编辑器、路径/camera、author 状态、版本/hash 管理、取消与错误定位均未实现 |
| API | 已有 capabilities/style-packs/asset-packs 列表 | `/validate-spec`、`/author`、`/compile` 目前在 text-animation router **不存在，全部待新增** |
| fidelity | `previewFidelity` 识别 unsupported | 不识别 approx/缺 ops；Canvas 不画 3D/blur/clip/mask，且 easing 读取下一帧而后端读当前帧；compiler 固定 exact 不可信 |

**非目标/阶段门禁：** 第 2、7、8、12、14 节列的是最终目标，不是第一阶段上线范围。先做所有 text clip 可见的只读摘要、待编译/不支持/错误状态、真实成片对照；有限 v1 参数编辑在 P0 闭环后开放。spring/path/group/camera/tracks/mask/3D/插件效果等依赖后端逐项解锁；capabilities 未声明或不可获取时隐藏或禁用控件并写明原因，不做“可编辑却保存失败”的假入口。高级 JSON 只在契约/事务闭环后可编辑，默认只读；不推出八类面板同时可用。

**Schema 契约（待实现）：** 第 4.2 节 TS 片段是草案，不可作为当前可保存类型：后端 `spec_id` 和 `requires` 必填，后端 Layer 还允许 `mask`，两端字段及能力表必须由同一版本 JSON Schema 生成或做 CI 契约对账。未知顶层/嵌套字段、未声明能力、非法资源拒绝；前端轻量校验仅作输入反馈，保存与导出必须后端复验。后端能力快照包括 schema/编译器版本、可编辑字段、fidelity 原语；不能从本地硬编码完整能力表猜测。`clip.text`、layer.content 与 duration 变更有同步/拒绝规则：MotionSpec layer.content 为渲染权威，显式 layer.style 覆盖样式包默认值；现有文字输入/style pack 改 clip 字段却不改 spec，必须通过事务同步或禁止提交并提示重新生成，时长同步 spec.duration 与所有关键帧（不能偷偷截断），无明确重定时策略即拒绝。

## 17. 修订契约：API、编辑事务与 UX

**待新增 API（第 5 节不是已可接线的接口）：** `POST /validate-spec` 接收 `{clip_id, base_revision, base_hash, schema_version, capability_version, draft_spec}`，返回定位到 layer/field/time 的 errors、warnings、能力版本和可提交状态，不写盘；`POST /compile` 接收同一草稿与版本，服务端验证后返回 `{spec_hash, compiler_version, mg_def, mg_html, preview_ops, fidelity_inputs}` 及错误，不写盘、不调用 LLM；author 是**Agent 任务入口**而不是直接插件调用，`POST /author` 的启动回执应含 task_id、revision/幂等键，另有按 task_id 查询或 SSE 订阅终态及取消入口，须明确鉴权、clip/任务归属和超时。三个路由及提交事务端点均待新增，最终路径以统一 API 设计为准；在后端契约实现前 UI 只读。写入端点使用 `If-Match` 或 `{base_revision, base_hash}` 乐观并发，冲突 409 并保留草稿；后端负责**原子替换** spec/hash/compiler_version/MGDef/HTML/preview_ops/来源，不让浏览器直接造 hash 或只调 `updateClip` 持久化半套数据。错误码还须携带可重试性和任务终态，不能仅靠枚举字符串。

**编辑事务：** 以当前已提交 spec/hash/产物为 last-known-good；在内存草稿中编辑→轻量检查→后端验证/编译→确认版本未变→原子提交→一次 history 快照/一次 undo。拖动/曲线连续输入只合并草稿，pointerup/blur 才形成一个事务；`updateClip` 本身不建 history，不能视为撤销保证。旧 spec 恢复来源为提交前 history 快照或后端版本记录，不是将覆盖后的 metadata 凭空倒推；“恢复上次生成”仅当后端留有版本才显示。切 clip、关闭面板、取消、超时或请求乱序时取消/忽略未完成请求（generation token/AbortController），不取消已提交版本；编译失败保留旧 spec/画面、显示草稿错误并允许继续手工修正或放弃草稿，绝不覆盖旧产物。author 最多单次 300 秒且 Agent 可外层重试，UI 显示任务 ID、进度/等待、取消回执与重试成本，重试需显式动作和幂等保护；刷新从服务端任务/clip 版本恢复，不将 pending 当成功。

**时间与 easing 适配器（待实现）：** 通用 KeyframeEditor 操作 `clip.keyframes` 的 `[0,1]` 时间，Bezier 保存在**结束帧**；MotionSpec 使用 `[0,duration_sec]` 秒且 easing 属于**起始帧→下一帧**。建立 `specSeconds <-> UI normalized` 的显式适配器，按 duration 映射并处理零时长/浮点量化/裁剪；读取 UI 第 i+1 帧 easing 映射至 spec 第 i 帧，回写做反向映射，最后帧 easing 忽略/禁止编辑，逐段测试往返与预览；不改写旧 `clip.keyframes`。Canvas 当前读 next.easing，必须与 compiler/MGRenderer 的当前帧语义对齐后才能承诺接线。路径 progress 与 tracks 同属性同时间窗冲突直接拒绝并标记 layer/property/time，不能靠 UI 的“优先/合并”文案随意解决。

**预览状态与画面：** 有 MotionSpec 标识时缺 MGDef、hash/版本不符、编译失败、unsupported 或缺 preview_ops，禁止落普通白字/legacy `drawText`；显示上次可信画面并覆盖“待编译/失效/不支持/失败”明确状态，或空画面+错误，不能伪装成当前草稿。无 spec 的 legacy clip 按明确来源标识继续读旧 mg_def/ASS；来源不明不得猜。fidelity 从实际 Canvas 属性/效果/easing/采样与后端渲染差异逐项计算：未知属性或无 ops 为 unsupported，近似/漏绘效果为 approx，不能相信后端固定 `exact`；即使抽帧达标也保留“近似预览”常驻提示，最终成片以后端为准。预览、属性面板、timeline 同步展示可定位错误；文字 clip 也有入口，不只 animation clip。

## 18. 审阅意见落实矩阵与验收

| 优先级 / 审阅点 | 落实章节 | 新验收（均为待实现） |
|---|---|---|
| P0 MGDef 预览误导、固定 exact、缺 MGDef 普通文字回退 | §6、§16–17、§14 | spec clip 无有效派生产物不画白字；缺 ops/unsupported/approx 各有状态；Canvas 与渲染多时点抽帧对比，起始帧 easing 语义一致 |
| P0 spec/hash/MGDef 权威与原子更新、旧 spec 保留 | §4、§6、§9、§16–17 | 校验/编译/保存失败、409、乱序与刷新均无半写；hash/版本绑定，旧可用 spec/画面可恢复 |
| P1 三个 API 不存在、author 任务授权与取消/超时 | §5、§10、§16–17 | 路由/响应契约与任务归属测试；取消及超时回执、刷新重连、手工修复、重试成本可见 |
| P1 TS schema 差异、通用 Keyframe 时间/easing 不同 | §4、§7、§16–17 | `spec_id/requires/mask` 契约对账；秒/归一化往返和每段 easing 测试；旧 `clip.keyframes` 不变 |
| P1 文字/style/duration 编辑结果不可信 | §7、§9、§16–17 | 文字/样式/时长修改要么原子同步 spec 并重编译，要么明确拒绝；刷新增量一致 |
| P2 基础/高级、capability 隐藏、路径/tracks 冲突、撤销 | §7–9、§12、§16–17 | 只读先行；未开放控件不可选；冲突定位；拖动单 undo、取消不记 history，旧 spec 有来源 |
| P2 长任务/真实成片 E2E、成本延迟 | §13–14、§17–18 | 702s 全任务、真实 provider 成本/延迟、编辑→保存→刷新→撤销→取消/失败恢复、预览/成片多帧比对；短片/局部测试不替代 |

第 14 节的全部能力验收须按后端冻结 v1 子集拆分为可交付门禁；未开放能力保持未勾选，不能因只读 UI 出现就标为完成。现有测试数与本 PRD 所列测试文件名不代表这些新测试已存在；本次文档修订未运行代码测试。
