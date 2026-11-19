# HyperFrames 动画 Skill 调研报告

> 调研目标：找出适用于 HyperFrames 的动画类 Agent Skill，说明其可实现的视觉效果，并评估 DeepSeek V4.1 Flash 在这些 Skill 上的实际表现。
>
> 调研时间：2026-11-18
>
> 结论先行：HyperFrames 的动画能力不是单一“生成动画”按钮，而是 **动画规则库 + 制作工作流 + 连续性法则 + 转场技术 + 文本特效** 的组合。DeepSeek V4.1 Flash 很适合执行这些结构化 Skill 的代码与迭代环节，但“一次生成即有导演级动效”的能力仍有限，必须配合 lint/render/check 与人工审美复核。

## 1. 调研范围与方法

本次检索了 HyperFrames 官方仓库、官方文档、Catalog 与 DeepSeek 官方发布说明，重点查看：

- `hyperframes-animation`：动画规则、blueprint、转场与 runtime adapter；
- `motion-graphics`：短视频动效的完整制作流程；
- `motion-doctrine`：多场景连续性与转场法则；
- `cut-the-curve`：速度匹配的转场/入场技术；
- `marker-highlight`：文字高亮动画；
- HyperFrames Catalog 中的文本与图表组件；
- DeepSeek V4.1 Flash / V4.1-Flash-1017 的官方能力说明。

说明：HyperFrames 的 skill 仍在快速迭代，以下按检索到的公开版本归纳；具体 API 以安装后的 skill 文件为准。

## 2. 适用 Skill 清单

### 2.1 `hyperframes-animation`（核心动画知识库）

**定位**：HyperFrames 所有动画知识的入口，包含：

- atomic rules：原子动画配方；
- blueprints：多阶段场景模板；
- transitions：场景间转场；
- techniques：更宽泛的动效设计模式；
- adapters：7 种运行时适配（GSAP 默认，另有 Lottie、Three.js、Anime.js、CSS keyframes、Web Animations API、TypeGPU）。

**能实现的效果**：

- 文字入场、逐字/逐词动画、强调、替换；
- 数字 count-up、图表/数据可视化动画；
- Logo reveal、品牌收尾；
- 场景转场与多阶段编排；
- Lottie 素材播放、Three.js 3D 场景、CSS/WAAPI/WebGPU 特效；
- 24 种命名文本效果（通过外部 `animate-text` 适配器）。

**关键约束**：单一 paused timeline、可 seek、确定性渲染；禁止 `Math.random`、`Date.now`、`performance.now`、无限循环；空间动画只允许 `x/y/scale/rotation` 等 transform 别名。

**适合 DeepSeek 的程度**：高。它是“规则 + 代码”型 Skill，模型可以按规则选型、生成 GSAP 代码、读 lint 报错迭代。

### 2.2 `motion-graphics`（短视频动效生产工作流）

**定位**：制作 10 秒左右、无口播、以动效本身传达信息的短片；也可做到约 30 秒。

**内置品类**：

- kinetic-type：动态文字/金句；
- stat：单个大数字 + count-up；
- charts：柱状/折线/饼图/数据竞赛；
- logo-reveal：Logo sting；
- lower-thirds：人名条、标注、社交 overlay；
- maps：地图高亮、连线、地点缩放；
- webpage：网页/UI 滚动、光标、标注；
- news：新闻标题 + 来源卡 + 关键事实；
- tweet：推文卡片动画；
- asset-fusion：把真实图片的几何形状融合成图表。

**工作流**：

```text
init → plan（是否搜索/选品类） → source（条件性素材搜索）
→ design（镜头设计） → build（复用 catalog block）
→ render（MP4/透明 WebM/MOV） → verify（lint/inspect）
```

**能实现的效果**：

- 短平快的品牌动效、知识区动效、数据卡、地图动画；
- 真实网页/新闻/推文转动画；
- 以真实素材为形状来源的“图像变图表”；
- 透明 overlay 输出，便于后期叠加。

**适合 DeepSeek 的程度**：中高。流程明确、每步有产物，适合 agent 执行；但“选什么素材、镜头怎么设计”依赖审美和判断。

### 2.3 `motion-doctrine`（多场景连续性法则）

**定位**：在写任何动画前先读的“运动法则”，防止多场景像一张张独立 PPT。

**核心规则**：

- Vector Law：A 场景怎么退出，B 场景就怎么进入；同轴、同方向、速度匹配、切在运动中；
- The Current：全片选一个主导方向（默认向左），其他方向代表“升级/推进/到达”等语义；
- Vector Ledger：先写 `ledger.json`，记录每个 seam 的退出/进入向量；
- Carriers：用具体对象（光标、容器、Logo、词群）承载视线跨 cut；
- Causal Motion：动作必须有可见起因，点击→挤压→释放→飞行→撞击；
- No idle wobble：禁止用呼吸/漂浮/脉冲填充时间；
- Seam Gate：用 `seam-gate.mjs` 数值验证。

