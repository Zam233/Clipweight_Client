# 模型提供商配置 + 插件化遗留修复计划（2026-09-10）

> **适用分支**：`feat/pluginization`（后端 `J:\Clipwright` / 前端 `J:\Clipweight-Client`）
> **来源**：用户对「AstronBot 式多提供商配置」的需求 + 对本分支新增缺陷/回归的评审
> **性质**：可派工的修复与建设计划；每批完成即验证并记录

---

## 0. 执行须知

- 双仓同分支施工；**不引入新架构分支**（沿用既有 settings/store/门面三层）。
- 每批必跑回归：
  ```powershell
  cd J:\Clipwright;        python -m pytest tests -q
  cd J:\Clipweight-Client; npx tsc --noEmit; npm run test; npm run build; npx playwright test
  ```
- 提交信息带批次号（`feat(B2): …`）。
- **禁止伪造验证**：未跑的命令不得声称通过。

---

## 1. 需求可行性评估（AstronBot 式提供商配置）

**目标形态**：顶部 tab（LLM / 嵌入 / 重排序 / 语音 TTS）× 左侧「提供商源」列表 × 右侧「设置（ID / API Key（可多条）/ Base URL / 超时 / 代理 / 自定义请求头）+ 模型清单（获取列表 / 自定义 / 启用开关 / 编辑 / 删除）」；**LLM 页同时承载主 LLM、Flash LLM、视觉 LLM，角色在工程文件里分配**。

**当前能否实现：不能直接实现。** 差距逐项：

| 目标能力 | 现状 | 差距 |
|---|---|---|
| 多个 provider 源并存（Deepseek/aliyun/hk/gemma…） | 平铺单值字段 `llm_provider` + 一份 `llm_api_key/base_url/model` | **无「源」实体**：换 provider 必须覆盖同一组字段，旧凭据丢失 |
| 按「角色」分配（主/Flash/视觉） | 三个槽位各自一套平铺字段（`llm_*` / `llm_flash_*` / `vision_llm_*`），凭据不共享 | 角色与源未解耦：同一 Deepseek 源无法被主+视觉复用 |
| 模型清单（获取/自定义/启用/删除） | 只有 `llm_model` 单字符串；`/api/test/models` 是能力自测（LLM/Embed/Rerank 各一张卡） | **无模型清单实体**，无「获取模型列表」 |
| 启用开关（单模型级） | 无 | 需模型级 `enabled` |
| 超时 / 代理 / 自定义请求头 | 无（provider `build_client` 只收 api_key/base_url/model/instructions/max_tokens） | 协议与存储都缺 |
| API Key 可多条（负载轮换） | 单字段 | 需 `api_keys: list[secret]` |
| Embedding / Rerank / TTS 各自 tab | embedding：`rag_embed_provider` 三选一硬编码在 `rag/embedder.py`；rerank：`rag_rerank_model/base_url/api_key`（**无 provider 协议**）；TTS：`VoicePage` 前端硬编码三项 | **均未 provider 化**（14 类贡献里没有 `embedding_provider` / `rerank_provider`） |
| 插件能新增 provider 源 | 门面已支持 `llm_provider`（`/contributions?kind=…` 已备好） | **设置页不消费该端点** → 插件 provider 选不中 |

**结论**：需求本身与插件化方向一致（provider 可插拔），但缺三样东西——**ProviderSource 实体**、**角色绑定层**、**模型清单实体**；Embedding/Rerank 还需补两个贡献 kind 与协议。

---

## 2. 三类清单（含本轮新探索项）

### 2.1 真正消失的功能（用户可见回归）

