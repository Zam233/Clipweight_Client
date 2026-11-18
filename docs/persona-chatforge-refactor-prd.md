# Clipwright Persona ChatForge 重构 PRD

- 状态：待评审
- 范围：前端 `J:\Clipweight-Client` 与后端 `J:\Clipwright` 的 Persona 创建、查看、编辑链路
- 依据：2026-11-18 阅读本文件末尾所列源码；本文只描述代码可证实的现状，新增契约均标注为**拟议**，实施前需同步 OpenAPI、前端类型及测试。

## 1. 背景与现状

Persona 的权威数据为后端 `PersonaManifest`：`parameter` 六维参数、`prompt`、`vision_prompt`、`knowledge`，以及可选的继承/示例/嵌入/模型层。后端规范字段是 `max_sentence_len`、`base_shot_duration_ms`、`primary_color`、`target_loudness_lufs`、`require_source_citation` 等；前端视图使用另一套字段及秒单位，已有 `personaFromBackend` / `buildUpdatePayload` 转换。不能把前端 `Persona` 类型直接当作后端请求 schema。

当前入口 `/persona` 复用 `PersonaGalleryPanel`，卡片点击在独立页进入 `/persona/$personaId`，在带 `onPick` 的创作表单中则是“选中”；“对话创建”和“新建人格”均进入 `/persona/forge`。创建页有对话、从提示词、从脚本、引导问答四种模式，但没有真正的“手动填写参数+Prompt”创建流程。从提示词/脚本/问答的生成端点直接保存 manifest，生成结果未提供统一提交前确认。

对话模式已有 `start`、同步/POST SSE 消息、知识文本导入、会话列表/状态/删除、commit；图片及文件随消息以 data URL 发送。前端单文件 6 MiB、单消息 4 个附件；后端只校验类型标记、数量 4、`data_url` 字符数至多 8 MiB，未验证 MIME 与真实内容。图片仅在视觉能力启用且分析成功时以分析文本进入 LLM，未启用时只提示附图；普通文件仅作占位，不解析正文。参考文档 `.md/.txt` 是另一条“读取文本→`/knowledge`”路径。后端把原始 data URL 和派生文本一起落到 `chatforge_sessions/*.json`，没有独立附件仓库或限时清理。

会话启动返回六维默认草稿；`GET /state/{session_id}` 仅返回计数、草稿、时间，不返回对话消息或 Prompt。服务启动只恢复最近 1 小时内的 JSON 会话，内存过期也为 1 小时；磁盘过期文件未因内存清理自动删除。前端 localStorage 仅记最后 session ID，恢复后展示一条“已恢复”摘要，不能重显对话；切换会话会清空原消息。同步 `_process` 成功时追加助手消息后不再 `_persist_session`，重启后可能丢失该回复；流式路径在 `done` 后落盘，但异常中断时可能已记用户消息/部分助手回复。未知 session ID 在服务层 `_get_or_create_session` 中会被隐式创建，API 层所谓 404 并不可靠。

ChatForge 的六维草稿在消息时更新，`prompt` 与 `vision_prompt` 却到 `commit` 才从用户消息拼接生成，前者是原话列表而非经审核的完整行为指令，后者按关键词筛选；对话中没有可确认/编辑的最终 Prompt。`_merge_draft` 跳过假值，无法通过对话将数值改为 0、布尔值改为 false 或清空字段。`commit` 默认 ID 为 `chat_<session_id>`，现有实现没有防同 ID 覆盖或提交幂等检查；`vision_prompt.md` 有 no-clobber 保护，而 `prompt.md` 在有文本时会被写入。前端提交按钮的 40% 阈值来自进度展示，不等同 schema 校验；前端网络失败后还有离线模拟进度，可能产生不能真正保存的草稿。

