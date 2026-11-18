# MotionSpec 预览 3D / 精确抽帧 Coding Plan

> 状态：可执行方案（CP-0 尚未开工）  
> 前端仓库：`J:\Clipweight-Client`，分支 `feat/zam_text_motion_frontend`  
> 后端仓库：`J:\Clipwright`，分支 `feat/zam_text_motion_llm_spec`  
> 适用对象：文字 / 字幕 / MG 动画 clip（`metadata.mg_def`）  
> 用户已裁定：mask 不投入；blur 做一次半径标定；连续播放继续 Canvas 2D（mask/blur 近似、3D unsupported）；暂停 / seek 用 CSS 3D 覆盖层；精确抽帧用服务端 Hyperframes PNG。

---

## 0. 结论先行

1. **不替换 Canvas 2D 播放链路**。播放仍由 `PreviewPanel.tsx` 的 Canvas 合成器负责；覆盖层只在 `isPlaying === false` 时接管当前时刻、满足条件的 MG clip。
2. **覆盖层是 DOM + CSS 3D + Web Animations**，不是 WebGL。它镜像后端 `MGRenderer` 的 HTML/CSS 语义（同一套锚点、transform 顺序、easing），因此 3D 在暂停态可比 Canvas 精确得多。
3. **覆盖层与 Canvas 不能同时画同一个 MG clip**。用“代际握手”（generation / canvasGeneration）保证任一帧只有一个渲染者，避免双重 alpha 与半透明叠色。
4. **blur 不靠猜**。先跑离线标定，得到 `k(scale, dpr)` 修正表；未达标就保持 `approx`，绝不把 blur 标成 exact。
5. **精确帧单独一条服务端链路**：新增 `POST /api/text-animation/preview-frame`，服务端从项目时间线取 `mg_def`，用现有 `MGRenderer` 生成 HTML，再用 **已存在的 `hyperframes snapshot` CLI** 输出 PNG；前端只拿 PNG，不执行 HTML。
6. **安全边界不变**：前端只从结构化 `mg_def` 生成 DOM，`textContent` 写入文本，`innerHTML` / `dangerouslySetInnerHTML` / `mg_html` / iframe `srcdoc` 全部禁止；CSP 不需要放宽。

---

## 1. 已核对现状（真实路径，避免虚构）

### 1.1 前端

| 事实 | 位置 |
|---|---|
| 预览 Canvas 合成入口 `compositeTimelineClips()` | `src/features/preview/PreviewPanel.tsx:1195` |
| 预览主绘制 `draw()`（含帧矩形、letterbox、safe area） | `src/features/preview/PreviewPanel.tsx:609` |
| 预览 rAF 循环 `loop()`（只在 t / timeline / zoom 等变化时重绘） | `src/features/preview/PreviewPanel.tsx:728` |
| Canvas 中的 MG 分支：有 `mg_def` 就 `drawMgFrame`，`return false` 不进层缓存 | `src/features/preview/PreviewPanel.tsx:1356` |
| `drawMgFrame()` / `resolveElementProps()` / `emptyFidelity()` | `src/features/preview/mgRenderer.ts:316 / 205 / 94` |
| Canvas 对 3D 属性只记 `unsupportedProps` | `src/features/preview/mgRenderer.ts:358` |
| Canvas blur 用 `ctx.filter = blur(...)` | `src/features/preview/mgRenderer.ts:388` |
| MG 还原度台账（按 clip 去重、只在有差异时显示） | `src/features/preview/mgFidelity.ts` |
| 预览差异角标（LUT / Mask / MotionSpec 状态） | `src/features/preview/previewFidelity.ts` |
| 帧矩形纯函数 `computePreviewFrameRect()` | `src/features/preview/frameGeometry.ts` |
| 播放头 / 播放态 / 缩放 store | `src/stores/previewStore.ts` |
| 连续播放开关 `previewContinuousPlayback` | `src/stores/settingsStore.ts` |
| MotionSpec 类型 / 预览状态 / 产物读取 | `src/features/textMotion/types.ts`、`adapter.ts` |
| 文本动效 API 客户端（capabilities / compile / commit / author SSE） | `src/services/api/textMotion.ts` |
| 现有预览 E2E 与 mock 后端 | `e2e/preview-fixes.spec.ts`、`e2e/helpers.ts` |
| 当前审计已承认 3D/mask/blur 无逐原语阈值 | `docs/text-motion-remaining-audit.md` §4 |

补充事实：

- `computePreviewFrameRect()` 已存在，但 `draw()` 仍内联重复同一套 `(W-32)*zoom` 计算；覆盖层必须与它同源，CP-3 顺手收口。
- `previewFidelity.ts` 仍把“有 motion_spec 但无 mg_def”挂到 `noPreview`，文案会出现“仅渲染后可见”，与现在 MG 能预览的事实不一致；审计 §5 已记录，本计划 CP-4 修正。
- 前端仓库 `index.html` / `vite.config.ts` / `nginx.conf` 中**未检索到** `Content-Security-Policy` 头；本计划按“严格 CSP”约束设计，不依赖内联 `<style>` / `<script>` / `innerHTML`。

### 1.2 后端

| 事实 | 位置 |
|---|---|
| 文字动效路由已存在：`/api/text-animation/{capabilities,style-packs,asset-packs,validate-spec,compile,author,commit}` | `clipwright/api/text_animation.py:155-319` |
| `compile` 目前把响应 `fidelity` **硬编码为 `approx`**，而 `motion_compiler` 产出的是 `exact` + `preview_ops=[{kind:"mg_def",fidelity:"exact"}]` | `clipwright/api/text_animation.py:151`、`clipwright/animation/motion_compiler.py:259` |
| MotionSpec 白名单包含 `translate_z` / `rotate_x` / `rotate_y` / `perspective` / `blur` / `clip_inset` / `mask` | `clipwright/animation/motion_spec_validator.py:10-18` |
| MG 校验白名单包含同一批 3D / blur / mask 属性 | `clipwright/animation/mg/validator.py:17-18` |
| `MGRenderer.render()` 生成完整 HTML；关键帧的 transform 顺序为 `anchor → perspective → scale → rotate → translateY → translateX → translateZ → scaleX → scaleY → rotateX → rotateY → rotateZ` | `clipwright/animation/mg_renderer.py:238`、`:400-500` |
| MG 元素最终 HTML 语义（text / shape / line / circle / ring / arc / bg / image） | `clipwright/animation/mg_renderer.py:541-640` |
| `HyperframesRenderer` 现有方法：`render_mg_html_to_mov()`、`render_overlays()`、`lint_html()`、`check_html()` | `clipwright/animation/hyperframes_renderer.py:341 / 454 / 217 / 277` |
| `POST /api/animation/preview` 已用 `render_mg_html_to_mov` 出 MP4 | `clipwright/api/animation.py:170` |
| 项目时间线读取：`ProjectManager().load(project_id)` | `clipwright/services/project_manager.py:161` |
| 全局 API token 中间件（新路由自动继承） | `clipwright/main.py:522` |
| `run_tracked_ff()` 可复用做带取消/超时的子进程 | `clipwright/services/render.py:165` |
| 本机 Hyperframes CLI（0.8.171）**已有 `snapshot` 命令**，支持 `--at` / `--no-end` / `--output` / `--timeout` / `--zoom` / `--zoom-scale` / `--describe false` | `J:\Clipwright\node_modules\hyperframes\dist\cli.js`、`J:\Clipweight-Client\_research\hyperframes\packages\cli\src\commands\snapshot.ts` |

**不存在、本计划才新增的接口/文件**（正文均标 `[新增]`）：

- `POST /api/text-animation/preview-frame`；
- `clipwright/services/mg_frame.py`；
- `HyperframesRenderer.render_mg_html_to_png()`；
- 前端 `src/features/preview/motionSpecOverlay/` 目录；
- `scripts/calibrate-blur.mjs`、`scripts/compare-mg-frame.mjs`。

### 1.3 关键决策（来自用户裁定）

| 议题 | 决策 |
|---|---|
| mask | 时间线 clip 级 mask 不投入；Canvas 维持矩形裁剪近似；mg 元素自带 mask/clip_inset 只做后端同式 clip-path |
| blur | 做一次半径标定；标定前一律 `approx` |
| 3D 连续播放 | 不支持；Canvas 标 `unsupported`，不伪造投影 |
| 3D 暂停 / seek | CSS 3D 覆盖层接管 |
| 精确抽帧 | 服务端 Hyperframes PNG，不在浏览器执行 `mg_html` |
| WebGL | 本计划**不做**；只有 CSS 3D 在明确的像素对比中证明不够，才另立计划 |

---

## 2. 目标 / 非目标

### 2.1 目标

1. 暂停或拖动播放头时，MotionSpec 的 `translate_z` / `rotate_x` / `rotate_y` / `perspective` 有**真实 CSS 3D 预览**，不再只显示“unsupported”。
2. 连续播放保持现有 Canvas 2D 流畅度，不因 3D 覆盖层引入掉帧；播放态明确告知“3D 仅暂停精确”。
3. 覆盖层与 Canvas **同一时刻只有一个渲染者**，不出现双重 alpha、描边加粗、半透明叠色、暂停瞬间闪黑。
4. blur 有可复现的标定数据与修正表；未达标时诚实标 `approx`，不虚标 `exact`。
5. 任一帧可通过服务端 Hyperframes 输出 PNG，用于逐原语核对；PNG 有缓存、超时、降级与安全边界。
6. fidelity 矩阵落到 UI 文案：用户知道当前看到的是 Canvas 近似、CSS 精确，还是服务端精确帧。
7. 全链路不执行模型生成的 `mg_html`，不引入外链图片/字体，不放宽 CSP。

### 2.2 非目标

- 不做 WebGL / Three.js / Babylon.js / 自写 3D 光栅器。
- 不做浏览器端视频编码、不做 WebCodecs 导出、不做整片前端渲染。
- 不改变 `motion_spec/1` schema；不新增 MotionSpec 原语。
- 不修复后端 `line` 元素 `margin` 偏移这类成片行为（只保证覆盖层镜像成片）。
- 不为 mask 做形状精确化（用户已裁定无关）。
- 不保证连续播放与成片像素一致；只保证“近似可看 + 暂停可核对 + 服务端可抽帧”。
- 不新增运行时 npm 依赖（Playwright 已存在，标定脚本只用它）。

---

## 3. 架构图（文字）