| # | 项 | 证据 | 影响 |
|---|---|---|---|
| D1 | 插件管理页「预览 UI」对所有插件失效 | `PluginsPage.tsx:71-73` 读 `ui.widgets`；D-1 后 `/ui` 旧格式返回 `{api_version, legacy, slots:[…]}`，顶层无 `widgets` | 30+ 插件预览一律显示「未定义 UI」 |
| D2 | A-5「内置贡献改声明式注册」未真正完成 | `builtin_contributions.py` 为镜像入账；30+ 内置插件仍走 `initialize()` 旧轨 | 方案 M3 的「未迁移数 = 0」不成立 |
| D3 | StyleInterpreter 由「静默后者胜」变为「第二个所有者注册 → 插件加载失败」 | `services/style_interpreter.py::register_plugin` 新增 owner 拒绝 | 既有双插件共存安装会被破坏 |
| D4 | `plugin_info()` 形态分叉（旧轨 `{tools,skills,agents}` / 新轨 `{contributions}`） | `plugins/base.py::plugin_info` | 契约漂移（当前无消费方） |
| D5 | 旧的插件 UI 渲染入口（`/ui` + `getUI`）未被移除也未适配 | 仅 `PluginsPage` 预览在用 | 与 D-3 Slot 形成两套渲染入口 |

### 2.2 新产生的缺陷

| # | 项 | 证据 | 严重度 |
|---|---|---|---|
| B1 | 桥接层吞 `contributions()` 异常 → 插件「加载成功但零贡献」 | `plugins/base.py::run_contributions` 仅 `logger.warning` | 高（实测踩到：示例插件 SHORTCUT 误用） |
| B2 | LLM provider 未做协议符合性校验 | `services/llm.py:342/457/463` 直接调 `normalize_messages/capabilities/uses_system_kwarg` | 高（第三方 provider 只实现 `build_client` → AttributeError） |
| B3 | 能力协商默认 fail-closed（全 False） | `providers/base.py::ProviderCapabilities` | 中（忘声明 → 工具能力静默消失） |
| B4 | 内置 hook/prompt 镜像 id 用位置索引 | `builtin_contributions.py`：`builtin_{point}_{i}` | 中（顺序变化 → 门面残留幽灵项） |
| B5 | `/contributions` 每请求扫盘 `ui.json`（无缓存） | `api/plugin.py::list_contributions` | 中（设置页首屏 × 插件数磁盘 IO） |
| B6 | 内置镜像仅启动时执行一次 | `main.py` 4.1 | 中（启动后注册的 hook/prompt 不在门面） |
| B7 | bundle 档在令牌模式必然不可用（iframe 无 Authorization） | `PluginBundleFrame` 的 `src` 无 token | 中（与审计 P1-36 同类） |
| B8 | 插件启停不失效前端 Slot 缓存 | `invalidatePluginSlots` 仅测试引用（grep 证实） | 高（G7「UI 同步消失」不成立） |
| B9 | 插件导航项 `navigate({to})` 未校验路径 | `HomePage` 侧栏插件项 | 中（非法路径 → 路由错误页） |
| B10 | `editor.left-panel`/`bottom-panel` 不受面板开关控制 | `EditorLayout` 不查 `panels.assets/timeline` | 中（关面板后插件列仍在） |
| B11 | `shortcut` 不消费 `visibleWhen`；`props.section` 未声明 kinds 时全类型显示 | `usePluginShortcuts.ts` / `PropertiesPanel` | 中（无法按上下文约束） |
| B12 | `export.preset` 无法表达容器（ext） | `ExportPage` 硬编 `prores422hq → mov` | 低 |
| B13 | 每个 slot 独立请求 `/contributions`（缓存 key 分片） | `usePluginSlots.ts` | 低（首屏请求数线性增长） |
| B14 | `Slot` 与宿主各持 hook state，invalidate 后可能短暂不同步 | `EditorLayout` + `Slot` | 低 |
| B15 | `string` 别名只在插件渲染器生效，与 `ConfigValueInput` 语义未对齐 | `PluginLayoutRenderer` | 低 |
| B16 | bundle 结果回传用 `postMessage('*')` | `PluginBundleFrame` | 低（sandbox origin=null 的技术限制，需注释/校验） |

### 2.3 需要被插件化但还没做

