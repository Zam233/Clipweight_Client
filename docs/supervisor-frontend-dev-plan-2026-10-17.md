# 主 agent 化 · 前端开发计划 v1.0

| 项 | 内容 |
|---|---|
| 分支 | `主agent化`（基于 `feat/pluginization` @ `0375710`） |
| 日期 | 2026-10-17 |
| 上位文档 | `docs/supervisor-agent-prd-2026-10-17.md`（PRD v0.2）；后端计划见后端仓库 `docs/supervisor-dev-plan-2026-10-17.md` |
| 范围 | 调度面板、诊断书、成本条、人工改派、路由表管理；以及相应的类型/API/SSE/状态层 |
| 一句话 | 把「为什么失败、花了多少钱、下一步怎么做」变成用户能看懂、能一键执行的界面 |

---

## 1. 现状锚点（要动的代码）

| 位置 | 现状 | 本计划改动 |
|---|---|---|
| `src/types/pipeline.ts` | 已有 `PipelinePhase` / `PipelineStep` / SSE 事件类型注释 | 扩展 SSE 事件类型；**不新增** phase（红线：不改阶段顺序） |
| `src/services/api/pipeline.ts` | 管线 API 模块 | 新增 `getLedger / getAttribution / getDiagnosis / getDecisions / dispatch / acceptSuggestion` |
| `src/services/api/sseStream.ts` | 已有 `connectSseStream` / `SseStreamHandle`（自动重连） | 直接复用，不新写 SSE 客户端 |
| `src/stores/agentStore.ts` | 持有 `pipelineId / phase / pipelineSummary` | 新增 `supervisorStore`（**不塞进 agentStore**，避免其继续膨胀） |
| `src/features/agent/AgentPanel.tsx` | 1418 行，管线过程中主面板 | 只加一个入口（打开调度抽屉），**不在此文件堆新逻辑** |
| `src/layouts/EditorLayout.tsx` | 侧栏挂 `AgentPanel` | 新增「调度」抽屉/面板入口 |
| `src/services/api/index.ts` | 统一导出 | 导出 `supervisorApi` |

> **不做**：不在本分支重写 `AgentPanel`；不改编辑器主流程；不做移动端专属重构（沿用现有 `mobilePanel` 机制即可）。

---

## 2. 信息架构与术语

### 2.1 入口

- 管线运行中/失败后，`AgentPanel` 顶部出现状态条：**「已自动诊断 · 2 条建议」** / **「正在诊断…」**。
- 点击打开右侧抽屉「调度」，含三个分段：**决策记录 / 诊断书 / 成本**。
- 管线失败时，诊断书卡片直接内联展示在面板主区（不必先开抽屉）——失败是用户唯一必须看到的东西。

### 2.2 术语替换（对外一律用左列，不用右列）

| 对外文案 | 内部概念 | 备注 |
|---|---|---|
| 选材、剪辑、动画、配音、质检 | structure / material / edit / animation / audio / quality | 只在「高级详情」里保留内部名 |
| 重试、换模型再试、回到选材、接受当前版本、换一种做法、停止 | S1–S6 | 「换模型再试」在 UI 上显示具体模型名（如「换 Sonnet 再试」） |
| 花费 | token 用量 | 默认显示货币，悬停显示 token |

---

## 3. 类型层（`src/types/supervisor.ts`）

```ts
export type FailureCategory =
  | 'resource_missing' | 'input_insufficient' | 'model_incapable'
  | 'timeout' | 'external_unavailable' | 'constraint_conflict'
  | 'internal_defect' | 'unknown';

export interface Degradation {
  kind: string; detail: string; scope: string; impact: string;
}

export interface LedgerEntry {
  id: string; stage: string; attempt: number; decision: 'pass' | 'fail';
  input_digest: string;
  failure?: { category: FailureCategory; blocking_point: string; location: Record<string, unknown>;
              retryable: 'retry_same' | 'needs_upstream' | 'needs_human' | 'permanent';
              needs: { from_stage: string; field: string; why: string }[] } | null;
  degradations: Degradation[];
  model?: string; usage?: { input_tokens: number; output_tokens: number };
  duration_ms: number; ts: string;
}

export interface Attribution {
  primary_stage: string; upstream_chain: string[];
  evidence_refs: string[]; confidence: 'high' | 'mid' | 'low';
  unrepairable: boolean;
}

export interface DispatchOrder {
  id: string; target_stage: string; strategy: 'S1'|'S2'|'S3'|'S4'|'S5'|'S6';
  reason: string; model?: { provider: string; model: string };
  issues: string[]; budget_usd?: number; timeout_sec?: number;
}

export interface DiagnosisReport {
  conclusion: string;
  problems: { severity: 'error'|'warning'; title: string; location?: string }[];
  evidence: { text: string; ref?: string }[];
  attempted: { action: string; outcome: string }[];
  suggestions: { id: string; label: string; action:
    'retry_with_model'|'redo_stage'|'accept_degraded'|'manual'; est_cost_usd?: number }[];
  cost: { spent_usd: number; budget_usd?: number; tokens: number };
}

export interface BudgetSnapshot {
  spent_usd: number;
  budgetEnabled: boolean;          // false = 设置里未填预算（PRD F6：无上限，不阻断）
  budget_usd?: number;             // budgetEnabled=false 时 undefined
  ratio?: number;                  // 同上，无预算时无比例
  level: 'unlimited' | 'ok' | 'warn' | 'blocked';
  subagentSpentUsd?: number;       // 子代理开销单列（PRD §7.3）
}
```