```text
┌─────────────────────────────── 数据源（唯一真相） ───────────────────────────────┐
│ timelineStore.clips[].metadata                                                   │
│   mg_def（结构化 JSON，后端 validator 校验）                                     │
│   mg_params（占位符实际值）                                                       │
│   preview_ops / fidelity / motion_spec_hash                                      │
│ 禁止读取/执行 metadata.mg_html                                                   │
└───────────────┬───────────────────────────────────────────────┬──────────────────┘
                │ t / isPlaying / zoomLevel                     │ compile / commit
                ▼                                               ▼
┌──────────────────────────────┐                  ┌─────────────────────────────────┐
│ PreviewPanel 单一时钟         │                  │ textMotionApi                   │
│ 绝对锚点 (wall, tl, speed)    │                  │  POST /compile → mg_def         │
│ 外部 seek 才重打锚点          │                  │  POST /commit  → metadata       │
└───────┬──────────────────────┘                  └─────────────────────────────────┘
        │
        ├──────────────────────────────┐
        ▼                              ▼
┌───────────────────────────┐   ┌──────────────────────────────────────────────────┐
│ Canvas 2D 合成器           │   │ OverlayCoordinator（暂停/seek 才激活）            │
│ compositeTimelineClips()   │   │  ├─ 计算 activeMgClips(t)                        │
│  - video / image / caption │   │  ├─ eligibility（mask/blend/transition/嵌套）     │
│  - MG：播放态 drawMgFrame  │   │  ├─ plan cache（mg_def hash + params + 尺寸）      │
│  - 覆盖层激活时 skip 指定  │   │  ├─ mgDomPlan（纯函数，锚点/关键帧/CSS 白名单）    │
│    MG clip ids             │   │  ├─ mgDom.ts（createElement + textContent）       │
│                            │   │  ├─ WAAPI 创建后 pause，seek 只改 currentTime      │
│                            │   │  └─ 代际握手：overlay ↔ canvas 单一渲染者           │
└───────────┬────────────────┘   └───────────────────────┬──────────────────────────┘
            │                                            │
            ▼                                            ▼
┌───────────────────────────┐   ┌──────────────────────────────────────────────────┐
│ <canvas> 像素              │   │ <div data-testid="mg-overlay"> CSS 3D 像素        │
│ 视频/图片/字幕/手柄/安全框 │   │ 透明底、pointer-events:none、z-index 在 canvas 之上│
└───────────┬────────────────┘   └───────────────────────┬──────────────────────────┘
            └───────────────────┬────────────────────────┘
                                ▼
                 ┌──────────────────────────────────────┐
                 │ DOM 叠层顺序                          │
                 │ canvas → overlay → 编辑 textarea(z20) │
                 └──────────────────────────────────────┘

精确帧旁路：
┌──────────────┐   POST /api/text-animation/preview-frame   ┌────────────────────────────┐
│ 前端“抽一帧” │ ──────────────────────────────────────────▶ │ FastAPI 路由               │
└──────┬───────┘   {project_id, clip_id, time_sec, dpr}      │  ├─ ProjectManager.load    │
       │                                                      │  ├─ 找 clip / 校验 mg_def  │
       │                                                      │  ├─ MgFrameRenderer        │
       │                                                      │  │   ├─ cache key / LRU    │
       │                                                      │  │   ├─ MGRenderer.render  │
       │                                                      │  │   ├─ hyperframes snapshot│
       │                                                      │  │   └─ PNG bytes          │
       ▼                                                      └────────────┬───────────────┘
  <img src=blob:...> 覆盖 canvas（带“服务端精确帧”标签）                    │
  失败 → 回退覆盖层 / Canvas + “精确抽帧不可用”                             ▼
                                                               PNG / 304 / 4xx JSON
```

**不变量**

1. `mg_def` 是唯一渲染输入；`mg_html` 永远不进入浏览器 DOM。
2. 播放态覆盖层不可见；暂停态 Canvas 不画被覆盖层接管的 clip。
3. 覆盖层 DOM 只允许 `div` / `span` / `img`（图片受白名单约束），文本只经 `textContent`。
4. 服务端 PNG 只接受 `project_id + clip_id`，不接受客户端上传的 HTML / spec。
5. 任一路径失败都回退，不出现空白帧；回退必须带可见说明。

---

## 4. 分阶段 CP-0..CP-6

> 约定：每个 CP 独立可合并、独立可回滚；新增行为全部置于 feature flag 后。  
> 前端 flag 写在 `src/features/textMotion/flags.ts`；后端开关用环境变量（见 CP-5）。

### CP-0 基线与契约冻结（0.5 天）

**目的**：把“现在是什么样”钉死，避免边写边猜。

**文件**

- `docs/text-motion-preview-3d-coding-plan.md`（本文件）
- `docs/text-motion-remaining-audit.md`（追加 CP-0 记录）
- `src/features/textMotion/flags.ts`（修改）
- `[新增] e2e/fixtures/mgPreviewFixture.ts`（3D / blur / mask / line / 外链图片 / 恶意文本 六类 MG clip）
- `[新增] src/features/preview/motionSpecOverlay/overlayTypes.ts`

**接口 / 类型**

```ts
// flags.ts 追加（默认全部 false，dev 可单独开）
export const textMotionFlags = {
  ui: /* 现有 */,
  preview: /* 现有 */,
  editor: /* 现有 */,
  overlay3d: env.VITE_TEXT_MOTION_OVERLAY_3D === '1',
  overlayServerFrame: env.VITE_TEXT_MOTION_SERVER_FRAME === '1',
  blurCalibrated: env.VITE_TEXT_MOTION_BLUR_CALIBRATED === '1',
} as const;
```

```ts
// overlayTypes.ts
export type RenderMode = 'canvas-play' | 'css3d-pause' | 'server-frame';
export type Fidelity = 'exact' | 'approx' | 'unsupported';

// 复用现有帧矩形类型，避免两套坐标定义
export type { FrameRect } from '../frameGeometry';

export interface OverlayFidelity {
  exact: string[];
  approx: string[];
  unsupported: string[];
  reasons: string[];
}
```

**任务**

1. 用固定 fixture 录基线：当前 Canvas 播放 p50/p95 帧时间、MG 单 clip 绘制耗时、暂停 seek 耗时、现有角标截图。
2. 把 fixture 的 `mg_def` 覆盖到：`translate_z + rotate_x + perspective`、`blur` 关键帧、`clip_inset`、`mask`、`line` 宽度动画、外链 `image`、含 `<script>` / `<img onerror>` 的文本。
3. 冻结本计划的决策表（第 1.3 节），后续 CP 不再重新讨论 WebGL。
4. 明确“当前仓库无 CSP 头”的事实，并在 PR 描述里要求：若目标部署加 CSP，覆盖层不得依赖 `unsafe-inline` 脚本。

**性能预算**：本 CP 无新增运行时路径；基线数据写入本文附录 A。

**验收**：`npx tsc --noEmit` 通过；flags 在 dev/prod 下取值符合预期；fixture 可被 Vitest / Playwright 复用。

**回滚**：只加 flag 与文档，删除即可；无行为变化。

---

### CP-1 blur 半径标定（1–1.5 天，可与 CP-2 并行）

**目的**：把 `ctx.filter` 与 CSS `filter: blur()` 的半径差异量化，产出可提交的修正表；未达标就不启用修正。

**文件**

- `[新增] scripts/calibrate-blur.mjs`
- `[新增] src/features/preview/motionSpecOverlay/blur-calibration.generated.ts`（由脚本生成，提交）
- `[新增] src/features/preview/motionSpecOverlay/blurModel.ts`
- `[新增] src/features/preview/motionSpecOverlay/blurModel.test.ts`
- `[新增] docs/text-motion-blur-calibration.md`（脚本同时生成）

**标定方法**

1. **两条渲染路径，同一设计空间**
   - Canvas 路径：`canvas` 尺寸 512×512，按生产顺序 `setTransform(dpr,0,0,dpr,0,0)` → `scale(s,s)` → 画测试图 → `ctx.filter = blur(R px)`。
   - CSS 路径：同样 512×512 的 DOM 层，`filter: blur(R_css px)`，外层 `transform: scale(s)`，DPR 由浏览器处理。
   - 背景固定 `#0E101A`，前景纯白，避免 alpha 合成干扰。
2. **测试图**（6 类，覆盖软/硬边、细线、文字）
   - T1 48px 文本「并」；T2 96px 文本「文」；T3 4px 直线；T4 64px 圆环（8px 描边）；T5 实心矩形硬边；T6 2px 发丝线。
3. **半径网格**：`R ∈ {0, 2, 4, 8, 12, 16, 24, 32}`。
4. **缩放 / DPR**：`s ∈ {0.25, 0.5, 1.0}`，`dpr ∈ {1, 2}`；共 6×8×3×2 = **288 个用例**，全自动。
5. **图像获取**：Playwright 分别截取 canvas 与 DOM 层 512×512（`clip`），把 PNG buffer 以 base64 回灌页面，`createImageBitmap` → 2D canvas → `getImageData`；**不新增图像库**。
6. **对齐**：两图都以非背景像素 bbox 对齐；bbox 外扩 16px 作为 ROI；比较前把 alpha 合成到固定背景。
7. **指标**
   - **SSIM**：灰度 `0.2126R + 0.7152G + 0.0722B`；11×11 高斯窗，`σ=1.5`；`C1=(0.01*255)^2`、`C2=(0.03*255)^2`；输出 ROI 均值。
   - **边缘扩散**：取测试图 4 条直边，沿法线取 32 条扫描线平均；归一化后找 10% / 90% 交点，线性插值；`edgeWidthCssPx = |x90-x10| / (dpr*s)`；输出 `Δedge = |edge_canvas - edge_css|`。
   - **质心偏移**：亮度加权质心，`Δcentroid` 以 CSS px 计。
   - **对比度保持**：ROI 标准差比值，要求在 `1 ± 0.03`。
8. **拟合**
   - 对每个 `(s, dpr)`，在 `k ∈ [0.25, 2.0]`、步长 `0.05` 上搜索，使 `CSS 半径 = k * Canvas 半径` 时 SSIM 最大；记录最优 `k`、SSIM、`Δedge`。
   - 若 `k` 随 R 漂移 > 15%，改拟合线性 `R_canvas = a * R_design + b`，并在生成文件里存 `a/b` 与残差。
   - 运行时只做 O(1) 查表 + 线性插值，不跑图像计算。

**生成文件形状**

```ts
export const BLUR_CALIBRATION_VERSION = 1;

export interface BlurBucket {
  scale: number;            // 0.25 / 0.5 / 1.0
  dpr: 1 | 2;
  a: number;                // R_canvas = a * R_design + b
  b: number;
  maxSsimError: number;     // 拟合残差
}

export const BLUR_BUCKETS: BlurBucket[] = [/* 由脚本写入 */];

/** Canvas 侧应使用的半径；未标定/超范围返回 null，调用方保持 approx。 */
export function canvasBlurRadius(designPx: number, scale: number, dpr: number): number | null;
```

**测试数据表（脚本输出；下表为待测骨架，实测列由脚本回填，禁止手填）**

| Case | 内容 | R_design | s | DPR | Canvas 等效 σ | CSS 等效 σ | k = σ_css/σ_canvas | SSIM | Δedge (CSS px) | 判定 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| B-01 | T1 文本 | 2 | 1.0 | 1 | 待测 | 待测 | 待测 | 待测 | 待测 | 待定 |
| B-02 | T1 文本 | 8 | 1.0 | 1 | 待测 | 待测 | 待测 | 待测 | 待测 | 待定 |
| B-03 | T1 文本 | 16 | 1.0 | 1 | 待测 | 待测 | 待测 | 待测 | 待测 | 待定 |
| B-04 | T3 4px 线 | 8 | 0.5 | 1 | 待测 | 待测 | 待测 | 待测 | 待测 | 待定 |
| B-05 | T5 硬边 | 24 | 0.5 | 2 | 待测 | 待测 | 待测 | 待测 | 待测 | 待定 |
| B-06 | T2 文本 | 32 | 1.0 | 2 | 待测 | 待测 | 待测 | 待测 | 待测 | 待定 |
| … | 其余 282 例 | | | | | | | | | |

**验收阈值（修正后）**

| 场景 | SSIM 下限 | Δedge | Δcentroid | 处理 |
|---|---:|---:|---:|---|
| R ≤ 8，s ≥ 0.5 | 0.990 | ≤ 0.5 px | ≤ 0.2 px | 可标 `exact`（仅限 blur 原语证据） |
| 12 ≤ R ≤ 16，s ≥ 0.5 | 0.985 | ≤ 0.75 px | ≤ 0.25 px | 可标 `exact` |
| 24 ≤ R ≤ 32，s ≥ 0.5 | 0.970 | ≤ 1.5 px | ≤ 0.5 px | 标 `approx`，UI 提示“大半径模糊近似” |
| s = 0.25 | 0.960 | ≤ 2.0 px | ≤ 0.75 px | 单独桶；不达标则低倍率禁用覆盖层 blur 接管 |
| 端到端 overlay vs 服务端 PNG（R ≤ 16） | 0.980 | ≤ 1.0 px | ≤ 0.5 px | 含字体差异；不达标降 `approx` |