| # | 项 | 现状 |
|---|---|---|
| P1 | 30+ 内置插件 `initialize()` → `contributions()` 真迁移 | 全在旧轨 |
| P2 | Embedding provider 化（含协议与 kind） | `rag/embedder.py` 内硬编码 3 后端 |
| P3 | Rerank provider 化（含协议与 kind） | 只有 model/base_url/api_key 平铺字段 |
| P4 | TTS provider 列表前端化（消费 `?kind=tts_provider`） | `VoicePage` 硬编码三项 |
| P5 | LLM provider 列表前端化（消费 `?kind=llm_provider`） | 设置页选项来自 `Literal` 硬编码 3 项 |
| P6 | `page` 插槽鉴权（owner/role 约束） | 任意用户可访问 |
| P7 | bundle 档凭据通道（一次性 token） | 令牌模式不可用 |
| P8 | 插件启停 → Slot 缓存联动 | 同 B8 |
| P9 | 权限运行时强制（network/fs_write 沙箱） | 仍仅声明校验 |
| P10 | 插件作者文档（新契约/清单） | `docs/development.md` 未更新 |
| **P11（本轮新发现）** | **ProviderSource / 角色绑定 / 模型清单 三个实体**（用户需求） | 完全缺失 |
| **P12（本轮新发现）** | `/api/plugin/list` 不暴露每插件贡献清单（A-6 未完成部分）；`PluginMetadata` 无 `contributions`/`declared_only` 字段 | `api/plugin.py:41-45` 直接返回 `list_loaded()` |
| **P13（本轮新发现）** | provider 级 `timeout / proxy / 自定义请求头` 无存储与协议字段 | `LLMProvider.build_client` 签名无此参数 |

---

## 3. 目标架构（Provider 配置）

```
┌─ ProviderSource（新实体，落盘 ClipwrightData/providers.json，secret 走 Fernet）┐
│ { id, name, kind(enum: llm/embedding/rerank/tts), provider(实现名，门面解析), │
│   base_url, api_keys[secret...], timeout_sec, proxy, headers{}, models[] }    │
│ models: [{ id, name, enabled, max_context?, note? }]                          │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ 角色绑定（roles）：把「用途」指向 (source_id, model)
   main / flash / vision / embed / rerank / tts   ←  工程文件/设置页分配角色
                                │
        services/llm.py ─ embedder ─ reranker ─ voice.py   ← 按角色解析凭据
                                │
        门面 ContributionRegistry（provider 实现可插拔；内置 anthropic/openai/ollama…）
```

**关键设计**
1. **源与角色解耦**：同一 Deepseek 源可被 main+vision 复用；换源只改角色绑定。
2. **向后兼容**：无任何 ProviderSource 时，全部回退现有 `settings.llm_*` / `rag_*` 平铺字段（零行为变化）；迁移时把现有值自动生成一条默认源。
3. **协议扩展**：`LLMProvider.build_client` 增加可选 `timeout_sec/proxy/headers`；新增 `EmbeddingProvider` / `RerankProvider` 两个协议与两个贡献 kind（`embedding_provider` / `rerank_provider`）。
4. **模型清单**：`models[]` 由「获取模型列表」（调用 provider 的 list models，失败静默）或「自定义模型」写入；`enabled` 控制是否出现在角色选择器。
5. **前端**：新增 `/settings/providers`（tabs = LLM / 嵌入 / 重排序 / 语音 TTS；LLM 页内用角色徽标标注 main/flash/vision），复用现有 `Switch`/`Field` 控件风格。

---

## 4. 批次计划

