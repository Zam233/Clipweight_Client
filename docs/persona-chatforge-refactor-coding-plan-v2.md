# Persona ChatForge 重构 Coding Plan v2（M1–M4）

- 状态：待评审，编码前基线；替代 [v1](./persona-chatforge-refactor-coding-plan.md)
- 依据：[PRD](./persona-chatforge-refactor-prd.md)（§5.1 字段命名、§6.3 API 复核优先）
- 范围：后端 `J:\Clipwright`、前端 `J:\Clipweight-Client`；分支 `feat/zam_persona_chatforge_refactor`
- 口径：**只有标「现有」的才是已实现**；「拟变更/拟新增」一律未实现，不得当既有能力引用。M1 只产模型与 fixture，不注册新路由。

## 0. 相对 v1 的独立评审

### 0.1 修正（必做）

| # | v1 问题 | v2 处理 |
| --- | --- | --- |
| C1 | `progress` 只在类型行写了 `dict[str,float]`；§0.3 称形状冻结、M3 的 `ForgeState` 无此字段、验收仍按“40% 整体”放行 | 契约/API/TS/用例钉死六键 dict；`overall=round(mean(六维)*100)` 只展示不落盘 |
| C2 | 路径未写全前缀，漏 `refine`、`commit-prompt`、`knowledge` PUT/DELETE | 全表用 `/api/persona/forge/chat/...` 完整路径，补“现有但不改”端点 |
| C3 | 按“大量旧会话”排迁移，实际库为空 | 迁移器保留；dry-run 期望 `scanned=0`，能力用合成 fixture 验收 |
| C4 | 未发现与 F9（未知 session 改 404）冲突的既有测试 | `test_chat_forge_stream.py:197` 先反转再改实现 |
| C5 | 只抄“4×8 MiB”，漏全局 20 MiB JSON 体上限（`main.py:386`） | 旧契约 4×6 MiB base64≈32 MiB 必 413；新上传 multipart + 端点自校验 |
| C6 | 未指出空 Prompt / vision no-clobber 造成“保存假成功”（`repository.py:74-88`） | 按“字段是否出现”写；空串=清空；vision 显式覆盖 |
| C7 | 未指出 `personaFromBackend` 合成 `tone='neutral'` 等默认值 | 详情/手动改 DTO；缺失显示“未设置”；旧映射只给图库只读卡 |
| C8 | 手动创建未提 `/create` 与 PUT 的 ID/owner 风险（`api/persona.py:44-68`） | 强制 `manifest.persona_id==path id`；owner 取服务端值 |
| C9 | 前端测试放 `src/types/__tests__/`，不合共置约定 | 扩展 `src/types/persona.test.ts` 等共置文件 |

### 0.2 保留

F1–F10 基线；三层字段分层与边界转换；A1–A19 编号骨架与统一错误体；附件受控目录 + SHA256 + 相对引用；commit“校验→组装→加锁→写→记幂等”顺序；灰度顺序；附录禁止事项。

### 0.3 删除 / 降级

1. **D1** `status.expired` 落盘会让读请求写盘 → 只存 `active/committed`，过期读取时判 410。
2. **D2** 前端 `personaChatforgeV2` 运行时开关：仓库无 flag 基础设施 → 不做，靠后端开关与发布顺序。
3. **D3** “旧码可读 v2 会话”作回滚：旧前端无 `data_url` → 回滚=代码整包 + 恢复备份 JSON。
4. **D4** `tests/contracts/` 顶层目录 → `tests/clipwright/contracts/chatforge/`。
5. **D5** 附件路径只写“待评审” → 给唯一候选 N3–N5，标拟新增。

### 0.4 复核后事实基线

