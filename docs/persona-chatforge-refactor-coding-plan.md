# Persona ChatForge 重构编码计划（M1–M4）

- 状态：待评审（编码前基线）；依据 [PRD](./persona-chatforge-refactor-prd.md)（2026-11-18，含 §5.1 字段复核、§6.3 契约复核）
- 范围：`J:\Clipwright` + `J:\Clipweight-Client`；分支 `feat/zam_persona_chatforge_refactor`
- 铁律：只写**待实施**改动。PRD 未证实的能力一律标「拟新增/拟变更」，不得当既有能力引用；代码路径与实际注册不符时以 M1-T0 核对为准。

## 0. 前置约定

### 0.1 事实基线（PRD §6.3，不得假设已修）

| # | 事实 | 约束 |
| --- | --- | --- |
| F1 | `POST /start` 的 `reply` 恒为空串；`scope/context` 只回显不落盘 | 不设计开场白；持久化须版本化 |
| F2 | `POST /message` 同步路径追加助手消息后**未**再 `_persist_session`，与流式不同 | M2 必修 + 重启回归 |
| F3 | `GET /state/{id}` 仅 `session_id,message_count,persona_draft,knowledge_base_count,created_at,updated_at` | 不扩形状，历史另立端点 |
| F4 | `POST /commit` 只收 `{session_id,persona_id?,persona_name?}` | 新字段全部可选，M2 才实现 |
| F5 | prompt GET 为 `{persona_id,prompt}`；视觉 PUT 返回 `{status,persona_id}` | 前端不得当纯字符串 |
| F6 | `POST /create`、`PUT /{id}` 收发完整 manifest；POST 冲突 409，PUT 整份替换 | 手动创建非 PATCH；PUT 加 `If-Match` |
| F7 | `GET /persona/list` 返回 `list[str]` | 图库逐条 GET，不伪造 manifest 列表 |
| F8 | 附件固定 `{type,name,mime,data_url}`，限 4 个、单 `data_url` ≤8 MiB 字符，只校验标记/数量/长度 | 新旧并存，同请求禁混用 |
| F9 | 未知 session 由 `_get_or_create_session` 隐式创建 | M2 改 404/410 |
| F10 | commit 默认 ID `chat_<session_id>`，无防覆盖/幂等；`prompt.md` 有文本即写 | 同 key 返原 manifest，不同 key 同 ID 409 |

### 0.2 字段分层（§5.1）

| 层 | 形状 | 禁止 |
| --- | --- | --- |
| 后端权威 | `PersonaManifest.parameter` 对象，六维 `identity/language/rhythm/visual/audio/constraints` | 别名 `parent_id`/`color_palette`/`loudness_target_lufs` |
| ChatForge 草稿 | **扁平**六维键 | `{parameter:{...}}` 或整份 manifest |
| 前端视图 | `src/types/persona.ts`，秒单位/`color_palette` | 直接作请求体；只许在 `personaFromBackend`/`buildUpdatePayload` 转换 |

| 后端 | 前端 | 规则 |
| --- | --- | --- |
| `inherits` | `parent_id` | 直接映射 |
| `language.max_sentence_len` | `max_sentence_length` | 改名 |
| `rhythm.base_shot_duration_ms` | 秒字段 | `ms=sec*1000`；`None` 保持 `None`，不得填 6 秒 |
| `visual.primary/accent/background_color` | `color_palette` | 双向拆装 |
| `audio.target_loudness_lufs` | `loudness_target_lufs` | 改名 |
| `audio.voice_model` | `voice_clone_model_id` | 改名 |
| `constraints.require_source_citation` | `source_citation_required` | 改名 |
| `version`（string） | `version` | 只读，不作并发令牌 |
| `revision`（int，新增） | `revision` | 响应头/会话字段，不由时间或 version 推断 |
| `parameter` | 六维表单 | commit 时才包对象 |

0/`false`/空串/显式清空均为合法意图；按「字段是否出现」合并（`exclude_unset` / `key in patch`），不得沿用 `_merge_draft` 跳过假值。遗留 Persona 缺 `parameter` 显示「未设置」或显式初始化，不合成默认值。