详情页当前打开即编辑六维参数、Prompt、视觉 Prompt；Prompt 有独立保存按钮，页面底部“保存人格”又通过整份 `PUT /api/persona/{id}` 保存参数与 Prompt。该 PUT 是整份 manifest 替换，前端尝试重新取 raw manifest 保留未知字段，但 raw 请求失败后仍可用不完整数据覆盖；不同按钮还可能互相覆盖新值。详情读取失败会构造可编辑 shell，造成“看似有内容”的误导。版本页仅显示当前版本及“暂无历史版本记录”，不是 Prompt 历史。图库后端失败时展示演示 Persona，需要与真实库清晰隔离。

## 2. 目标与成功标准

1. 对话创建：文本、图片、受支持的附件共同构建 Persona；在**提交前**展示经后端校验的完整六维参数、系统 Prompt 和视觉 Prompt（可以为空但必须显式标明），用户可以修正并确认，再一次性保存，返回可访问的 Persona ID。
2. 手动创建：无需模型即可输入完整参数和系统 Prompt（视觉 Prompt 可选），保存后重新打开所得值与填写值一致，未知/高级字段不丢失。
3. 查看/编辑：在 `/persona` 点击人格先进入只读详情，能查看全部参数、系统 Prompt 与视觉 Prompt；显式点击“编辑”才进入编辑态，保存后刷新可复核，取消不写入。
4. 可靠性：刷新/重启后恢复会话消息、草稿与附件元信息；失败不伪造成功；重复提交不生成两份或覆盖原 Persona；有冲突时提示选择而不是静默覆盖。
5. 验收以真实后端、持久化文件与页面重新读取为准，不能靠 demo、离线模拟或只检查按钮状态通过。

## 3. 非目标

- 不重做四层 Persona 的示例/嵌入/模型训练及 RAG 检索算法；知识库仅保证既有文档链路与新附件链路边界清晰。
- 不保证通用附件（如 PDF、Office、音视频）均可被理解；一期只支持服务器验证并能提取内容的格式，其他格式明确拒绝或仅附存为资料，不能宣称模型已读取。
- 不修改全局 Prompt 覆盖顺序（全局 `prompts.py` < Category < Persona < Skill < 插件），也不把聊天系统提示词等同于 Persona 的 `prompt.md`。
- 不建设账号注册/云同步/跨设备分享；当前项目本地令牌环境下的 owner 兼容与未来多用户隔离仍须设计和测试。
- 不把现有 `from-prompt`、`from-script`、`dialogue` 端点删除；先保留既有用户入口，再统一其生成结果进入可审核详情。

## 4. 用户流程与交互

### 4.1 对话创建

1. 用户在图库选“对话创建”；服务成功启动后记录 session ID，显示可恢复的消息列表。首次启动失败则保留输入并给重试，不使用虚构的离线进度。
2. 用户发送文本及图片/文件；选择文件时展示类型、大小、数量校验；上传/解析/视觉分析状态明确区分“已收到”“已解析”“未解析”“失败”。发送失败保留输入与待发送附件。消息有稳定 ID、发送状态与重试操作。
3. 每次模型回复后更新参数草稿、缺失维度、Prompt 草稿及来源/手动覆盖标志；右栏可查看**全部六维字段**及两类 Prompt，0、false 与清空操作可准确应用。流式展示自然语言，只有后端有效的 `done` 才接受结构化结果；错误时标记失败，不自动重发已落库的请求。
4. 用户进入“预览并确认”：将当前草稿编译、校验并显示默认值/推断值/用户确认值；允许修正参数与 Prompt；不能仅凭进度达到 40% 放行无效内容。
5. 提交时按版本/幂等令牌执行；成功返回 manifest 并导航至只读详情。保存失败保留会话及编辑草稿，重试不会覆盖既有 ID。

### 4.2 手动创建

