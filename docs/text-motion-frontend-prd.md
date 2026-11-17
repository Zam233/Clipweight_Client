# 文字 MotionSpec 前端与编辑器 PRD

> 状态：现状审计 + 方案  
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
