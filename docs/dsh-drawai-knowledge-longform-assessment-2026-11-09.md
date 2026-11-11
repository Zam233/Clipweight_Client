# dsh-drawai × ClipWright：知识区长片可借鉴点分析

> 分析对象：A = `fourzkw/dsh-drawai`（master，已克隆到 `J:\dsh-drawai`，1811 个文件 / 39MB）；
> B = 本项目（`J:\Clipwright` + `J:\Clipweight-Client`），聚焦第一个视频类型 **知识区长片**（`clipwright/category/knowledge_longform.py`）。
> 日期：2026-11-09。

## 0. 一句话结论

A 是「人在画布上协作 + 用代码写动效镜头」的**编辑型工具**，B 是「一条 Agent 管线从选题跑到成片」的**自动生产系统**。
两者渲染栈和交互形态不同，**不能整仓移植**；真正值得拿的是 A 的四类「契约」：**镜头卡契约、风格 brief 契约、图元 ops 契约、打样/质检闸门**。
其中投入最小、对知识长片收益最大的是「**先打样 1 镜、再量产**」这一条（B 目前一次跑完全部动画，返工成本是全片级的）。

## 1. 两个项目的定位差异

| 维度 | A · dsh-drawai | B · ClipWright |
|---|---|---|
| 形态 | DSH 侧栏可编辑画布 + 对话改图 + 动效视频工程 | Web 前端 + FastAPI 引擎，7 段 Agent 管线 |
| 内容来源 | 人给需求，模型在画布/工程里逐镜写 | requirements → structure → material → edit → animation → audio → quality 全自动 |
| 动效实现 | Remotion（React/TSX 场景），逐帧确定性渲染 | `mg_def` JSON → Hyperframes（Chrome）或 PIL/ffmpeg；另有 `pv_engine` 逐帧渲染 |
| 画布/编辑 | `.drawai` 文档 + drawio 兼容；`diagram_read/apply` 结构化 ops | 无画布；前端只做「近似预览」（canvas 重绘 mg_def） |
| 交付物 | `timeline.json` + `scene-*.tsx` + `assets/` + `film.mp4` | Timeline JSON + 渲染 MP4（`renders/`） |
| 协作方式 | 人机来回迭代（改一镜看一镜） | 一次任务跑完，必要时人工确认/中止 |

**这意味着**：A 的「工程格式」「TSX 场景」不适用于 B；但 A 在**镜头选择、风格落地、局部修改、验收粒度**上的做法，正好补 B 的短板。

## 2. A 的关键机制（与知识长片相关的部分）

| # | 机制 | 数据/接口 | 来源 | 对知识长片相关度 |
|---|---|---|---|---|
| 1 | 画布文档 + 版本 | `.drawai`（format/schemaVersion/多页），`revision` 为内容指纹；写前校验 `expectRevision` | `docs/native-canvas.md`、`docs/diagram-tools.md` | 中 |
| 2 | 结构化改图 ops | `addNode/addEdge/setStyle/move/remove/setLabel…`，支持 `ids[]` 批量、`as/from` 别名、几何齐全时禁重排；失败一个字节都不写 | `docs/diagram-tools.md` | 中 |
| 3 | 读图契约 | 节点/边/样式键/图层/`parent`/`labelX/Y`/`revision`/选区；可按层或 ids 过滤；`render:true` 返图 | `docs/diagram-tools.md` | 中 |
| 4 | 位图矢量化 `traceImage` | 像素解码→去背→k-means 调色板→连通域轮廓→RDP 简化→SVG path；参数 `colors/minArea/epsilon/removeBg` | `docs/diagram-tools.md` | **高**（截图/论文图变可动矢量） |
| 5 | 镜头卡（shotcraft） | `cardId + styleKey` → 配方 + demo 源码；卡自带时长（`168f@30fps`）；连线顺序=时间轴顺序、卡时长=段长 | `docs/motion-video.md`、`skills/mg-code-video/SKILL.md` | **高** |
| 6 | 风格 brief（mgstyles） | 8 节固定模板（判据/色板/字排/动效语法/落地配方/镜头结构/坑/版权），6–11KB；`STYLE.md` 进工程，渲染前校验 | `lib/motion/mgstyles/BRIEF-TEMPLATE.md` | **高** |
| 7 | 分镜表 + 定调帧 | 画布上一张六列分镜表；先只写 `scene-0` 出 styleframe，再铺开 | `skills/mg-code-video/SKILL.md` | **高** |
| 8 | 制作闸门 | P0 立项 → P1 方向 → P2 分镜 → P3 资产 → P4 打样（第 1 镜真视频）→ P5 量产 → P6 声音 → P7 质检；闸门不过不进下一阶段 | `docs/motion-video-playbook.md` | **高** |
| 9 | 预览同源 | `motion_preview` 走同一 Remotion 管线渲 still 拼图，预览即样片 | `docs/motion-video.md` | 高 |
| 10 | 帧检 | `motion_qa`：帧数/黑场/静止/闪烁/空白/越界/削波，带帧号与镜头号 | `docs/motion-video.md` | 高 |
| 11 | 渲染缓存 | `bundleKey` = 规格 + 每段源码 + 素材哈希 + entry 哈希；命中直接复用 | `docs/motion-video.md` | 中 |
| 12 | 声音在时间轴里 | `timeline.audio[]`（role/gainDb/fadeIn/duck）+ 踩点绑定 + 成片回测 | `docs/motion-video.md`、`docs/motion-audio.md` | 中 |