类型与后端 `schema/supervisor.py` 一一对应；后端契约变更必须先改本文件（对账见 `docs/frontend-backend-parity.md`）。

---

## 4. API 层（`src/services/api/supervisor.ts`）

```ts
export const supervisorApi = {
  getLedger: (pid: string, stage?: string) => getApiClient().get(`/api/pipeline/${pid}/ledger`, { params: { stage } }),
  getAttribution: (pid: string) => ...,
  getDiagnosis: (pid: string) => ...,
  getDecisions: (pid: string) => ...,
  dispatch: (pid: string, order: DispatchOrder) => ...,
  acceptSuggestion: (pid: string, suggestionId: string) => ...,
  getRoutes: () => ..., updateRoutes: (routes) => ...,
  getMode: () => ..., setMode: (mode: 'off'|'shadow'|'on') => ...,
};
```

- 统一走 `getApiClient()`（已有鉴权/续期拦截器），**不新建 axios 实例**。
- 写操作（`dispatch` / `acceptSuggestion` / `setMode`）必须二次确认，确认弹窗展示**预估成本与耗时**（PRD §7.2）。
- **v1.1 追加 API**（子代理、执行日志与授权、`auto-mode`、worker 审核）见 §13.2，本段不重复。

---

## 5. SSE 消费

复用 `connectSseStream`，在现有管线 trace 流上按 `type` 分流：

| 事件 type | 前端处理 |
|---|---|
| `ledger_entry` | 追加到 `supervisorStore.ledger`，刷新决策记录列表 |
| `attribution` | 更新「当前归因」小结 |
| `dispatch` | 在决策记录里插入一条「已派工」行 |
| `diag_report` | 渲染诊断书卡片（失败时自动展开） |
| `budget` | 更新成本条 |

要求：
- **断线可恢复**：重连后先用 `GET /decisions` 全量拉一次，再增量追 SSE（避免重连丢事件导致面板空白）。
- **乱序容忍**：以 `ts` 排序渲染，不以到达顺序。
- **节流**：`ledger_entry` 高频时合并渲染（16ms 批处理），避免长管线把主线程压死。

---

## 6. 组件清单（`src/features/supervisor/`）

| 组件 | 职责 | 状态 | 交互 |
|---|---|---|---|
| `SupervisorDrawer.tsx` | 抽屉容器 + 三段切换 | 折叠/展开 | 记住上次选中的分段（localStorage） |
| `DecisionTimeline.tsx` | 决策记录时间线（一步一行） | loading / empty / error / partial | 行可展开看证据；「高级详情」显示内部阶段名与模型 |
| `DecisionRow.tsx` | 单行：读到了什么 → 判定 → 派给谁 → 什么模型 → 花了多少 → 结果 | — | 点击展开原始账本条目 |
| `DiagnosisCard.tsx` | 诊断书（结论/问题/证据/已尝试/建议/成本） | loading / ready / stale | 建议按钮 → 二次确认 → 调用 API |
| `BudgetBar.tsx` | 成本条（已花/预算，70% 黄、100% 红） | ok / warn / blocked | 悬停显示 token 明细 |
| `SuggestionButton.tsx` | 建议动作按钮（含成本徽标） | idle / pending / done / failed | 失败时展示原因，不静默 |
| `RouteTableEditor.tsx` | 路由表管理（管理员） | — | 每个阶段 2–3 档模型，选型后预览影响 |
| `EmptyState.tsx` | 未触发秘书时的占位（「本次运行未触发自动诊断」） | — | 提供「手动诊断」按钮 |

