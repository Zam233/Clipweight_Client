# 视频类型创作与修改 PRD

- 状态：待实施
- 范围：`J:\Clipweight-Client` + `J:\Clipwright`
- 分支：`feat/zam_video_type_forge`
- 目标：把现有“类型制作器”从表单 CRUD 升级为 **AI 对话创建 + 详情查看 + 显式编辑/删除**。

## 1. 现状

已有：

- 后端 `/api/type-maker/list|/{id}|create|update|delete|validate|resolve|preview`；
- `TypeDefinition`：`id/name/description/shot_params/persona_mapping/prompts/param_rules/signature_traits/declares/waivers`；
- 前端 `/settings/type-maker`：卡片、内联编辑、复制、删除、预览、规范编辑弹层；
- `/settings/types`：只读类型总览。

缺口：

- 没有 AI 对话创建类型；
- 类型卡片不能进入只读详情；
- 参数/10 个 Prompt 槽位分散在弹层，不能“先看后改”；
- 删除只有卡片入口，详情页没有；
- 内置类型不可修改/删除，需在 UI 明确。

## 2. 目标

1. 对话创建视频类型：像 PersonaForge 一样，左侧历史会话、新会话、消息、附件；会话中实时生成 TypeDefinition 草稿；确认后创建自定义类型。
2. 类型详情：点击类型卡片进入 `/settings/type-maker/{id}`，查看完整参数、Prompt 10 槽位、参数规则、指标、声明。
3. 显式修改：详情页默认只读，点“编辑”才可改；保存走 `PUT /api/type-maker/{id}`；内置类型只读。
4. 删除：详情页提供删除按钮，二次确认；仅自定义类型可删。
5. 保留现有手动创建、复制、预览、规范校验能力。

## 3. 非目标

- 不修改类型插件运行时翻译逻辑；
- 不重写 `TypeDefinition` schema；
- 不新增视频渲染能力；
- 不改变内置 4 类型（knowledge_longform/kichiku_fastcut/digital_review/vlog_daily）；
- 不实现多人协作/权限系统。

## 4. 用户流程

### 4.1 AI 对话创建

1. `/settings/type-maker/forge`。
2. 左侧：`新建类型` + 历史会话（平铺）。
3. 主区：消息流；空态提示“描述你想做的视频类型”。
4. 输入：文本、图片/附件、文稿上传（`.txt/.md/.srt`）。
5. 每次回复后，右侧更新草稿：
   - 名称/描述；
   - shot_params；
   - prompts 10 槽位；
   - param_rules / signature_traits；
   - 缺失项/待确认项。
6. 用户点“保存类型”：
   - 必须有 `id`、`name`、`prompts.genre`；
   - 后端 validate；失败显示逐条错误，不保存；
   - 成功创建自定义类型并进入详情。

### 4.2 查看详情

`/settings/type-maker/{id}`：

- 顶部：名称、ID、内置/自定义、编辑/删除；
- Tabs：
  - 参数：shot_params、persona_mapping、declares；
  - Prompt：10 槽位只读；
  - 规则：param_rules、signature_traits、waivers；
  - 原始 JSON。
- 内置类型：编辑/删除禁用并说明。

### 4.3 修改与删除

- 点“编辑”：快照工作副本，参数和 Prompt 可编辑；
- 保存：`PUT /api/type-maker/{id}`，validate 通过后生效；
- 取消：恢复快照；
- 删除：二次确认，`DELETE /api/type-maker/{id}`；成功后回列表；内置/409/404 显示原因。

## 5. 数据与校验

权威类型：

```python
TypeDefinition(
  id, name, description, shot_params, persona_mapping,
  prompts: dict[slot, PromptSlot], param_rules, signature_traits,
  declares, waivers
)
```

校验：

- id 合法、创建后不可改；
- `prompts.genre` 必填；
- 10 槽位只允许 `genre/anti_patterns/lexicon/structure/material/edit/animation/audio/subtitle/quality`；
- `min_shot_sec <= max_shot_sec`；
- transition 白名单；
- 未知字段拒绝（现有 `extra=forbid`）；
- 内置类型禁止 PUT/DELETE，返回 404/403 语义明确。

## 6. API 契约

现有：

```text
GET    /api/type-maker/list
GET    /api/type-maker/{id}
POST   /api/type-maker/create
PUT    /api/type-maker/{id}
DELETE /api/type-maker/{id}
POST   /api/type-maker/validate
POST   /api/type-maker/resolve
POST   /api/type-maker/preview
```

拟新增 TypeForge：

```text
POST /api/type-forge/chat/start
POST /api/type-forge/chat/message
POST /api/type-forge/chat/message/stream
GET  /api/type-forge/chat/sessions
GET  /api/type-forge/chat/sessions/{session_id}
POST /api/type-forge/chat/commit
DELETE /api/type-forge/chat/sessions/{session_id}
```

会话模型：

```text
session_id, title, messages[],
draft: TypeDefinition,
missing_fields[], progress,
attachments[], revision,
committed_type_id,
created_at, updated_at
```

commit 请求：

```json
{"session_id":"...", "type_id":"...", "definition": {...}}
```

服务端以 `definition` 或草稿重建 TypeDefinition，validate 后 create；ID 冲突 409，不覆盖。

## 7. 前端改造

新增：

- `src/features/typeforge/TypeForgePage.tsx`
- `src/features/typeforge/TypeForgeChat.tsx`
- `src/features/typeforge/TypeForgeSessionList.tsx`
- `src/features/typeforge/TypeForgeDraftPanel.tsx`
- `src/pages/admin/TypeDetailPage.tsx`
- `src/services/api/typeForge.ts`

修改：

- `TypeCatalogPage` / `TypeCatalogPanel` 卡片点击进入详情；
- `TypeMakerPage` 保留手动创建/复制/预览，增加“AI 创建”入口；
- 路由新增 `/settings/type-maker/forge`、`/settings/type-maker/:typeId`。

## 8. 测试

- 后端：session start/message/commit、validate 失败、ID 冲突、内置禁改/禁删、附件；
- 前端：左侧会话、消息恢复、草稿渲染、详情只读、编辑/取消/保存、删除确认、内置禁用；
- 浏览器：对话创建 → 详情 → 编辑 → 删除；手动创建回归。

## 9. 风险

- AI 生成字段不完整/类型变形：必须 validate，禁止直接入库；
- 内置类型删除：UI 禁用 + 后端保护；
- Prompt 10 槽位长度/未知槽位：沿用 schema；
- TypeForge 会话附件复用 Persona 附件存储，需独立 owner/配额；
- 旧 TypeMaker 卡片行为变化：卡片点击从“无动作”改为详情，需回归。
