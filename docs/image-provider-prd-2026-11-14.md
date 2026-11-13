# 图片生成 Provider 化 PRD（含 `ai_*_gen` 系列下架）

> 状态：**待评审，未实施**。基线：Engine `J:/Clipwright@a7d7924`（分支 `ref/zam_plugin_system_optimization`），前端 `J:/Clipweight-Client@8311dab`。本文只描述设计与验收口径，不表示代码已修改。
>
> 本文严格区分两件事：**Engine 对插件的能力接口与宿主职责**（本文要做的）与**插件自身提供的生成能力**（本文只定义契约，不把厂商实现写进 Engine）。

---

## 0. 结论先行

**当前插件层不支持接入 `gpt-images` 这类模型。** 不是"配置没填"，而是三层都缺：

| # | 缺口 | 证据（当前代码） | 后果 |
|---|---|---|---|
| 1 | 没有 `image_provider` 贡献种类 | `clipwright/plugins/contribution.py:22-52` 19 类里无图像生成；`provider_decl.py:36-43` 的 `PROVIDER_KINDS` 只有 llm/tts/stt/embedding/rerank/renderer_backend | 插件无法"声明自己是图像生成 provider" |
| 2 | Provider 配置源与角色不含图像 | `services/provider_sources.py:27` `ROLES=("main","flash","vision","embed","rerank","tts")`；`:30` `SOURCE_KINDS=("llm","embedding","rerank","tts")` | 后台"Provider 源"页面无法为图像生成配 base_url/api_key/model |
| 3 | 无图像生成协议，厂商知识被写死在插件里 | `plugins/ai_image_gen/main.py:102-119` 按 `provider in {volcengine,dalle,flux,local}` 分支；`:184-226` 四个厂商的请求体各自硬编码 | 接一个新的兼容网关必须改插件源码，配置改不了 |
| 4 | 产物落在进程相对目录，不在任务工作区 | `plugins/ai_image_gen/main.py:168-182` 写 `PluginData/assets/`；`plugins/generated_source.py:36-38` 历史也写 `PluginData/plugins/<id>/` | 与"项目一切都在工作区"（`services/workspace.py:1-17`）冲突；项目搬家/归档时不带走产物 |
| 5 | 生成图不进入素材检索链路 | `agents/material_agent.py:454` 只查 `MaterialRegistry.search`；生成图没有对应的工作区素材源 | 主 Agent 生成了图，素材阶段检索不到，只能靠 `generated_image_entries()` 旁路喂给动画阶段（`services/stage_inputs.py:325`） |
| 6 | "插入指定位置"没有面向主 Agent 的受控接口 | `tool/image.py:32-45` 只把图转成片段；`services/intent_apply.py:875-941` 的 `add` 需要调用方自己给 `asset_id` 与位置 | 主 Agent 只能"生成"，不能"按需求放到第 N 段/某个片段之后" |

另外，现有 `ai_*_gen` 三个插件与 Engine 有硬编码耦合（`prompts.py:49`、`services/requirements_service.py:350-379`、`services/capability_matrix.py:79-81`、`tests/clipwright/test_ai_generation_integration.py` 直接 import 插件模块），下架必须一并清理，否则会留下指向空实现的能力宣传。

---

## 1. Problem Statement

创作者想在成片里用上"只有 AI 能画出来"的画面（具体角色、特定品牌、罕见场景、概念视觉），并且希望：

- 用自己已有的模型服务（例如一个 OpenAI 兼容的图片网关，`POST {base_url}/images/generations`），而不是被绑死在某个厂商；
- 换模型/换网关只改配置，不改代码、不重装插件；
- 生成的图自动落进**当前项目的工作区**，能备份、能追溯、能被后续阶段检索到；
- 让主 Agent 按需求把图放到**指定位置**（第 N 个场景、某个片段之后），而不是"生成完就丢在那里"。

当前系统做不到其中任何一条的完整闭环：接入新模型要改插件源码；产物离开工作区；生成图不参与素材检索；主 Agent 无法定点插入。

---

## 2. 边界与不变量（本 PRD 的硬约束）