**失败处理**：任一桶 `k > 2` 或 `k < 0.5`，先怀疑 transform/filter 顺序，不提交修正表；连续两次标定不达标，则 blur 永久保持 `approx`，覆盖层直接使用设计半径 CSS blur，Canvas 维持现状，不阻塞 3D 上线。

**性能预算**：标定离线；运行时查表 < 0.01 ms/元素；`blur-calibration.generated.ts` 体积 < 8 KB。

**回滚**：`VITE_TEXT_MOTION_BLUR_CALIBRATED=0` → `canvasBlurRadius` 返回 null，走现有 `ctx.filter` 原逻辑；生成文件保留但不被引用。

---

### CP-2 纯函数：布局 / DOM 计划 / CSS 白名单（1.5–2 天）

**目的**：把“MG JSON → 可安全挂载的 DOM 计划”做成无副作用纯函数，先单测，再上屏。

**文件**

- `[新增] src/features/preview/motionSpecOverlay/mgLayout.ts`
- `[新增] src/features/preview/motionSpecOverlay/mgDomPlan.ts`
- `[新增] src/features/preview/motionSpecOverlay/cssSafety.ts`
- `[新增] src/features/preview/motionSpecOverlay/mgDomPlan.test.ts`
- `[新增] src/features/preview/motionSpecOverlay/mgLayout.test.ts`
- `src/features/preview/mgRenderer.ts`（修改：复用 `mgLayout` 的锚点函数，行为不变）
- `src/features/preview/mgRenderer.motionSpec.test.ts`（补充回归）

**接口**

```ts
// mgLayout.ts
export interface AnchorInput {
  x: unknown; y: unknown; xOffset: number; yOffset: number;
  width: number; height: number; designW: number; designH: number;
}
export interface AnchorCss {
  left: string; top: string; right?: string; bottom?: string;
  translate: string;   // '' | 'translateX(-50%)' | 'translateY(-50%)' | 两者
}
export function anchorCss(input: AnchorInput): AnchorCss;

// 与后端 mg_renderer._render_element 的 transform 函数顺序完全一致
export function keyframeTransform(props: Record<string, unknown>, anchor: string): string;
```

```ts
// mgDomPlan.ts
export interface OverlayKeyframe {
  offset: number;            // 0..1
  easing?: string;           // CSS 合法 timing function
  transform?: string;
  opacity?: string;
  filter?: string;
  clipPath?: string;
  width?: string;
  height?: string;
  fontSize?: string;
  letterSpacing?: string;
}

export interface OverlayElementPlan {
  id: string;
  kind: 'text' | 'shape' | 'line' | 'circle' | 'ring' | 'arc' | 'bg' | 'image';
  tag: 'div' | 'img';
  text?: string;             // 仅 text，最终 textContent
  attrs: Record<string, string>;      // 仅白名单属性
  baseStyle: Record<string, string>;  // 已 sanitize 的 CSS 声明
  keyframes: OverlayKeyframe[];
  durationSec: number;
  fidelity: OverlayFidelity;
}

export interface OverlayPlan {
  key: string;
  width: number;             // 时间线宽（不是 mg_def 设计宽）
  height: number;
  durationSec: number;
  elements: OverlayElementPlan[];
  fidelity: OverlayFidelity;
}

export function buildOverlayPlan(
  spec: MgSpec,
  params: Record<string, unknown>,
  timeline: { width: number; height: number; fps: number },
  options?: { blurCalibrated?: boolean },
): OverlayPlan;
```

**关键实现规则**

1. **锚点必须镜像后端**，不是 Canvas 的盒模型：
   - `x=center` → `left: calc(50% + x_offset px)` + `translateX(-50%)`；
   - `x=left` → `left: (20 + x_offset) px`；
   - `x=right` → `right: (20 + x_offset) px`；
   - `y=center` → `top: calc(50% + y_offset px)` + `translateY(-50%)`；
   - `y=top` → `top: (20 + y_offset) px`；
   - `y=bottom` → `bottom: (60 + y_offset) px`；
   - 数值 x/y 直接 `px`。
2. **transform 顺序**严格按 `mg_renderer.py:400-500`：`anchor → perspective → scale → rotate → translateY → translateX → translateZ → scaleX → scaleY → rotateX → rotateY → rotateZ`。不做“更合理”的重排，否则与成片不一致。
3. **line 元素**镜像后端的 `margin-left: -w/2; margin-top: -h/2`（即使它导致宽度动画不居中）；这是成片行为，不在本计划修正。
4. **circle/ring/arc/shape** 的 `border-radius` 规则按 `mg_renderer.py:555-575`：
   - circle/ring/ellipse → `50%`；arc → `50% 50% 0 0`；shape rect 默认 `4px`；
   - ring 背景透明 + border；line 用 width/height/background + margin；
   - shape 的 `props` 包装（`color` / `width` / `height`）按 `MGRenderer._render_element` 的读取顺序处理，不自行改优先级。
5. **文本**：`font-size`、`color`、`font-weight`、`font-style`、`letter-spacing`、`line-height`、`text-shadow`、`text-align` 全部走 CSS；文本写入 `textContent`，不解析 HTML。
6. **元素级 mask / clip_inset**：按后端同式映射 `clip-path: inset(...)`（`mask` 用百分比，`clip_inset` 用四值 px）；不做形状精确化。**clip 级 `clip.mask_type` 不接管**，由 eligibility 排除。
7. **图片**：仅允许同源相对路径 / `blob:` / 体积受限的 `data:image/(png|jpeg|webp|gif)`；`http(s)`、协议相对 `//`、`file:`、`data:image/svg+xml` 一律拒绝并记 `unsupported`。`attr.src` 只接受通过 `safeImageSrc()` 的值；`data:` 上限 2 MB。
8. **CSS 安全**：
   - 颜色：只接受 `#rgb/#rgba/#rrggbb/#rrggbbaa/rgb()/rgba()/hsl()/hsla()/transparent`，或 `linear-gradient(...)` 且 stop 颜色均合法；
   - 数值：`Number.isFinite` + 范围钳制（见下）；
   - 字体：只允许 `MOTION_FONT_ALLOWLIST`（与 `PreviewPanel` 现有字体栈一致）；不允许 `url(`、`var(`、`expression(`、`@import`；
   - 任何字符串先过 `cssSafety.assertSafeCssValue()`；失败则丢弃该属性并记 `unsupported`，不整段失败。
9. **关键帧归一化**：
   - 过滤 `time` 非数字 / 越界的帧；按时间排序；
   - `offset = clamp(time / duration_sec, 0, 1)`；
   - 若首帧 `offset > 0`，用元素静态值补 `0`；若末帧 `< 1`，用末帧值补 `1`（对应 CSS animation 的底层值语义）；
   - easing 映射复用后端 `_css_timing`：`linear/ease/ease-in/ease-out/ease-in-out/back-out/elastic-out/bounce/cubic-bezier(...)`；未知 → `linear` + `approx` 标记；
   - 单帧元素（`kfs.length < 2`）：后端 `_render_element` 会直接跳过；覆盖层同样跳过，并记 `unsupported: no-keyframes`（这是与 Canvas 现有“静态也画”的已知差异，见 §7）。
10. **钳制**：`font-size ∈ [8, 512]`、`blur ∈ [0, 48]`、`translate_* ∈ [-10000, 10000]`、`opacity ∈ [0,1]`、`duration ∈ (0, 60]`、元素数 ≤ 64、单文本 ≤ 2000 字符。

**测试**

- `anchorCss` 对 9 种 `x/y` 组合 + offset 的期望字符串；
- `keyframeTransform` 与后端生成顺序逐 token 对比（用固定 fixture 的期望字符串）；
- `buildOverlayPlan` 对 6 类元素快照；
- 安全：`<script>`、`"><img src=x onerror=...>`、`url(javascript:...)`、`expression(...)`、`data:image/svg+xml` 全部不产生可执行节点/属性；
- 图片白名单同源：`safeImageSrc()` 与 `mgRenderer.ts` 内部 `isAllowedImageSrc()` 收敛到同一规则（拒绝 `http(s)` / `file:` / SVG data / >2 MB data），Canvas 侧行为变化记入 `docs/text-motion-remaining-audit.md`；
- 文本节点断言：`el.textContent === 原文` 且 `el.children.length === 0`。

**性能预算**：24 元素 plan 构建 p95 ≤ 8 ms；无 DOM 操作；缓存命中后 0 成本。

**回滚**：纯函数未被引用；删除文件即可，`mgRenderer` 的锚点重构需保持行为，测试兜底。

---

### CP-3 CSS 3D 覆盖层 + 代际握手（2–3 天）

**目的**：暂停 / seek 时把 MG 文字层从 Canvas 切到 DOM；播放时切回 Canvas；两者不重叠。

**文件**

- `[新增] src/features/preview/motionSpecOverlay/MotionSpecOverlay.tsx`
- `[新增] src/features/preview/motionSpecOverlay/overlayStore.ts`
- `[新增] src/features/preview/motionSpecOverlay/overlayState.ts`
- `[新增] src/features/preview/motionSpecOverlay/mgDom.ts`
- `[新增] src/features/preview/motionSpecOverlay/overlayEligibility.ts`
- `[新增] src/features/preview/motionSpecOverlay/overlayStore.test.ts`
- `[新增] src/features/preview/motionSpecOverlay/overlayState.test.ts`
- `[新增] src/features/preview/motionSpecOverlay/MotionSpecOverlay.test.tsx`
- `src/features/preview/PreviewPanel.tsx`（修改）
- `src/features/preview/frameGeometry.ts`（可能补 hook，见下）

**PreviewPanel 接入点**

1. `draw()` 改为调用 `computePreviewFrameRect(W, H, tl.width, tl.height, zoom)`，删除内联重复计算；`frameGeometry.test.ts` 补一组与旧公式的等价断言。
2. `<canvas>` 之后、`editingText` 之前挂载：

```tsx
{textMotionFlags.overlay3d && (
  <MotionSpecOverlay wrapRef={wrapRef} />
)}
```

3. `compositeTimelineClips()` 增加可选参数：

```ts
export interface CompositeOptions {
  skipClipIds?: ReadonlySet<string>;
}
export function compositeTimelineClips(
  ctx: CanvasRenderingContext2D,
  timeline: Timeline,
  t: number,
  geom: FrameRect,
  dpr = 1,
  perf?: FramePerf,
  playing = false,
  options?: CompositeOptions,
): number;
```

`skipClipIds` 命中时直接 `continue`；嵌套时间线内的 MG 不参与覆盖层（见 eligibility），因此不会漏画。

4. `loop()` 每帧读 `useOverlayStore.getState()`，把 `generation` 纳入“是否需要重绘”的比较；`draw()` 完成合成后调用 `markCanvasDrawn(generationUsed)`。
5. 不在 React 顶层订阅 overlay 的高频字段；覆盖层自己订阅 `previewStore`，避免播放时整树重渲染。

**Store / 状态机**

```ts
export type OverlayPhase = 'idle' | 'arming' | 'seeking' | 'ready' | 'releasing' | 'error';

export interface OverlayStore {
  phase: OverlayPhase;
  activeClipIds: string[];
  generation: number;        // 每次“请求接管/释放”+1
  canvasGeneration: number;  // Canvas 最近一次按 activeClipIds 完成绘制的代际
  releaseGeneration: number; // 释放请求代际
  visible: boolean;
  error: string;
  requestOverlay(clipIds: string[]): void;   // activeClipIds + generation++
  releaseOverlay(): void;                    // activeClipIds=[] + generation++
  markCanvasDrawn(gen: number): void;
  setVisible(v: boolean): void;
  fail(reason: string): void;
  reset(): void;
}
```

状态迁移：

