# Persona ChatForge 重构 Coding Plan v2（M1–M4）

- 状态：待评审，编码前基线；替代 [v1](./persona-chatforge-refactor-coding-plan.md)
- 依据：[PRD](./persona-chatforge-refactor-prd.md)（§5.1 字段命名、§6.3 API 契约复核为最高优先级）
- 范围：后端 `J:\Clipwright`、前端 `J:\Clipweight-Client`；分支 `feat/zam_persona_chatforge_refactor`
- 口径：**只有标「现有」的才是已实现**。标「拟变更 / 拟新增」的一律未实现，不得在联调、验收、文档里当成既有能力。M1 只产模型与 fixture，不注册新路由。

## 0. 对 v1 的独立评审

### 0.1 修正（v2 必做）

| # | v1 问题 | 证据 | v2 处理 |
| --- | --- | --- | --- |
| C1 | `progress` 只在 `SessionDetail` 类型行写了 `dict[str,float]`，但 §0.3 称形状冻结、M3 的 `ForgeState` 没有该字段、验收仍按“40% 整体”放行，前后不一致 | `services/chat_forge.py:283-307` 返回六维 dict；`PersonaForgePage.tsx:464` 用六维均值算 overall | 契约、API、TS、用例四处钉死 `dict[str,float]`（六键、0..1），并定义聚合函数 `overall = round(mean(六维)*100)`，聚合值只在前端展示、不落盘 |
| C2 | API 路径未写全前缀，漏了 `refine`、`commit-prompt`、`knowledge` PUT/DELETE 等真实端点 | `api/chat_forge.py:14` 前缀 `/api/persona/forge/chat`；`api/persona_forge.py:117-175` | 全表使用完整路径；补“现有、本期不改/不接线”的端点 |
| C3 | 迁移按“大量旧会话”排期，但实际库为空 | `J:\Clipwright\chatforge_sessions` 下 0 个文件 | 保留迁移器，明确 dry-run 期望 `scanned=0`；迁移能力用合成 fixture 验收，不虚构体量 |
| C4 | 未发现与 F9（未知 session 改 404）直接冲突的既有测试 | `tests/clipwright/test_chat_forge_stream.py:197 test_new_session_is_created_on_demand` | 列为 M2 首个任务：先反转测试，再改实现 |
| C5 | 只抄“4 个附件 × 8 MiB”，漏了全局 JSON 体上限 | `main.py:386` 20 MiB（非 multipart 才拦）；`main.py:412-421` | 说明旧契约自相矛盾（4×6 MiB base64≈32 MiB 必被 413）；新上传走 multipart，端点内自校验 |
| C6 | 未指出 `save_manifest` 的空 Prompt / vision no-clobber 会让保存“假成功” | `persona/repository.py:74-88`：`if manifest.prompt`、`_save_vision_prompt_noclobber` | 明确改为按“字段是否出现”写入；空串=清空；用户编辑 vision 走显式覆盖 |
| C7 | 未指出 `personaFromBackend` 在合成默认值 | `src/types/persona.ts:98,105`（`tone='neutral'`、`version='1.0.0'`） | 详情/手动表单改用 DTO；缺失显示“未设置”；旧映射仅保留给图库只读卡 |
| C8 | 手动创建只说“复用 `/create`”，未提 ID/owner 一致性风险 | `api/persona.py:59-68`：PUT 不校验 body 与路径 ID；body 可改 owner | 服务端强制 `manifest.persona_id == path id`、owner 取服务端值；新增用例 |
| C9 | 前端测试放在新建 `src/types/__tests__/`，不符合仓库共置约定 | 现有 `src/types/persona.test.ts`、`src/pages/*.test.tsx` | 全部扩展/新增共置测试 |

### 0.2 保留（v1 成立，继续执行）

1. F1–F10 事实基线（逐条复核成立；F2 补充“`_persist_session` 吞异常”，见 F11）。
2. 三层字段分层与“只在边界转换”的铁律。
3. A1–A19 编号骨架、统一错误体思路、`schema_version` 版本化。
4. 附件“受控目录 + SHA256 去重 + 只回相对引用”；commit“校验→组装→加锁→写→记幂等”的顺序。
5. 灰度顺序：后端兼容读 → 新端点 → 前端 → 关旧上传。
6. 附录禁止事项与里程碑门槛。

### 0.3 删除 / 降级

| # | v1 内容 | 原因 | v2 |
| --- | --- | --- | --- |
| D1 | `SessionDetail.status` 含 `expired` 且落盘 | 会让读请求产生写盘，破坏只读语义 | 存储只存 `active/committed`；`expired` 由读取时判定并返回 410 |
| D2 | 前端 `personaChatforgeV2` 运行时开关 | 仓库无 feature-flag 基础设施，纯属虚构 | 不做运行时开关；靠“后端先上、前端后上”的发布顺序与整包回滚。要开关另立基础设施任务 |
| D3 | “旧代码可读 v2 会话”作为回滚方案 | 旧前端拿到 `attachment_ids` 无法渲染（没有 `data_url`） | 回滚 = 代码整包回滚 + 从 `_backup/<ts>/` 恢复 v1 JSON；不承诺旧码读 v2 |
| D4 | `tests/contracts/` 顶层新目录 | 仓库测试根是 `tests/`，`testpaths=["tests"]` | fixture 放 `tests/clipwright/contracts/chatforge/` |
| D5 | 仅给“路径待评审”的附件占位 | 无法评审 | 给出唯一候选路径并标“拟新增、未上线”，评审可改 |