## 3. B 的现状与真实缺口

| 现状 | 实现位置 | 局限 |
|---|---|---|
| 知识长片体裁约束 | `category/knowledge_longform.py`：镜头 5–15s、硬切 0.8、结构模板、MG 风格一句话 | 只有「文字规范」，没有可检验的视觉判据/风格包 |
| 类型化动画 39 类 | `animation/catalog.py`、`animation/prompts/types/*.md` | 动画时长由视频片段决定（`animation_agent.py:1099` `min(dur, 6.0)`），不是「卡自带时长」；没有卡级别的配方/参考帧/验收标准 |
| 自由 MG | `mg_dynamic` → `MGGenerator`（`animation/mg/generator.py`） | 一次性生成整段 `mg_def`；用户/Agent 不能「只改一条边/一个颜色」；重跑会整段覆盖 |
| MG 质量门禁 | `mg/config.yaml`（lint_gate、critique、visual_eval）、`mg/validator.py` | 门禁在「生成时」；缺「成片帧级」的静止/闪烁/安全区检查 |
| 图解 12 类 + 5 套配色 | `plugins/logic_animations`、`plugins/diagram_style` | 图解是参数化 SVG，没有可迭代的图文档；无 revision / 局部编辑 |
| 预览 | 前端 `mgRenderer.ts` 重绘 `mg_def`，`mgFidelity.ts` 标差异 | 近似预览与 Hyperframes 成片存在字体/阴影/滤镜差异；缺「精确帧」入口 |
| 帧检 | `tool/frame_validator.py`（blackdetect/signalstats）、quality agent 空镜检测 | 无 freezedetect、闪烁、安全区越界、削波检查 |
| 缓存 | `mg/generation_cache.py`（按 description/text）、render trim cache | 无「按 mg_def+素材+字体」的渲染产物缓存 |

**由此归纳出 6 个真缺口**：
① 镜头语言没有「卡」这一层契约（时长/配方/参考/验收）；
② 风格只有一段提示词，没有「判据 + 色板 + 禁用项」的可检验 brief；
③ 图表/MG 产物不可局部编辑、不可版本化；
④ 截图/照片没有「矢量化再动效」的通道；
⑤ 预览是近似的，成片才发现差异；
⑥ 质检粒度停在「黑/白帧」，不覆盖静止/闪烁/越界。

## 4. 可取之处（按收益/成本排序）

### 4.1 先打样 1 镜，再量产（建议立刻做）

- **A 的做法**：playbook P4 —— 只做第 1 镜、出**真视频**（不是静帧拼图），用户认可方向后才铺其余镜头；「一镜未过，不量产」。
- **B 的落点**：`clipwright/agents/animation_agent.py`（批量处理 marker 的入口）+ `clipwright/api/animation.py`（已有 `POST /api/animation/preview` 渲 MP4）+ `clipwright/animation/mg/visual_eval.py`（视觉 LLM 打分）。
- **怎么做**：在 animation 阶段开始前，按「钩子镜 / 信息密度最高镜」选 1 个代表 marker，先走完整生成→Hyperframes 渲染→`visual_eval` 打分；低于阈值带着问题重做该镜（最多 2 次），并把结果写 `reports/styleframe.json`；通过后再跑其余 marker。失败时把「哪一镜哪一处」写进质量 issue。
- **成本**：M（1 个代表镜的额外渲染 ≈ 全片 5–10% 时间）。
- **风险**：代表镜选错会误导；需要按体裁给「代表镜选择规则」。
- **收益**：动画返工从「整片重跑」降到「单镜重跑」；对知识长片（每镜信息密度高、返工贵）最明显。

### 4.2 镜头卡契约：`card_id + duration_frames + recipe + reference`