用户明确要求：**不要让 Engine 承担本该插件提供的功能**。因此先钉死分工，后续所有设计不得越界。

| 职责 | 归属 | 说明 |
|---|---|---|
| 图像生成协议（`generate()` 的形状、能力协商、错误语义） | **Engine** | 与 `LLMProvider`/`TTSProvider` 同级的**契约**，不含任何厂商知识 |
| 具体厂商/网关的请求构造、鉴权头、响应解析、重试前的可重试判定 | **插件** | 新插件 `image_providers` 提供 OpenAI 兼容实现；其它厂商另立插件 |
| Provider 注册、发现、启停、归属、配置 schema 下发 | **Engine** | 已有机制，扩一个种类即可 |
| 配置源与角色（base_url / api_key / model / 默认模型） | **Engine** | `provider_sources` 扩 kind/role |
| 解析模型与尺寸是否合法（能力协商） | **Engine** | 按 provider 声明的 capabilities 判定，不合规**报可读错误**，不静默改尺寸 |
| 产物落盘位置、命名、去重、权限、上限 | **Engine** | 工作区是宿主资产，插件不得决定写哪 |
| 生成账本（谁在什么时候用什么 prompt 生成了什么） | **Engine** | 宿主审计职责 |
| 素材可见性（生成图能否被素材阶段检索） | **Engine** | 工作区扫描属于宿主 |
| "插入到时间线指定位置" | **Engine** | 时间线是宿主数据结构；工具只做受控补丁 |
| 提示词内容策略（怎么描述画面） | **主 Agent（模型）** | 提示词不写在 Engine 里 |
| 费用/配额/并发上限 | **Engine**（策略）+ **插件**（声明） | provider 声明单价/并发；Engine 做闸 |

推论（明确不做）：
- Engine **不得**出现 `if provider == "openai_images"` 之类的厂商分支；
- Engine **不得**内置"文生图"的 HTTP 调用；
- 插件 **不得**自行决定产物路径、不得绕过素材登记、不得直接改 `timeline.json`。

---

## 3. Solution

三层新增，彼此可独立验收：

### 3.1 第一层：`image_provider` 契约（Engine）

- 新增第 20 类贡献 `ContributionKind.IMAGE_PROVIDER = "image_provider"`（契约评审项，名单冻结规则同前 19 类）。
- 加入 `PROVIDER_KINDS`，使其走已有的 provider 校验/登记/展示链路（`api/providers.py:65-95` 的下拉与 `provider_meta` 自动生效）。
- 协议（Engine 定义，插件实现）：

  - `name`：实现名，与 manifest 的 `id` 一致。
  - `default_model() -> str`：未显式配置时的默认模型。
  - `capabilities() -> ImageProviderCapabilities`：`sizes`（支持的尺寸白名单或 `"any"`）、`max_n`、`reference_image`（是否支持图生图）、`seed`、`output_formats`、`max_prompt_chars`、`concurrency`、`cost_per_image_usd`（可空 = 未知，不假装 0）。
  - `async generate(request) -> list[GeneratedImage]`：`request` 含 `prompt / model / size / n / reference_image / seed / extra`；返回每项 `data: bytes | None`、`url: str`、`mime: str`。
  - 可选 `probe() -> bool`：探活（凭证/网络），缺省视为"未声明"。

- 注册时协议符合性校验与 `llm_provider` 同款：缺方法 → 该贡献被拒并给出可读原因（`contribution_dispatch.py:177-184` 的既有模式）。
- `provider_decl.PROVIDER_CAPABILITY_KEYS` 增补图像相关键（`sizes`/`max_n`/`reference_image`/`output_formats`/`cost_per_image_usd`），未知键仍只记录不报错。

### 3.2 第二层：配置源与角色（Engine）