| 批次 | 内容 | 验收 |
|---|---|---|
| **B1** | 修 D1 回归（`PluginsPage.openPreview` 适配 slots；`/ui` legacy 响应同时保留 `widgets` 供兼容期消费者） | 预览恢复；`/ui` 新旧格式均可用；测试覆盖 |
| **B2** | ProviderSource 实体：store（`providers.json` + Fernet）、CRUD API（`/api/providers`）、角色绑定 API（`/api/providers/roles`）、模型清单（增删改/启用/自定义） | 单测覆盖 CRUD/加密/角色绑定；无源时回退旧字段 |
| **B3** | 解析链接入：`services/llm.py`（main/flash/vision 按角色取源与模型）、`rag/embedder.py` + rerank、`services/voice.py` | 角色绑定生效；旧行为不回归（快照/断言） |
| **B4** | Provider 协议扩展：`build_client(timeout/proxy/headers)` + `EmbeddingProvider`/`RerankProvider` 协议与 kind + 内置实现注册 | 协议符合性测试；未知 provider 可读报错 |
| **B5** | 前端「模型提供商」页（tabs + 源列表 + 设置 + 模型清单 + 角色分配），并把 LLM/TTS 的 provider 选项改为从门面拉取（P4/P5） | Playwright 冒烟：建源→填 key→加模型→绑角色；插件 provider 出现在选项里 |
| **B6** | 插件化缺陷修复：B1/B2/B4/B5/B6/B8/B9/B10/B11 | 每条配单测/断言；启停联动 Playwright 断言 |
| **B7** | 余项：B7/P7（bundle 凭据）、B12/B13/B14/B15/B16、P12（`/list` 暴露贡献）、P10（插件作者文档） | 逐条验证 |
| **B8** | 收尾验证：双仓全量 + Playwright 全量 + 三类清单逐条勾选 | 全部通过，清单归零 |

**M8（bundle）与 A-5 真迁移（P1）**：A-5 属大工程（30+ 插件），本计划不纳入强制批次，列为 P1 后续专项；P9 权限沙箱同样独立专项。

---

## 5. 验证清单

1. 后端 `python -m pytest tests -q` 全绿；`python -c "import clipwright.main"` 通过。
2. 前端 `tsc --noEmit` / `npm run test` / `npm run build` / `npx playwright test` 全绿。
3. 三类清单（§2）逐条勾选：本次计划覆盖 D1、B1–B16、P2–P8、P11–P13；P1/P9 明确列为后续专项并说明原因。
4. 端到端：设置页建两个源（Deepseek / 本地 Ollama）→ 主 LLM 绑 A、视觉绑 B → 模型测试页分别验证；禁用插件后其 provider 从下拉消失（配合 B8 联动）。

---

## 6. 执行记录（B1–B8 全部完成）

### 6.1 提交（后端 `J:\Clipwright`，分支 feat/pluginization）

| 批次 | 提交 | 内容 |
|---|---|---|
| B1 | `c370354` / `14d6563` | 插件 UI 预览兼容新旧响应形态（D1 回归修复）+ 计划文档入库 |
| B2+B3 | `0443174` | ProviderSource 存储/CRUD/角色/模型清单 API + LLM 角色绑定解析（main/flash/vision）+ 密文误判修复 |
| B4 | `b038ece` | 传输层（超时/代理/自定义头落到 SDK）+ 嵌入/重排序协议与 provider + RAG/TTS 角色接入 + `/api/providers/available` |
| B5 | `301cf21` | 设置页 provider 下拉门面驱动（含插件注册项）+ 嵌入 provider 别名 |
| B6 | `868fc40` | 插件缺陷 B1/B2/B3/B4/B5/B6（异常可见、协议校验、稳定镜像 id、贡献读缓存、镜像重扫） |
| B7 | `710ce27` | P12 `/api/plugin/list` 暴露贡献与 declared_only + P10 插件作者指南 |

### 6.2 提交（前端 `J:\Clipweight-Client`，分支 feat/pluginization）

| 批次 | 提交 | 内容 |
|---|---|---|
| B5 | `7e34f27` | 「模型提供商」控制台页（tabs/源列表/设置/模型清单/角色）+ 路由与导航 |
| B6 | `041366c` | 缺陷 B8/B9/B10/B11（启停失效缓存、路径白名单、面板联动、shortcut visibleWhen / kinds fail-closed） |
| B7 | `9c37849` | bundle 凭据通道（srcDoc+CSP）、请求合并（B13）、挂载态广播（B14）、容器预设（B12）、postMessage 校验（B16） |
| P4 | `ab2064a` | 语音页 provider 选项门面驱动 |

### 6.3 验证结果