从“新建人格”进入创建方式选择，默认可选“手动填写”；表单分六维参数、系统 Prompt、视觉 Prompt（可选），基础字段可视化、高级字段可在结构化编辑区查看/编辑；预览显示后端规范字段与转换后的单位。提交前校验 ID、名称、时长上下界、数值范围、颜色、数组/映射类型和 Prompt 长度；后端再次验证。若 ID 已存在显示冲突，不自动改 ID 或覆盖。

### 4.3 查看与编辑

图库卡片点击进入只读详情；`onPick` 场景仍保持选择语义，并提供独立的“查看详情”可达路径。详情并列查看六维参数、系统 Prompt、视觉 Prompt、版本与来源；缺失参数用“未设置”而非合成默认值冒充已保存值。点“编辑”后以服务端快照开始工作副本，显示未保存状态；“保存”统一提交变更并重新获取服务端值；“取消”丢弃当前工作副本（离开前确认）。Prompt 快捷单独保存与整份保存若共存，须共享同一更新/冲突策略，禁止陈旧快照回写覆盖。

## 5. 数据模型与校验

权威结构继续使用 `PersonaManifest`（`persona_id`、`persona_name`、`version`、`owner_id`、`parameter`、`prompt`、`vision_prompt`、`knowledge` 等）；`parameter` 为 `ParameterLayer` 六维，后端已有 Pydantic 范围限制：语言密度/比例 0..1、镜头毫秒数为空或 >=100、主/强调/背景色 `#RRGGBB`、响度 -30..-10 LUFS、最大时长 >0、最小时长 >=0。新增跨字段校验 `min_duration_sec <= max_duration_sec`，ID 使用 repository 的 `validate_id`，服务端不要依赖前端的 UI 范围。`None` 镜头时长表示由类型插件档位决定，不能替换为 UI 默认 6 秒。所有保存都保持非 UI 字段、`knowledge`、`inherits`、`owner_id` 原值；顶层/参数层 `persona_id` 必须一致，不允许编辑时偷换 ID。

**拟议会话存储模型**：`session_id`、`owner_id`、`status`（active/committed/expired）、`revision`、`messages[{id,role,content,created_at,status,attachment_ids}]`、`persona_draft`（规范字段）、`prompt_draft`、`vision_prompt_draft`、`field_sources`（user/model/default/manual）、`missing_dimensions`、`progress`、`attachments[{id,name,detected_mime,size,sha256,analysis_status,storage_ref}]`、`created_at/updated_at/committed_persona_id`。此为新增设计，并非当前 `GET /state` 已返回的形状。模型产物只作为候选值，Pydantic 校验成功后才进入权威草稿；失败返回字段错误而不是静默回退默认值。

**拟议并发字段**：Persona 资源 `revision`/ETag（与现有展示版号 `version` 分离），会话独立 revision；每次成功保存递增，不以客户端时间或 `version` 字符串推断并发次序。Prompt 版本至少保存修订号、修改时间、来源（generated/manual）、摘要和可回退快照；不能把当前版本页的单个 v1.0.0 当作历史记录。

## 6. API 契约

### 6.1 已存在且须保持兼容