- `SOURCE_KINDS` 增 `"image"`；`ROLES` 增 `"image"`；`ROLE_EXPECTED_KINDS["image"] = ("image",)`。
- 复用现有源结构：`base_url`、`api_keys`（Fernet 加密）、`models[]`、`config{}`（插件声明的 `config_schema` 驱动表单）。
- 后台 Providers 页面新增"图像生成"分页，字段来自 `/api/providers/schemas?kind=image`，**不写死厂商**（遵循 AGENTS.md 第 24 条）。
- 多源并存：允许同时挂两个图像源（例如一个本地 SD、一个云网关），由角色绑定或显式 `source_id` 选择；未绑定则按"启用的源里第一个可用"解析，并在结果里如实回传 `provider/source_id/model`。

### 3.3 第三层：主 Agent 的两个受控工具（Engine 编排，非厂商实现）

**工具 A：`image_generate`（capability = `image_generate`）**

职责只有"编排 + 落盘 + 登记"，不含任何 HTTP：

1. 解析 provider（角色绑定 → 显式 source → 唯一启用源；都没有 → `ToolStatus.NOT_FOUND` 并给可执行提示"去装 image_providers 插件/去配图像源"，不伪造）；
2. 用 provider 的 capabilities 校验 `size/n/reference_image/seed`；超限**报错**并列可用值，不静默改；
3. 调 `provider.generate()`；
4. 把返回值落盘到 `<workspace>/materials/image/`（命名 `gen-<sha256 前 8 位>.<ext>`，内容去重：同 sha 已存在则复用不重写）；
5. 登记进生成账本与工作区素材索引；
6. 返回结构化结果：`path`（工作区绝对路径）、`rel_path`（`materials/image/xxx.png`）、`sha256`、`width/height`、`mime`、`provider`、`source_id`、`model`、`prompt`、`cost_usd`（未知则 `null`）。

关键性质：**可重入**（同 prompt+size+seed+model 命中账本即复用，返回 `reused=true`）；**可 dry-run**（只校验 provider/size/配额，不产生费用）；**失败不留半成品**（先写临时文件后原子替换）。

**工具 B：`timeline_insert_image`（capability = `timeline_insert_image`）**

职责是"把一张已存在的图放到时间线指定位置"，复用既有补丁通道而不是另造一套：

- 输入：`project_id`/`task_id`、`asset_ref`（`rel_path` 或 `asset_id`）、`position`（`start` / `end` / `after:<clip_id>` / `at:<sec>`）、`duration_sec`、`motion`（`still` / `ken_burns`）、`fit`（`contain`/`cover`）、可选 `track_id`。
- 行为：先按 `intent_apply` 的 `add` 补丁做 dry-run（校验素材真实存在、时长合法、位置可解析、重叠告警），通过后 apply；写回项目时间线的路径与现有增量回写一致（`services/task_project_sync.py`）。
- 与 `image_clip` 的关系：`still/ken_burns` 的片段生成复用内置 `image_to_clip`（`tool/image.py:37` 已声明 `capability="image_clip"`，可被插件接管），`timeline_insert_image` 只负责"放到哪"，不重复实现转码。
- 失败语义：素材不存在 → `error`（不新增幽灵片段）；位置解析失败 → `refused` 并列出可选锚点；与既有片段重叠 → 默认**允许并告警**（与 `intent_apply._add_clip` 现有行为一致），不静默移动别人的片段。

### 3.4 产物可见性（让素材阶段真的能用上）

- 新模块 `services/workspace_materials.py`：把 `<workspace>/materials/**` 映射成与 `MaterialAsset` 同形的可检索结果（文件名 + 生成 prompt 分词）。
- `MaterialAgent` 检索时合并"注册表源"与"工作区素材"，来源字段标明 `workspace`；这样生成图与用户手放素材走同一条路（`material_agent.py:454`）。
- 生成账本按 `project_id` 分桶（不再是 `PluginData/plugins/<id>/generated.json`），历史条目保持兼容读取：旧路径存在时只读迁移提示，不自动删用户数据。

### 3.5 提示词与能力宣传（不写死工具名）