**复用已有**：`ReviewPanel.tsx`、`TimelineDiffView.tsx` 的样式与折叠交互，避免再造一套视觉语言。

---

## 7. 状态管理（`src/stores/supervisorStore.ts`）

```ts
interface SupervisorState {
  pipelineId: string | null;
  ledger: LedgerEntry[];
  attribution: Attribution | null;
  decisions: SupervisorDecision[];
  diagnosis: DiagnosisReport | null;
  budget: BudgetSnapshot | null;
  drawerOpen: boolean; activeTab: 'decisions' | 'diagnosis' | 'cost';
  // actions
  setPipeline(id: string | null): void;
  hydrate(pid: string): Promise<void>;   // 首屏全量拉取
  applyEvent(e: SseEvent): void;         // SSE 增量
  dispatch(order: DispatchOrder): Promise<void>;
  acceptSuggestion(id: string): Promise<void>;
}
```

- `setPipeline` 切换时清空并重新 `hydrate`，避免跨管线串数据（沿用 `agentStore.setPipelineId` 的防串设计）。
- 任何写操作后必须本地 patch + 下一次 SSE/轮询纠正，**不发起全量重拉**（长管线成本高）。

---

## 8. 交互与文案规范

1. **失败必可见**：管线 FAILED 时诊断书自动展开，不要求用户点开抽屉。
2. **不给裸结论**：每条建议必须带「预计成本 / 预计耗时」。
3. **不隐藏降级**：接受降级的建议按钮文案写明后果（例：「接受当前版本（第 3 段仍是占位图）」）。
4. **可解释**：决策记录里每个「换模型」都要显示理由（例：「上次选择用 Sonnet 未找到合适镜头」）。
5. **空态友好**：秘书未触发时明确说明「本次未触发自动诊断」，而不是空白面板。
6. **无障碍**：时间线用 `<ol>`，展开按钮带 `aria-expanded`，成本条红黄状态不只靠颜色（加图标 + 文案）。

---

## 9. 分批计划（与后端 B0–B9 对齐）

| 批次 | 内容 | 依赖 | 退出标准 |
|---|---|---|---|
| **F0** | 类型层 + API 层 + mock fixture（`__mocks__/ledger.json` 等） | 无（可先行） | `tsc --noEmit` 通过；mock 数据能被 store hydrate |
| **F1** | `supervisorStore` + SSE 分流 + `SupervisorDrawer` + `DecisionTimeline` | 后端 B1（账本端点 + `ledger_entry` 事件） | 真实管线能看到逐阶段决策记录 |
| **F2** | `DiagnosisCard` + `SuggestionButton` + 失败自动展开 | 后端 B2（诊断书 + 影子模式） | 失败管线自动展示诊断书，建议按钮可点 |
| **F3** | `BudgetBar` + `budget` 事件 + 确认弹窗成本提示 | 后端 B5（预算） | 配置预算时 70%/100% 状态正确并冻结重试；**未配置时只显示已花、无进度条、不冻结**（PRD F6/A6） |
| **F4** | 人工改派工单（`dispatch` 写操作）+ 接管后续跑 | 后端 B3/B5（F7） | 改派后管线继续执行，UI 留痕 |
| **F5** | `RouteTableEditor`（管理员）+ 模式开关 `off/shadow/on` | 后端 B4 | 切换路由表后下一次管线生效 |

> F0 可在后端 B0 期间并行开工；F1 起被后端端点阻塞，**不建议提前臆造接口**（对账成本高于等待）。

---

## 10. 测试计划

| 类型 | 内容 | 位置 |
|---|---|---|
| 单测 | store 的 hydrate / applyEvent / 跨管线清空；SSE 乱序与节流 | `src/stores/supervisorStore.test.ts` |
| 组件测 | DecisionTimeline 四态；DiagnosisCard 建议按钮 pending/done/failed；BudgetBar 三档 | `src/features/supervisor/*.test.tsx` |
| 契约测 | 类型与后端 schema 字段对齐（fixture 由后端团队提供） | `src/types/supervisor.contract.test.ts` |
| e2e | 失败管线 → 诊断书自动展开 → 点建议 → 重跑成功 | `e2e/supervisor.spec.ts`（沿用 `e2e/providers.spec.ts` 模式） |
| 回归 | `npm run test`、`npx tsc --noEmit`、`npm run build` | CI/本地 |

---

## 11. 风险与依赖