| 方法与路径 | 现有请求/响应要点 | 限制 |
| --- | --- | --- |
| `POST /api/persona/forge/chat/start` | `{persona_id?:string,scope?:string,context?:object}` → `session_id,reply,persona_draft,missing_dimensions,progress`；`scope/context` 在路由响应附加 | 服务 `start()` 不持久化 scope/context，也不产生模型回复 |
| `POST /api/persona/forge/chat/message` | `{session_id,message,persona_id?,attachments?:[{type,name,mime,data_url}]}` → `reply,persona_draft,missing_dimensions,progress` | 同步助手消息未可靠二次落盘；无幂等键 |
| `POST /api/persona/forge/chat/message/stream` | 同请求，POST SSE `delta{text}`、`done{session_id,reply,persona_draft,missing_dimensions,progress}`、`error{detail,partial}` | error 是 SSE 事件，不等于 HTTP 失败；不得将已接收请求盲目重发 |
| `GET /api/persona/forge/chat/sessions?scope=mine` | `{sessions:[{session_id,title,message_count,knowledge_count,owner_id,created_at,updated_at,progress,draft_summary}],total}` | 服务仅列当前未过期内存会话，当前 token/off 环境 mine/all 无用户区分 |
| `GET /api/persona/forge/chat/state/{session_id}` | `session_id,message_count,persona_draft,knowledge_base_count,created_at,updated_at` | 不含 messages、Prompt 草稿或附件元信息 |
| `DELETE /api/persona/forge/chat/sessions/{session_id}` | `{deleted:true,session_id}` | 现有路由没有 owner 检查 |
| `POST /api/persona/forge/chat/knowledge` 及 `/knowledge/{session_id}[/{kb_id}]` | 文本导入及知识列表/详情/更新/删除；更新不触发模型重分析 | 与消息附件不是一套资料存储 |
| `POST /api/persona/forge/chat/commit` | `{session_id,persona_id?,persona_name?}` → `PersonaManifest` | 现有服务可能重建/覆盖同 ID，Prompt 到提交时才拼装 |
| `GET /api/persona/list`、`GET /api/persona/{id}` | 分别返回 ID 数组与 `PersonaManifest` | ID 列表未按 owner 过滤，单条读取已有 `enforce_owner` |
| `POST /api/persona/create`、`PUT /api/persona/{id}` | 请求/响应均为完整 `PersonaManifest`；POST 冲突 409；PUT 整体替换 | 可复用手动创建；PUT 需先解决未知字段保留/并发风险 |
| `GET/PUT /api/persona/{id}/prompt`、`/vision-prompt` | GET 返回文本，PUT 分别接受 `{prompt}` / `{vision_prompt}` | 两种 PUT 目前都无 revision 条件；视觉文件的 manifest 写入走 no-clobber |
| `POST /api/persona/forge/from-prompt`、`/from-script`、`/dialogue/generate-questions`、`/dialogue/build` | 已存在的生成方式 | 生成/构建路由会直接保存 manifest，不是手动创建 API |

### 6.2 拟新增/拟变更（**当前不存在，路径和细节须经接口评审**）

1. **拟新增** `GET /api/persona/forge/chat/sessions/{session_id}`：分页返回可展示的真实消息、六维规范草稿、Prompt 草稿、缺失维度、附件元信息/可访问预览、会话 revision/status；`?cursor=&limit=` 支持增量恢复；服务端对未知/过期会话返回 404/410，不隐式新建。若选择扩展现有 `state`，必须版本化并保证旧客户端字段兼容。
2. **拟新增** `PATCH /api/persona/forge/chat/sessions/{session_id}/draft`：以 `{expected_revision,parameter_patch,prompt_draft?,vision_prompt_draft?}` 更新人工修订；只接收白名单可写字段，显式 `null`/0/false/空值遵照字段 schema 处理；返回验证后的草稿、字段错误及新 revision。消息端点同步/流式增加 `client_message_id` 去重与 `revision`，相同 ID 重试返回同一结果，冲突为 409。
3. **拟变更** `POST .../commit`：请求增加 `expected_revision`、`idempotency_key`、最终确认的规范 `parameter`、`prompt`、`vision_prompt` 或引用已持久化的草稿 revision；服务端先校验真实 session、owner、字段与 ID 未占用，再原子保存并记录 `committed_persona_id`。同 key 重试返回原 manifest；不同 key 且 ID 已存在返回 409，**绝不覆盖**。原字段请求兼容期内继续可用，但内部走同一安全提交逻辑。
4. **拟变更** `PUT /api/persona/{id}`（或另加 PATCH，经接口评审二选一）：要求 `If-Match`/`expected_revision`；服务端读取最新 manifest 并合并允许编辑的字段，校验 ID/owner 不变，持久化参数与两类 Prompt 后返回最新 manifest、revision。若仍保留全量 PUT，则 raw 读取失败必须禁止提交，且明确 Prompt 独立 PUT 的优先关系；冲突 409/412 返回当前 revision 供用户手工合并。`GET /api/persona/{id}` 暴露对应 revision/ETag。
5. **拟新增** 附件上传及受控读取契约（具体路径待评审）：二进制分片/受限上传返回 `attachment_id`、检测 MIME、大小、SHA256、解析状态；消息只引用已归属当前会话的 ID。禁止把客户端任意路径或远程 URL 当作服务端读取源。旧 data URL 消息契约暂保留，阶段性拒绝超限并引导新接口。
6. 统一错误格式建议 `{code,message,field_errors?,retryable?,current_revision?}`：400 非法附件/无效字段、401/403 授权失败、404 不存在、409 重复 ID 或 revision 冲突、410 过期、413 体积超限、422 schema 错误、429 限流、5xx 服务端/模型异常；SSE 必须在 `error` 中携带稳定 code 与请求/消息 ID。以上为拟定目标，不表示现有服务已实现这些状态。