| 当前 | 事件 | 守卫 | 下一状态 | 动作 |
|---|---|---|---|---|
| `idle` | 暂停且存在 eligible MG clip | flag 开、无 error 冷却 | `arming` | 取 plan、建 DOM、挂到 host（`visibility:hidden`） |
| `arming` | 构建成功 | — | `seeking` | 创建 WAAPI、`pause()`、seek 到 localSec |
| `arming` | 构建失败 / 安全拒绝 | — | `error` | 释放、`fail()`、Canvas 继续画 |
| `seeking` | seek 完成 | — | `ready` | `requestOverlay(ids)`；等 Canvas 代际 |
| `ready` | `canvasGeneration >= generation` | — | `ready` | `visible=true` |
| `ready` | t 变化（暂停拖动） | 仍在 clip 内 | `seeking` | rAF 合并后 seek；不重建 |
| `ready` | `isPlaying=true` | — | `releasing` | `releaseGeneration = generation + 1`；`activeClipIds=[]`；保持可见 |
| `releasing` | `canvasGeneration >= releaseGeneration` | — | `idle` | `visible=false`、`anim.pause()`、DOM 保留 1s 后 dispose |
| 任意 | 离开 clip / 卸载 / 项目切换 | — | `idle` | `anim.cancel()`、移除节点、清缓存 |
| 任意 | spec/params 变化 | 暂停 | `arming` | 旧 DOM dispose，重新构建 |

**时序（暂停）**

```text
isPlaying=false
  → activeMgClips(t) = [c1, c2]
  → plan = cache.get(key) ?? buildOverlayPlan(...)
  → host.append(root); root.style.visibility='hidden'
  → animations = elements.map(el.animate(...)); animations.forEach(a => a.pause())
  → seekAll(localMs)
  → store.requestOverlay([c1,c2])       // generation++
  → PreviewPanel.loop 看到 generation 变化
  → draw() 合成时 skip {c1,c2}
  → store.markCanvasDrawn(generation)
  → MotionSpecOverlay 看到 canvasGeneration >= generation
  → root.style.visibility='visible'
```

**时序（播放）**

```text
isPlaying=true
  → store.releaseOverlay()               // activeClipIds=[]; generation++; releaseGeneration=generation
  → PreviewPanel.loop 看到 generation 变化
  → draw() 不再 skip，Canvas 画 MG 近似
  → store.markCanvasDrawn(generation)
  → 覆盖层看到 canvasGeneration >= releaseGeneration
  → visible=false；动画保持 pause（预热 1s 后 dispose）
```

**为什么必须握手**：暂停瞬间如果覆盖层先显示而 Canvas 还没跳过 MG，会看到“文字被画两遍”（alpha 叠加、描边变粗、渐变发白）；播放瞬间如果覆盖层先隐藏而 Canvas 还没画 MG，会闪一帧空白。两个方向的顺序由 `generation` 强制。

**Web Animations seek**

```ts
interface OverlayHandle {
  seek(localSec: number): void;   // 只改 currentTime，不 play()
  setLayerOpacity(v: number): void;
  dispose(): void;
}

const anim = el.animate(frames, {
  duration: durationSec * 1000,
  fill: 'both',
  easing: 'linear',   // 每帧 easing 覆盖区间；与后端 CSS animation 的 linear 基线一致
});
anim.pause();
anim.currentTime = clamp(localSec, 0, durationSec) * 1000;
```

规则：

- `localSec = (t - clip.start_sec) * clip.speed + clip.source_offset_sec`，再 `clamp` 到 `[0, mg_def.duration_sec]`；与 `drawMgFrame` 的 `_mgLocal` 完全一致。
- 一个元素可能有多条动画（`transform` / `opacity` / `filter` / `clipPath` / `width` / `height` / `fontSize` / `letterSpacing`）；同一条动画内属性不冲突。
- `transform` 动画的每一帧都是**完整字符串**（含 anchor），不做分量拆分；这与后端 CSS keyframes 的写法一致。
- 动画创建后立刻 `pause()`；页面里没有任何 `play()`，不存在“覆盖层偷偷跑时间”。
- seek 用 `requestAnimationFrame` 合并：同一帧内多次 `setCurrentTime` 只 seek 最后一次。
- `document.fonts.ready` 后重新 seek 一次（字体落位会改变文本宽度，但锚点用百分比，不需要重建）；`document.fonts` 变化记 `approx` 原因 `font-loaded`。
- 浏览器不支持 `Element.animate`（极旧）→ 直接 `el.style` 赋静态值，标 `approx`，不阻塞。

**坐标系**

- 覆盖层根节点：`position:absolute; left:fx; top:fy; width:fw; height:fh; overflow:hidden; pointer-events:none; contain:layout style; isolation:isolate;`
- 内部“舞台”：`width: timeline.width px; height: timeline.height px; transform-origin: 0 0; transform: scale(u);`，`u = fw / timeline.width`。
  - 这样所有 `mg_def` 的 px 值原样使用，与后端 HTML 的页面尺寸一致；
  - 若 `timeline.height * u !== fh`（宽高比不一致），舞台垂直居中并记 `approx: aspect_mismatch`，不拉伸 3D 投影。
- 文本、边框、阴影、blur 都在“舞台”内以设计 px 书写，由统一 `scale(u)` 缩放；这与后端“先渲染 1920×1080 再缩放成片”的物理过程一致。
- 不使用 `zoom` 属性；不使用 per-length 乘法，避免 3D 投影矩阵被非均匀缩放。

**DPR**

- 覆盖层完全用 CSS px，浏览器按 `devicePixelRatio` 光栅化；不手动乘 DPR，不设置 canvas 尺寸。
- `window.devicePixelRatio` 变化（浏览器缩放、拖到不同 DPI 屏）不需要重建：`ResizeObserver` 会触发尺寸重算；文本由浏览器重新栅格化。
- 预览 `zoomLevel` 变化只改 `fx/fy/fw/fh` 与 `u`，plan 缓存键包含 `timeline.width/height` 但不包含面板尺寸（plan 与面板无关）。
- 与 Canvas 的 DPR 差异：Canvas 文字在 `dpr` 下可能略糊，覆盖层更锐利；这是预期差异，不作为 fidelity 失败项。

**透视 / 3D**

- 每个元素自己的 `transform` 里带 `perspective(...)`，与后端一致；**不在父级加 `perspective`**，不使用 `transform-style: preserve-3d`。
  - 原因：后端 `mg_renderer` 就是逐元素 `perspective()` + DOM 顺序合成；加 `preserve-3d` 会改变兄弟元素的深度排序与裁剪，和成片不一致。
- 没有 `perspective` 但有 `rotate_x/rotate_y` 时，保持正交投影（无透视收缩）——这也是后端行为，不“补”透视。
- `transform-origin` 用元素声明的值；缺省 `50% 50%`（CSS 默认），与后端一致。
- `backface-visibility` 默认 `visible`；`will-change: transform, opacity` 只加在当前 active 的元素上，且元素数 ≤ 64。
- 3D 元素的 `z-index` 只用于同层排序；不承诺元素间真实深度相交（后端也不承诺）。

**层级 / 与视频合成**

- DOM 顺序：`canvas` → `mg-overlay` → `editingText`（z-20）→ 播放按钮 / 全屏条。
- 覆盖层根 `z-index: 15`；每个 clip 层 `z-index = compositeRank + 1`，`isolation:isolate`；clip 内元素 `z-index = elementIndex`。
- 覆盖层 `pointer-events:none`：拖动、点击、双击编辑仍由 canvas 接收。
- Canvas 在覆盖层激活时仍绘制视频 / 图片 / 字幕 / 安全框 / 手柄；只跳过被接管的 MG clip。视频帧与覆盖层文字是“同一帧时间”的两个源，视频 seek 异步可能晚一帧，接受并在性能面板可见。
- 覆盖层不复制视频、不做背景色；透明区域露出 Canvas 的视频。
- 若 clip 有 `mask` / 非 `normal` blend / `slide|wipe` 转场 / 嵌套时间线，覆盖层**不接管**（见 eligibility），继续 Canvas，避免语义不一致。

**Eligibility（接管条件）**

```ts
export interface Eligibility {
  ok: boolean;
  reasons: string[];   // 'mask' | 'blend' | 'transition' | 'nested' | 'no-mg-def' | 'state'
  localSec: number;
}

export function overlayEligibility(
  clip: Clip,
  track: Track,
  t: number,
  playing: boolean,
): Eligibility;
```

`ok` 需同时满足：

1. `!playing`；
2. `clip.enabled !== false`，`track.hidden !== true`；
3. `t ∈ [start, start+duration)`；
4. `motionPreviewState(clip) === 'ready'` 且 `mgSpecOf(metadata)` 非空；
5. `clip.mask_type` 为空 / `none`；
6. `clip.blend_mode` 为空 / `normal`；
7. 当前不在 `transition_in/out` 的 `slide|wipe` 几何窗口；
8. `!clip.nested_timeline`；
9. `clip.opacity > 0.001`。

不满足的 clip 由 Canvas 画，覆盖层记 `approx`/`unsupported` 原因；不静默丢失。

**缓存失效**

- plan 键：`clipId + stableHash(mg_def) + stableHash(mg_params) + timeline.width/height + compilerVersion + overlayPlanVersion`。
- 失效触发：`mg_def` 变化、`mg_params` 变化、`motion_spec_hash` 变化、undo/redo、切项目、时间线尺寸变化、flag 关闭。
- 字体加载完成只 re-seek，不重建。
- plan LRU 16；DOM 不跨 clip 复用；`dispose()` 必须 `anim.cancel()` + `remove()` + 清 ref，防止 compositor 泄漏。
- 服务端 PNG 另有缓存（CP-5），与本缓存无关。

**性能预算**

| 指标 | p50 | p95 | 硬失败 |
|---|---:|---:|---:|
| 暂停激活构建（≤ 24 元素） | 20 ms | 60 ms | > 150 ms |
| 同 clip seek（WAAPI currentTime） | 3 ms | 12 ms | > 24 ms |
| 暂停→播放切换可见帧 | 1 帧 | 2 帧 | > 3 帧 |
| 播放→暂停切换可见帧 | 1 帧 | 3 帧 | > 5 帧 |
| 覆盖层 DOM 节点 | ≤ 24/clip | ≤ 64 总数 | > 96 |
| 覆盖层常驻内存 | ≤ 12 MB | ≤ 24 MB | > 48 MB |
| 连续播放帧时间增量 | +0 ms | +1 ms | +3 ms |

**回滚**：`VITE_TEXT_MOTION_OVERLAY_3D=0` → 不渲染组件、`skipClipIds` 为空、`compositeTimelineClips` 走原签名（新参数可选）；删除组件即可，无 schema/数据迁移。

---

### CP-4 3D 精确化 + fidelity 矩阵 + UI 文案（1.5–2 天）

**目的**：把 3D 从“能显示”变成“有证据的精确”，并让角标不再撒谎。

**文件**

- `[新增] src/features/preview/motionSpecOverlay/fidelity.ts`
- `[新增] src/features/preview/motionSpecOverlay/fidelity.test.ts`
- `src/features/preview/motionSpecOverlay/mgDomPlan.ts`（补 3D 变换与静态样式）
- `src/features/preview/mgFidelity.ts`（合并覆盖层 fidelity 来源）
- `src/features/preview/previewFidelity.ts`（修正文案/归属）
- `src/features/preview/PreviewPanel.tsx`（角标）
- `docs/text-motion-frontend-prd.md` §6.2（同步）
- `docs/text-motion-remaining-audit.md` §4/§5（标记已解决）

**类型**

```ts
export interface FidelityVerdict {
  mode: RenderMode;
  fidelity: Fidelity;
  exact: string[];        // 有证据的原语
  approx: string[];       // 近似原因
  unsupported: string[];  // 明确不支持
  evidence?: string;      // 证据文件/时间点
}

export function verdictForClip(
  clip: Clip,
  mode: RenderMode,
  opts?: { blurCalibrated?: boolean; evidence?: Record<string, boolean> },
): FidelityVerdict;
```