### 0.4 复核后事实基线（写入验收，不得假设已修）

| # | 事实 | 证据 |
| --- | --- | --- |
| F1 | `/start` 的 `reply` 恒为空串；`scope/context` 只回显，不落盘 | `api/chat_forge.py:84-91`；`services/chat_forge.py:406-421` |
| F2 | 同步 `/message` 追加助手消息后**不再持久化**（流式会） | `chat_forge.py:446-451`；`_process` 870 行后无 `_persist_session` |
| F3 | `/state` 仅 `session_id,message_count,persona_draft,knowledge_base_count,created_at,updated_at` | `chat_forge.py:791-803` |
| F4 | `/commit` 只收 `{session_id,persona_id?,persona_name?}`；默认 ID `chat_<session>`；无幂等、无防覆盖 | `api/chat_forge.py:53-57,257-275`；`chat_forge.py:729-789` |
| F5 | `/prompt` GET 返回 `{persona_id,prompt}`；vision PUT 返回 `{status,persona_id}` | `api/persona.py:248-286` |
| F6 | `/create`、PUT `/{id}` 收发完整 manifest；POST 冲突 409；PUT 整份替换 | `api/persona.py:44-68` |
| F7 | `/api/persona/list` 返回 `list[str]` | `api/persona.py:33-35` |
| F8 | 附件固定 `{type,name,mime,data_url}`，4 个、单 `data_url` ≤8 MiB 字符，只校验标记/数量/长度 | `api/chat_forge.py:27-39`；`chat_forge.py:140-144,455-483` |
| F9 | 未知 session 由 `_get_or_create_session` 隐式创建，API 的 404 不可靠 | `chat_forge.py:222-228` |
| F10 | commit 时 Prompt 才由用户原话拼接；vision 关键词筛选且 no-clobber | `chat_forge.py:1066-1115`；`repository.py:86-88` |
| F11 | `_persist_session` 捕获异常只告警，接口仍返回成功 | `chat_forge.py:158-175` |
| F12 | 非 multipart 请求体全局上限 20 MiB；multipart 跳过 | `main.py:386,412-421` |
| F13 | PUT 不校验路径 ID 与 body ID；body `owner_id` 会被采用 | `api/persona.py:59-68` |
| F14 | `save_manifest` 仅在 `prompt` 真值时写；vision 仅文件不存在时写 | `repository.py:74-88` |
| F15 | `from-prompt/from-script/refine/dialogue/build` 直接 save，不查重、无 409 | `api/persona_forge.py:73-175` |
| F16 | `scope=mv_prompt` 复用同一组 chat 端点，本期不得破坏 | `api/chat_forge.py:21-24` |

### 0.5 API 状态总表（完整前缀）

| # | 方法与路径 | 状态 | 本期 |
| --- | --- | --- | --- |
| A1 | `POST /api/persona/forge/chat/start` | 现有 | 响应附加 `revision`（可选字段） |
| A2 | `POST /api/persona/forge/chat/message` | 现有 | 拟变更：`client_message_id`、`attachment_ids`、返回 `message_id/revision` |
| A3 | `POST /api/persona/forge/chat/message/stream` | 现有 | 拟变更：同上；`done` 带 `revision`；`error` 带 `code` |
| A4 | `GET /api/persona/forge/chat/sessions?scope=` | 现有 | 列表项附加 `status/revision`（可选） |
| A5 | `GET /api/persona/forge/chat/state/{id}` | 现有 | 形状冻结，不扩 |
| A6 | `DELETE /api/persona/forge/chat/sessions/{id}` | 现有 | 拟变更：补 owner 校验；删会话不删 Persona |
| A7 | `/knowledge` 及 `/{session_id}[/{kb_id}]` | 现有 | 不改；与消息附件不是一套存储 |
| A8 | `POST /api/persona/forge/chat/commit` | 现有 | 拟变更：幂等/防覆盖/校验 |
| A9 | `POST /api/persona/forge/chat/commit-prompt` | 现有 | 不改（视频提示词蒸馏，v1 漏列） |
| A10 | `GET /api/persona/list`、`GET /api/persona/{id}` | 现有 | 前者不变；后者加 `ETag`/`X-Persona-Revision` |
| A11 | `POST /api/persona/create` | 现有 | 拟变更：ID 一致性校验；仍是完整 manifest |
| A12 | `PUT /api/persona/{id}` | 现有 | 拟变更：`If-Match`、ID/owner 校验、字段存在性合并 |
| A13 | `GET/PUT /api/persona/{id}/prompt`、`/vision-prompt` | 现有 | 拟变更：`If-Match`、允许显式清空 |
| A14 | `from-prompt` / `from-script` / `refine` / `dialogue/*` | 现有 | 保留；不接新确认流程；另记覆盖风险 |
| N1 | `GET /api/persona/forge/chat/sessions/{session_id}` | **拟新增** | 历史+草稿+附件+revision，游标 |
| N2 | `PATCH /api/persona/forge/chat/sessions/{session_id}/draft` | **拟新增** | 白名单草稿修订 |
| N3 | `POST /api/persona/forge/chat/sessions/{session_id}/attachments` | **拟新增** | multipart 上传 |
| N4 | `GET /api/persona/forge/chat/attachments/{attachment_id}` | **拟新增** | 受控读取 |
| N5 | `DELETE /api/persona/forge/chat/attachments/{attachment_id}` | **拟新增** | 仅未引用可删 |
| N6 | `POST /api/persona/forge/chat/sessions/{session_id}/preview` | **拟新增** | 编译草稿，不落盘 |
| N7 | `GET /api/persona/forge/chat/capabilities` | **拟新增** | 前端能力探测（灰度用） |