| 风险 | 缓解 |
|---|---|
| 后端契约未定就动手 → 返工 | F0 只锁类型与 mock；真实联调等 B1 |
| `AgentPanel.tsx` 已 1418 行，继续堆逻辑会失控 | 新功能全部放 `features/supervisor/`，`AgentPanel` 只加一行入口 |
| 长管线 SSE 高频事件拖慢主线程 | 16ms 批处理 + 列表虚拟化（超过 200 行时启用） |
| 术语直译导致用户看不懂 | 按 §2.2 文案表统一；用可用性测试「5 人 4 过」卡门禁（PRD A8） |
| 权限边界 | 非 owner 只读；路由表与模式开关仅管理员可见 |

---

## 12. 交付物

- `src/types/supervisor.ts`、`src/services/api/supervisor.ts`、`src/stores/supervisorStore.ts`
- `src/features/supervisor/`（8 个组件 + 测试）
- `e2e/supervisor.spec.ts`
- 文档同步：`docs/frontend-backend-parity.md`（§1 路由表 + §2 客户端矩阵）、`docs/api_reference.md` 的前端消费章节（副本）

---

## 13. v1.4 追加：子代理控制台、执行日志与 worker 审核（F6–F8）

> 对应 PRD **v1.4** 的 F12（子代理观测）/ F11（执行能力）/ F10（审核门）。**观测（F6）先于执行日志（F7）**：先把「子代理在干什么」显示出来，再显示「它跑了什么命令」。

### 13.1 新增类型（追加到 `src/types/supervisor.ts`）

```ts
export type SubagentStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface SubagentNode {
  id: string; parentId?: string | null;
  role: string;                              // 角色名，例如「素材可用性核查员」
  kind: 'stage' | 'plugin' | 'ephemeral';    // 阶段 / 插件 / 临时派生
  status: SubagentStatus;
  model?: { provider: string; model: string };
  durationMs?: number; costUsd?: number;
  lastOutput?: string;
  cancellable: boolean;
}

export type RiskLevel = 'low' | 'med' | 'high' | 'critical';

export interface ExecRecord {
  id: string; ts: string;
  kind: 'shell' | 'python';
  command: string;                 // 原文；UI 截断显示，可展开
  cwd: string;
  riskLevel: RiskLevel;            // 独立 LLM 判定（确定性规则只能上调）
  riskReasons: string[];           // 判定理由
  dangerExplanation?: string;      // 给人看的危险说明（弹框必填）
  autoMode: boolean;               // 当时是否开启自动模式（审计需要）
  exitCode: number | null; durationMs: number;
  outputTail?: string;
  rejected?: { reason: string };
}

export interface PendingExecApproval {
  id: string; command: string;
  riskLevel: Exclude<RiskLevel, 'low'>;
  riskReasons: string[];
  dangerExplanation: string;       // 「会动到什么 + 可能后果」，弹框必须展示
  requestedBy: string; expiresAt: string;
}

export interface PendingWorkerReview {
  id: string; role: string;
  toolAllowlist: string[];
  hasExecPermission: boolean;          // true 才进审核队列
  systemPrompt: string;                // 供审核人查看全文
  risk: { level: 'low' | 'med' | 'high'; reasons: string[]; suggestedAction: string };
  createdAt: string;
}
```