## 7. 前端改造

- `PersonaGalleryPanel`：区分“对话创建”“手动创建”；成功/失败/空库单独呈现，演示数据禁止进入可保存的真实编辑链路；独立页卡片默认查看，`onPick` 时为选择保留可达的详情命令。
- `PersonaForgePage`：把会话、历史、附件队列、六维参数、Prompt 草稿和确认步骤拆成可测试的功能组件；统一模型回复/手动修订状态；删除前端随机模拟成功；恢复真实消息与附件状态；切换会话中止旧异步回包、恢复新会话快照。失败后重试遵循 message ID，而不是自动把已落盘的流再发一次。
- 新建手动表单复用详情的参数控件和同一 schema 映射，直接提交符合后端规范的完整 `PersonaManifest` 到既有 `/create`；提供包括 `cut_profile`、`palette`、`bgm_slots`、`forbidden_topics` 等高级字段的可读编辑能力，避免只展示 UI 子集却承诺“完整参数”。
- `PersonaDetailPage`：只读/编辑显式切换；读取失败显示 404/权限/网络错误和重试，移除可保存 shell；编辑以服务端快照和 revision 为基，统一保存后重新获取，保留未映射字段和空值语义。Prompt、视觉 Prompt、参数均显示来源和变更状态；离开前提醒未保存内容。
- `src/types/persona.ts` / API 客户端：规范 DTO 与 UI view model 分层，运行时对模型/接口数据做结构校验，保证字段 round-trip；对缺失 `parameter` 的遗留 Persona 展示只读缺失提示或显式初始化，不直接假设六维对象都存在。模型/接口文本渲染走现有 `asText`/`textList` 边界。

## 8. 后端改造与安全