错误体（拟新增）：`{code,message,field_errors?,retryable?,current_revision?}`；400 字段/附件、403 owner、404 不存在、409 ID/幂等冲突、410 过期、412 revision、413 体积、415 类型、422 schema。

## M1 契约、数据模型、字段映射

### 目标

1. 把 §5.1/§6.3 固化为可执行 Pydantic 模型与 TS DTO；冻结 N1–N6 的请求/响应。
2. 建立唯一映射入口与共享 fixture，同一份样本两端解析零差异。
3. 只定义、不挂业务路由；现有端点行为零变化。

### 改动文件（后端 `J:\Clipwright`）

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `clipwright/schema/chat_forge.py` | 新增 | Message/AttachmentMeta/SessionDetail/DraftPatch/CommitRequest/Preview/ApiError |
| `clipwright/schema/persona.py` | 改 | `ConstraintsConfig` 增 `min_duration_sec<=max_duration_sec`；现有别名 validator 标 deprecated（保留兼容，不作契约） |
| `tests/clipwright/test_chatforge_schema_contract.py` | 新增 | 范围、三态、拒绝对路径、草稿禁 `parameter` |
| `tests/clipwright/contracts/chatforge/*.json` | 新增 | start/message/done/state/sessions/detail/draft/attachment/commit/error |
| `scripts/sync_chatforge_fixtures.py` | 新增 | 后端 canonical fixture → 前端副本；`--check` 校验哈希 |
| `docs/api_reference.md` | 改 | 明确“拟新增（未上线）”，列错误码 |

### 改动文件（前端 `J:\Clipweight-Client`）

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `src/types/personaDto.ts` | 新增 | `PersonaManifestDto`、`ParameterLayerDto`（全部后端字段，含高级字段） |
| `src/types/chatforge.ts` | 新增 | `ChatSessionDetailDto`、`ChatMessageDto`、`ChatAttachmentDto`、`DraftPatch`、`CommitRequest`、`ApiErrorBody` |
| `src/features/persona/__fixtures__/chatforge/` | 新增（生成） | 与后端同源副本，带 `_meta.sha256` |
| `src/types/chatforge.contract.test.ts` | 新增 | DTO 守卫、六键 progress、fixture 哈希 |
| `src/services/api/persona.ts` | 不改 | M1 不接新端点，避免请求未上线路由 |

### API

- 不新增可调用端点；A1–A14 不改行为。N1–N7 只有类型与 fixture。
- A2/A3 的 `client_message_id`、`attachment_ids`、`revision` 均为**拟变更**，M1 不实现。
- A8 的 `expected_revision`、`idempotency_key`、`parameter/prompt/vision_prompt` 均为**拟新增字段**；旧三字段仍合法。
- `/persona/{id}` 的 `ETag`/`X-Persona-Revision` 在 M2 实现。

### 数据结构

```python
class ChatMessage(BaseModel):
    id: str; seq: int; role: Literal["user","assistant","system"]
    content: str; created_at: datetime
    status: Literal["sent","failed","interrupted"]
    client_message_id: str | None = None
    attachment_ids: list[str] = []
    error_code: str | None = None

class ChatAttachmentMeta(BaseModel):
    id: str; name: str; kind: Literal["image","text"]
    detected_mime: str; size: int; sha256: str
    analysis_status: Literal["pending","parsed","not_analyzed","failed","rejected"]
    storage_ref: str            # 相对，禁止绝对路径/../
    content_url: str            # /api/.../attachments/{id}
    created_at: datetime

class ChatSessionDetail(BaseModel):
    schema_version: int = 2; session_id: str; owner_id: str | None = None
    status: Literal["active","committed"]; revision: int
    messages: list[ChatMessage]
    persona_draft: dict[str, Any]        # 扁平六键，禁止 parameter
    prompt_draft: str = ""; vision_prompt_draft: str = ""
    field_sources: dict[str, Literal["user","model","default","manual"]]
    missing_dimensions: list[str]
    progress: dict[str, float]           # 恰好六键，0..1
    attachments: list[ChatAttachmentMeta]
    created_at: datetime; updated_at: datetime
    committed_persona_id: str | None = None
    next_cursor: str | None = None       # 消息 seq 游标

class DraftPatch(BaseModel):
    expected_revision: int
    parameter_patch: dict[str, Any] | None = None
    prompt_draft: str | None = None
    vision_prompt_draft: str | None = None

class ChatCommitRequest(BaseModel):
    session_id: str; persona_id: str = ""; persona_name: str = ""
    expected_revision: int | None = None
    idempotency_key: str | None = None
    parameter: ParameterLayer | None = None
    prompt: str | None = None
    vision_prompt: str | None = None
```

TS 侧同名 camelCase（`sessionId/createdAt/attachmentIds/...`），`progress` 类型固定：

```ts
export type Dimension = 'identity'|'language'|'rhythm'|'visual'|'audio'|'constraints';
export type ProgressMap = Record<Dimension, number>; // 六键齐全，0..1
```