- `prompts.py:49` 里按名字点名 `ai_image_generate` / `ai_video_generate` 的段落改为**能力口径**："若 function schemas 里存在 `image_generate` 就可用；生成后把结果路径用于对应场景"，不出现具体工具名。
- `services/requirements_service.py:350-379` 的 `_AI_GEN_TOOLS` 改为按 `image_generate` 的可用性生成概览，不再硬编码三个工具名；`ai_video/music` 移除后概览不得再宣传这两项能力。
- `services/capability_matrix.py:79-81` 的 `OPTIONAL_PLUGIN_TOOLS` 移除三个旧工具名，`TIER_MAP` 继续为空（AGENTS.md 第 12 条）。

### 3.6 `ai_*_gen` 下架清单

| 项 | 动作 | 备注 |
|---|---|---|
| `plugins/ai_image_gen/` | 删除 | 由 `image_providers` + `image_generate` 取代 |
| `plugins/ai_music_gen/`、`plugins/ai_video_gen/` | 删除 | **能力暂时缺失**（见风险 R1），提示词/概览同步去掉宣传 |
| 三个 `ui.json` legacy 面板 | 随目录删除 | `/contributions` 将不再合成这三个 legacy 槽 |
| `services/capability_matrix.py:79-81` | 移除三行 | |
| `services/requirements_service.py:350-379` | 重写为能力口径 | |
| `clipwright/prompts.py:49` | 重写为能力口径 | 不点名工具 |
| `tests/clipwright/test_ai_generation_integration.py` | 删除，另立新测试 | 现文件直接 `import ai_image_gen.main`，必然红 |
| `plugins/generated_source.py` | 迁到 `services/generated_assets.py` | 由 Engine 持有；`stage_inputs.py:316`、`requirements_service.py:1859` 改导入 |
| 历史生成物（`PluginData/assets/*`、`generated.json`） | **保留只读** | 不删用户文件；账本迁移时提供一次性索引提示 |
| 文档引用（`docs/ai-generation-integration-plan.md`、插件作者指南） | 标注"已下架，见本文" | 不静默留死链 |

---

## 4. User Stories

1. 作为创作者，我想把自己的 OpenAI 兼容图片网关填进"Provider 源"，这样不用改代码就能换模型。
2. 作为创作者，我想在后台看到"图像生成"这一类源，并能选默认模型，这样主 Agent 不必每次猜模型名。
3. 作为插件作者，我想只实现 `generate()` 与 `capabilities()`，这样我的厂商插件不需要关心文件落在哪、怎么登记。
4. 作为插件作者，我想让 Engine 在注册时告诉我"缺 `default_model`"，这样我不用等到运行期才踩 `AttributeError`。
5. 作为创作者，我想让主 Agent 判断"这个场景图库大概率命不中"，然后自己决定生成，这样我不用手动描述每一张图。
6. 作为创作者，我想让生成的图直接出现在项目工作区 `materials/image/` 下，这样项目备份/归档能带走它。
7. 作为创作者，我想让生成图在素材阶段能被检索到，这样它会被正常编入时间线，而不是被旁路塞进动画阶段。
8. 作为创作者，我想让主 Agent 把图插到"第 3 个场景之后"，这样我能控制叙事顺序。
9. 作为创作者，我想在插入前看到"会新增哪个片段、落在第几秒、与谁重叠"，这样我能在不满意时拒绝。
10. 作为创作者，我想要相同的 prompt+参数重复调用时不重复计费，这样重试不会白花钱。
11. 作为创作者，我想在不配置任何图像源时，系统明确告诉我"没有可用的图像 provider"，而不是假装生成成功返回空路径。
12. 作为创作者，我想让生成失败的半成品不留在工作区，这样素材列表不会出现 0 字节的坏图。
13. 作为运维者，我想看到每次生成用了哪个 source/provider/model、花了多少钱（未知则明确未知），这样账单可追溯。
14. 作为运维者，我想给图像生成设并发与单次上限，这样一次误操作不会把配额打爆。
15. 作为运维者，我想让 provider 的密钥走既有加密与掩码通道，这样后台不会回显明文。
16. 作为前端开发者，我想让"图像生成"表单由 `/api/providers/schemas?kind=image` 驱动，这样新增厂商不需要改前端。
17. 作为前端开发者，我想让未安装 `image_providers` 时下拉显示"（未安装）"，而不是给一个点了报错的选项。
18. 作为维护者，我想让 `ai_*_gen` 三个插件被彻底移除且没有悬空引用，这样代码库里不再有"宣传了但不存在"的能力。
19. 作为维护者，我想让旧生成物只读保留，这样用户历史作品不会因为一次下架而丢失。
20. 作为维护者，我想让 capability 名（`image_generate` / `timeline_insert_image`）稳定，这样插件可以接管实现而不改 Agent 代码。
21. 作为主 Agent，我想通过能力名而不是工具名调用，这样插件换实现时我不受影响。
22. 作为主 Agent，我想在插入失败时拿到"可选锚点列表"，这样我能自己改正而不是重试同一个错。
23. 作为创作者，我想让 `ken_burns` 这类简单运动成为可选参数，这样静态图不会显得死板。
24. 作为创作者，我想让同一张图被多次插入时复用同一个文件，这样工作区不会堆重复素材。
25. 作为质检者，我想让插入的片段带 `metadata.source=generated` 与 prompt 摘要，这样后续能追溯来源。