- **F1** `/start` 的 `reply` 恒空；`scope/context` 只回显不落盘（`chat_forge.py:406-421`）。
- **F2** 同步 `/message` 追加助手消息后**不再持久化**（`chat_forge.py:446-451`）。
- **F3** `/state` 仅 `session_id,message_count,persona_draft,knowledge_base_count,created_at,updated_at`。
- **F4** `/commit` 只收 `{session_id,persona_id?,persona_name?}`；默认 `chat_<session>`；无幂等/防覆盖。
- **F5** `/prompt` GET `{persona_id,prompt}`；vision PUT `{status,persona_id}`。
- **F6** `/create`、PUT `/{id}` 收发完整 manifest；POST 409；PUT 整份替换。
- **F7** `/api/persona/list` 返回 `list[str]`。
- **F8** 附件 `{type,name,mime,data_url}`，4 个、单 `data_url` ≤8 MiB 字符，只校验标记/数量/长度。
- **F9** 未知 session 由 `_get_or_create_session` 隐式创建（`chat_forge.py:222-228`）。
- **F10** Prompt 到 commit 才由用户原话拼接；vision 关键词筛选 + no-clobber。
- **F11** `_persist_session` 吞异常只告警，接口仍成功（`chat_forge.py:158-175`）。
- **F12** 非 multipart 体上限 20 MiB，multipart 跳过（`main.py:386,412-421`）。
- **F13** PUT 不校验路径/body ID；body `owner_id` 会被采用（`api/persona.py:59-68`）。
- **F14** `save_manifest` 仅 `prompt` 真值时写；vision 仅文件不存在时写（`repository.py:74-88`）。
- **F15** `from-prompt/from-script/refine/dialogue/build` 直接 save，不查重、无 409。
- **F16** `scope=mv_prompt` 复用同一组 chat 端点，本期不得破坏。

## M1 契约、数据模型、字段映射

### 目标

1. 把 §5.1/§6.3 固化为 Pydantic 模型与 TS DTO，冻结 N1–N6 请求/响应。
2. 建立唯一映射入口与共享 fixture，同一份样本两端零差异。
3. 只定义不挂业务路由，现有端点行为零变化。

### 改动文件（后端 `J:\Clipwright`）

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `clipwright/schema/chat_forge.py` | 新增 | Message/AttachmentMeta/SessionDetail/DraftPatch/CommitRequest/Preview/ApiError |
| `clipwright/schema/persona.py` | 改 | `ConstraintsConfig` 加 `min<=max`；别名 validator 标 deprecated（保留兼容，不作契约） |
| `tests/clipwright/test_chatforge_schema_contract.py` | 新增 | 范围、三态、拒绝对路径、草稿禁 `parameter` |
| `tests/clipwright/contracts/chatforge/*.json` | 新增 | start/message/done/state/detail/draft/attachment/commit/error |
| `scripts/sync_chatforge_fixtures.py` | 新增 | 后端 canonical → 前端副本，`--check` 哈希 |
| `docs/api_reference.md` | 改 | 标“拟新增（未上线）”，列错误码 |

### 改动文件（前端 `J:\Clipweight-Client`）

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `src/types/personaDto.ts` | 新增 | `PersonaManifestDto`、`ParameterLayerDto`（全部后端字段含高级字段） |
| `src/types/chatforge.ts` | 新增 | `ChatSessionDetailDto`、`ChatMessageDto`、`ChatAttachmentDto`、`DraftPatch`、`CommitRequest`、`ApiErrorBody` |
| `src/features/persona/__fixtures__/chatforge/` | 新增（生成） | 同源副本，带 `_meta.sha256` |
| `src/types/chatforge.contract.test.ts` | 新增 | DTO 守卫、六键 progress、fixture 哈希 |
| `src/services/api/persona.ts` | 不改 | M1 不接新端点，避免请求未上线路由 |

### API

- 不新增可调用端点；A1–A14 行为不变，N1–N7 只有类型与 fixture。
- A2/A3 的 `client_message_id`、`attachment_ids`、`revision` 为拟变更；A8 新字段为拟新增（旧三字段仍合法）。
- `/persona/{id}` 的 `ETag`/`X-Persona-Revision` 在 M2 实现。

### 数据结构