### 0.3 API 状态总表

| 编号 | 路径 | 状态 | 里程碑 |
| --- | --- | --- | --- |
| A1 | `POST .../chat/start` | 现有，不改语义 | M2 可选补持久化 |
| A2 | `POST .../chat/message` | 现有，增可选 `client_message_id`/`revision` | M2 |
| A3 | `POST .../chat/message/stream` | 现有，同上；SSE 事件名不变 | M2 |
| A4/A5 | `GET .../state/{id}`、`GET .../sessions` | 现有，形状冻结 | — |
| A6 | `DELETE .../sessions/{id}` | 现有，现无 owner 检查 | M2 补 |
| A7 | `POST .../chat/commit` | 现有，新字段可选 | M2 |
| A8 | `/knowledge...` | 现有，与消息附件非同一存储 | — |
| A9 | `GET .../sessions/{id}` | **拟新增**：历史+草稿+附件+revision，游标分页 | M1 契约/M2 实现 |
| A10 | `PATCH .../sessions/{id}/draft` | **拟新增**：白名单 + 三态人工修订 | M1/M2 |
| A11 | `POST .../chat/attachments` | **拟新增（路径待评审）**：上传 | M1/M2 |
| A12/A13 | `GET/DELETE .../attachments/{id}` | **拟新增**：受控读取；可选删除 | M2 |
| A14 | `GET /api/persona/list` | 现有 `list[str]` | — |
| A15 | `GET /api/persona/{id}` | 现有，加 `ETag`/`X-Persona-Revision` | M2 |
| A16 | `POST /api/persona/create` | 现有，完整 manifest | M3 复用 |
| A17 | `PUT /api/persona/{id}` | 现有，**拟变更**：`If-Match` | M2/M3 |
| A18 | `GET/PUT .../prompt`、`.../vision-prompt` | 现有，**拟变更**：`If-Match`，形状不变 | M2 |
| A19 | `from-prompt`/`from-script`/`dialogue/*` | 现有，保留 | M4 决策 |

统一错误体 `{code,message,field_errors?,retryable?,current_revision?}`：400 字段/附件、403 owner、404 不存在、409 ID/幂等冲突、410 过期、412 revision 冲突、413 超体积、422 schema、429 限流。SSE `error` 必须带同一 code 与消息 ID。

### 0.4 依赖与粒度

M1 契约冻结 → M2 后端 → M3 前端 → M4 灰度；映射 fixture 贯穿 M1–M3。M1 前不写业务，M2 前前端不调 A9–A13。每任务一提交（`feat|fix|test(chatforge): ...`），每里程碑留回滚点。

---

## M1 契约、数据模型、字段映射、附件契约

### 目标

1. 把 §5.1/§6.3 固化为可执行模型、TS 类型、共享 fixture，同一请求/应答样本两端校验通过。
2. 冻结 A9/A10/A11/A7 的请求响应、错误码、游标、revision；只定义不挂业务路由。
3. 建立映射单一入口与 round-trip 测试，API 层不得出现前端别名。

### 改动文件

| 侧 | 文件 | 动作 | 内容 |
| --- | --- | --- | --- |
| 后端 | `clipwright/schema/persona.py` | 改 | `ConstraintsConfig` 增 `min_duration_sec<=max_duration_sec`；确认镜头 `None` 或 ≥100 |
| 后端 | `clipwright/schema/chat_forge.py` | 新增 | `Message/AttachmentMeta/SessionDetail/DraftPatch/CommitRequest/ApiError/FieldError` |
| 后端 | `clipwright/api/persona_forge.py` 或 `api/chat_forge.py` | 改（仅类型） | A2/A3/A7 加 `response_model`/可选字段；归属以 `main.py` 注册为准 |
| 后端 | `tests/contracts/persona_chatforge/*.json` | 新增 | start/message/done/state/sessions/commit/detail/draft/attachment/error |
| 后端 | `tests/test_persona_chatforge_schema.py` | 新增 | 范围、三态、错误体 |
| 后端 | `docs/api_reference.md` | 改 | 「拟新增（未上线）」+ 错误码，明确未实现 |
| 前端 | `src/types/persona.ts` | 改 | DTO 与 view model 分层、守卫、映射签名 |
| 前端 | `src/types/chatforge.ts` | 新增 | `ChatSessionDetail/ChatMessage/ChatAttachment/DraftPatch/CommitRequest/ApiErrorBody` |
| 前端 | `src/types/__tests__/personaMapping.test.ts` | 新增 | round-trip、`None`、0/false/空值 |
| 前端 | `src/services/api/persona.ts` | 改（仅类型） | A9–A11 签名；M1 不接调用点，避免请求未上线端点 |