---

## 5. Implementation Decisions

### 5.1 模块与接口

| 模块 | 动作 | 说明 |
|---|---|---|
| `providers/base.py` | 新增 `ImageProvider` 协议 + `ImageProviderCapabilities` + `missing_image_provider_methods()` | 与 `LLMProvider` 同级；缺方法给可读错误 |
| `plugins/contribution.py` | 新增 `IMAGE_PROVIDER` 枚举值 | 第 20 类，需契约评审 |
| `plugins/provider_decl.py` | `PROVIDER_KINDS` 增 `image_provider`；能力键增图像项 | 复用既有校验 |
| `plugins/contribution_dispatch.py` | 增加 image_provider 的协议校验分支 | 与 llm 分支同形 |
| `plugins/override_policy.py` | `OVERRIDABLE_KINDS` 增 `image_provider` | 当前无内置可覆盖，表不加项 |
| `services/provider_sources.py` | `SOURCE_KINDS` 增 `image`；`ROLES` 增 `image`；映射表补项 | 复用加密/掩码/模型清单 |
| `services/image_generation.py`（新） | `ImageGenerationService.generate()`：解析 provider → 校验 → 调用 → 落盘 → 登记；返回 `GenerationResult` | **深模块**，可单测；无 HTTP |
| `services/workspace_materials.py`（新） | `search_workspace_materials()`：工作区素材 → `MaterialAsset` 同形 | 宿主职责 |
| `services/generated_assets.py`（由 `plugins/generated_source.py` 迁入） | 账本读写 + `image_entries(project_id)` | 按 project 分桶，兼容旧路径只读 |
| `tool/image_generate.py`（新） | `ImageGenerateTool`，`capability="image_generate"`，`permission_tier="costly"` | 薄包装，只调 service |
| `tool/timeline_insert_image.py`（新） | `ImageInsertTool`，`capability="timeline_insert_image"` | 走 `intent_apply` 补丁 |
| `tool/surface.py` | 两个新工具进工具面；`workspace_root`/`project_id` 自动注入沿用现有逻辑 | 见 `surface.py:888-902` |
| `agents/material_agent.py` | 检索结果合并工作区素材 | 一处合并，不新增分支逻辑 |
| `plugins/image_providers/`（新插件） | OpenAI 兼容实现（`/images/generations`），`config_schema` 含 `base_url`/`api_key`/`model`/`size` 映射 | **厂商知识只在这里**；支持 `b64_json` 与 `url` 两种响应 |

### 5.2 契约细节（Engine 侧）

