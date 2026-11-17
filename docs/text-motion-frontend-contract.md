# MotionSpec 前端契约冻结（CP-0）

> 状态：前端侧契约基线；后端路由/版本的最终真相以后端实现与 capability snapshot 为准。  
> 本文件不表示 API 已存在。

## 1. 路由现状

| 路由 | 状态 | 前端处理 |
|---|---|---|
| `GET /api/text-animation/capabilities` | PRD 声明已有，需运行时核验响应 | 只读；缺版本/能力时禁用编辑 |
| `GET /api/text-animation/style-packs` | 已有（PropertiesPanel 当前使用） | 只读列表 |
| `GET /api/text-animation/asset-packs` | 已有，前端未接 | 待 CP-8 |
| `POST /api/text-animation/validate-spec` | **待新增** | 契约 mock；不假定可用 |
| `POST /api/text-animation/compile` | **待新增** | 契约 mock；不写 timeline |
| `POST /api/text-animation/author` | **待新增 Agent 任务入口** | 不直接调 LLM |
| 条件提交/版本冲突 | **待新增** | 409 保留草稿 |

## 2. 前端契约

- MotionSpec 版本：`motion_spec/1`；
- 权威 hash：只能由服务端生成；前端只算 draft fingerprint；
- 预览状态：`ready | spec_without_artifact | invalid_spec | legacy | plain`；
- 缺 `mg_def`/非法 spec：禁止普通文字回退；
- fidelity：`exact | approx | unsupported`，`exact` 需逐原语抽帧证据；
- 时间：spec 秒；通用编辑器 `[0,1]`；easing 属起始帧；
- API 错误必须带可定位信息（layer/field/time）与可重试性；
- 未声明能力：控件隐藏/禁用，不静默保存。

## 3. 与后端对账项

- schema/字段/未知字段；
- capability snapshot 版本；
- MG validator 白名单；
- Canvas 原语矩阵；
- 错误码；
- revision/hash 并发；
- author 任务/SSE/取消/超时；
- asset_id resolver。

## 4. 当前不可宣称

- `/validate-spec`、`/compile`、`/author` 尚未实现；
- 后端 capability 快照未冻结；
- 前端只有 `mg_def` 只读预览，不是 MotionSpec 原生编辑器。