校验：`progress` 键集合必须恰为六维；`persona_draft` 出现 `parameter` 直接拒绝；`storage_ref` 必须匹配 `^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.[a-z0-9]+$`；`revision>=0`；`seq>=1`；`model_fields_set` 区分“未出现”和“显式 null”。

### 迁移

- 无数据迁移；`schema_version=2` 先定义，读取兼容在 M2。
- 只增不改：删字段必须升版本并保留一个发布窗口的兼容读。
- fixture 即 M2 迁移对账基准（迁移输出必须过同一组模型）。

### 测试

1. 六维范围：密度/比例 0..1、`base_shot_duration_ms` 为 `None` 或 ≥100、颜色 `#RRGGBB`、响度 −30..−10、`min<=max`。
2. `DraftPatch` 缺省 / null / 0 / false 的 `model_fields_set` 不同。
3. `SessionDetail` 拒绝绝对 `storage_ref`、拒绝草稿含 `parameter`、`progress` 缺键/越界报错。
4. 同一 fixture 双端解析字段集合零差异；高级字段与空值 round-trip 相等。

### 验收命令

```powershell
cd J:\Clipwright
py -3.14 -m pytest tests/clipwright/test_chatforge_schema_contract.py -q
py -3.14 scripts/sync_chatforge_fixtures.py --check
py -3.14 -c "import clipwright.main"
cd J:\Clipweight-Client
npx tsc --noEmit
npm run test -- src/types/chatforge.contract.test.ts src/types/persona.test.ts
```

### 风险

| 风险 | 缓解 |
| --- | --- |
| 模型与真实路由漂移 | 路由以 `main.py:667-669` 注册为准，M1 只做模型 |
| DTO 拆分引发类型错 | 旧 `Persona` 类型保留；新页面只读 DTO |
| fixture 两仓漂移 | `--check` 进 M4 回归；哈希不一致即失败 |
| 别名 validator 掩盖前端 bug | 新契约用例只发规范字段；别名仅兼容旧数据 |

## M2 后端：会话、附件、草稿、commit、revision

### 目标

1. 一次成功转移内落盘消息、草稿、Prompt 草稿、状态、revision；修 F2/F11。
2. N1/N2 可用；未知 404、过期 410，删除 F9 的隐式创建。
3. 附件受控：magic 嗅探、真实字节、SHA256、配额、TTL；JSON 不再内嵌 Base64。
4. commit 幂等且绝不覆盖；Persona 保存有 revision/CAS，Prompt 两路不再假成功。

### 改动文件（后端）

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `clipwright/services/chat_forge.py` | 改 | 严格取 session、v2 落盘、同步二次持久化、`_merge_draft` 三态、草稿校验、TTL/GC |
| `clipwright/services/chatforge_attachments.py` | 新增 | 上传/嗅探/配额/受控读取/清理 |
| `clipwright/services/chatforge_commit.py` | 新增 | 暂存目录、幂等记录、原子建 Persona |
| `clipwright/services/persona_forge.py` | 改 | 草稿编译为 `ParameterLayer`，非法值报字段错误而非静默默认 |
| `clipwright/persona/repository.py` | 改 | revision 侧车、按字段存在性写 prompt/vision、raw manifest 保留未知字段、原子替换 |
| `clipwright/api/chat_forge.py` | 改 | N1–N7；A2/A3/A6/A8 新字段与错误码 |
| `clipwright/api/persona.py` | 改 | A10/A12/A13：ETag/If-Match/ID 与 owner 校验 |
| `clipwright/config.py` | 改 | TTL、附件配额、`CHATFORGE_V2_MODE`、`PERSONA_CAS_MODE` |
| `pyproject.toml` | 改 | 显式声明 `pillow`（已在用但未声明）；如需 `filelock` 一并声明 |
| `scripts/migrate_chatforge_sessions.py` | 新增 | v1→v2：`--dry-run/--backup/--report` |
| `tests/clipwright/test_chat_forge_stream.py` | 改 | 反转 `test_new_session_is_created_on_demand` |
| `tests/clipwright/test_chat_forge_debts.py`、`test_chatforge_persist.py` | 改 | 404/410、同步落盘、progress dict |
| `tests/clipwright/test_chatforge_{sessions_api,attachments,commit,security,migration,revision_api}.py` | 新增 | 见测试矩阵 |
| `docs/api_reference.md`、`docs/frontend-backend-parity.md` | 改 | 端点转正、限制、错误码 |

### API

| 端点 | 状态 | 行为 |
| --- | --- | --- |
| A1 `/start` | 现有 | 响应附加 `revision:0`；**不持久化** `scope/context`（F1 不变） |
| A2/A3 `/message`、`/message/stream` | 现有·拟变更 | `client_message_id` 去重；返回 `message_id/revision`；sync 成功后持久化助手消息 |
| A5 `/state` | 现有 | 形状不变 |
| A6 DELETE | 现有·拟变更 | owner 校验；只删会话与附件，不级联 Persona |
| A8 `/commit` | 现有·拟变更 | 新字段全部可选；同 key 返原 manifest，不同 key 同 ID 409 |
| N1 详情 | **拟新增** | `?cursor=&limit=`（≤200）；未知 404、过期 410；不隐式新建 |
| N2 PATCH draft | **拟新增** | `expected_revision` 不符 409+`current_revision`；0/false/""/显式 null 生效 |
| N3 上传 | **拟新增** | multipart `file`；白名单；伪造 415、超限 413；返回元信息 |
| N4/N5 读取/删除 | **拟新增** | 校验会话归属；仅未被消息引用可删 |
| N6 preview | **拟新增** | 编译+校验，不写盘、不增 revision |
| N7 capabilities | **拟新增** | 灰度能力探测 |
| A10–A13 Persona | 现有·拟变更 | `ETag`/`If-Match`；412 带 `current_revision`；ID/owner 取服务端 |