```python
ChatMessage:        id, seq, role(user|assistant|system), content, created_at,
                    status(sent|failed|interrupted), client_message_id?, attachment_ids[], error_code?
ChatAttachmentMeta: id, name, kind(image|text), detected_mime, size, sha256,
                    analysis_status(pending|parsed|not_analyzed|failed|rejected),
                    storage_ref(相对，禁绝对/..), content_url, created_at
ChatSessionDetail:  schema_version=2, session_id, owner_id?, status(active|committed), revision,
                    messages[], persona_draft(扁平六键，禁 parameter), prompt_draft,
                    vision_prompt_draft, field_sources{路径:user|model|default|manual},
                    missing_dimensions[], progress: dict[str,float](恰六键 0..1),
                    attachments[], created_at, updated_at, committed_persona_id?, next_cursor?
DraftPatch:         expected_revision, parameter_patch?, prompt_draft?, vision_prompt_draft?
ChatCommitRequest:  session_id, persona_id?, persona_name?, expected_revision?,
                    idempotency_key?, parameter: ParameterLayer?, prompt?, vision_prompt?
```

TS 同名 camelCase；`progress` 固定：

```ts
export type Dimension = 'identity'|'language'|'rhythm'|'visual'|'audio'|'constraints';
export type ProgressMap = Record<Dimension, number>; // 六键齐全，0..1
```

校验：`progress` 键集合恰六维；草稿出现 `parameter` 直接拒绝；`storage_ref` 匹配 `^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.[a-z0-9]+$`；`revision>=0`；`seq>=1`；用 `model_fields_set` 区分“未出现”与“显式 null”。

### 迁移

- 无数据迁移；`schema_version=2` 先定义，兼容读在 M2。
- 只增不改：删字段须升版本并留一个发布窗口兼容读。
- fixture 即 M2 迁移对账基准。

### 测试

1. 六维范围：密度/比例 0..1、`base_shot_duration_ms` 为 `None` 或 ≥100、颜色 `#RRGGBB`、响度 −30..−10、`min<=max`。
2. `DraftPatch` 缺省/null/0/false 的 `model_fields_set` 不同。
3. `SessionDetail` 拒绝绝对 `storage_ref`、草稿含 `parameter`、`progress` 缺键/越界。
4. 同 fixture 双端解析零差异；高级字段与空值 round-trip 相等。

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
| 模型与真实路由漂移 | 路由以 `main.py:667-669` 为准；M1 只做模型 |
| DTO 拆分引发类型错 | 旧 `Persona` 保留；新页面只读 DTO |
| fixture 两仓漂移 | `--check` 进 M4 回归，哈希不一致即失败 |
| 别名 validator 掩盖前端 bug | 新契约用例只发规范字段 |

## M2 后端：会话、附件、草稿、commit、revision

### 目标

1. 一次成功转移内落盘消息、草稿、Prompt 草稿、状态、revision；修 F2/F11。
2. N1/N2 可用；未知 404、过期 410，删除 F9 隐式创建。
3. 附件受控：magic 嗅探、真实字节、SHA256、配额、TTL；JSON 不再内嵌 Base64。
4. commit 幂等且绝不覆盖；Persona 保存有 revision/CAS；Prompt 两路不再假成功。

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
| `clipwright/config.py`、`pyproject.toml` | 改 | TTL、配额、`CHATFORGE_V2_MODE`、`PERSONA_CAS_MODE`；声明已在用的 `pillow/filelock` |
| `scripts/migrate_chatforge_sessions.py` | 新增 | v1→v2，`--dry-run/--backup/--report` |
| `tests/clipwright/test_chat_forge_stream.py` | 改 | 反转 `test_new_session_is_created_on_demand` |
| `tests/clipwright/test_chat_forge_debts.py`、`test_chatforge_persist.py` | 改 | 404/410、同步落盘、progress dict |
| `tests/clipwright/test_chatforge_{sessions_api,attachments,commit,security,migration,revision_api}.py` | 新增 | 见测试 |

### API