### API

- 不新增可调用端点；A9–A11 只有 schema 与 OpenAPI 片段。
- A2/A3 可选 `client_message_id`、`revision`；`done` 增 `revision` 不破坏旧客户端。
- A7 可选 `expected_revision`、`idempotency_key`、`parameter`（必须 `ParameterLayer`）、`prompt`、`vision_prompt`；全缺等价旧语义。
- A17/A18 定义 `If-Match: "<revision>"`，412 带 `current_revision`；A9 定义 `?cursor=&limit=`。

### 数据结构

```python
class Message(BaseModel):
    id: str; role: Literal["user","assistant","system"]; content: str
    created_at: datetime
    status: Literal["pending","sent","failed","interrupted"]
    attachment_ids: list[str] = []

class AttachmentMeta(BaseModel):
    id: str; name: str; detected_mime: str; size: int; sha256: str
    analysis_status: Literal["pending","parsed","not_analyzed","failed","rejected"]
    storage_ref: str            # 相对受控目录，不得含绝对路径

class SessionDetail(BaseModel):
    schema_version: int = 2; session_id: str; owner_id: str | None
    status: Literal["active","committed","expired"]; revision: int
    messages: list[Message]
    persona_draft: dict[str, Any]   # 扁平六维，禁止 parameter 键
    prompt_draft: str = ""; vision_prompt_draft: str = ""
    field_sources: dict[str, str]   # 规范字段路径 → user/model/default/manual
    missing_dimensions: list[str]; progress: dict[str, float]  # 六个维度名 → 0..1
    attachments: list[AttachmentMeta]
    created_at: datetime; updated_at: datetime
    committed_persona_id: str | None = None; next_cursor: str | None = None

class DraftPatch(BaseModel):
    expected_revision: int
    parameter_patch: dict[str, Any] | None = None
    prompt_draft: str | None = None
    vision_prompt_draft: str | None = None
```

判定：① 草稿扁平，commit 才包 `parameter`；② revision 为 int，与 `version` 分离；③ 只回相对路径；④ `model_fields_set` 区分「未出现」与「显式 null」；⑤ 显式 null 仅限可清空字段。前端逐字段 camelCase 对齐并加守卫，不用 `as`。映射纯函数：`personaFromBackend`、`buildUpdatePayload(view, rawManifest)`、`draftToParameter`（仅 commit）。

### 迁移

- 无数据迁移；`schema_version=2` 先定义，v1 读取在 M2。
- 契约只增不改；删字段须升版本并留一个发布窗口兼容读。
- fixture 即 M2 迁移对账基准（迁移输出须过同一组 schema）。

### 测试

1. 六维范围：密度/比例 0..1、镜头 `None` 或 ≥100、颜色 `#RRGGBB`、响度 −30..−10、时长关系。
2. `DraftPatch` 四种输入（缺省/null/0/false）的 `model_fields_set` 不同。
3. `SessionDetail` 拒绝绝对 `storage_ref`、拒绝草稿含 `parameter`。
4. 同一 fixture 双端解析字段集合零差异；高级字段（`cut_profile/palette/bgm_slots/forbidden_topics`）与空值 round-trip 相等。

### 验收命令

```powershell
cd J:\Clipwright; py -3.14 -m pytest tests/test_persona_chatforge_schema.py -q; py -3.14 -c "import clipwright.main"
cd J:\Clipweight-Client; npx tsc --noEmit; npm run test -- src/types/__tests__/personaMapping.test.ts
```