- **A 的做法**：shotcraft 卡带 `cardId/styleKey/duration("168f@30fps")`，配「配方 + demo 源码」；连线顺序=镜头顺序，卡时长=段长。
- **B 的落点**：`animation/catalog.py`（39 类动画 + shotcraft 变体）与 `animation/prompts/types/*.md` 已有素材，但没有「卡」的 schema；`structure_agent` 只给 `mg_dynamic` 描述。
- **怎么做**：新增 `clipwright/animation/shot_cards.py`：`ShotCard{id, style_key, duration_frames, recipe, reference_frames[], pitfalls[]}`；`AnimationMarker` 增 `card_id/style_key/duration_frames`；`animation_agent` 用卡时长替代硬编码 6s；structure prompt 注入卡目录摘要（10–15 张，按知识长片筛选）。
- **成本**：S（先做 8–10 张，不做全库）。
- **风险**：卡与 mg_def 能力不匹配时降级；需要 `validator.py` 支持卡要求的属性。
- **收益**：镜头语言稳定、时长可控、减少「同一镜头每次生成都不一样」。

### 4.3 风格 brief：判据 + 色板 + 禁用项 + 落地方案

- **A 的做法**：`mgstyles/BRIEF-TEMPLATE.md` 固定 8 节；`STYLE.md` 进工程，渲染前按 `engines` 校验；判据是「像不像」的唯一标准。
- **B 的落点**：`mg/config.yaml` 有统一提示词与「华丽技巧/质量红线」；`knowledge_longform.get_mg_style_guidance()` 只有一段话；Persona 给色板/字体。
- **怎么做**：新增 `clipwright/animation/styles/<style_id>.yaml`，字段：`signature`（可检验判据，如「主色占画面 ≤3 种」「落点在 12 栅格」「末帧 hold ≥1s」）、`palette`、`type_scale`、`motion`（缓动/错峰帧数）、`forbidden`；MG prompt 注入该 brief；输出 `mg_def.style_id`；质检用现有 `SignatureTrait` 机制扩展「视觉签名」评分。
- **成本**：M。
- **风险**：判据过严会限制创作；先做 soft（只告警）。
- **收益**：跨镜头风格漂移减少；「知识区长片」可以出 2–3 个可复用风格（学术黑金 / 极简白 / 蓝灰）。

### 4.4 图元 ops + revision（只做后端，不做画布）

- **A 的做法**：`diagram_apply` 结构化 ops、批量 ids、`expectRevision` 冲突即拒写、失败不落盘、`highlight` 不改文档。
- **B 的落点**：`logic_animations` 是「参数 → SVG」的一次性渲染；MG 每次全量重生成。
- **怎么做**：新增 `clipwright/schema/diagram.py`（`Diagram{nodes, edges, layers, revision}`）；动画阶段对 `diagram` marker 先生成 diagram spec，再由渲染器出 SVG；给 Agent 提供 `diagram_apply` 风格的工具（ops + revision + 返回 created/changed/removed）；前端后续再加只读/编辑画布。
- **成本**：M/L（后端 M，前端 L）。
- **风险**：与现有 `diagram_svg.py` 两套图元模型并存，需要一次性收敛。
- **收益**：图表可局部改、可复用、可版本化；「把这张图第三条边改成虚线」这类指令才成立。

### 4.5 位图矢量化 `traceImage`

- **A 的做法**：像素级矢量化（去背→k-means 调色板→连通域轮廓→RDP 简化→SVG path），参数化控制细节与字符预算。
- **B 的落点**：素材只能作为图片 clip；知识长片常需要把论文图/界面截图/架构图做成动效。
- **怎么做**：新增 tool `vectorize_image`（输出 SVG + 元数据：色数/路径数/字符数），接入 material/animation：截图→SVG→作为 `mg_def` 的 image 元素或独立 SVG clip；保留原图做参考。
- **成本**：M。
- **风险**：文字变成路径不可编辑；复杂照片字符数爆炸（需预算与降级）。
- **收益**：知识视频特有素材可动效化，且风格与全片统一。

### 4.6 预览同源：用后端渲精确帧

- **A 的做法**：`motion_preview` 走同一渲染管线出 still，不做前端近似。
- **B 的落点**：前端 `mgRenderer.ts` 近似绘制；后端已有 `/api/animation/preview`（MP4）与 `/preview-html`。
- **怎么做**：加 `POST /api/animation/preview-frame {mg_def, frame, width}` → PNG（复用 hyperframes snapshot），前端在「近似预览」旁提供「精确帧」按钮，质检/视觉 LLM 也用真实帧。
- **成本**：S/M。
- **风险**：每次精确帧要起 Chrome，需缓存（按 mg_def hash）。
- **收益**：消除「预览好看、成片翻车」，并给 4.1 的打样提供判据。

### 4.7 帧检补齐：静止 / 闪烁 / 安全区 / 削波