- 尺寸：provider 声明 `sizes` 为白名单时，Engine 只接受其中值；声明 `"any"` 时接受 `WxH` 且做像素区间与偶数校验（区间由 provider 声明 `min_pixels`/`max_pixels`，未声明则只做 `64..4096` 的通用上限）。
- `n`：超 `max_n` 直接报错，不截断。
- 参考图：`reference_image` 为 false 时传了就报错（不静默忽略，避免"以为做了图生图"）。
- 费用：`cost_per_image_usd` 未知时结果里 `cost_usd=null`，账本记 `null`，统计口径标"未知"，绝不记 0。
- 超时：单次调用默认 120s，可被源配置覆盖；超时视为失败并保留账本错误条目。
- 并发：按 `concurrency` 做进程内信号量；超过则排队并记录等待时长。
- 幂等：`(source_id, model, prompt, size, n, seed, reference_sha)` 计算键，命中账本且文件仍存在 → `reused=true`，不再调用 provider。
- 安全：`url` 响应下载前必须 `assert_public_url`（复用现有 SSRF 防护）；只接受 `image/*`，拒绝 SVG（脚本面）。

### 5.3 API 与前端

- `GET /api/providers` 的 `role_kinds` 增 `image`；`provider_meta` 自动带出新 provider 的展示名。
- `GET /api/providers/schemas?kind=image` 返回插件声明；前端 Providers 页新增"图像生成"分页，纯 schema 驱动。
- 不新增"生成图片"的 REST 端点给插件调用：生成只走主 Agent 工具面（避免插件绕过工作区与账本）。
- 前端导出/编辑器不新增面板；生成结果通过既有素材库可见。

### 5.4 主 Agent 提示词与决策边界

- 判断"要不要生成"交给模型（AGENTS.md 第 19 条）；Engine 只提供能力与约束，不写"必须生成"。
- 提示词要求：先查/先判断素材库命中率，再决定生成；生成后必须把 `rel_path` 用于对应场景；插入必须给明确位置。
- 收口期（closeout）不放开 `image_generate`（costly），避免收尾阶段继续花钱。

### 5.5 下架与兼容

- 删除三个插件目录后，`/api/plugin/contributions` 不再合成对应 legacy ui_slot；前端无需改动（Slot 会自动少一项）。
- 旧账本：新账本 `services/generated_assets.py` 在读取时若发现旧 `PluginData/plugins/ai_image_gen/generated.json`，按只读方式并入并标注 `legacy=true`，不写回、不删除。
- 旧产物文件保留在原处；新流程不引用它们，用户可在素材库手动迁移。

---

## 6. Testing Decisions

好测试只断言**外部行为**：给什么输入、产生什么文件/时间线/错误码，不断言内部调用顺序。

| 被测模块 | 测试类型 | 关键用例 |
|---|---|---|
| `ImageProvider` 注册校验 | 单元 | 缺 `generate`/`default_model` → 贡献被拒且错误可读；合法 provider → 出现在 `/api/providers` 与 schemas |
| `ImageGenerationService` | 单元 + 假 provider | 未配置 → `NOT_FOUND` 带指引；size 超限 → 报错并列可用值；`n` 超限不截断；`cost=null` 不被记成 0 |
| 落盘与去重 | 集成（临时工作区） | 产物落在 `materials/image/`；同 sha 第二次不重写；失败不留临时文件 |
| 幂等复用 | 单元 | 同键第二次 `reused=true` 且 provider 调用次数不增 |
| `image_generate` 工具 | 契约 | 未注入 `workspace_root` 时给可读错误；dry-run 不产生文件与费用 |
| `timeline_insert_image` | 集成 | `after:<clip_id>` 落在正确起点；素材不存在 → `error` 不新增片段；重叠 → 告警但成功 |
| 工作区素材可见性 | 集成 | 生成后 `MaterialAgent` 检索命中，`source=workspace` |
| 下架完整性 | 静态 | 仓库内无 `ai_image_gen`/`ai_music_gen`/`ai_video_gen` 引用（除历史文档与只读账本迁移） |
| 提示词 | 快照 | `prompts.py` 不再出现三个旧工具名；能力口径文案存在 |

优先接近既有测试风格：`tests/clipwright/test_plugin_hardening_round2.py`（真实 loader + 临时目录）、`tests/clipwright/test_plugin_proxy_contribution_id.py`（正例 + 负例成对）。

---

## 7. 验收标准