- 会话服务：将消息、草稿、Prompt 草稿、状态、revision 在同一成功转移中持久化；用稳定消息 ID 与幂等键区分发送/重试/中断；同一 session 的生成、手动改稿、commit 串行化或乐观并发校验。禁止未知 session 隐式创建；恢复策略明确 TTL 起点、保留期与磁盘 GC，过期用户能得到可解释的状态。
- 附件：服务端校验文件头、MIME、扩展名、解码后真实字节数及累计会话配额；允许列表建议首期 PNG/JPEG/WebP + UTF-8 TXT/MD/JSON，是否支持 PDF 等另行评审。图片重编码/像素限制以防解压炸弹；文本限大小与编码、拒绝脚本/可执行文件和路径穿越；病毒扫描能力可用时接入，未扫描标识风险；不信任文件名和附件内容中的指令。原件存受控目录，按 ID 引用、SHA256 去重、权限检查、清理 TTL、日志脱敏，不能继续把整张图的 Base64 写入 JSON 与每轮 LLM 历史。旧 data URL 迁移须限额且不重复引用。
- Prompt 生成：对话中持续形成“系统 Prompt 草稿”和可选“视觉需求 Prompt 草稿”，经参数一致性校验与用户确认后写入；将用户引用/模型建议/人工编辑分开，附件提取文本仅是低信任素材，防 Prompt 注入和秘密泄漏。已有 Prompt 不自动由重复提交覆盖；覆盖前展示 diff、来源和版本，提供回退。严格区分 ChatForge 自身的 `CHAT_SYSTEM_PROMPT`、Persona 的 `prompt.md`、视觉 `vision_prompt.md` 及视频用 `commit-prompt` 端点。
- 所有权：本地 token 不等于用户身份；当前 `current_user_id` 可能为空，不能宣称已有跨用户隔离。若支持多用户，须在 start/message/state/sessions/knowledge/attachment/commit/delete、生成端点及 persona list/export/import/PUT 上逐一校验 owner，防 session ID 枚举与越权；本地模式明确仅本机受信任用户和绑定监听范围。沿用 `owner_id` 兼容旧数据，不把请求体里的 owner 当权威。
- 保存事务：当前 repository 逐文件原子替换但整份 manifest 的多个文件并非单事务；新增暂存目录/提交标记或回滚流程确保参数、Prompt、视觉 Prompt、索引一致；commit 的 ID 分配与存在性检查要防并发 TOCTOU。审计保存、覆盖、失败和冲突（不记录敏感正文）。

## 9. 迁移与兼容

1. 在现有 `chatforge_sessions/*.json` 上进行容错读取，补 session/message ID、revision、状态；老文件中的 data URL 分批转存受控附件库，保留关联与校验 hash，迁移成功再清理原内联数据；无法迁移则标记只读/失败，不静默丢弃。当前启动只装载未过期会话，需先评审遗留文件保留策略，不直接批量删除。
2. 已有 Persona 的 `persona.yaml`、`parameter.yaml`、`prompt.md`、`vision_prompt.md` 读取行为保持不变；缺 Prompt 显示未设置，旧 `vision_prompt.md` 不被对话自动覆盖；为老 Persona 初始化 revision/版本快照时不改原文。含额外层/高级字段的样本做保存前后对照。
3. 先发布后端兼容读/写与迁移脚本（带 dry-run、备份、统计、失败清单），再发布前端只读/手动/会话新 UI，最后逐步禁用离线模拟和旧 data URL 上传；旧客户端兼容窗口与淘汰日期由发布评审确定。
4. 回滚保留旧数据快照和旧路由；若新元数据不可读，旧版仍能读取规范 manifest 与已迁移的文本 Prompt。不得以回滚为由重新覆盖用户人工编辑的 Prompt。

## 10. 测试与验收

| 维度 | 核验场景与通过条件 |
| --- | --- |
| 对话与附件 | 文本、真实图片、TXT/MD 各一条；图无视觉能力明确“未分析”，有视觉能力记录分析状态；非白名单、伪造 MIME、超字节/总量、损坏数据被拒绝且不进入 LLM；恶意附件指令不改变系统策略。 |
| 草稿与 Prompt | 六维字段都可预览，用户将数值设 0、布尔设 false 或清空允许字段后可保存；模型非法枚举/超范围/JSON 解析失败不能形成可提交成功态；Prompt/视觉 Prompt 与最终文件内容一致。 |
| 会话恢复 | 发送消息与附件后刷新、重启、切换会话可恢复原消息顺序、草稿、Prompt、附件元信息；过期、删除和未知 ID 不新建空会话；同步回复和 SSE 中断的已确认内容落盘可复现。 |
| 手动创建 | 无 LLM 环境输入六维与 Prompt，POST 成功后 GET、重新进入页面与磁盘三方一致；重复 ID 409；高级字段、空值及单位往返不变。 |
| 查看编辑 | 点击先只读，编辑/取消/保存流程明确；GET 失败不得展示可保存 shell；未知字段、knowledge、owner、inherits 不丢；Prompt 单独/整份保存竞争不覆盖新文本，两个浏览器并发有可恢复冲突。 |
| 幂等与权限 | 断网后相同消息 ID/commit key 重试无重复内容或 Persona；不同 key 同 ID 409；跨 owner 的会话/附件/Persona CRUD 全部拒绝，token-only 模式说明信任边界。 |
| 兼容与回归 | 旧 session JSON/旧 Persona 文件迁移前后可读，备份回滚可验证；既有 from-prompt/from-script/dialogue、知识库/RAG、导入导出、复制/派生不回归。 |