commit 顺序：① 严格读会话（404/410）→ ② owner/status（已 committed 仅同 key 重放）→ ③ `expected_revision` 比对 → ④ 请求字段 > 草稿 > 旧拼接（仅兼容）→ ⑤ Pydantic 校验，失败 422+`field_errors`（禁用 `_safe_*` 静默默认）→ ⑥ `validate_id`、ID 占用检查 → ⑦ 文件锁内再查幂等与占用 → ⑧ 暂存目录写全量 → `os.replace` 原子落位 → ⑨ 写 `.revision=1`、幂等记录、回写会话状态。失败清理暂存并回滚会话 revision。

幂等记录 `chatforge_commits/<key>.json`：`{key,session_id,persona_id,request_fingerprint,response_persona_id,response_revision,created_at}`。同 key 不同 fingerprint → 409；无 key 的旧客户端用兼容键 `legacy:<session>:<target_id>`，同 fingerprint 返回原 manifest。

### 数据结构

```text
chatforge_sessions/<sid>.json            # v2，无 Base64
chatforge_sessions/_staging/<sid>.tmp
chatforge_attachments/<sid>/index.json
chatforge_attachments/<sid>/<attachment_id>.<ext>
chatforge_commits/<key>.json
personas/<pid>/.revision                 # int 侧车，不改 manifest 形状
personas/.staging/<pid>-<uuid>/          # commit 暂存目录
```

v2 JSON：`schema_version/session_id/owner_id/status/revision/messages[]/persona_draft/prompt_draft/vision_prompt_draft/field_sources/missing_dimensions/progress/attachments[]/created_at/updated_at/committed_persona_id`。`revision` 只覆盖消息/草稿/状态，附件上传不增；消息 ID 服务端生成，`client_message_id` 只去重；写盘临时文件 + `os.replace`，失败 500 且不推进 revision。

附件：图片 PNG/JPEG/WebP（magic+Pillow `verify`，像素 ≤40MP，单文件 ≤10 MiB）；文本 TXT/MD/JSON（UTF-8 严格、≤1 MiB、拒 NUL）；PDF/Office/音视频一期 415 拒绝。单消息 ≤4、单会话 ≤20 个/40 MiB。文件名只作展示，落盘名=`attachment_id`；`storage_ref` 相对且 `is_within` 校验；`Content-Type` 取检测值、`X-Content-Type-Options: nosniff`、下载带 `Content-Disposition: attachment`。附件正文按低信任数据注入（分隔符包裹），不得进系统提示词。

### 迁移

1. 兼容读：无 `schema_version` 视为 v1，补 `seq/id/revision=0/status`，内存转换不重写。
2. v1 内联 `data_url`：解码→嗅探→SHA256→落附件目录→换 `attachment_ids`；成功才重写 v2，原文件移 `_backup/<ts>/`。
3. 失败（非白名单/超限/解码失败）标 `legacy_inline` 只读，保留原 JSON 并在报告列原因。
4. 脚本支持 `--dry-run`（仅统计）、`--backup`、`--report`、`--limit`；失败退出码非 0。
5. 当前库为空：dry-run 期望 `scanned=0`；用 `tests/clipwright/contracts` 合成 v1 样本验收迁移。

### 测试

| 用例 | 断言 |
| --- | --- |
| 同步落盘 | 发消息→重建 `ChatForge`→助手回复仍在 |
| 流式中断 | 已确认 partial 落盘且 `interrupted`，不伪造 done |
| 未知/过期 | 404 不新增文件；过期 410；DELETE 后 404 |
| 草稿三态 | 0/false/""/null 回读一致；非法字段 422 |
| revision 并发 | 后写 409 且 `current_revision` 为前者 |
| 附件安全 | 伪造 PNG/扩展名、超限、路径穿越、跨会话读取全拒 |
| commit | 同 key 只一份；不同 key 同 ID 409；写失败无半份 Persona |
| Prompt | 空串可清空；PUT 改 vision 生效；旧 manifest 未知字段保留 |
| 兼容 | `scope=mv_prompt` 仍可用；旧 `data_url` 请求仍可用 |

### 验收命令

```powershell
cd J:\Clipwright
py -3.14 -m pytest tests/clipwright/test_chatforge_sessions_api.py tests/clipwright/test_chatforge_attachments.py tests/clipwright/test_chatforge_commit.py tests/clipwright/test_chatforge_security.py -q
py -3.14 -m pytest tests/clipwright/test_chatforge_persist.py tests/clipwright/test_chat_forge_debts.py tests/clipwright/test_chat_forge_stream.py -q
py -3.14 -c "import clipwright.main"
py -3.14 scripts/migrate_chatforge_sessions.py --dry-run --report .\reports\chatforge-dryrun.json
```

### 风险

| 风险 | 缓解 |
| --- | --- |
| 单进程锁不足 | 明确单进程部署；ID 用 `filelock`；多进程需存储层 CAS（M4 评估） |
| 多文件非单事务 | commit 用整目录暂存 + 单次 rename；更新用备份回滚 |
| 附件内存/磁盘 | 1 MiB 分块写、早期 413、会话配额 + GC |
| 旧测试反转遗漏 | C4 首个任务；全量跑 `test_chat_forge*` |
| 幂等键泄漏 | 记录不含正文，仅指纹与 ID |