**判定规则**

1. `exact` 必须同时满足：
   - 该原语在覆盖层实现清单内；
   - 该原语有服务端 PNG 对比证据（`docs/e2e/mg-fidelity/<compilerVersion>/*.json`，SSIM/Δedge 达标）；
   - 没有 `font` / `aspect_mismatch` / `blur_uncalibrated` 等降级原因。
   未满足一律 `approx`，**不得**因为“代码写了”就标 exact。
2. `unsupported`：3D 在 Canvas 播放态；外链图片；未知元素类型；`preview_ops` 中 `fidelity:"unsupported"` 的 op；无关键帧元素（后端会跳过）。
3. `approx`：blur 未标定/大半径、字体差异、clip 级 mask 回退、clip 级混合/转场回退、宽高比不一致。
4. `motionPreviewState` 的 `invalid_spec` / `spec_without_artifact` 保持 fail-closed，不落普通文字。

**fidelity 矩阵**

| 原语 | Canvas 连续播放 | CSS 3D 暂停/seek | 服务端 PNG | 说明 |
|---|---|---|---|---|
| opacity / translate_x/y / scale / rotate | A | E* | E | Canvas 字体/描边差异 |
| translate_z / rotate_x / rotate_y / perspective | U | E* | E | 覆盖层镜像后端 transform 顺序 |
| blur（关键帧 / `filter` effect） | A（标定后） | A/E* | E | 标定未过则 A；≤16px 且达标可 E |
| mg 元素 mask / clip_inset | A（矩形裁剪） | E*（CSS clip-path） | E | 用户裁定不投入精确化；覆盖层只做与后端同式的 clip-path |
| text_shadow / stroke / gradient / letter_spacing | A | E* | E | Canvas 只取第一层阴影；CSS 完整 |
| font family / weight / italic | A | A | E | 客户端字体集合可能不同；同机 Web 端接近 |
| 同源图片 / raster data | A | E* | E | `blob:` / 相对路径 / 受限 `data:image`；`file:` 前端不可用 |
| 外链 / SVG / `file:` 图片 | U | U | U | 安全拒绝，不请求 |
| width / height 关键帧 | A | E* | E | line 的 margin 偏移按成片镜像 |
| 逐字 stagger（编译后多元素） | A | E* | E | 编译产物已展开 |
| 无关键帧元素 | A（静态） | U | U | 后端 `_render_element` 直接跳过；标记差异 |
| `preview_ops` unsupported | U | U | — | 不伪装 |
| clip 级 mask_type / blend / slide-wipe / 嵌套 | A | N/A（不接管） | N/A（PNG 仅 MG 层） | 覆盖层继续 Canvas，避免语义错 |

`E*` = 只有在证据达标时才允许标 exact；否则由 `verdictForClip` 降为 `approx`。`N/A` = 该模式不接管，不是“不支持”。

**UI 文案**

| 场景 | 组件 | 文案 |
|---|---|---|
| 连续播放，clip 含 3D | 预览头角标（琥珀） | `3D·暂停精确`；tooltip：`连续播放为 Canvas 2D，3D 属性不参与投影；暂停后自动切换 CSS 3D 覆盖层。` |
| 暂停，覆盖层 ready，全部 exact | 不额外显示角标（沿用 PRD：exact 无角标） | 现有“近似预览”tooltip 补充：`当前为 CSS 3D 精确预览（暂停态）。` |
| 暂停，覆盖层 ready，有 approx | `近似预览 N 处差异` | tooltip 列出：`blur 未标定` / `字体差异` / `mask 回退` / `宽高比不一致` |
| 覆盖层构建失败 | toast + 角标（红） | `3D 覆盖层不可用，已回退 Canvas（原因：…）` |
| 服务端 PNG 成功 | 覆盖层顶部小标签（绿点） | `服务端精确帧 · 1.23s`；tooltip：`该帧由 Hyperframes/Chromium 渲染，与成片同源。` |
| 服务端 PNG 超时/503 | toast + 角标 | `精确抽帧暂不可用，已显示浏览器预览` |
| 无 `mg_def` | 角标 | `MotionSpec 待编译`（不再出现“仅渲染后可见”） |
| 非法 spec | 画布中央 | `MotionSpec 无效，预览已阻止`（沿用） |
| 外链图片被拒 | 角标计数 | `外部图片已拦截`（沿用 `mgFidelity`） |

**previewFidelity 修正**

- 删除 `if (meta.motion_spec && !meta.mg_def) out.push('MotionSpec 待编译')` 归入 `noPreview` 的做法；改为独立状态，交给 `motionPreviewState` + 角标。
- `fidelityBadges()` 不再对 MG 输出“仅渲染后可见”。
- 统一从 `verdictForClip()` 取差异，避免 `mgFidelity` 与 `previewFidelity` 两套口径。

**性能预算**：角标只在 clip 切换 / 模式切换时更新，不在 rAF 里 setState；覆盖层 fidelity 计算 p95 < 0.5 ms。

**回滚**：`VITE_TEXT_MOTION_OVERLAY_3D=0` 即回到现有 `mgFidelity`；文案改动可单独 revert。

---

### CP-5 服务端 PNG 抽帧 API（2 天，后端可与 CP-1/2 并行）

**目的**：给“精确”一个可核对的终点；不依赖浏览器字体/滤镜。

#### 5.1 API 契约

`[新增] POST /api/text-animation/preview-frame`

请求：

```http
POST /api/text-animation/preview-frame
Authorization: Bearer <CLIPWRIGHT_API_TOKEN>
Content-Type: application/json

{
  "project_id": "proj_7e160520ccee-20ccee",
  "clip_id": "c_2bdf86f7",
  "time_sec": 1.234,
  "dpr": 1,
  "spec_hash": "可选；提供则校验一致，避免抽到旧产物"
}
```

字段约束：

| 字段 | 类型 | 约束 |
|---|---|---|
| `project_id` | string | `^proj_[A-Za-z0-9_-]{1,64}$`；`ProjectManager.load` 必须存在 |
| `clip_id` | string | 1–64 字符；必须属于该项目 |
| `time_sec` | float | `0 <= t <= clip.start + clip.duration`，且本地时间 clamp 到 `mg_def.duration_sec`；服务端按 `frame = round(t*fps)` 量化 |
| `dpr` | int | `1`（v1 必选）；`2` 走 `--zoom 0,0,w,h --zoom-scale 2`，CP-5 验证后开放，否则 422 |
| `spec_hash` | string | 可选；与 `metadata.motion_spec_hash` 不一致返回 409 |

成功响应：

```http
HTTP/1.1 200 OK
Content-Type: image/png
Cache-Control: private, max-age=86400, immutable
ETag: "mgf-<key16>"
X-MgFrame-Cache: hit | miss
X-MgFrame-Render-Ms: 812
X-Content-Type-Options: nosniff
```

`If-None-Match` 命中 → `304 Not Modified`（无 body）。

错误响应统一 JSON：

```json
{ "code": "MG_FRAME_TIMEOUT", "message": "...", "retryable": true, "retry_after_ms": 2000 }
```

| HTTP | code | 场景 | 前端行为 |
|---:|---|---|---|
| 400 | `BAD_REQUEST` | 参数非法 | 不重试，toast |
| 404 | `PROJECT_NOT_FOUND` / `CLIP_NOT_FOUND` | 项目/clip 不存在 | 不重试 |
| 409 | `MG_DEF_STALE` | `spec_hash` 不一致 | 刷新项目后重试一次 |
| 422 | `MG_DEF_MISSING` | clip 无 `mg_def` | 隐藏按钮，提示“待编译” |
| 422 | `MG_DEF_INVALID` | `validate_mg_json` 失败 | 不重试，记日志 |
| 429 | `RATE_LIMITED` | 超过 30 次/分钟/令牌 | 按 `Retry-After` 退避 |
| 503 | `HYPERFRAMES_UNAVAILABLE` | CLI/浏览器不可用 | 回退覆盖层，标记“精确抽帧不可用” |
| 503 | `RENDER_BUSY` | 并发队列满 | 2s 后重试一次 |
| 504 | `MG_FRAME_TIMEOUT` | 15s 未完成 | 回退，不自动重试 |

#### 5.2 服务端实现

**文件**

- `[新增] clipwright/services/mg_frame.py`
- `clipwright/animation/hyperframes_renderer.py`（新增 `render_mg_html_to_png()`）
- `clipwright/api/text_animation.py`（新增路由 + `MgFrameRequest`）
- `[新增] tests/clipwright/test_mg_frame_api.py`

**接口**

```python
# clipwright/services/mg_frame.py
class MgFrameRenderer:
    VERSION = "1"

    async def render(
        self,
        *,
        mg_def: dict,
        params: dict,
        width: int,
        height: int,
        fps: float,
        frame: int,
        dpr: int = 1,
    ) -> tuple[bytes, bool]:  # (png_bytes, cache_hit)
        ...
```

```python
# hyperframes_renderer.py（新增方法，复用现有 _cli_cmd / _render_env）
@staticmethod
async def render_mg_html_to_png(
    html: str,
    out_dir: str,
    *,
    time_sec: float,
    width: int,
    height: int,
    dpr: int = 1,
    timeout_sec: float = 20.0,
    run_cmd=None,
) -> bytes | None:
    ...
```

实现步骤：

1. `ProjectManager().load(project_id)`；遍历 `timeline.tracks[].clips` 找 `clip_id`；拒绝非 `text/caption` 或不含 `mg_def` 的 clip。
2. `validate_mg_json(mg_def)`；元素数 ≤ 64、文本 ≤ 2000、`mg_def` JSON ≤ 256 KB；`mg_params` 只取 `mg_def.params` 声明过的键。
3. 缓存 key：

```text
sha256(json({
  v: 1,
  renderer: "mg_frame/1",
  hyperframes: <package version>,
  mg_def: <canonical json>,
  mg_params: <canonical json>,
  width, height, fps,
  frame, dpr
}, sort_keys=True))[:32]
```

4. 缓存路径：`settings.project_dir.parent / "_cache" / "mg_frames" / key[:2] / f"{key}.png"`；`CLIPWRIGHT_MG_FRAME_CACHE_DIR` 可覆盖。
5. 缓存命中：校验 PNG 头 + 大小，`os.utime` 更新 LRU，返回 `(bytes, True)`。
6. 未命中：`asyncio.Semaphore(2)` + `dict[key, Future]` 单飞；用临时目录写 `index.html`（`MGRenderer.render(mg_def, params, width, height, fps)`），调用：

```text
hyperframes snapshot <tmpdir> --at <time_sec> --no-end --output <tmpdir>/out
  --timeout 8000 --describe false [--no-browser-gpu]
```

7. 读 `out/*.png`（按文件名/时间排序，取最新）；校验 PNG 签名、尺寸、大小 ≤ 8 MB；`os.replace` 原子写缓存；返回 `(bytes, False)`。
8. 任何异常：清理临时目录、释放 Future、记录 `logger.warning`，按错误表返回。

**超时 / 并发 / 降级**

- 请求硬超时 15s；子进程 20s；超时杀进程树（Windows 用 `taskkill /T /F` 或 `run_tracked_ff` 的取消路径）。
- 并发 2；等待队列 > 8 → `503 RENDER_BUSY` + `Retry-After: 2`。
- Hyperframes 不可用 → `503`；不降级到 Canvas 渲染（服务端不做画布）。
- 缓存目录不可写 → 直接渲染并返回，不缓存（日志 warning）。
- 前端失败回退：保留覆盖层；按钮显示“精确抽帧不可用”；指数退避 1s/4s，最多 2 次。

**安全**