### 风险

| 风险 | 缓解 |
| --- | --- |
| 模型与真实路由漂移 | M1-T0 先核对 `main.py` 与两个 api 文件归属 |
| DTO 拆分引发类型错 | 旧别名留窗口；先测映射再替换调用点 |
| 草稿误当 `parameter` | schema 禁止 `persona_draft.parameter`，测试固化 |
| `If-Match` 灰度未定 | M1 只定头格式与 412 体，强制与否 M4 裁决 |

---

## M2 后端：会话历史、附件、草稿、commit 幂等

### 目标

1. 一次成功转移落盘消息、草稿、Prompt 草稿、附件引用、revision；修 F2。
2. A9/A10 可用；未知/过期 404/410，删除 F9 隐式创建。
3. 附件受控：嗅探 MIME、真实字节、SHA256、配额、TTL；JSON 不再内嵌 Base64。
4. commit 幂等且原子：同 key 原 manifest，不同 key 同 ID 409，绝不覆盖。

### 改动文件

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `clipwright/services/chat_forge.py` | 改 | 状态机、v2 落盘、同步二次持久化、严格读取、TTL/GC |
| `clipwright/services/persona_forge.py` | 改 | 安全提交、ID 锁、Prompt 组装 |
| `clipwright/services/chatforge_attachments.py` | 新增 | 上传、嗅探、配额、受控读取、清理 |
| `clipwright/api/persona_forge.py` / `api/chat_forge.py` | 改 | A9–A13；A2/A3/A6/A7 新字段与错误码 |
| `clipwright/api/persona.py` | 改 | A15 ETag、A17/A18 If-Match、412 |
| `clipwright/persona/repository.py` | 改 | revision 侧车、原子替换、ID 存在性检查防 TOCTOU |
| `scripts/migrate_chatforge_sessions.py` | 新增 | v1→v2，`--dry-run/--backup/--report` |
| `tests/test_persona_chatforge_{session,attachments,commit}.py` | 新增 | 见测试 |
| `docs/api_reference.md`、`docs/frontend-backend-parity.md` | 改 | 端点转正、限制、错误码 |

### API

| 端点 | 状态 | 关键行为 |
| --- | --- | --- |
| A9 `GET .../sessions/{id}` | 新增 | 游标分页；未知 404、过期 410；不隐式新建；limit ≤200 |
| A10 `PATCH .../draft` | 新增 | `expected_revision` 不符 409 + `current_revision`；白名单；0/false/空/null 生效 |
| A11 `POST .../attachments` | 新增 | multipart；白名单；伪造/损坏 400、超限 413；返回 `analysis_status` |
| A12/A13 | 新增 | 校验归属，不可枚举；仅未发送/未引用可删 |
| A2/A3 | 扩展 | 同 `client_message_id` 重试返同条，冲突 409；`done` 带 revision |
| A6 | 修正 | owner/状态检查；已 committed 默认拒绝删除（M4 裁决） |
| A7 | 扩展 | 旧三字段合法；新字段见下 |
| A15/A17/A18 | 扩展 | ETag/If-Match；不符 412 + `current_revision`，不静默合并 |

commit 顺序：① 读真实 session（404/410）→ ② owner/状态（已 committed 仅同 key 重放）→ ③ `expected_revision` 比对（409）→ ④ 组装 `parameter/prompt/vision_prompt`（请求>草稿>默认，校验失败 422+`field_errors`）→ ⑤ ID 解析与 `validate_id`，已存在无同键记录 409 → ⑥ 锁内查幂等与占用，暂存→写参数/Prompt→提交标记→原子切换 → ⑦ 记 `committed_persona_id`、status、revision、幂等记录 → ⑧ 返回 manifest，失败回滚暂存。

幂等记录 `chatforge_commits/<key>.json`：`{idempotency_key,session_id,persona_id,request_fingerprint,response_persona_id,response_revision,created_at}`；同 key 但 fingerprint 不同 → 409。

### 数据结构

