# 视频类型创作与修改 Coding Plan

- 依据：`docs/video-type-forge-prd.md`
- 分支：`feat/zam_video_type_forge`
- 原则：先契约/只读详情，再 AI 会话，再编辑/删除，最后 E2E。

## M1 契约与只读详情

### 后端

- 复核 `clipwright/api/type_maker.py` 现有 TypeDefinition；
- 新增 `clipwright/schema/type_forge.py`：`TypeForgeSession/TypeForgeMessage/TypeForgeDraft`；
- 新增 `tests/clipwright/test_type_forge_schema.py`。

### 前端

- `src/services/api/typeMaker.ts` 补 `get/list` 类型守卫；
- 新增 `src/pages/admin/TypeDetailPage.tsx`：
  - 参数/Prompt/规则/JSON 四块；
  - 内置只读；
  - 编辑/删除按钮（M3 接线）；
- `TypeCatalogPanel` 卡片点击 `navigate('/settings/type-maker/$typeId')`；
- 路由：`/settings/type-maker/:typeId`。

### 验收

- GET 详情渲染 10 槽位；
- 内置类型无编辑/删除；
- `npx tsc --noEmit`。

## M2 TypeForge 会话

### 后端

- `clipwright/services/type_forge.py`：
  - start/list/detail/message/commit/delete；
  - 首条消息后 LLM 生成标题；
  - LLM 输出 TypeDefinition 草稿，`validate_bundle`/`validate_type` 后接受；
  - commit 调 `TypeMaker` create，冲突 409，不覆盖；
- `clipwright/api/type_forge.py`：`/api/type-forge/chat/*`；
- 附件复用受控附件目录，会话归属校验；
- 测试：schema、start/message、commit、409、内置禁改。

### 前端

- `src/features/typeforge/*`：
  - 左侧历史会话 + 新建类型；
  - 消息流 + 文稿/图片上传；
  - 右侧草稿：id/name/shot_params/prompts 摘要/缺失项；
  - 保存按钮调 commit；
- 新增 `/settings/type-maker/forge`；
- 会话恢复用详情接口。

### 验收

- 真实对话能生成草稿；
- 刷新后消息/草稿恢复；
- 未通过 validate 不显示“已保存”。

## M3 详情编辑与删除

### 前端

- `TypeDetailPage` 默认只读，编辑进入工作副本；
- 参数编辑：shot_params、persona_mapping、declares；
- Prompt 编辑：复用 `TypeSpecEditor` 的槽位编辑，但放在详情页；
- 保存：先 validate 再 PUT；
- 取消：恢复快照；
- 删除：确认弹层 → DELETE；内置禁用。

### 后端

- 现有 PUT/DELETE 保持；补 404/409/内置错误文案；
- 测试：内置禁改/禁删、ID 不可改、删除自定义。

### 验收

- 详情 → 编辑 → 保存 → 刷新值一致；
- 删除后列表消失；
- 内置按钮禁用且有说明。

## M4 回归与 E2E

- 前端全量 + 定向；
- 后端 type-maker/type-forge/validate/delete 定向；
- 浏览器 E2E：
  - 对话创建 → 详情 → 编辑 → 删除；
  - 手动创建 → 详情；
  - 内置类型只读。
- 截图：`docs/e2e/video-type-forge/`。

## 风险与回滚

- AI 草稿不合格：validate 阻断，不写盘；
- commit 冲突：409，不覆盖；
- 内置类型：UI + 后端双保护；
- 回滚：删除新路由/入口即可恢复旧 TypeMaker。