1. 请求只接受 ID，不接受 `mg_def` / `mg_html` / HTML / 文件路径。
2. `project_id` 正则 + `ProjectManager` 路径解析；`clip_id` 只在已加载时间线内查找，不拼路径。
3. `mg_def` 必须过 `validate_mg_json`；`MGRenderer._sanitize_css_value` 中和 `url(...)`；`_safe_image_src` 拒绝 `http(s)` / 越权绝对路径 / `..`。`MgFrameRenderer` 预检额外拒绝 `data:image/svg+xml` 与 > 2 MB 的 `data:` 图片（不改 `MGRenderer` 现有行为）。
4. 生成 HTML 注入 CSP meta：`default-src 'none'; img-src data: file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'`，阻止 Chromium 发起网络请求；该 HTML 不返回给前端。**先在 CP-5 验证该 CSP 下 `snapshot` 能出图**；若 Hyperframes runtime 需要 `blob:` / worker，按最小必要放行并在测试里锁定，不允许 `default-src *`。
5. 子进程环境只保留浏览器路径与最小变量；剥离 `CLIPWRIGHT_API_TOKEN` / LLM key（`_render_env` 基础上过滤 `*_KEY` / `*_TOKEN`）。
6. 响应 `nosniff`；不设 CORS；文件不超过 8 MB。
7. 速率限制：沿用 `main.py` 的全局中间件；路由内再加进程内令牌桶 30 req/min/令牌，防抽帧风暴。

**测试**

- `tests/clipwright/test_mg_frame_api.py`：
  - 200 + PNG 签名 + `X-MgFrame-Cache: miss`；
  - 第二次 200 + `hit` + `ETag` + `If-None-Match` 304；
  - `spec_hash` 不一致 409；
  - 无 `mg_def` 422；
  - 非法 `project_id` 400；
  - 超时/不可用（monkeypatch `render_mg_html_to_png` 返回 None / raise）→ 503/504；
  - 并发 3 个同 key 请求只调用一次渲染（单飞）；
  - CSP meta 存在、`img src=http` 被 `MGRenderer` 拒绝。
- 前端 `src/services/api/mgFrame.test.ts`：AbortSignal、304、错误码映射、blob URL 生命周期。

**性能预算**

| 场景 | p50 | p95 | 硬失败 |
|---|---:|---:|---:|
| 缓存命中（1080p） | 15 ms | 60 ms | 200 ms |
| 冷启动抽帧（1080p，draft） | 1.8 s | 4.5 s | 15 s |
| 并发 2 冷启动 | — | 6 s | 15 s |
| 缓存体积 | — | ≤ 2 GiB | 5 GiB |

**回滚**：`CLIPWRIGHT_MG_FRAME_ENABLED=0` → 路由 503（或 404），前端按钮隐藏；缓存目录可整目录删除；不影响现有 `/api/animation/preview`。

#### 5.3 前端客户端

**文件**

- `[新增] src/services/api/mgFrame.ts`
- `[新增] src/features/preview/motionSpecOverlay/useServerFrame.ts`
- `PreviewPanel.tsx`（“精确抽帧”按钮 + PNG 覆盖层）
- `[新增] src/features/preview/motionSpecOverlay/useServerFrame.test.ts`

**接口**

```ts
export interface MgFrameRequest {
  project_id: string;
  clip_id: string;
  time_sec: number;
  dpr?: 1 | 2;
  spec_hash?: string;
}

export interface MgFrameResponse {
  blob: Blob;
  cache: 'hit' | 'miss';
  etag?: string;
}

export async function fetchMgFrame(
  req: MgFrameRequest,
  opts?: { signal?: AbortSignal; ifNoneMatch?: string },
): Promise<MgFrameResponse>;
```

- 用 `getApiClient()` 的 `responseType: 'blob'`；错误体按 JSON 解析，映射为 `MgFrameError { code, message, retryable }`。
- 内存 LRU 8 个 `blob:` URL；evict 时 `URL.revokeObjectURL`；卸载时清空。
- 显示：`<img data-testid="mg-frame-exact" src={blobUrl} />` 覆盖 canvas（`z-index: 16`），顶部标签 `服务端精确帧 · <time>s`，点击关闭。
- 播放/切换 clip/时间变化时自动关闭 PNG 覆盖层，避免“旧帧贴在新画面上”。
- 失败：toast + 覆盖层回退；不阻塞播放。

---

### CP-6 性能收口、文档与灰度（1–2 天）

**任务**

1. 用 `PreviewPerfOverlay` / `previewPerf` 采集播放与暂停数据，填附录 A 的 p50/p95。
2. 检查 702s 长项目：只在当前 t 的 clip 上建 DOM；离开即 dispose；plan LRU 不爆。
3. 内存：Chrome DevTools heap snapshot，覆盖层 < 24 MB；确认 `anim.cancel()` 后无 detached nodes。
4. 灰度：
   - 第 1 周：`VITE_TEXT_MOTION_OVERLAY_3D=0`，只上服务端 PNG 与文案修正；
   - 第 2 周：内部 `=1`，收集错误率、p95；
   - 达标后默认开；`VITE_TEXT_MOTION_OVERLAY_3D=0` 仍可一键回滚。
5. 文档同步：
   - `docs/text-motion-frontend-prd.md` §6 / §12 / §13 / §14；
   - `docs/text-motion-remaining-audit.md` 关闭 §4/§5；
   - `docs/api_reference.md` 新增 `preview-frame`；
   - `docs/frontend-backend-parity.md` 路由表 + 客户端矩阵。
6. 清理：删除不再使用的 `approxProps` 重复文案、临时 `console.debug`、未引用的校准分支。

**验收**：附录 B 全绿；`npm run test`、`npx tsc --noEmit`、`npm run build`、后端定向 pytest 全通过。

**回滚**：三个 flag 全关 + `CLIPWRIGHT_MG_FRAME_ENABLED=0`，系统回到 2026-11-18 行为；无数据迁移。

---

## 5. CSS 3D 覆盖层设计细则

### 5.1 坐标系与尺寸

```text
frame rect (CSS px)          : fx, fy, fw, fh  ← computePreviewFrameRect()
stage (timeline px)          : 0,0,timeline.width,timeline.height
stage transform              : scale(u), transform-origin: 0 0
u                            : fw / timeline.width
element left/top             : mg_def 的 px / calc(50% + offset px)
element translate            : 百分比/px，按后端语义
```

- 文本宽度由浏览器布局决定，锚点用 `translateX(-50%)`，与后端一致；不用 canvas `measureText`。
- `timeline.width/height` 与 `mg_def.width/height` 不一致时：舞台仍用时间线尺寸（后端 HTML 的页面尺寸），元素 px 原样；记 `approx: aspect_mismatch`，不缩放到设计尺寸。
- 面板尺寸变化只改 `fx/fy/fw/fh/u`；不重建 plan。

### 5.2 DPR 与清晰度

- 不手动乘 DPR；不创建离屏 canvas；不设 `image-rendering`。
- 文本在覆盖层是真实 DOM 文本，浏览器按 DPR 子像素定位；比 canvas 缩放更锐利是预期。
- 浏览器缩放 / 多屏 DPI 变化由 `ResizeObserver` + 浏览器重栅格化处理；不需要重建动画。
- E2E 用 `deviceScaleFactor: 1` 与 `2` 各跑一次，断言布局坐标不变（只有像素密度变化）。

### 5.3 透视

- 逐元素 `perspective()`，顺序见 CP-2；不共享相机、不做 `preserve-3d`。
- 父级不加 `filter` / `opacity` / `mask`（会创建 containing block 并改变 3D 渲染上下文）；clip 级透明度放在外层 wrapper，3D 元素自身只做元素动画。
- `transform-origin` 缺省 `50% 50%`；若 spec 有 `transform_origin`，原样写入。
- 元素有 `rotate_x/y` 但没有 `perspective` 时保持正交；不自动补 `perspective(1000px)`。

### 5.4 层级

| 层 | z-index | 说明 |
|---|---:|---|
| canvas | 0（DOM 顺序在前） | 视频 / 图片 / 字幕 / 手柄 |
| overlay root | 15 | `pointer-events:none` |
| clip layer | 16 + compositeRank | 每个被接管 clip 一层 |
| element | elementIndex | 同 clip 内 DOM 顺序 |
| textarea 编辑 | 20 | 现有 |
| 播放按钮 / 全屏条 | 现有 | 覆盖层不拦截 |

- 每个 clip 层 `isolation:isolate`，避免 `mix-blend-mode` 泄漏；覆盖层不使用 `mix-blend-mode`。
- 3D 元素不承诺交叉深度；同 clip 内按元素顺序绘制，与后端一致。

### 5.5 与视频合成

- Canvas 始终先画视频/图片/字幕；覆盖层只盖文字。
- 覆盖层激活时，`compositeTimelineClips` 跳过 `activeClipIds`；否则会出现双份文字。
- 覆盖层透明背景，视频从下方透出；有 `bg` 元素时覆盖层自己铺满，语义与成片一致。
- 视频 seek 异步：暂停时 Canvas 的 `seekVideo` 可能晚一帧；覆盖层文字先精确，视频下一帧追上。可接受，性能面板可观测。

### 5.6 Web Animations seek

- 每条动画 `pause()` 后只改 `currentTime`；不调用 `play()`、不改 `playbackRate`、不用 `commitStyles()`。
- `duration = mg_def.duration_sec * 1000`；`fill: 'both'`；`easing: 'linear'` 基线，逐帧 `easing` 覆盖区间。
- 首末帧缺失时补 `offset:0/1` 的静态值，语义对齐 CSS animation 的底层值。
- seek 合并到 rAF；同一帧多次 seek 只落最后一次；seek 后不强制 `getComputedStyle`（会触发额外布局）。
- 字体 `document.fonts.ready` 后 re-seek；`document.fonts.onloadingdone` 也 re-seek（去抖 100ms）。

### 5.7 暂停 / 播放切换

- 唯一判定源：`usePreviewStore.isPlaying`；覆盖层不自己维护“用户以为的播放态”。
- 暂停：build → seek → requestOverlay → 等 `canvasGeneration` → visible。
- 播放：releaseOverlay → 等 `canvasGeneration` → hidden；动画暂停保留 1s 预热。
- 快速反复点播放/暂停：用 `generation` 单调递增，旧代际回调直接丢弃；不允许“旧 build 完成后再把覆盖层显示出来”。
- 拖动播放头：`isPlaying=false` 时照常 seek；rAF 合并；不重建。
- 页面隐藏（`visibilitychange`）时现有逻辑会暂停；覆盖层跟随暂停流程，不额外处理。

### 5.8 缓存失效

| 变化 | 动作 |
|---|---|
| `mg_def` / `mg_params` / `motion_spec_hash` | plan key 变化 → 重建 |
| undo / redo | 同上（hash 变化） |
| 时间线宽高 | key 变化 → 重建 |
| 切项目 / 卸载 | `reset()`：dispose 全部、清 LRU、revoke blob |
| 字体加载完成 | 只 re-seek，不重建 |
| flag 关闭 | 立即 release + dispose |
| 预览 zoom / 面板尺寸 | 只改 frame rect / u，不重建 |
| 浏览器 DPR 变化 | 不重建；ResizeObserver 触发重排 |

---

## 6. 测试计划

### 6.1 单元测试（Vitest）

| 文件（新增/修改） | 覆盖 |
|---|---|
| `mgLayout.test.ts` | 锚点 9 组合 + offset；transform 顺序；百分比/px 字符串 |
| `mgDomPlan.test.ts` | 6 类元素快照；无关键帧跳过；首末帧补全；easing 映射；数值钳制 |
| `cssSafety.test.ts` | `<script>`、`onerror`、`url(javascript:)`、`expression`、`data:image/svg`、超长文本 |
| `overlayState.test.ts` | 状态迁移表；快速 play/pause；旧 generation 回调丢弃；error 冷却 |
| `overlayStore.test.ts` | request/release/markCanvasDrawn；visible 只在握手后为 true |
| `MotionSpecOverlay.test.tsx` | 挂载/卸载；animations pause；seek 调用；pointer-events none |
| `fidelity.test.ts` | E/A/U 判定；证据缺失降级；3D 播放态 unsupported |
| `blurModel.test.ts` | 查表/插值/越界返回 null；k 单调性；拟合残差 |
| `previewFidelity.test.ts`（修改） | 不再输出“仅渲染后可见”；3D 文案 |
| `mgFrame.test.ts`（前端 API） | 304、AbortSignal、错误码、blob revoke |