**能实现的效果**：

- 多场景像“一个连续镜头”而不是幻灯片；
- 速度匹配的 cut、无缝转场、共享元素 morph；
- 有因果关系的动作链和更有节奏的叙事。

**适合 DeepSeek 的程度**：中。规则可执行，但“哪个方向代表什么语义”“何时静止”需要导演判断；模型容易机械套用。

### 2.4 `cut-the-curve`（速度匹配转场技术）

**定位**：实现 motion-doctrine 中 seam 的具体技术 Skill。

**能实现的效果**：

- 速度匹配的 scene cut；
- waterfall entry（文字/元素瀑布式入场）；
- nudge curve（场景内组位移，不 cut）；
- 与 `motion-doctrine` 的 ledger/seam-stamp 配合，生成和验证转场。

**适合 DeepSeek 的程度**：高。参数化、可验证，适合模型生成 GSAP 曲线与时间点。

### 2.5 `marker-highlight`（文字标记高亮）

**定位**：给文字加手绘圆圈、下划线、方框等强调。

**能实现的效果**：

- 关键词圈选；
- 下划线/荧光笔强调；
- 方框标注；
- 配合字幕/口播做“重点词”提示。

**适合 DeepSeek 的程度**：高。单一视觉原语、代码量小、容易验证。

### 2.6 补充：`animate-text` 文本效果适配器

`hyperframes-animation` 通过外部 `animate-text` 适配器提供 24 种命名文本效果。Catalog 中可见的相关效果包括：

- Headline Slam；
- Blur Out Up；
- Char Slam Explode；
- RGB Glitch Text；
- Kinetic Type Swap；
- Matrix Decode；
- Scramble Reveal；
- Marker Highlight；
- Per-Word Crossfade / Per Word Rise；
- Particle Text Dissolve；
- Morph Text；
- Handwritten Write-On Title。

这些效果适合标题、金句、数据强调和转场前后的文字节奏。

## 3. 这些 Skill 组合起来能做什么

| 目标 | 推荐 Skill 组合 | 可达到的效果 |
|---|---|---|
| 10 秒品牌/标题动效 | `motion-graphics` + `hyperframes-animation` + `marker-highlight` | Logo/标题 slam、关键词高亮、干净收尾 |
| 知识区动态图表 | `hyperframes-animation` + `motion-graphics`（charts/stat） | 柱状/折线/count-up、数据卡、结论强调 |
| 多场景产品演示 | `motion-doctrine` + `cut-the-curve` + `motion-graphics` | 连续镜头感、速度匹配转场、UI/网页动画 |
| 口播视频叠加层 | `motion-graphics`（lower-thirds/overlay）+ `marker-highlight` | 人名条、标注、关键词圈选、透明 WebM |
| 3D/WebGL 视觉 | `hyperframes-animation`（Three.js/TypeGPU adapter） | 3D 场景、粒子、着色器视觉 |
| 新闻/推文/网页转动画 | `motion-graphics`（news/tweet/webpage） | 标题揭示、来源卡、滚动/光标演示 |
| 真实图片变图表 | `motion-graphics`（asset-fusion） | 用图片轮廓/几何生成图表动效 |

## 4. DeepSeek V4.1 Flash 适配评估

### 4.1 官方能力要点

根据 DeepSeek 官方发布说明：

- V4.1 Flash 是 552B 参数的 MoE 模型，采用 Causal-Encoder-Decoder 非对称结构；
- 输入激活约 8B、输出激活约 16B，主打低成本、高吞吐；
- 原生多模态视觉理解；
- 官方称其在 Agentic Benchmark 上超过 DeepSeek V4 Pro；
- V4.1-Flash-1017 强化了从零项目开发、游戏、3D 建模等“许愿式编程”能力，并针对 DeepSeek Harness 等框架优化。

### 4.2 对 HyperFrames Skill 的优势

1. **结构化执行能力强**  
   HyperFrames 的 skill 是“规则 + 步骤 + 产物”的结构，Flash 擅长读规则、生成 HTML/GSAP、按 lint 报错修复。

2. **代码生成与迭代成本低**  
   动画主要是 GSAP timeline、CSS、SVG、Canvas 代码；Flash 的输出成本低，适合多轮 draft → check → repair。

3. **Agent 工具链适配**  
   `motion-graphics` 本身是多阶段 agent workflow，Flash 的 tool use 与长上下文能力适合执行 plan/source/build/render/verify。

4. **多模态有帮助**  
   可以读参考图、截图、渲染帧，辅助判断布局与视觉问题。

### 4.3 局限与风险