| 端点 | 状态 | 行为 |
| --- | --- | --- |
| A1 `/start` | 现有 | 附 `revision:0`；**不持久化** `scope/context`（F1 不变） |
| A2/A3 message | 现有·拟变更 | `client_message_id` 去重；返回 `message_id/revision`；sync 成功后持久化助手消息 |
| A5 `/state` | 现有 | 形状不变 |
| A6 DELETE | 现有·拟变更 | owner 校验；只删会话与附件，不级联 Persona |
| A8 `/commit` | 现有·拟变更 | 新字段全可选；同 key 返原 manifest，不同 key 同 ID 409 |
| N1 详情 | **拟新增** | `?cursor=&limit=`（≤200）；未知 404、过期 410；不隐式新建 |
| N2 draft | **拟新增** | `expected_revision` 不符 409+`current_revision`；0/false/""/显式 null 生效 |
| N3 上传 | **拟新增** | multipart `file`；白名单；伪造 415、超限 413 |
| N4/N5 | **拟新增** | 校验归属；仅未被消息引用可删 |
| N6 preview | **拟新增** | 编译+校验，不写盘、不增 revision |
| N7 capabilities | **拟新增** | 灰度能力探测 |
| A10–A13 | 现有·拟变更 | `ETag`/`If-Match`；412 带 `current_revision`；ID/owner 取服务端 |

commit 顺序：① 严格读会话（404/410）→ ② owner/status（已 committed 仅同 key 重放）→ ③ `expected_revision` 比对 → ④ 请求字段 > 草稿 > 旧拼接（仅兼容）→ ⑤ Pydantic 校验，失败 422+`field_errors`（禁用 `_safe_*` 默认可）→ ⑥ `validate_id`、ID 占用 → ⑦ 文件锁内再查幂等/占用 → ⑧ 暂存目录写全量 → `os.replace` 原子落位 → ⑨ 写 `.revision=1`、幂等记录、回写会话。失败清暂存并回滚会话 revision。

幂等记录 `chatforge_commits/<key>.json`：`{key,session_id,persona_id,request_fingerprint,response_persona_id,response_revision,created_at}`；同 key 不同 fingerprint 409。无 key 的旧客户端用兼容键 `legacy:<session>:<target_id>`，同 fingerprint 返回原 manifest。

### 数据结构

```text
chatforge_sessions/<sid>.json          # v2，无 Base64
chatforge_sessions/_staging/<sid>.tmp
chatforge_attachments/<sid>/index.json
chatforge_attachments/<sid>/<attachment_id>.<ext>
chatforge_commits/<key>.json
personas/<pid>/.revision               # int 侧车，不改 manifest 形状
personas/.staging/<pid>-<uuid>/        # commit 暂存目录
```

v2 JSON：`schema_version/session_id/owner_id/status/revision/messages[]/persona_draft/prompt_draft/vision_prompt_draft/field_sources/missing_dimensions/progress/attachments[]/created_at/updated_at/committed_persona_id`。`revision` 只覆盖消息/草稿/状态，附件上传不增；消息 ID 服务端生成，`client_message_id` 只去重；写盘临时文件 + `os.replace`，失败 500 且不推进 revision。

附件：图片 PNG/JPEG/WebP（magic+Pillow `verify`，像素 ≤40MP，单文件 ≤10 MiB）；文本 TXT/MD/JSON（UTF-8 严格、≤1 MiB、拒 NUL）；PDF/Office/音视频一期 415。单消息 ≤4、单会话 ≤20 个/40 MiB。文件名只展示，落盘名=`attachment_id`；`storage_ref` 相对且 `is_within`；`Content-Type` 取检测值、`nosniff`、下载带 `Content-Disposition: attachment`。附件正文按低信任数据注入（分隔符包裹），不得进系统提示词。

### 迁移

1. 兼容读：无 `schema_version` 视为 v1，补 `seq/id/revision=0/status`，内存转换不重写。
2. v1 内联 `data_url`：解码→嗅探→SHA256→落附件目录→换 `attachment_ids`；成功才重写 v2，原文件移 `_backup/<ts>/`。
3. 失败（非白名单/超限/解码失败）标 `legacy_inline` 只读，保留原 JSON 并在报告列原因。
4. 脚本 `--dry-run`（仅统计）、`--backup`、`--report`、`--limit`；失败退出码非 0。
5. 当前库为空：dry-run 期望 `scanned=0`；用合成 v1 样本验收迁移。

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
| 单进程锁不足 | 明确单进程；ID 用 `filelock`；多进程需存储层 CAS（M4 评估） |
| 多文件非单事务 | commit 整目录暂存 + 单次 rename；更新用备份回滚 |
| 附件内存/磁盘 | 1 MiB 分块写、早期 413、会话配额 + GC |
| 旧测试反转遗漏 | C4 首个任务；全量跑 `test_chat_forge*` |