运行：

```powershell
cd J:\Clipweight-Client
npm run test -- src/features/preview/motionSpecOverlay src/features/preview/previewFidelity.test.ts
npx tsc --noEmit
```

### 6.2 Playwright / 浏览器 E2E

`[新增] e2e/motion-spec-overlay.spec.ts`（mock 后端，默认套件）：

1. **暂停 3D**：seed 含 `translate_z/rotate_x/perspective` 的 MG clip；`seekViaRuler` 到 1s；断言 `[data-testid="mg-overlay"]` 可见、`getComputedStyle(el).transform` 含 `perspective` / `translateZ` / `rotateX`；断言 canvas 不再含该 clip 的黄色文字像素（复用 `preview-fixes` 的像素计数 helper）。
2. **播放回退**：点播放；2 帧内 `data-mg-overlay-visible="false"`；canvas 重新出现 MG 像素；角标出现 `3D·暂停精确`。
3. **暂停握手无闪白**：录制 3 帧截图，比较覆盖层可见前后 canvas 像素差；不允许整帧空白（非背景像素 > 阈值）。
4. **seek 不重建**：连续拖动 10 次，`overlay DOM 节点数` 不变；transform 值随时间变化。
5. **安全**：fixture 文本 `<img src=x onerror=window.__x=1>`；断言页面文本原样、`window.__x` 未定义、无外部请求（`page.on('request')` 过滤 `http`）。
6. **外链图片**：`mg_def.image.src = 'http://127.0.0.1:9/x.png'`；断言无请求、角标含“外部图片已拦截”。
7. **CSP**：`page.on('console')` 无 CSP violation；断言覆盖层无 `<style>` / `<script>` 注入（DOM 查询）。
8. **性能**：`page.evaluate` 包住 20 次 seek（`setCurrentTime` + 双 rAF），读 `performance.now()`，输出 p50/p95；断言 p95 ≤ 12 ms（本机基线，CI 可放宽 1.5×）。

`[新增] e2e/motion-spec-frame-parity.spec.ts`（`testIgnore` 里默认排除，集成环境单独跑）：

1. 真实后端 + 固定项目；暂停到 0.5s / 1.5s / 2.5s；
2. 页面内 `fetch('/api/text-animation/preview-frame')` 拿 PNG；
3. 截图 overlay 区域，浏览器内解码两张图，计算 SSIM / Δedge（复用标定脚本的指标函数）；
4. 断言：无 blur/3D 静态文本 SSIM ≥ 0.99；3D 文本 ≥ 0.98；blur ≤16px ≥ 0.98；输出 JSON 到 `test-results/mg-parity/`。

运行：

```powershell
cd J:\Clipweight-Client
npx playwright test e2e/motion-spec-overlay.spec.ts
# 真实后端（8080）就绪后
npx playwright test e2e/motion-spec-frame-parity.spec.ts --project=chromium
```

### 6.3 抽帧对比（脚本）

`[新增] scripts/compare-mg-frame.mjs`

- 输入：`--project <id> --clip <id> --times 0.5,1.5,2.5`；
- 启 Playwright → 打开编辑器 → 暂停 → 截图 overlay；
- fetch 服务端 PNG；
- 在页面内解码两图，计算 SSIM / Δedge / Δcentroid；
- 输出 `docs/e2e/mg-fidelity/<compilerVersion>/<clip>-<time>.json` 与一张并排 PNG；
- CI 可选：阈值不达标退出码 1。

### 6.4 后端测试

```powershell
cd J:\Clipwright
py -3.14 -m pytest tests/clipwright/test_mg_frame_api.py -q
py -3.14 -m pytest tests/clipwright/test_text_motion_api.py -q
python -c "import clipwright.main"
```

覆盖：路由、缓存、单飞、超时、409/422/429/503/504、CSP meta、`http(s)` 图片拒绝、PNG 尺寸。

### 6.5 性能 p50/p95 汇总

| 场景 | 采集方式 | 目标 |
|---|---|---|
| 播放 1080p，3 个 MG clip | `previewPerf` 120 帧环形缓冲 | p95 ≤ 16.7 ms，掉帧 < 1% |
| 暂停激活（24 元素） | `performance.mark` + `PerformanceObserver` | p50 ≤ 20 ms，p95 ≤ 60 ms |
| seek（同 clip） | 20 次 `setCurrentTime` + 双 rAF | p50 ≤ 3 ms，p95 ≤ 12 ms |
| 服务端冷抽帧 | `X-MgFrame-Render-Ms` | p50 ≤ 1.8 s，p95 ≤ 4.5 s |
| 服务端缓存命中 | 同上 | p95 ≤ 60 ms |
| 覆盖层内存 | CDP `HeapProfiler` / detached 检查 | ≤ 24 MB |

---

## 7. 执行顺序

```text
第 1 天    CP-0（前端）  ─┬─ CP-5a 后端骨架（路由/服务/测试）可并行
第 2–3 天  CP-1 标定     ─┴─ CP-2 纯函数可并行
第 4–6 天  CP-3 覆盖层 + 握手 + 基础 E2E
第 7–8 天  CP-4 3D + fidelity + UI
第 9–10 天 CP-5b 前端精确帧 + 集成测试
第 11–12 天 CP-6 性能/文档/灰度
```

依赖关系：

- CP-3 依赖 CP-2；
- CP-4 依赖 CP-3 + CP-1 的标定结果；
- CP-5b 依赖 CP-5a；
- CP-6 依赖全部；
- CP-1 不阻塞 CP-2/CP-3 的 2D 部分；blur 可先保持 `approx`。

PR 拆分（沿用当前分支，不新建长生命周期分支）：

1. PR-1：CP-0 + CP-1（flags、标定脚本/生成表/文档）；
2. PR-2：CP-2（纯函数 + 锚点重构 + 单测）；
3. PR-3：CP-3（覆盖层、握手、PreviewPanel 接入、E2E）；
4. PR-4：CP-4（3D、fidelity、文案）；
5. PR-5：CP-5（后端 API + 前端客户端 + 测试）；
6. PR-6：CP-6（性能、文档、灰度开关默认值）。

每个 PR 必须附：改动文件、验证命令输出、性能/像素证据路径、回滚方式。

---

## 8. 风险与缓解

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---:|---|---|
| 1 | 覆盖层与 Canvas 双重绘制 / 闪帧 | 高 | 高 | generation 握手；E2E 3 帧像素断言；失败即回退 |
| 2 | WAAPI 关键帧语义与后端 CSS 不一致 | 高 | 高 | 镜像 `mg_renderer` 顺序/补帧/easing；PNG 对比；不达标降 `approx` |
| 3 | 3D transform 顺序写错 | 中 | 高 | 单测逐 token 对比；服务端 PNG 对比 |
| 4 | 字体差异导致文字宽度/位置偏移 | 高 | 中 | 百分比锚点；`document.fonts.ready` re-seek；PNG 作为 exact 依据 |
| 5 | blur 修正表不成立 | 中 | 中 | 288 用例标定；不达标保持 approx；不阻塞 3D |
| 6 | 服务端 Chromium 并发打满 | 中 | 高 | 信号量 2 + 单飞 + 缓存 + 503/Retry-After |
| 7 | mg_def 注入/外链请求 | 中 | 高 | textContent、CSS 白名单、图片白名单、CSP meta、无 innerHTML |
| 8 | 覆盖层 DOM 过多导致暂停卡顿 | 中 | 中 | 只接管当前 clip；元素 ≤64；plan LRU；离开即 dispose |
| 9 | 缓存命中旧产物 | 中 | 中 | key 含 mg_def/params/尺寸/帧号/renderer 版本；spec_hash 409 |
| 10 | line 元素 Canvas/成片本来就不一致 | 高 | 低 | 覆盖层按成片镜像；文档标注；不在本计划修后端 |
| 11 | 覆盖层在 `zoomLevel > 1` 时溢出 | 中 | 低 | 根节点 `overflow:hidden`；frame rect 允许负 fx/fy；E2E 覆盖 1.5× |
| 12 | 浏览器缩放/多屏 DPR 变化 | 低 | 低 | CSS px + ResizeObserver；不手动 DPR |
| 13 | 播放按钮/编辑层被覆盖层挡住 | 低 | 中 | `pointer-events:none`；z-index 15 < textarea 20 |
| 14 | 真实项目无 `mg_def`/旧数据 | 中 | 低 | `motionPreviewState` fail-closed；角标“待编译”；回退 Canvas |

**P0（阻断合并）**

- 任意路径执行 `mg_html` / `innerHTML` / 外链请求；
- 暂停/播放出现双重绘制或空白帧；
- 3D 播放态被标成 `exact`；
- 覆盖层构建失败导致预览崩溃（必须回退）；
- 没有 E2E 与安全用例；
- `npm run build` / `tsc` 失败。

**P1（本期内完成）**

- blur 标定表与阈值；
- 服务端缓存/ETag/超时/降级；
- 性能 p95 达标；
- 文案与 fidelity 矩阵一致；
- 字体加载 re-seek。

**P2（可后续）**

- `dpr=2` 抽帧；
- 并排对比滑块；
- mask 精确化；
- line 后端行为修正；
- 覆盖层性能遥测上报（本地，不上传）。

---

## 9. 验收清单

### 9.1 功能

- [ ] 暂停在含 `translate_z/rotate_x/rotate_y/perspective` 的 MG clip 上，覆盖层出现，`getComputedStyle().transform` 含对应函数。
- [ ] 播放时覆盖层隐藏，Canvas 显示 MG；角标 `3D·暂停精确`。
- [ ] 暂停/播放快速切换 10 次，无空白帧、无双份文字、无控制台异常。
- [ ] 拖动播放头 20 次，覆盖层不重建、不泄漏 DOM/Animation。
- [ ] 有 mask / blend / slide-wipe / 嵌套时间线的 clip 不被接管，继续 Canvas，并有说明。
- [ ] 无关键帧元素按后端语义跳过，角标记差异（不静默）。
- [ ] 服务端 PNG 成功显示“服务端精确帧 · t”；播放/切 clip 自动关闭。
- [ ] 服务端 503/504 时回退覆盖层，提示“精确抽帧不可用”。

### 9.2 安全

- [ ] 搜索代码：无 `dangerouslySetInnerHTML`、无 `innerHTML`、无 `srcdoc`、无 `mg_html` 读取。
- [ ] 恶意文本原样显示，无脚本执行，无 `onerror`。
- [ ] 外链图片/`data:`/`file:` 被拒绝，无网络请求。
- [ ] CSS 值无 `url(` / `expression(` / `var(` 注入。
- [ ] 服务端只接受 ID；`project_id` 路径穿越被拒；CSP meta 存在。
- [ ] 若部署加 CSP，覆盖层不需要 `unsafe-inline` 脚本（CSSOM 写样式）。

### 9.3 像素 / 性能

- [ ] blur 标定表提交；修正后 SSIM/Δedge 达阈值；未达标项在 fidelity 中为 `approx`。
- [ ] 覆盖层 vs 服务端 PNG：静态文本 SSIM ≥ 0.99，3D ≥ 0.98，blur ≤16px ≥ 0.98。
- [ ] 播放 p95 ≤ 16.7 ms；暂停构建 p95 ≤ 60 ms；seek p95 ≤ 12 ms；冷抽帧 p95 ≤ 4.5 s。
- [ ] 覆盖层内存 ≤ 24 MB；detached nodes = 0。