1. 安装 `image_providers` 插件、在后台配置一个 OpenAI 兼容源后，主 Agent 能在工具面看到 `image_generate`。
2. 一次真实生成产出文件位于 `<workspace>/materials/image/`，`sha256` 与账本条目一致，`/api/plugin/contributions` 无新增噪音。
3. 同参数重复调用返回 `reused=true`，provider 调用次数不增加。
4. 素材阶段无需任何旁路即可检索到该图，并把它编入时间线。
5. `timeline_insert_image` 能把指定图插到 `after:<clip_id>` 与 `at:<sec>` 两种位置，重叠时有告警、无静默移位。
6. 未配置源、尺寸非法、`n` 超限、参考图不支持四种情况均返回可执行错误，不产生文件。
7. 删除三个 `ai_*_gen` 目录后，全量后端插件测试与前端 `tsc`/`vitest` 通过；仓库内无悬空引用。
8. `TIER_MAP` 仍为空；Engine 代码中无厂商名分支（可用静态检查断言 `grep` 无 `volcengine|dalle|flux|suno` 于 `clipwright/`）。

---

## 8. Out of Scope

- 视频生成与音乐生成的 provider 化（`ai_video_gen`/`ai_music_gen` 移除后能力缺失，见 R1；另行立 PRD）。
- 图像编辑/局部重绘/inpaint（只做文生图 + 可选参考图）。
- 多图排版、批量导入、图库市场。
- 计费结算与账单对账（只记录成本字段）。
- 前端新增"AI 生成"面板（生成走对话，结果走素材库）。
- 把 `image_to_clip` 的转码逻辑重写（继续复用）。

---

## 9. 风险与开放问题

- **R1（能力缺失）**：移除 `ai_music_gen`/`ai_video_gen` 后，系统不再具备音乐/视频生成。若产品仍需要，必须先做同类 provider 化，否则提示词与需求概览不得再承诺。**需产品确认**：是"彻底放弃"还是"先下架、后 provider 化"。
- **R2（工作区素材检索成本）**：每次素材检索都扫 `materials/` 可能变慢；建议按目录 mtime 缓存（与 `LocalFolderSource.refresh` 同思路），需在实施时量化。
- **R3（插入与 EditAgent 并发）**：主 Agent 直接改时间线可能与阶段产物冲突；本 PRD 采用"补丁 + 时间线版本校验"（写入前比对 `timeline.json` 的修订号，不一致则拒绝并提示重试）。
- **R4（尺寸方言）**：不同网关对 `size` 接受 `1024x1024` 或 `auto`；由 provider 声明 `size_dialect`，Engine 只做透传与白名单，不猜。
- **开放问题 Q1**：图像源是否需要"按场景自动选模型"（便宜模型打草稿、贵模型出终稿）？本 PRD 只支持显式模型，避免隐式费用放大。
- **开放问题 Q2**：是否允许插件贡献 `image_generate` 同名 capability 接管？建议允许（与 `image_clip` 同机制），但需在接管时保留 Engine 的落盘/账本语义。

---

## 10. 附录：接入一个 OpenAI 兼容图片网关（示例，不含任何密钥）

前提：该网关实现 `POST {base_url}/images/generations`，请求 `{model, prompt, size, n, response_format}`，响应 `{data:[{url}|{b64_json}]}`。

1. 后台 → Providers → 图像生成 → 新建源：`kind=image`、`provider=openai_images`、`base_url=<你的网关>`、`api_key=<你的密钥>`、`models=[gpt-image-1]`。
2. 插件 `image_providers` 的 `config_schema` 提供上述字段（`api_key` 标 `secret: true`）。
3. 主 Agent 调用 `image_generate(prompt=..., size=1024x1024, model=gpt-image-1)`；Engine 落盘 → 返回 `rel_path`。
4. 主 Agent 调用 `timeline_insert_image(asset_ref=<rel_path>, position="after:clip_07", duration_sec=4, motion="ken_burns")`。

测试环境建议使用独立的测试源与小额配额；**不要把密钥写进仓库、测试或文档**，只在后台源配置里填写。