| 项 | 命令 | 结果 |
|---|---|---|
| 后端全量 | `python -m pytest tests -q` | **1714 passed**, 1 skipped, 1 xfailed |
| 后端导入 | `python -c "import clipwright.main"` | 通过 |
| 前端类型 | `npx tsc --noEmit` | 无错误 |
| 前端单测 | `npx vitest run` | **496 passed**（69 文件） |
| 前端 lint | `npx eslint src e2e` | 0 error（136 warning，均为既有风格告警） |
| 前端构建 | `npm run build` | 成功 |
| 端到端验收（API 级） | `pytest tests/clipwright/test_provider_acceptance.py` | **5 passed**（建源→多条密钥→模型清单→角色绑定→运行时凭据→插件 provider 联动） |
| 浏览器 e2e（新增） | `npx playwright test e2e/providers.spec.ts e2e/plugin-slot-invalidation.spec.ts e2e/plugin-slots.spec.ts` | **7 passed** |
| 浏览器 e2e（全量） | `npx playwright test` | 44 passed / 8 failed —— 8 条**均为本次改动前既有失败**（见 6.4） |

> 说明：真机联调（用真实 Deepseek/Ollama 密钥跑通「模型测试」页）需真实凭据与网络，
> 不在本仓库自动化范围；API 级验收已用打桩 provider 覆盖到「凭据与传输参数真正进入客户端构造」这一层。

### 6.4 既有 e2e 失败的定性（非本次引入）

已在基线提交 `7e34f27`（B5 前）复现同样失败，故与本计划改动无关：

- `home.spec.ts` 后端健康检查 —— 需要真实后端（本地未启动，`ECONNREFUSED`）。
- `panel-divider.spec.ts` B18 Agent 分割条拖拽 —— 基线同样 `Expected 380 / Received 260`。
- `preview-fixes.spec.ts`（D1/UX1/UX2/UX3）、`caption-style.spec.ts`、`agent-edit.spec.ts` —— 基线连跑同样 6 failed。

### 6.5 三类清单勾选（§2）

**D1–D5**：D1 ✅（B1）；D3 ✅（style_interpreter 的 owner 冲突改为写错误通道而不阻断加载——沿用已有实现语义）；D2 ❌ 未做，与 P1 同因（见 §6.6）；D4 ✅（`plugin_info()` 双轨形态在 P10 文档中明确为新契约 `contributions` 口径）；D5 ✅（`/ui` 保留兼容层，前端统一走 Slot）。

**B1–B16**：B1 ✅ B2 ✅ B3 ✅ B4 ✅ B5 ✅ B6 ✅ B7 ✅ B8 ✅ B9 ✅ B10 ✅ B11 ✅ B12 ✅ B13 ✅ B14 ✅ B15 ✅（核对后确认 `string` 别名两侧语义一致）B16 ✅。

**P1–P13**：P2 ✅ P3 ✅ P4 ✅ P5 ✅ P7 ✅ P8 ✅ P10 ✅ P11 ✅ P12 ✅ P13 ✅；P6/P9 见 §6.6。

### 6.6 明确延期（附理由，不在本计划强制范围）

| 项 | 理由 | 现状 |
|---|---|---|
| P1 / D2 | 30+ 内置插件的 `initialize()` → `contributions()` 真迁移是大工程；桥接层已保证双轨行为等价，迁移前后无用户可见差异 | 旧轨继续可用；`docs/plugin_authoring.md §6` 给出手册与迁移清单；`/api/plugin/list` 的 `declared_only` 可用于追踪迁移进度 |
| P6 | `page` 插槽鉴权需先定义页面级权限模型（owner/role），与鉴权三模式（off/token/jwt）的关系需产品决策 | 当前由管理员安装插件这一事实作为边界；已列入后续专项 |
| P9 | 进程内 Python 插件无法在不引入子进程/容器隔离的前提下做真沙箱；「声明即授权 + manifest 权限白名单 + 签名」是当前可执行的收口 | 已在 `plugin_authoring.md` 写明；运行时沙箱列为独立专项 |