## M3 前端：双入口、恢复、只读详情 + 编辑

### 目标

1. 对话闭环：真实恢复、消息/附件状态、预览确认再提交；删离线模拟与“40% 放行”。
2. 手动闭环：无模型填完整六维与两类 Prompt，提交完整 manifest，重开一致。
3. 详情先只读，显式编辑；以 revision 为基，冲突可恢复，取消不写。
4. 图库区分“对话创建/手动创建”，演示数据隔离。

### 改动文件（前端）

| 文件 | 动作 | 内容 |
| --- | --- | --- |
| `src/router.tsx` | 改 | 新增 `/persona/new` |
| `src/pages/PersonaNewPage.tsx` | 新增 | 创建方式选择 + 手动表单 |
| `src/pages/PersonaForgePage.tsx` | 改 | 拆编排；删模拟/假 session/假成功；接 N1/N2/N3/N6 |
| `src/pages/PersonaDetailPage.tsx` | 改 | 只读/编辑、删 `makeShell`、ETag/412、未保存提醒 |
| `src/features/persona/forge/*`、`manual/*`、`detail/*` | 新增 | 会话/消息/附件/确认；全字段表单；view/edit 状态机 |
| `src/features/settings/PersonaGalleryPanel.tsx` | 改 | 两入口；演示只读；失败/空库分态 |
| `src/types/persona.ts` | 改 | `personaFromBackend` 标 legacy；加 presence 判断 |
| `src/services/api/persona.ts` | 改 | N1–N4/N6、If-Match、错误体解析（M2 合并后接线） |
| 共置测试 | 改/新增 | 见测试 |

### API

| 场景 | 调用 | 状态 |
| --- | --- | --- |
| 启动 | A1 | 现有；失败保留输入重试，不渲染空 reply |
| 发消息 | N3 → A2/A3 | 上传拟新增 + 消息拟变更 |
| 恢复 | A4 → N1 | 列表现有 + 详情拟新增；进入必读详情 |
| 改草稿/预览 | N2、N6 | 拟新增；防抖 + expected_revision |
| 提交 | A8 | 拟变更；同 key 重试；409 让用户改 ID |
| 手动创建 | A11 | 现有；409 显示冲突，不自动改 ID |
| 详情读/存 | A10、A12/A13 | 拟变更；412 冲突面板 |

约束：M2 合并前，前端不得调用 N1–N6；`personaApi` 新方法加 `@since M2`。

### 数据结构

```ts
type LoadState = 'idle'|'loading'|'ready'|'expired'|'not_found'|'error';

interface ForgeState {
  sessionId: string | null; sessionRevision: number;
  messages: ChatMessageDto[]; attachments: AttachmentDraft[];
  draft: PersonaDraftDto;                // 扁平六键，规范字段名
  promptDraft: string; visionPromptDraft: string;
  fieldSources: Record<string, 'user'|'model'|'default'|'manual'>;
  missingDimensions: Dimension[]; progress: ProgressMap; // 六维 dict，不是 float
  loadState: LoadState; generation: number;
  pendingClientMessageId: string | null; error: ApiErrorBody | null;
}

interface PersonaEditorState {
  mode: 'view'|'edit'; dto: PersonaManifestDto | null;
  snapshot: PersonaManifestDto | null; revision: number;
  loadState: LoadState; conflict: { serverRevision: number } | null;
}
```

规则：① `overall=round(mean(Object.values(progress))*100)` 仅展示，不作提交门槛；提交只由 `preview.can_commit` 与后端校验决定。② 切会话先 abort 并 `generation++`，晚到响应按 `sessionId+generation` 丢弃；新快照成功后才替换消息/草稿。③ 恢复用 N1 真消息，不写“已恢复”假消息；404/410 清本地并解释。④ 附件先传后发，发送只带 `attachment_ids`；失败阻止发送。⑤ 流式只在 `done` 应用结构化结果；网络中断不盲目回退同步，仅 404/405（旧后端）且未收字节时用**同一** `client_message_id` 回退一次。⑥ 提交前必须 N6 预览；`idempotency_key` 在确认页生成，字段变更则换 key。

### 迁移