```text
chatforge_sessions/<session>.json      # v2，无 Base64
chatforge_sessions/<session>.lock
chatforge_attachments/<session>/<attachment_id>
chatforge_attachments/<session>/index.json
chatforge_commits/<idempotency_key>.json
personas/<persona_id>/.revision        # int 侧车，不改 manifest 形状
```

v2 JSON 字段：`schema_version/session_id/owner_id/status/revision/messages[]/persona_draft/prompt_draft/vision_prompt_draft/field_sources/missing_dimensions/progress/attachments[]/created_at/updated_at/committed_persona_id`。消息 ID 服务端生成，`client_message_id` 仅去重。写盘用临时文件 + `os.replace`，磁盘失败返回 500 且不推进 revision。TTL 默认内存 1 小时不变，磁盘保留期独立配置（拟议 7 天，M4 裁决）；GC 只删 expired 超期与无引用附件，删前审计（不含正文）。

### 迁移

1. 先上兼容读：v1 补 `id=msg-<index>-<hash8>`、`revision=0`、`status`、`schema_version=1`，内存转换不重写。
2. 附件：`data_url` 解码→嗅探→SHA256→落受控目录→换 `attachment_ids`，同 hash 去重；成功后重写 v2，原文件移 `_backup/<ts>/`。
3. 失败：无法解码/超限/非白名单 → 标 `legacy_inline` 只读，保留原 JSON，报告列原因。
4. 脚本：`--dry-run` 仅统计；`--backup` 整目录复制；`--report` 输出 JSON；失败退出码非 0。
5. 回滚：保留旧文件与备份；v2 读取器不删字段，旧版仍可读 manifest 与文本 Prompt。

### 测试

| 用例 | 断言 |
| --- | --- |
| 同步落盘 | JSON 含两条消息 → 重启 → A9 可见 |
| 流式中断 | 已确认内容可读，`interrupted`，不伪造 done |
| 未知/过期 | 404 不新增文件；410；DELETE 后 404 |
| 草稿三态 | 0/false/""/null 回读一致；非法字段 422 |
| revision 并发 | 后写 409，`current_revision` 为前者结果 |
| 附件安全 | 伪造扩展名拒绝；>6 MiB 413；路径穿越不落盘；配额 413；跨会话 403/404 |
| commit | 同 key 两份 → 只一份；不同 key 同 ID 409；旧请求不回归 |
| 原子性 | 模拟 `prompt.md` 写失败 → 无半份 Persona，会话 active |
| owner | A6/A7/A9–A12 非 owner 全拒；token-only 信任边界入文档 |

### 验收命令

```powershell
cd J:\Clipwright
py -3.14 -m pytest tests/test_persona_chatforge_session.py tests/test_persona_chatforge_attachments.py tests/test_persona_chatforge_commit.py -q
py -3.14 -c "import clipwright.main"
py -3.14 scripts/migrate_chatforge_sessions.py --dry-run --report .\reports\migrate-dryrun.json
py -3.14 scripts/migrate_chatforge_sessions.py --backup --report .\reports\migrate-report.json
```

### 风险

| 风险 | 缓解 |
| --- | --- |
| 单进程锁不足 | 明确单进程前提；`filelock`/`msvcrt` 文件锁；多进程改存储 CAS（M4） |
| 多文件非单事务 | 暂存目录 + 提交标记 + 启动清理未完成暂存 |
| 附件内存/磁盘 | 流式写临时文件、分块校验、会话/全局配额、413 早拒 |
| TTL 冲突 | 双 TTL：active 1h、retention 独立；410 给新建引导 |
| 两套附件语义混用 | 同请求同时出现 `attachment_id` 与 `data_url` → 400 |

---

## M3 前端：对话创建、手动创建、详情只读 + 编辑

### 目标

1. 对话闭环：真实恢复、消息/附件状态、预览确认再提交；删离线模拟与「40% 放行」。
2. 手动闭环：无模型填完整六维与两类 Prompt，提交完整 manifest，重开一致。
3. 详情先只读，显式编辑；以 revision 为基，冲突可恢复，取消不写。
4. 图库区分两个创建入口，演示数据隔离，`onPick` 保留且详情可达。