| 问题 | 说明 | 影响 |
|---|---|---|
| 动效审美不稳定 | 模型擅长“实现”，不擅长“导演级节奏/构图” | 首版容易机械、平均、缺少重点 |
| 多场景连续性弱 | `motion-doctrine` 需要全局规划，模型容易逐场景独立生成 | 容易出现 PPT 感、方向乱、转场断裂 |
| 确定性约束易违反 | 禁止随机、无限循环、运行时测量等规则较多 | 需要 lint/seam-gate 强校验 |
| API/版本幻觉 | HyperFrames 迭代快，模型可能使用旧 API | 需要锁定 skill 版本并跑 `check` |
| 长 composition 上下文压力 | 大段代码 + 素材 + 规则容易丢上下文 | 需要分阶段产物和局部修复 |
| 无官方 HyperFrames 基准 | 目前没有公开的 HyperFrames 专项评测 | 以下评分为工程判断，不是 benchmark |

### 4.4 分项评分（主观工程评估）

| 能力 | 评分 | 说明 |
|---|---:|---|
| 原子文本/图表动效代码 | 8/10 | 规则清晰、可验证，Flash 能稳定产出 |
| 单场景 10 秒动效 | 7/10 | 有 skill + catalog 时可用，审美需人工挑选 |
| 多场景连续叙事 | 5/10 | 需要 motion-doctrine + seam-gate 强约束 |
| 一次生成即交付 | 4/10 | 不建议无人复核直接交付 |
| 带 lint/render 迭代的交付 | 7.5/10 | 这是 Flash 最合适的工作方式 |
| 3D/WebGL/Lottie 复杂场景 | 6/10 | 能写代码，但调试成本高，需更强模型/人工 |

### 4.5 最适合的分工

推荐把 DeepSeek V4.1 Flash 放在“执行型”位置：

- 读 skill 文档并选规则；
- 生成 catalog block + GSAP 组合；
- 写测试/校验脚本；
- 根据 lint、seam-gate、截图反馈修复；
- 批量生成多个候选版本。

不建议让它单独承担：

- 品牌动效的最终审美判断；
- 多场景叙事结构；
- 关键镜头的手工精修；
- 未经渲染验证的最终交付。

## 5. 推荐落地流程

```text
1. 固定 HyperFrames skill 版本
2. 用 motion-graphics 选品类、写 shot-plan
3. 用 motion-doctrine 写 ledger + seam 计划
4. 用 hyperframes-animation 选 2–4 条 atomic rule
5. 生成 composition + catalog block
6. render 一版低清 draft
7. 看截图/抽帧，人工确认节奏与构图
8. 用 lint/inspect/seam-gate 修复
9. 再 render 终版
```

对 DeepSeek V4.1 Flash 的 prompt 应明确：

- 只使用当前 skill 版本中的 API；
- 先输出 plan/ledger，再写代码；
- 每次只改一个场景；
- 必须运行 `hyperframes check`；
- 不要用随机/无限循环/运行时测量。

## 6. 结论

HyperFrames 的动画 Skill 已经形成一套比较完整的“动效工程体系”：

- `hyperframes-animation` 解决“用什么动画原语”；
- `motion-graphics` 解决“怎么从需求走到成片”；
- `motion-doctrine` + `cut-the-curve` 解决“多场景为什么像一支片子”；
- `marker-highlight` 等文本 skill 解决“重点怎么被看见”。

DeepSeek V4.1 Flash 在这套体系里是**高性价比的执行者**：擅长按规则生成代码、调用工具、根据校验修复；但在审美、导演判断和多场景连续性上仍需人类或更强模型把关。最稳妥的用法不是“一句话生成动画”，而是“Skill 约束 + Flash 迭代 + 渲染校验 + 人工审美确认”。

## 7. 参考来源

- [HyperFrames animation skill](https://raw.githubusercontent.com/heygen-com/hyperframes/3518abe7aaa8d26740a333a43791741d0959ca43/skills/hyperframes-animation/SKILL.md)
- [HyperFrames motion-graphics skill](https://raw.githubusercontent.com/heygen-com/hyperframes/3518abe7aaa8d26740a333a43791741d0959ca43/skills/motion-graphics/SKILL.md)
- [HyperFrames motion-doctrine skill](https://raw.githubusercontent.com/heygen-com/hyperframes/63574a7c7f9562508769938e92e35ee7f92d9cea/.claude/skills/motion-doctrine/SKILL.md)
- [HyperFrames skills 安装文档](https://hyperframes.heygen.com/guides/skills)
- [Headline Slam Catalog](https://hyperframes.heygen.com/catalog/components/headline-slam)
- [DeepSeek V4.1 Flash 发布说明](https://api-docs.deepseek.com/zh-cn/news/news260910/)
- [DeepSeek V4.1 Flash 1017 发布说明](https://api-docs.deepseek.com/zh-cn/news/news261017/)