- `localStorage` 键 `clipwright.forgeSessionId`（字符串）→ `clipwright.forgeSession`（`{id,updatedAt}`）；兼容读旧键，读到即迁。
- 旧 `data_url` 组件保留只读窗口，由 `CHATFORGE_V2_MODE` 决定；新 UI 不再产生 `data_url`。
- 删 `simulateProgress`、`uid('forge')` 假会话、无 session 也提示“已保存”的路径。
- 演示 Persona 只在 `dataMode='demo'` 展示，禁入编辑/保存链路；详情移除 `makeShell`。

### 测试

1. 映射：DTO→表单→DTO round-trip；`None` 不写成 6000；0/false/空串可保存；未知字段不丢。
2. Hook：切会话丢弃旧响应；SSE error 不追加助手消息；同 `client_message_id` 重试不重复。
3. 组件：>4 个/超限前置拒绝；上传失败阻止发送；提交失败保留草稿；无 session 不得提示成功。
4. 手动：提交→GET→表单一致；高级字段往返不变。
5. 详情：view 无输入控件；取消无写入；412 冲突面板；GET 失败无可保存壳。
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
| 手动表单丢高级字段 | DTO 基底 + 字段覆盖测试 + 保存前 diff |

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
| 后 | `docs/api_reference.md`、`docs/frontend-backend-parity.md`、`J:\Clipwright\docs\Persona.md` | 端点转正、限制、错误码 |
| 前 | `e2e/persona-chatforge.spec.ts`（可选，需真实后端） | 端到端 |
| 前 | `docs/persona-chatforge-refactor-prd.md` | 只改状态与偏差记录，不改需求 |

### API

- 冻结 A1–A14、N1–N7 路径与字段；本阶段不新增端点。
- 只允许补错误码、文档与 OpenAPI 描述，不改成功响应。
- `data_url` 与 `attachment_ids` 并存窗口由 `CHATFORGE_V2_MODE` 控制；淘汰前一个周期提示。

### 数据结构

- 无新结构；`schema_version=2` 唯一写版本，v1 只读。
- 迁移报告：`{scanned,migrated,skipped,failed:[{session_id,reason}],bytes_before,bytes_after,attachments,duration_ms}`。
- 审计字段：操作、session/persona id、结果、revision；不记录消息与 Prompt 正文。

### 迁移

1. 停写或置 `CHATFORGE_V2_MODE=read`；备份 `chatforge_sessions/`、`personas/` 并记校验和。
2. dry-run，人工核对失败清单；不允许“未知失败”。
3. 正式迁移 `--backup`；抽 10 个会话验 N1 顺序与附件可读（本机 0 个则用合成样本）。
4. 旧 Persona 逐条 GET 对比快照，`prompt.md`/`vision_prompt.md` 逐字节一致。
5. 回滚演练：恢复备份 + 代码整包回滚，验证 manifest 与 Prompt 可读。
6. 观察一个发布周期后删旧字段与 `data_url` 分支；记录后端 tag、前端 hash、备份目录。

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

测试层次：Pydantic/附件解码单测、FastAPI 契约与冲突/重启集成测试、前端映射与竞态单测、真实浏览器端到端；保留脱敏样本与文件对账结果。

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
- 回滚：关 write 回旧路径；代码整包回滚；恢复会话备份；**不删**用户已编辑 Prompt；迁移后新增附件保留（孤儿由 GC 处理）。
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

M1-T0 路由核对 → T1 schema/validator → T2 TS DTO + fixture → M2-T1 反转隐式建会话测试 → T2 持久化/严格读取 → T3 详情/N2 → T4 附件 → T5 commit 幂等 → T6 revision/Prompt → T7 迁移 → M3-T1 hook/恢复 → T2 消息/附件 → T3 草稿/预览 → T4 手动 → T5 详情 → T6 图库/删模拟 → M4-T1 回归 → T2 迁移回滚 → T3 灰度 → T4 文档。

## 附录 B：禁止事项

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
3. PDF/Office 是否进二期（一期 415）。
4. N1–N7 路径需接口评审确认；本计划给唯一候选。
5. 详情页是否永久只保留“整份保存”，还是保留 Prompt 独立保存（需共享 revision）。