### 13.2 API 与 SSE

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/pipeline/{pid}/subagents` | 子代理树（F6） |
| POST | `/api/pipeline/{pid}/subagents/{sid}/cancel` | 取消单个子代理 |
| GET | `/api/pipeline/{pid}/exec` | 执行日志（分页） |
| POST | `/api/pipeline/{pid}/exec/{eid}/approve` | 授权一条 `med` 及以上命令（F7；`critical` 需 `confirm_high_risk`） |
| POST | `/api/pipeline/{pid}/exec/{eid}/reject` | 拒绝 |
| GET/PUT | `/api/pipeline/{pid}/exec/auto-mode` | 读 / 写自动模式（用户开关，默认关，状态入账） |
| GET | `/api/supervisor/workers/pending-review` | 待审核的临时 worker（含独立 LLM 风险等级与理由） |
| POST | `/api/supervisor/workers/{wid}/review` | 人工审核：`{approve, confirm_high_risk}` |

新增 SSE 事件：`subagent_start` / `subagent_progress` / `subagent_end` / `exec`。分流规则同 §5（重连后先全量拉再增量追，乱序按 `ts` 排序）。

### 13.3 组件

| 组件 | 职责 | 关键交互 |
|---|---|---|
| `SubagentTree.tsx` | 树形展示秘书 → 子代理 | 节点展开看 `lastOutput`；折叠状态记忆 |
| `SubagentRow.tsx` | 单节点：角色/状态/模型/耗时/成本 | 取消按钮（二次确认，提示成本不退） |
| `ExecLogList.tsx` | 命令流（时间·风险徽标·命令·退出码·耗时） | 点开看完整输出与 cwd；每行显示风险等级与判定理由；复制命令 |
| `ExecPermissionDialog.tsx` | `med` 及以上命令的授权弹窗 | 显示**风险等级 + 独立判定理由 + 危险说明（会动到什么、可能后果）** + 完整命令与 cwd；`critical` 需勾选二次确认；**默认焦点在「拒绝」** |
| `ExecLevelBadge.tsx` | `low / med / high / critical` 风险徽标 | 不只靠颜色，带图标与文字 |
| `AutoModeSwitch.tsx` | 自动模式开关（执行日志头部） | 明确文案 + 开关后立即生效；状态常驻可见，不藏二级菜单 |
| `WorkerReviewQueue.tsx` | 待审核的临时 worker 列表（带 shell 的才进队列） | 展示独立 LLM 的风险等级 + 理由 + 完整 prompt/工具集；批准/拒绝 |
| `WorkerReviewCard.tsx` | 单个待审 worker | `risk=high` 时批准需勾选二次确认，禁止一键通过 |

### 13.4 交互与文案红线

1. **授权弹窗默认焦点在「拒绝」**——手滑一次就能过审的弹窗等于没有弹窗。
2. **弹窗必须说清危险程度**：等级 + 会动到什么（哪个目录/哪些文件）+ 可能后果 + 建议动作。只写「是否允许执行」视为不合格。
3. **硬底线命令不在前端提供「授权」按钮**（后端直接拒：读凭据 / 不可逆系统破坏），前端只显示拒绝原因。
4. `med` 及以上**一次一授**，不做「本会话永久允许」；唯一的批量方式是自动模式开关（且它只减免 `med`，`high`/`critical` 仍弹）。
5. 自动模式开关必须**显式、常驻、可反向**：放在执行日志头部，状态文案写清后果（「中危命令将直接执行，高危仍会询问」），不能藏在设置二级页；会话结束自动复位为关。
6. 每一行执行日志都必须显示**风险等级 + 判定理由**，让用户能抽查判定质量。
6. 执行日志里的命令原文必须可**原样复制**，方便用户本地复现。
7. 子代理被取消后节点保留（状态 `cancelled`），不消失——用户要能看到「我取消过什么」。
8. **审核页必须把独立 LLM 的风险结论放在最显眼位置**（等级 + 理由），而不是折叠在详情里；`risk=high` 的批准按钮默认禁用，勾选「我已了解风险」后才可点。
9. 审核页明确标注「该判定来自独立模型，未参考秘书的说法」——这是审核人判断可信度的前提。

### 13.5 批次

| 批次 | 内容 | 依赖 | 退出标准 |
|---|---|---|---|
| **F6** | `SubagentNode` 类型 + `/subagents` + SSE 三事件 + `SubagentTree` + 取消 | 后端 B7 | 并发 3 个子代理状态实时；取消后额度释放（PRD A14） |
| **F7** | `ExecRecord` 类型 + `/exec` + 授权/拒绝 + `AutoModeSwitch` + `ExecLogList` + `ExecPermissionDialog` | 后端 B9 | `med+` 必弹框且写明危险程度；硬底线无授权按钮；每行显示等级与理由（A15/A16/A20/A21/A24–A26） |
| **F8** | `WorkerReviewQueue` + `WorkerReviewCard`（独立 LLM 风险等级 + 人工审核） | 后端 B8 | 带 shell 的 worker 未审核不可用；`risk=high` 需二次确认（A22/A23） |

### 13.6 测试

| 类型 | 内容 |
|---|---|
| 单测 | store 的子树合并、乱序事件排序、取消后的乐观更新 |
| 组件测 | `SubagentTree` 五态；授权弹窗默认焦点在「拒绝」；自动模式开关切换后文案与状态同步 |
| 单测 | `riskLevel` 缺失或 `riskReasons` 为空时不渲染为正常行（降级为「判定缺失」警示样式） |
| 组件测 | `WorkerReviewCard`：`risk=high` 时批准按钮默认禁用；勾选二次确认后可点 |
| e2e | 派生子代理 → 树出现节点 → 取消 → 状态变 cancelled；开自动模式 → `med` 不弹窗、`high` 仍弹 |
| 回归 | `tsc --noEmit` / `vitest run` / `lint` / `build` 四门禁 |