## M3 前端：双入口、恢复、只读详情 + 编辑

### 目标

1. 对话闭环：真实恢复、消息/附件状态、预览确认再提交；删除离线模拟与“40% 放行”。
2. 手动闭环：无模型填完整六维与两类 Prompt，提交完整 manifest，重开一致。
3. 详情先只读，显式编辑；以 revision 为基，冲突可恢复，取消不写。
4. 图库区分“对话创建/手动创建”，演示数据隔离。

### 改动文件（前端）

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `src/router.tsx` | 改 | 新增 `/persona/new` |
| `src/pages/PersonaNewPage.tsx` | 新增 | 创建方式选择 + 手动表单 |
| `src/pages/PersonaForgePage.tsx` | 改 | 拆编排；删模拟/假 session/假成功；接 N1/N2/N3/N6 |
| `src/pages/PersonaDetailPage.tsx` | 改 | 只读/编辑、删除 `makeShell`、ETag/412、未保存提醒 |
| `src/features/persona/forge/{SessionList,MessageList,AttachmentQueue,DraftPanel,ConfirmPreview}.tsx` | 新增 | 会话/消息/附件/六维+Prompt/确认 |
| `src/features/persona/forge/useChatForgeSession.ts` | 新增 | 状态机、SSE、abort、代际、去重 |
| `src/features/persona/manual/ManualCreateForm.tsx`、`fields.ts` | 新增 | 全字段控件与字段表 |
| `src/features/persona/detail/usePersonaEditor.ts` | 新增 | view/edit/conflict、保存后重取 |
| `src/features/settings/PersonaGalleryPanel.tsx` | 改 | 两入口；演示只读；失败/空库分态 |
| `src/types/persona.ts` | 改 | `personaFromBackend` 标 legacy；新增 presence 判断 |
| `src/services/api/persona.ts` | 改 | N1–N4/N6、If-Match、错误体解析（M2 合并后才接线） |
| 共置测试 | 改/新增 | 见测试 |

### API

| 场景 | 调用 | 状态 |
| --- | --- | --- |
| 启动 | A1 | 现有；失败保留输入重试，不渲染空 reply |
| 发消息 | N3 → A2/A3 | 上传拟新增 + 消息拟变更 |
| 恢复 | A4 → N1 | 列表现有 + 详情拟新增；进入必读详情 |
| 改草稿 | N2 | 拟新增；防抖 + expected_revision |
| 预览 | N6 | 拟新增；失败显示字段错误 |
| 提交 | A8 | 拟变更；同 key 重试；409 让用户改 ID |
| 手动创建 | A11 | 现有；409 显示冲突，不自动改 ID |
| 详情读/存 | A10、A12/A13 | 拟变更；412 冲突面板 |

约束：M2 合并前，前端不得调用 N1–N6；`personaApi` 新方法加 `@since M2` 注释。

### 数据结构

```ts
type LoadState = 'idle'|'loading'|'ready'|'expired'|'not_found'|'error';

interface ForgeState {
  sessionId: string | null; sessionRevision: number;
  messages: ChatMessageDto[];               // 服务端 id+seq
  attachments: AttachmentDraft[];           // uploading/uploaded/failed
  draft: PersonaDraftDto;                   // 扁平六键，规范字段名
  promptDraft: string; visionPromptDraft: string;
  fieldSources: Record<string, 'user'|'model'|'default'|'manual'>;
  missingDimensions: Dimension[];
  progress: ProgressMap;                    // 六维 dict，不是 float
  loadState: LoadState; generation: number;
  pendingClientMessageId: string | null; error: ApiErrorBody | null;
}

interface PersonaEditorState {
  mode: 'view'|'edit'; dto: PersonaManifestDto | null;
  snapshot: PersonaManifestDto | null; revision: number;
  loadState: LoadState; conflict: { serverRevision: number } | null;
}
```

规则：① `overall = round(mean(Object.values(progress))*100)` 仅展示，不再作为提交门槛；提交只由 `preview.can_commit` 与后端校验决定。② 切会话先 abort 并 `generation++`，晚到响应按 `sessionId+generation` 丢弃；新快照成功后才替换消息/草稿。③ 恢复用 N1 真消息，不写“已恢复”假消息；404/410 清本地并解释。④ 附件先传后发，发送只带 `attachment_ids`；失败阻止发送。⑤ 流式只在 `done` 应用结构化结果；网络中断不盲目回退同步；仅 404/405（旧后端）且未收到字节时，用**同一** `client_message_id` 回退一次。⑥ 提交前必须 N6 预览；`idempotency_key` 在确认页生成，字段变更则换 key。

### 迁移

- `localStorage` 键 `clipwright.forgeSessionId`（字符串）→ `clipwright.forgeSession`（`{id,updatedAt}`）；兼容读旧键，读到即迁。
- 旧 `data_url` 组件保留只读窗口，由 `CHATFORGE_V2_MODE` 决定；新 UI 不再产生 `data_url`。
- 删除 `simulateProgress`、`uid('forge')` 假会话、无 session 也提示“已保存”的路径。
- 演示 Persona 只在 `dataMode='demo'` 展示，禁止进入编辑/保存链路。
- 详情页移除 `makeShell`：GET 失败显示错误与重试，不提供可保存壳。