### 改动文件

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `src/features/settings/PersonaGalleryPanel.tsx` | 改 | 两入口；失败/空库/演示三态；卡片默认查看，`onPick` 另给详情 |
| `src/pages/PersonaPage.tsx` | 改 | 查看 vs 选择路由 |
| `src/pages/PersonaForgePage.tsx` | 改 | 编排：模式选择、恢复、异步代际 |
| `src/features/persona/forge/{SessionList,MessageList,AttachmentQueue,DraftPanel,ConfirmPreview}.tsx` | 新增 | 会话、消息、附件队列、六维+Prompt、确认预览 |
| `src/features/persona/forge/useChatForgeSession.ts` | 新增 | 状态机、SSE、abort、revision、恢复 |
| `src/features/persona/manual/ManualCreateForm.tsx` | 新增 | 可视化 + 结构化编辑，提交完整 manifest |
| `src/pages/PersonaDetailPage.tsx` | 改 | 只读/编辑、快照、ETag、未保存提醒、冲突面板 |
| `src/types/persona.ts`/`chatforge.ts`、`src/services/api/persona.ts` | 改 | 守卫、错误体、A9–A13、ETag、412 解析 |
| `src/features/persona/__tests__/*` | 新增 | hook/组件 |

### API

| 场景 | 调用 | 状态 | 备注 |
| --- | --- | --- | --- |
| 启动 | A1 | 现有 | 失败保留输入重试；空 `reply` 不渲染助手消息 |
| 发消息 | A11→A2/A3 | 新+现有 | 先传后发；同 `client_message_id` 不重复 |
| 恢复 | A5→A9 | 现有+新 | 列表只选择，进入必 A9 |
| 改草稿 | A10 | 新 | 防抖 + expected_revision；409 重拉 |
| 提交 | A7 | 现有扩展 | 成功后跳详情；同 key 重试 |
| 手动创建 | A16 | 现有 | 409 显示冲突，不自动改 ID |
| 详情读/存 | A15、A17/A18 | 现有扩展 | 412 → 重载/放弃/手工合并 |
| Prompt 快捷存 | A18 | 现有扩展 | 与整份保存同一 revision，禁陈旧回写 |

删除 `PersonaForgePage` 中随机进度定时器、离线伪造成功、失败仍推进的代码。

### 数据结构

```ts
interface ForgeState {
  sessionId: string | null; sessionRevision: number;
  messages: ChatMessage[];                 // 稳定 id + status
  attachments: ChatAttachment[];           // 上传中/成功/失败
  draft: PersonaDraft;                     // 扁平六维，字段名同后端
  promptDraft: string; visionPromptDraft: string;
  fieldSources: Record<string, 'user' | 'model' | 'default' | 'manual'>;
  missingDimensions: string[];
  pendingMessageId: string | null;         // client_message_id
  loadState: 'idle' | 'loading' | 'ready' | 'expired' | 'error';
  error: ApiErrorBody | null;
}
```

规则：① 切会话先 abort 并递增 generation，晚到响应按 `sessionId+generation` 丢弃；② 仅 `done` 应用结构化草稿，`error` 不自动重发；③ 附件未上传不许发送；④ 手动创建以 `rawManifest` 为基底，未知字段、`knowledge`、`inherits`、`owner_id` 原样带回；⑤ 详情用工作副本，保存成功重新 GET，取消二次确认。

### 迁移

- `localStorage` 仅存最后 session ID：改「取 ID → A9」，404/410 清 ID 并提示过期，不展示假摘要。
- 旧 data URL 路径留开关后（`personaChatforgeLegacyAttachments`，M3-T1 定名），与 A11 互斥。
- 旧组件按功能拆分，不并行保留两套可写路径；from-prompt/from-script/问答保留，结果先进可审核详情，M4 再统一。
- 演示 Persona 仅在 demo 标识下展示，禁止进入可保存链路。

### 测试

1. 映射：`buildUpdatePayload` 保留未知字段；`None` 不写成 6000；0/false 可提交。
2. Hook：切会话丢弃旧响应；SSE 中断无助手消息；同 ID 重试不追加。
3. 组件：>6 MiB 或 >4 个前置拒绝；上传失败阻止发送；提交失败保留草稿。
4. 手动创建：提交→GET→表单一致。
5. 详情：只读无输入控件；取消无写入；412 有冲突面板；GET 失败无可保存 shell。