- **A 的做法**：`motion_qa` 输出帧号 + 镜头号的黑场/静止/闪烁/空白/越界/削波。
- **B 的落点**：`tool/frame_validator.py` 已用 `blackdetect + signalstats` 查黑/白/过曝；缺 freezedetect、闪烁（相邻帧差异）、安全区、削波。
- **怎么做**：在 `frame_validator` 增加 `freezedetect`、相邻帧 `signalstats` 差异阈值判闪烁、按安全区裁边检测越界；输出统一 `reports/qa.json`（clip_id/frame/issue）。
- **成本**：S。
- **风险**：误报（知识视频本来就静态）；阈值需按体裁配置。
- **收益**：知识长片高频问题「静止过长/字出安全区」可自动发现。

### 4.8 内容缓存键

- **A 的做法**：`bundleKey` 覆盖规格、场景源码、素材哈希、入口源码。
- **B 的落点**：生成缓存按 description 文本；渲染无内容键。
- **怎么做**：`hyperframes_renderer` 增加 `render_key = sha256(canonical(mg_def) + assets_sha + font_version + spec)`；命中复用 mp4，用于预览/重跑质检。
- **成本**：M。
- **收益**：重复渲染/质检省时。

## 5. 不该照搬的部分

| A 的设计 | 为什么在 B 会变成负担 | 最小化做法 |
|---|---|---|
| 39MB 的 vendored 上游 demos / mgstyles / 采样 | 体积、许可不清、与 B 的渲染栈不兼容 | 只挑 3–5 张卡与 2–3 个风格，转写成 B 的数据结构，不整仓引入 |
| drawio 兼容层与画布客户端（`mxfile.js` 93KB、`client.js` 486KB） | B 不做「可编辑画布」就不需要 XML 兼容与撤销栈 | 只借 ops/revision/selection 契约，不搬实现 |
| Remotion/TSX 场景作为生产格式 | B 已有 Hyperframes/PIL/ffmpeg 三套渲染；再加一套会让「预览/成片/部署」分裂 | 借「场景=确定性帧函数」的心智模型，不引入 React 运行时 |
| 7 道人工闸门 | B 是全自动产品，每片 7 次审批会杀死体验 | 落成自动检查 + 只在「打样」与「终审」保留人工确认 |
| 「必须读 demo 源码再移植」的强约束 | 依赖上游源码可读、且 B 的 Agent 不写 TSX | 改成「配方 + 参考帧 + 相似度验收」 |

## 6. 如果只做一件事

**做 4.1「先打样 1 镜，再量产」**。

- **改哪些文件**：
  - `clipwright/agents/animation_agent.py`：在批量 marker 循环前挑代表镜（钩子/最高信息密度），先执行单镜生成与渲染。
  - `clipwright/api/animation.py`：复用 `POST /api/animation/preview`；如需精确帧，加 `preview-frame`（4.6）。
  - `clipwright/animation/mg/visual_eval.py`：把单镜打分结果写入 `reports/styleframe.json`。
  - `clipwright/prompts.py` 或 `animation/prompts/types/*`：加「代表镜选择规则」与「打样失败怎么改」的说明。
- **验收标准（可测）**：
  1. 同一知识长片任务，`reports/styleframe.json` 存在，含代表镜 clip_id、评分、问题清单；
  2. 代表镜评分 < 阈值时，该镜最多重做 2 次，且其余镜头**未开始**（事件流可验证）；
  3. 打样通过的整片任务，动画阶段 wall-clock 增加 ≤10%；
  4. 人为构造「代表镜风格不符」用例时，整片动画重生成次数下降 ≥30%（对比基线）；
  5. 不影响非知识类型（默认开关关闭或按类型开启）。
- **工期**：2–4 天（单镜路由 + 报告 + 开关 + 一个 e2e）。

## 7. 附：本报告引用的关键文件

**A（dsh-drawai）**：`README.md`、`docs/diagram-tools.md`、`docs/native-canvas.md`、`docs/motion-video.md`、`docs/motion-video-playbook.md`、`skills/mg-code-video/SKILL.md`、`lib/motion/mgstyles/BRIEF-TEMPLATE.md`、`lib/motion/shotcraft/upstream/references/*`、`docs/design.md`。

**B（ClipWright）**：`clipwright/category/knowledge_longform.py`、`clipwright/agents/animation_agent.py`、`clipwright/animation/mg/{generator,validator}.py`、`clipwright/animation/mg/config.yaml`、`clipwright/animation/catalog.py`、`clipwright/plugins/{diagram_style,logic_animations,pv_engine}`、`clipwright/tool/frame_validator.py`、`clipwright/agents/quality_agent.py`、`src/features/preview/{mgRenderer,mgFidelity,PreviewPanel}.ts*`。