### 测试

1. 映射：DTO→表单→DTO round-trip；`None` 不写成 6000；0/false/空串可保存；未知字段不丢。
2. Hook：切会话丢弃旧响应；SSE error 不追加助手消息；同 `client_message_id` 重试不重复。
3. 组件：>4 个/超限前置拒绝；上传失败阻止发送；提交失败保留草稿；无 session 不得提示成功。
4. 手动：提交→GET→表单一致；高级字段（`cut_profile/palette/bgm_slots/forbidden_topics`）往返不变。
5. 详情：view 模式无输入控件；取消无写入；412 冲突面板；GET 失败无可保存壳。
6. 图库：两入口可达；demo 卡片不可编辑。

### 验收命令

```powershell
cd J:\Clipweight-Client
npx tsc --noEmit
npm run test -- src/types/chatforge.contract.test.ts src/types/persona.test.ts src/pages/PersonaForgePage.chatforge.test.tsx src/pages/PersonaDetailPage.test.tsx src/pages/PersonaNewPage.test.tsx
npm run build
```

手工（需 M2 后端）：创建→传图/TXT→刷新恢复→预览→提交→只读→编辑保存→重开复核。

### 风险

| 风险 | 缓解 |
| --- | --- |
| 调用未上线端点 | M2 合并门槛；方法标 `@since M2`；灰度先开 N7 |
| SSE+回退重复消息 | 服务端 `client_message_id` 去重；前端只在未收字节时回退 |
| 大附件卡 UI | 先传后发、进度条、超限前置拒绝 |
| 只读态残留可编辑 | 工作副本 + 离开确认 + revision 校验 |
| 手动表单丢高级字段 | DTO 基底 + 字段表覆盖测试 + 保存前 diff |

## M4 测试、迁移、灰度、文档

### 目标

1. 把 PRD §10 固化为回归矩阵：断线、重启、越权、并发、旧数据、无模型配置。
2. 真实迁移与回滚演练，产出可审计报告。
3. 灰度：后端兼容读 → 新端点 → 前端 → 关旧上传；观测与回滚有据。
4. OpenAPI/文档同步，验收留脱敏样本与文件对账。

### 改动文件（后端 / 前端）

| 侧 | 文件 | 动作 |
| --- | --- | --- |
| 后 | `tests/clipwright/test_chatforge_e2e.py` | 新增：创建→恢复→预览→提交→详情→编辑→重开 |
| 后 | `tests/clipwright/test_chatforge_security.py` | 扩充：越权、穿越、伪造 MIME、注入样本 |
| 后 | `tests/clipwright/test_chatforge_migration.py` | 扩充：v1 样本、失败清单、幂等重跑 |
| 后 | `scripts/migrate_chatforge_sessions.py` | 统计/失败清单/幂等 |
| 后 | `docs/api_reference.md`、`docs/frontend-backend-parity.md`、`docs/Persona.md`（`J:\Clipwright\docs`） | 端点转正、限制、错误码 |
| 前 | `e2e/persona-chatforge.spec.ts`（可选，需真实后端） | 端到端 |
| 前 | `docs/persona-chatforge-refactor-prd.md` | 只改状态与偏差记录，不改需求 |

### API

- 冻结 A1–A14、N1–N7 的路径与字段；本阶段不新增端点。
- 只允许补错误码、文档与 OpenAPI 描述，不改成功响应。
- `data_url` 与 `attachment_ids` 并存窗口由 `CHATFORGE_V2_MODE` 控制；淘汰前一个周期提示，不静默拒绝旧客户端。

### 数据结构

- 无新结构；`schema_version=2` 是唯一写版本，v1 只读。
- 迁移报告：`{scanned,migrated,skipped,failed:[{session_id,reason}],bytes_before,bytes_after,attachments,duration_ms}`。
- 审计字段：操作、session/persona id、结果、revision；不记录消息与 Prompt 正文。

### 迁移

1. 停写或置 `CHATFORGE_V2_MODE=read`。
2. 备份 `chatforge_sessions/`、`personas/`，记录校验和。
3. dry-run，人工核对失败清单；不允许“未知失败”。
4. 正式迁移 `--backup`；抽 10 个会话验 N1 顺序与附件可读（本机 0 个则用合成样本）。
5. 旧 Persona 逐条 GET 对比快照；`prompt.md`/`vision_prompt.md` 逐字节一致。
6. 回滚演练：恢复备份 + 回滚代码整包；验证 manifest 与 Prompt 可读。
7. 观察一个发布周期后删旧字段与 `data_url` 分支。
8. 记录回滚点：后端镜像 tag、前端构建 hash、备份目录。

### 测试

| 维度 | 通过条件 |
| --- | --- |
| 对话/附件 | 文本+图片+TXT/MD；无视觉能力明确“未分析”；伪造/超限拒且不进 LLM |
| 草稿/Prompt | 0/false/清空可保存；非法值不能提交；文件与预览一致 |
| 恢复 | 刷新/重启/切换后顺序、草稿、Prompt、附件一致；未知/过期不新建 |
| 手动创建 | 无 LLM：POST→GET→页面→磁盘一致；重复 ID 409；单位往返不变 |
| 查看/编辑 | GET 失败无可保存壳；未知字段不丢；并发 412 可恢复 |
| 幂等/权限 | 同 key 无重复；不同 key 同 ID 409；越权全拒 |
| 兼容 | 旧 session/Persona 可读；`from-prompt`、知识库、导入导出不回归 |
| 失败注入 | 磁盘写失败 500 且 revision 不前进；模型超时/断流不伪造成功 |