### 验收命令

```powershell
cd J:\Clipweight-Client
npx tsc --noEmit
npm run test -- src/types/__tests__/personaMapping.test.ts src/features/persona/__tests__
npm run build
```

手工：创建→传图/TXT→刷新恢复→预览→提交→只读→编辑保存→重开复核。

### 风险

| 风险 | 缓解 |
| --- | --- |
| 调用未上线端点 | M3 前确认 M2 合并；类型标 `@since M2` |
| SSE+重试重复消息 | 服务端 client ID 去重；前端只按服务端 ID 合并 |
| 大附件卡死 | 前置校验大小/类型；超限直接拒；流式由 M2 契约定 |
| 只读/编辑状态残留 | 工作副本 + 离开确认 + revision 校验 |
| 手动表单丢高级字段 | rawManifest 基底 + 结构化编辑 + 保存前 diff |
| 两个保存路径互覆盖 | 同 ETag；冲突必须用户选择，禁自动重试 |

---

## M4 测试、迁移、灰度、文档

### 目标

1. 把 PRD §10 固化为回归矩阵：断线、重启、越权、并发、旧数据、无模型配置。
2. 真实迁移与回滚演练，产出可审计报告。
3. 灰度：后端兼容读→新端点→前端 v2（可关）→关旧 data URL→移除过渡兼容。
4. 文档/OpenAPI 同步，验收留脱敏样本与文件对账。

### 改动文件

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `tests/test_persona_chatforge_e2e.py` | 新增 | 创建→恢复→预览→提交→详情→编辑→重开 |
| `tests/test_persona_chatforge_compat.py` | 新增 | 旧 session JSON / 旧 Persona 迁移前后可读 |
| `tests/test_persona_chatforge_security.py` | 新增 | 越权、穿越、伪造 MIME、注入样本 |
| `tests/contracts/persona_chatforge/` | 改 | 410/412/413/错误体样本 |
| `scripts/migrate_chatforge_sessions.py` | 改 | 统计、失败清单、幂等重跑 |
| `docs/api_reference.md`、`docs/frontend-backend-parity.md` | 改 | 端点转正、限制、示例 |
| `J:\Clipwright\docs\Persona.md` | 改 | 字段口径、revision、附件、commit |
| `docs/persona-chatforge-refactor-prd.md` | 改 | 状态与偏差记录 |

### API

- 冻结 A1–A19 路径与字段；本阶段不新增端点。
- 仅允许错误码补充（不改成功响应）、文档与 OpenAPI 描述。
- `data_url` 与 `attachment_id` 并存窗口由配置决定；淘汰前一个周期提示，不静默拒绝旧客户端。

### 数据结构

- 无新结构；`schema_version=2` 为唯一写入版本，v1 只读。
- 迁移报告：`{scanned,migrated,skipped,failed:[{session_id,reason}],bytes_before,bytes_after,attachments,duration_ms}`，归档为验收附件。

### 迁移

1. 停写或切只读开关。
2. 备份会话目录与 Persona 根目录，记录校验和。
3. dry-run，人工核对失败清单，不允许「未知失败」。
4. 正式迁移（`--backup`），抽 10 个会话验 A9 顺序与附件可访问。
5. 旧 Persona 逐条 GET 对比快照，Prompt 逐字节一致。
6. 副本回滚演练：恢复备份 + 旧代码启动，manifest 与文本 Prompt 可读。
7. 观察一个发布周期后删旧字段与旧上传分支。

### 测试