### 9.4 工程

- [ ] `npx tsc --noEmit`、`npm run test`、`npm run build` 通过。
- [ ] 新增 vitest / Playwright / pytest 全部通过。
- [ ] `docs/text-motion-frontend-prd.md`、`docs/text-motion-remaining-audit.md`、`docs/api_reference.md`、`docs/frontend-backend-parity.md` 已同步。
- [ ] 三个前端 flag + 一个后端 env 的回滚演练通过。

---

## 10. 明确不做什么

1. **不做 WebGL / Three.js / Babylon**。CSS 3D 在具体像素对比中不达标之前，不引入第二套渲染栈。只有同时满足以下条件才另立 ADR 评估：① 3D 原语端到端 SSIM 连续两次 < 0.95，且已排除字体/采样误差；② 单 clip > 32 个 3D 元素时 seek p95 > 50 ms，且 DOM/plan 优化无效；③ 产品明确接受新增运行时依赖与 GPU 兼容成本。
2. **不执行模型 `mg_html`**，不把它塞进 iframe、`srcdoc`、`blob:` 文档或 `dangerouslySetInnerHTML`。
3. **不做浏览器端整片渲染 / 视频编码 / WebCodecs 导出**。
4. **不为 mask 做形状精确化**（用户已裁定无所谓）；有 mask 的 MG clip 继续 Canvas。
5. **不改 `motion_spec/1` schema**，不新增原语，不把 3D 塞进 Canvas 伪投影。
6. **不在连续播放时逐帧请求后端**；服务端 PNG 只用于暂停/核对。
7. **不新增运行时 npm 依赖**；标定/对比脚本只用已有 Playwright。
8. **不放宽 CSP**、不引外链字体/图片、不允许 `url()` 进入 MG CSS。
9. **不承诺连续播放与成片像素一致**；只承诺“近似可看 + 暂停可核对 + 服务端可抽帧”。
10. **不修复后端 line 元素的 margin 语义**；覆盖层按成片行为镜像，避免预览与成片更不一致。

---

## 附录 A：基线与实测记录（执行时填写）

### A.1 当前 Canvas 基线（CP-0）

| 场景 | p50 | p95 | 掉帧 | 备注 |
|---|---:|---:|---:|---|
| 1080p 播放，1 个 MG clip | 待测 | 待测 | 待测 | 现有代码 |
| 1080p 播放，3 个 MG clip | 待测 | 待测 | 待测 | 现有代码 |
| 暂停 seek，MG clip | 待测 | 待测 | — | 现有代码 |
| 覆盖层激活（24 元素） | 待测 | 待测 | — | CP-3 |
| 覆盖层 seek | 待测 | 待测 | — | CP-3 |
| 服务端冷抽帧 | 待测 | 待测 | — | CP-5 |
| 服务端缓存命中 | 待测 | 待测 | — | CP-5 |

### A.2 像素证据

| 原语 | 时间点 | SSIM | Δedge | Δcentroid | 证据文件 | 结论 |
|---|---|---:|---:|---:|---|---|
| 3D 文本 | 0.5s | 待测 | — | 待测 | `docs/e2e/mg-fidelity/...` | 待定 |
| 3D 文本 | 1.5s | 待测 | — | 待测 | 同上 | 待定 |
| blur 8px | 1.0s | 待测 | 待测 | 待测 | 同上 | 待定 |
| blur 16px | 1.0s | 待测 | 待测 | 待测 | 同上 | 待定 |
| 无 blur 静态文本 | 1.0s | 待测 | — | 待测 | 同上 | 待定 |

> 规则：没有证据文件的原语，`verdictForClip()` 一律返回 `approx`；不得在 PR 描述里声称 `exact`。

---

## 附录 B：命令速查

```powershell
# 前端
cd J:\Clipweight-Client
npx tsc --noEmit
npm run test
npm run build
npx playwright test e2e/motion-spec-overlay.spec.ts

# blur 标定（生成表 + 文档）
node scripts/calibrate-blur.mjs `
  --out src/features/preview/motionSpecOverlay/blur-calibration.generated.ts `
  --report docs/text-motion-blur-calibration.md

# 抽帧对比（需后端 8080）
node scripts/compare-mg-frame.mjs --project proj_e2e_demo --clip c_mg3d --times 0.5,1.5,2.5

# 后端
cd J:\Clipwright
py -3.14 -m pytest tests/clipwright/test_mg_frame_api.py -q
py -3.14 -m pytest tests/clipwright/test_text_motion_api.py -q
python -c "import clipwright.main"
```

---

## 附录 C：关键文件清单

**前端新增**

```text
src/features/preview/motionSpecOverlay/
  MotionSpecOverlay.tsx
  overlayStore.ts
  overlayState.ts
  overlayTypes.ts
  mgDom.ts
  mgDomPlan.ts
  mgLayout.ts
  cssSafety.ts
  fidelity.ts
  blurModel.ts
  blur-calibration.generated.ts
  useServerFrame.ts
  overlayEligibility.ts
  *.test.ts / *.test.tsx
src/services/api/mgFrame.ts
scripts/calibrate-blur.mjs
scripts/compare-mg-frame.mjs
e2e/motion-spec-overlay.spec.ts
e2e/motion-spec-frame-parity.spec.ts
e2e/fixtures/mgPreviewFixture.ts
docs/text-motion-blur-calibration.md
```

**前端修改**

```text
src/features/preview/PreviewPanel.tsx
src/features/preview/mgRenderer.ts
src/features/preview/mgFidelity.ts
src/features/preview/previewFidelity.ts
src/features/preview/frameGeometry.ts
src/features/textMotion/flags.ts
docs/text-motion-frontend-prd.md
docs/text-motion-remaining-audit.md
```

**后端新增**

```text
clipwright/services/mg_frame.py
tests/clipwright/test_mg_frame_api.py
```

**后端修改**

```text
clipwright/api/text_animation.py
clipwright/animation/hyperframes_renderer.py
docs/api_reference.md（仓库 J:\Clipwright\docs）
```

---

## 附录 D：与现有文档的关系

- 本计划是 `docs/text-motion-frontend-contract.md` 的 **预览/渲染补充**，不改变契约冻结项。
- 本计划不替代 `docs/text-motion-frontend-prd.md` §6；CP-4/CP-6 会把 §6.2 的 fidelity 文案与本节对齐。
- 本计划关闭 `docs/text-motion-remaining-audit.md` 的第 4、5 条；其余条目（深链接、长项目验证、全量测试、author 队列、UI 上限、PR/CI）仍按该审计跟踪。
- 服务端 PNG 路由需在 `docs/api_reference.md` 与 `docs/frontend-backend-parity.md` 登记；未登记前不得在 UI 里宣称“已有精确抽帧”。


## 实施记录

### CP-0（部分）

- flags 增加 `overlay3d` / `overlayServerFrame` / `blurCalibrated`；
- 新增 `src/features/preview/motionSpecOverlay/overlayTypes.ts`；
- 提交 `7c482ae`。

### CP-5（首版）

- 新增 `POST /api/text-animation/preview-frame`；
- 新增 `clipwright/services/mg_frame.py`；
- `HyperframesRenderer.render_mg_html_to_png()` 使用 `hyperframes snapshot --at`；
- 只接受 project/clip/time，不接受客户端 HTML/spec；
- 测试：`test_text_motion_api.py` 7 passed；
- 后端提交 `46b603a`。


### CP-2/CP-3 首版（2026-11-18）

- 新增 `mgLayout.ts`：anchor、transform 顺序、CSS 值安全检查、图片白名单；
- 新增 `mgDomPlan.ts`：结构化 mg_def → DOM 计划、keyframes、3D/fidelity 标记；
- 新增 `MotionSpecOverlay.tsx` + `overlayStore.ts`：暂停/seek 时 CSS3D 覆盖层；
- PreviewPanel 在覆盖层接管时跳过同 clip 的 Canvas MG 绘制；
- 测试：`mgDomPlan.test.ts` 3 passed；前端 241 passed；build 通过；
- 提交 `3185513`。
- 仍是首版：没有 generation 握手、没有 WAAPI 动画、blur 标定/服务端 E2E 未完成。


### CP-3 generation 握手（2026-11-18）

- `overlayStore` 增加 generation/canvasGeneration；
- 覆盖层请求接管后保持 hidden，Canvas 完成 skip 帧后 markCanvasDrawn，覆盖层才 visible；
- 播放时 release，Canvas 恢复绘制；
- 提交 `8cdd38f`。


### CP-3 浏览器复验（2026-11-18）

- 给 `tc_e9831d60` 首帧加 `rotate_x=12` 并 commit（spec_hash `6a9e63ae...`）；
- 暂停在 62.65s，`[data-testid="mg-overlay"]` 存在；
- 黄色「并非回应」以 CSS3D 倾斜显示，Canvas 同 clip 已跳过；
- 截图：`docs/e2e/motion-spec-3d-pause.jpg`。


### CP-4/CP-5 证据（2026-11-18）

- 新增 `fidelity.ts`：canvas-play 3D=unsupported、css3d-pause=approx、server-frame=exact；覆盖层显示 `CSS3D · 近似精确`；
- `render_mg_html_to_png` 实际执行成功：1920×1080 PNG，17,125 bytes，截图 `docs/e2e/motion-spec-server-frame.png`；
- 前端 243 tests/build 通过；提交 `c328e3b`。
- 仍缺 CP-1 标定表、CP-6 覆盖层/PNG 逐像素对比。


### CP-1 采样标定（2026-11-18）

- 新增 `scripts/calibrate-blur.mjs`：Playwright 对 Canvas/CSS 模糊矩形截图并比对；
- 当前采样 4 个半径 × 2 dpr（8 例），不是计划中的完整 288 例；
- 生成 `blur-calibration.generated.ts`：dpr=1 a=1.0，dpr=2 a=1.25；
- `blurModel.ts` 只对已有 bucket 返回半径，其余返回 null（继续 approx）；
- 测试通过；提交 `e40fee3`。
- 仍缺：scale 0.25/0.5、文字/细线测试图、SSIM/Δedge 阈值表。


### CP-6 视觉对比首轮（2026-11-18）

- 同一 clip local 0.2s：覆盖层截图 `docs/e2e/motion-spec-3d-overlay.jpg`；
- 服务端 Hyperframes 抽帧 `docs/e2e/motion-spec-3d-server.png`；
- 两者文字均倾斜、黄色，覆盖层叠加视频背景；服务端为透明/白底；
- 仍为人工目视对比，未做 SSIM/bbox/Δedge 数值。


### CP-6 数值对比（2026-11-18）

- 新增 `scripts/compare-mg-frame.py`：黄色文字 bbox 归一化对比；
- overlay/server bbox：left Δ0.0005、top Δ0.0081、right Δ0.0015、bottom Δ0.0247；
- 说明位置/宽度基本一致，底部差异来自覆盖层截图裁切/背景；
- 仍不是 SSIM/Δedge 全图指标。


### CP-6 mask IoU（2026-11-18）

- `compare-mg-frame.py` 增加 yellow mask IoU；
- 当前 3D clip 0.2s：bbox delta 0.0005/0.0081/0.0015/0.0247，mask IoU **0.4516**；
- IoU 受截图裁切/背景/抗锯齿影响，说明“位置接近但还不是像素等价”；
- 提交 `67939b1`（脚本修订待提交）。


### 深链接与 3D 覆盖层联合复验（2026-11-18）

- `?clip=tc_e9831d60&t=62.65` 现在会在水合后持续 3s 重试选中；
- 页面选中 `tc_e9831d60`，属性面板显示 MotionSpec；
- 暂停态 `mg-overlay` 可见，黄色 3D 文字与视频/字幕合成；
- 截图 `docs/e2e/motion-spec-3d-deeplink.jpg`。