测试层次：后端 Pydantic/附件解码/Prompt 生成单测、FastAPI 契约与所有权/冲突/重启集成测试、前端字段映射 round-trip 与异步竞态单测、真实浏览器端到端（创建→恢复→预览→提交→只读→编辑→保存→重开）。至少覆盖模型超时、SSE 中断、磁盘写失败、索引失败、两页并发、旧数据及无模型配置。验收记录保留请求/响应脱敏样本及文件对账结果。

## 11. 风险与待裁决

- **附件成本和隐私**：目前 data URL 同时占用请求、会话 JSON 和上下文；存储位置、配额、保留天数、清理时点与敏感内容删除策略需产品/安全确认。
- **“完整参数”边界**：一期承诺完整六维 `ParameterLayer`（包括高级字段）和两类 Prompt，不承诺四层模型权重可手填。默认值须标明来源，不能把未提及的信息包装成用户确认。
- **Prompt 覆盖关系**：全局/Category/Persona/Skill/插件优先顺序已约定；界面应提示 Persona Prompt 会受更高层覆盖，但不展示未经后端计算的“最终有效 Prompt”。
- **会话有效期**：当前内存一小时过期与“草稿可长期恢复”冲突；目标保留期、过期后的只读/恢复、磁盘 GC 和备份策略需明确后再定接口。
- **旧接口语义**：`from-prompt` 等直接保存且无统一确认，变更成先预览再保存可能影响现有调用者；需要兼容策略和调用方清单。
- **并发与文件事务**：多进程部署、同 ID 并行创建、生成与手改同时发生时须跨进程锁或存储层 CAS；单进程内锁不足以证明安全。

## 12. 里程碑与交付门槛

1. **M1 契约与治理**：确定完整六维字段清单、附件白名单/存储/TTL、Prompt 版本与覆盖决策、owner 模式及 revision/幂等规则；同步接口规范和失败码。门槛：前后端对同一请求/响应样本校验通过。
2. **M2 后端可靠性**：会话持久化/恢复、可读历史、附件受控存储、草稿校验与编辑、预览/安全提交、并发冲突及迁移工具。门槛：集成测试覆盖断线、重启、越权、并行与旧数据。
3. **M3 前端闭环**：对话与手动双入口、完整预览、只读详情及显式编辑、错误/重试/冲突体验；保留既有生成方式。门槛：浏览器端到端完整流程通过，离线模拟不会冒充保存结果。
4. **M4 灰度与验收**：备份/迁移 dry-run、样本复核、回滚演练、权限安全检查、性能/容量观测，更新前后端 API 文档和维护手册；经产品/研发/安全验收后移除过渡兼容。

## 13. 源码依据

- 前端：`src/pages/PersonaForgePage.tsx`、`src/pages/PersonaDetailPage.tsx`、`src/pages/PersonaPage.tsx`、`src/features/settings/PersonaGalleryPanel.tsx`、`src/types/persona.ts`、`src/services/api/persona.ts`。
- 后端：`J:\Clipwright\clipwright\services\chat_forge.py`、`services/persona_forge.py`、`api/persona.py`、`api/persona_forge.py`、`schema/persona.py`；为核对实际聊天路由和持久化行为，另读 `api/chat_forge.py`、`persona/repository.py`。