测试层次：Pydantic/附件解码单测、FastAPI 契约与冲突/重启集成测试、前端映射与竞态单测、真实浏览器端到端。保留脱敏请求/响应样本与文件对账结果。

### 验收命令

```powershell
cd J:\Clipwright
py -3.14 -m pytest tests/clipwright/test_chatforge_e2e.py tests/clipwright/test_chatforge_security.py tests/clipwright/test_chatforge_migration.py -q
py -3.14 -m pytest tests/test_task_api.py tests/test_event_contract.py tests/clipwright/test_run_addressing_api.py tests/clipwright/test_agent_run_replay.py -q
py -3.14 -m pytest tests -q
py -3.14 -c "import clipwright.main"
py -3.14 scripts/migrate_chatforge_sessions.py --dry-run --report .\reports\chatforge-dryrun.json
cd J:\Clipweight-Client
npx tsc --noEmit; npm run test; npm run build
```

通过：零失败（跳过项列原因）；迁移 `failed` 为空或有解释；端到端清单打勾并附证据。

### 灰度与回滚

- 后端开关：`CHATFORGE_V2_MODE=off|read|write`（默认 off→内部 read→write）；`PERSONA_CAS_MODE=off|warn|enforce`（M2 warn，M4 enforce）。
- 发布顺序：后端（兼容读）→ 后端（N1–N7，write 关）→ 前端新 UI → 开 write → 关旧 `data_url`。
- 观测：会话创建成功率、N1 404/410 比例、409/412 次数、附件拒绝原因与平均字节、迁移失败数、commit 重放命中数。
- 回滚：关 write 回旧路径；回滚代码整包；恢复会话备份；**不删**用户已编辑 Prompt；迁移后新增附件保留（孤儿由 GC 处理）。
- 前端无运行时开关（D2）；如需灰度只放内部构建，不做假 flag。

### 风险

| 风险 | 缓解 |
| --- | --- |
| 迁移不可逆 | 备份 + dry-run + 失败清单 + 回滚演练；迁移器幂等 |
| 双写/双读不一致 | 单一写入口；v2 后旧路径只读；切换前排空 |
| 全量测试长跑不稳 | 固定关键集 + 独立 job，记录基线 |
| 旧客户端 data_url | 至少一个周期提示；先 413 再 400，给迁移指引 |
| 本地 token 无多用户隔离 | 文档写“本机受信任用户”；owner 清单另立任务 |

## 附录 A：执行顺序

M1-T0 路由核对 → T1 schema/validator → T2 TS DTO + fixture 同步 → M2-T1 反转隐式建会话测试 → T2 持久化/严格读取 → T3 详情/N2 → T4 附件 → T5 commit 幂等 → T6 revision/Prompt 写入 → T7 迁移 → M3-T1 hook/恢复 → T2 消息/附件 → T3 草稿/预览 → T4 手动创建 → T5 详情只读+编辑 → T6 图库/删模拟 → M4-T1 回归 → T2 迁移回滚 → T3 灰度观测 → T4 文档。

## 附录 B：禁止事项（v2）

1. 把 N1–N7 或 A2/A3/A8/A10–A13 的新字段写成“已实现”。
2. 前端 view model 直接 POST `/create`/PUT；必须过 DTO 边界。
3. API 层出现 `parent_id`、`max_sentence_length`、`color_palette`、`loudness_target_lufs`、`source_citation_required`、`voice_clone_model_id`。
4. 草稿写成 `{parameter:{...}}` 或整份 manifest 塞 `persona_draft`。
5. `base_shot_duration_ms=None` 换成 5000/6000 或 UI 默认。
6. 用 `progress` 均值 40% 或前端校验替代后端 schema。
7. 未知 session 隐式创建；把 404/500 包装成成功；无 session 也提示“已保存”。
8. commit 覆盖同 ID 或无 key 重试产生第二份。
9. 会话 JSON 内嵌整张 Base64；回显绝对路径。
10. 同一请求混用 `data_url` 与 `attachment_ids`。
11. 用演示/离线模拟通过验收；宣称模型已读“未解析”附件。
12. 用 `ETag` 之外的 `version` 字符串推断并发。

## 附录 C：里程碑完成标准

- M1：双端 fixture 通过，`--check` 零差异；六维/三态/路径校验全绿。
- M2：重启后 N1 全量可见；同 key commit 只一份；空 Prompt 可清空、vision 可显式覆盖；旧测试已反转并有 404 回归。
- M3：真实浏览器全流程通过；断网/失败无假成功；只读页无输入控件；`progress` 按六维 dict 渲染。
- M4：迁移 `failed` 为空或有解释；回滚演练成功；灰度有基线；PRD 状态更新。

## 附录 D：待裁决

1. 多用户 owner 隔离是否在本地 token 模式落地（本期只做兼容）。
2. 会话磁盘保留期（拟 7 天）与 active 1h 内存过期是否统一。
3. PDF/Office 是否进入二期（一期 415）。
4. N1–N7 路径需接口评审确认；本计划给唯一候选，评审可改。
5. 详情页是否永久只保留“整份保存”（本期方案），还是保留 Prompt 独立保存（需共享 revision）。