| 维度 | 通过条件 |
| --- | --- |
| 对话/附件 | 文本+图片+TXT/MD；无视觉能力明确「未分析」；伪造 MIME/超限拒绝且不进 LLM |
| 草稿/Prompt | 0/false/清空可保存；非法值不能提交；文件与预览一致 |
| 恢复 | 刷新/重启/切换后顺序、草稿、Prompt、附件元信息一致；未知/过期不新建 |
| 同步/SSE | 断开、超时、磁盘失败不伪造成功；错误码稳定 |
| 手动创建 | 无 LLM：POST→GET→页面→磁盘一致；重复 ID 409；单位往返不变 |
| 查看/编辑 | GET 失败无可保存 shell；未知字段不丢；并发可恢复 |
| 幂等/权限 | 同 key 无重复；不同 key 同 ID 409；越权全拒 |
| 兼容 | 旧 JSON/旧 Persona 可读；from-prompt、知识库、导入导出不回归 |

### 验收命令

```powershell
cd J:\Clipwright
py -3.14 -m pytest tests -q
py -3.14 -m pytest tests/test_task_api.py tests/test_event_contract.py tests/clipwright/test_run_addressing_api.py tests/clipwright/test_agent_run_replay.py -q
py -3.14 -c "import clipwright.main"
py -3.14 scripts/migrate_chatforge_sessions.py --dry-run --report .\reports\migrate-dryrun.json
cd J:\Clipweight-Client; npx tsc --noEmit; npm run test; npm run build
```

通过：零失败（跳过列原因）；迁移 `failed` 为空或有解释；端到端清单打勾并附脱敏证据。

### 灰度与回滚

- 开关：前端 `personaChatforgeV2`，后端 `CHATFORGE_V2_WRITE`（默认关→开）；内部账号先开。
- 观测：创建成功率、A9 404/410 比例、409/412 次数、附件拒绝原因、平均字节、迁移失败数。
- 回滚：关开关回旧路径；v1 备份保留；不删用户已编辑 Prompt；v2 会话由兼容读承接，旧代码不得覆盖。

### 风险

| 风险 | 缓解 |
| --- | --- |
| 迁移不可逆 | 备份 + dry-run + 失败清单 + 副本演练；迁移器幂等 |
| 双写/双读不一致 | 单一写入口；v2 后旧路径只读；切换前排空 |
| 全量测试长跑不稳 | 固定关键集 + 独立 job，记录基线 |
| 旧客户端 data URL | 至少一个周期提示；先 413 再 400，给迁移指引 |
| 权限仅本地 token | 文档写「本机受信任用户」；多用户另立 owner 清单 |

---

## 附录 A：执行顺序

M1-T0 路由核对 → T1 映射+测试 → T2 schema → T3 双端 fixture → M2-T1 落盘 → T2 历史 → T3 草稿 → T4 附件 → T5 commit → T6 revision → T7 迁移 → M3-T1 hook → T2 消息/附件 → T3 草稿/确认 → T4 手动 → T5 图库/详情 → T6 删模拟 → M4-T1 回归 → T2 迁移/回滚 → T3 灰度观测 → T4 文档。

## 附录 B：禁止事项

1. 前端 view model 直接 POST A16/A17；必须过 `buildUpdatePayload`。
2. API 层出现 `parent_id`、`max_sentence_length`、`color_palette`、`loudness_target_lufs`、`source_citation_required`、`voice_clone_model_id`。
3. 草稿写成 `{parameter:{...}}` 或整份 manifest 塞 `persona_draft`。
4. `base_shot_duration_ms=None` 换成 6000 或 UI 默认。
5. 用 40% 进度或前端校验替代后端 schema。
6. 未知 session 隐式创建；把 404/500 包装成成功。
7. commit 覆盖同 ID 或无 key 重试产生第二份。
8. 会话 JSON 内嵌整张 Base64；回显绝对路径。
9. 同一请求混用 `data_url` 与 `attachment_id`。
10. 用演示/离线模拟通过验收；宣称模型已读「未解析」附件。
11. 未实现就把 A9–A13 标「已实现」。

## 附录 C：里程碑完成标准

- M1：双端 fixture 通过，映射 round-trip 零差异。
- M2：重启后 A9 全量可见；同 key commit 只一份；旧三字段不回归。
- M3：真实浏览器全流程通过；断网/失败无假成功；只读页无输入控件。
- M4：迁移 `failed` 为空或有解释；回滚演练成功；灰度有基线；PRD 状态更新。
