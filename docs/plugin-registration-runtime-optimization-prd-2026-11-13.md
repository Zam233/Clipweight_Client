# Clipwright Engine 插件层全功能治理 PRD

> 状态：**第一期已实施**（2026-11-13）。Engine 分支 `ref/zam_plugin_system_optimization` 已有 8 个提交实施 P0/P1 与部分 C 项；前端同名分支已实施 C4 动作收口。本文件保留“当前功能全景 + 裁定”作为实施依据，未实施的 C 项仍在文档中标注为条件改造。Engine 基线：`J:/Clipwright` `c396962`（实施起点）；前端：`J:/Clipweight-Client` `672a23e`（实施起点）。

## 1. 问题与目标

Engine 已有插件发现、本地安装、HMAC 清单签名/权限、依赖、配置加密/迁移、19 类贡献、Hook、Provider、Agent/Tool/Skill、子进程双向 RPC、Job Broker、工作区/素材/产物、渲染扩展以及前端声明式 Slot。旧版 PRD 只深入注册与运行，却以“42 个插件逐项清单”暗示全功能覆盖，还要求全域激活事务、所有调用代际、实时 revision 等成本较大的改造。实际更紧迫的是加载失败残留、子进程重载、安装路径和配置迁移、RPC/Job/素材/渲染信任校验等具体缺口。不能把已有功能重建一遍，更不能把配置声明或 Python audit hook 宣称为恶意代码的 OS 沙箱。

目标：G1 每项现有功能有当前代码/消费者/测试/验收与改动裁定；G2 高价值修复解决明确缺口且不破坏 42 个插件和旧客户端；G3 插件关闭或失败后执行/展示与实际状态一致；G4 对高风险边界增加可运行负例，报告未覆盖的平台。完整功能覆盖指**审计和回归范围**，不代表对每个功能都引入新架构。

## 2. 当前功能全景与改动裁定

`B` 为保留既有行为并做回归；`F` 为本期有益窄修；`C` 为条件触发的远期工作，不进入本期 Coding Plan 实施任务。源码均相对后端 `J:/Clipwright`，前端另注明。

| 功能链 | 当前实现/消费证据 | 现有验证 | 决策、收益与本期边界 |
|---|---|---|---|
| 发现、启停、依赖 | `plugins/loader.py:191-202,206-270,379-416,822-860`；`api/plugin.py:137-237,735-741` | `test_plugin_governance*.py`, `test_example_plugin_e2e.py` | F：`load_all()` 只计非空成功；依赖须实际加载成功才可消费；`load-all` 与 `/load` 守卫一致，但本地 token 模式下该守卫是 no-op（见 §2.2 事实更正），不宣称权限隔离。保留 `.enabled`、逐插件故障隔离和旧 API。 |
| 本地 tar.gz 安装/删除 | `services/install_service.py:17-85,124-126`；`api/plugin.py:588-622` | `test_install_service.py` 覆盖包内穿越、缺 manifest、重复 | F：安装参数 `plugin_id` 在拼路径前校验；失败回收注册副作用。当前全仓仅定义和测试调用 `install_plugin_from_bytes`，尚无生产入口，因此主 Loader 即时接入为 C（启用离线安装入口前必须完成），不在本期搭新入口。保留包内安全解压/校验与市场入口已剥离事实；DELETE 当前只清 PluginData，**不**声称移除插件安装目录。 |
| manifest、签名与贡献白名单 | `schema/plugin.py:27-115`；`plugins/loader.py:32-78,235-263,925-952`；`plugins/contribution.py:129-201` | `test_plugin_sign_cli.py`, `test_plugin_security_m1.py`, `test_plugin_contribution.py` | F：移除 `sandbox_demo` 的重复 api_version 后双入口拒绝重复键；`override_builtin` 不能仅凭自声明授权。现存无签名 shipped Provider 须通过受控来源策略保持可用；HMAC 是完整性/授权辅助，不是执行隔离。 |
| 插件加载/注册/卸载/重载 | `plugins/base.py:32-140,214-223`；`plugins/loader.py:299-377,400-416,509-674,728-780`；`contribution_dispatch.py:32-59,161-381` | `test_plugin_dispatch.py`, `test_plugin_dual_track.py`, `test_plugin_review_fixes.py` | F：Loader 新轨激活失败逆向清理已接受贡献；仅 Loader 对批次 all-or-fail，保持 `ContributionRegistry.register()` 逐条报告；子进程 reload 停/回收旧 worker，失败不谎称恢复。**不**强制 19 类全面 disposer 化或第二份全局注册表。 |
| Tool/Skill/Agent/Category/Material/Animation/Style 消费 | `tool/capabilities.py:136-221`、`tool/registry.py:31-115,260-312`；`plugins/contribution_dispatch.py:189-274` | `test_plugin_capability_m7.py`, `test_plugin_dispatch.py`, 各领域测试 | F：直接工具名 fallback 检查可用性；注销失败时主调用和 fallback 都不得执行失活 owner；能力目录列新声明能力（若真实消费者需要）。已存在语义能力路由、Tool 自声明权限/优先级保持不变。 |
| Hook 与派生缓存 | `plugins/hooks.py:25-96`, `hooks_async.py:21-40`；`animation/diagram_svg.py:159-205`；`plugins/shortform_category/main.py:75-92` | `test_hooks_async_dispatch.py`, `test_diagram_svg_preset.py` | F：先复现再修插件渲染器缓存禁用残留；Hook 异常进入 owner 错误通道但不阻断其它 Hook；shortform 只影响明确选中的类别，`RenderRequest` 当前无 category，应显式可选传入。保留同步/异步调用兼容，不一次性版本化全部 Hook。 |
| Provider（`llm_provider`/`tts_provider`/`stt_provider`/`embedding_provider`/`rerank_provider`）、提示词、展示契约 | `providers/*`、`plugins/provider_decl.py:97-147`；`plugins/prompt_overrides.py`；`services/display_spec/contract.py`；`api/providers.py` | `test_display_spec_plugin.py`, `test_provider_available.py`, Provider 和提示词测试 | F：卸载/失败后清 Provider schema 预登记，补消费者可用性回归；保持 prompt append/replace 与 display_spec 纯数据及现有校验，不重复迁移已归位实现。 |
| 渲染后端（`renderer_backend`） | `providers/render/__init__.py:167-220`；`api/render.py:223-241,1313-1360`；`plugins/headless_chrome/shell.py` | `test_render_backend_plugin_sidecar.py`、`test_headless_browser.py` | B：保留 backend 注册/探测/回退与 sidecar 协议；F：禁用后 backend 候选与可用性同步撤回，探测失败不冒充成功。此项是 19 类之一，旧矩阵漏列。 |
| 轨道/片段类型（`clip_kind`） | `services/clip_kind_registry.py`；`services/plugin_render.py:237-240`；`services/render.py:76-78`；`agents/quality_agent.py:69-71`；`services/preroll.py:46-48` | `test_clip_kind_registry.py`、`test_clip_kind_subprocess.py`、`test_motion_plugin_e2e.py` | B：保留类型注册、渲染/预览契约与子进程代理；F：禁用后 `is_plugin_kind`/`get` 不再命中，旧 clip 渲染按未知类型显式降级而非静默当作内置。当前 42 个内置 manifest 无 `clip_kind`，由外部动效插件使用，须用合成插件验收。 |
| 配置默认/加密/迁移 | `plugins/loader.py:684-726,790-816,864-923`；`plugins/config_types.py`；`api/plugin.py:627-732` | `test_plugin_config.py`, `test_typed_plugin_config.py`, `test_plugin_governance3.py:151-174` | F：迁移成功才升版本并持久落盘，失败保留原文件和版本；PUT/DELETE 失败不返回假成功；worker 与宿主使用同一生效配置。保留掩码回传、未加载插件预配置和既有密钥存储语义。 |
| 子进程启动/协议/代理 | `plugins/runtime/{host,worker,protocol,proxies,bridge}.py` | `test_plugin_runtime_subprocess.py`, `test_plugin_rpc_v2.py` | F：入口模块解析一致、超时杀旧 worker、入站帧限长/版本校验，保留 UTF-8、并发请求 ID、scope 和错误码；**未知 kind 当前只记错误并跳过（`loader.py:543-548`），未 fail-closed**，本期改为整批失败或显式拒绝。不能将 audit hook 描述为 OS 隔离。 |
| worker 权限与宿主数据 | `plugins/runtime/permissions.py:91-211`；`services/plugin_rpc.py:94-277`；`plugin_workspace.py:42-180`；`plugin_materials.py:53-104`；`plugin_context.py:133-152` | `test_plugin_security_m1.py`, `test_plugin_workspace_rpc.py`, `test_plugin_materials_rpc.py` | F：在隔离环境验证并封堵无写权限的文件删除/改名/创建与 `os.open` flags；素材列表/上下文阻止 symlink 越界并以流式 hash 处理大文件；只读 resolve 不建目录。保留 project/plugin scope、写入原子替换和素材读取限额。 |
| Job Broker、事件与取消 | `services/plugin_jobs.py:101-195,297-376`；`plugin_rpc.py:340-383`；`plugins/runtime/bridge.py` | `test_plugin_jobs.py`, `test_plugin_job_rpc.py`, `test_plugin_events_m4.py` | F：POSIX 启动独立进程组后才允许 killpg；不存在 cwd 不应创建目录；worker 退出时旧监听不留存。保持运行时批准、argv/env 白名单、幂等、并发上限和取消事件。C：真正跨**进程重启**的持久 Job 恢复，当前内存 `recover_interrupted()` 不提供。 |
| Artifact、渲染、跨插件调用 | `services/plugin_workspace.py:245-337`；`plugin_render.py:100-211`；`plugin_rpc.py:189-246,296-338` | `test_plugin_workspace*.py`, `test_plugin_render.py`, `test_plugin_cross_call_m5.py` | F：插件媒体 path 限制到已登记/工作区资源，尺寸/FPS/时长用实际 probe；跨插件链在宿主维护，不能信任插件传入 chain；artifact 任务隔离按已有契约实测决定；并发登记互不覆盖。保留 hash 校验、依赖+exposes 双门禁及已有渲染数据契约。 |
| 管理 API/错误/前端 Slot/受控 bundle | `api/plugin.py:282-352,373-622,743-902`；前端 `src/features/plugins/*`, `src/features/settings/PluginsPanel.tsx`, `src/services/api/project.ts:275-385` | `test_plugin_page_authz.py`, `test_plugin_proxy_2026_11_12.py`, `test_plugin_bundle_gate.py`, 前端 Slot 测试/E2E | F：legacy `ui.json` 仅对已加载且启用的 owner 输出，服务端 kind 筛选正确；前端 `usePluginContributions(kind)` 真按 kind 过滤；编辑器 UI 动作统一受控代理，代理核对插件归属与工具权限；bundle 验实际签名及内容，不只验非空字符串；Hook 错误可见。保留 15 个固定 Slot、当前本地启停失效广播和 iframe 隔离。**更正**：`_require_admin`/`admin_only` 在账号剥离后的本地 token 模式下是 no-op，不能称为管理员门禁；UI 与文档按单用户信任模型表述。C：跨标签实时推送与全局 revision，先有可复现需求再设计。 |

**安全与产品定位**：本期 F 项是现有 API/插件工作流可观察的修复，不承诺运行不可信 Python 插件的 OS 级安全边界。不能把“修 Python audit hook”视作恶意插件安全上线条件；若产品需要该承诺，须另评估低权限进程/ACL/资源隔离。安全负例只在临时目录、无生产凭据和数据的隔离子进程运行。

### 2.1 编辑器 UI 扩展能力与缺口（本期 F）

| 扩展面 | 当前可用范围与证据 | 本期有益改动/验收边界 |
|---|---|---|
| 布局与控件 | `src/features/plugins/slots.ts:13-47` 固定 15 个 Slot；`EditorLayout.tsx:218-252,294-305` 在桌面端挂左/右/下栏，随宿主面板开关；`Slot.tsx:30-74` 渲染 layout 或 iframe；`PluginLayoutRenderer.tsx` 提供受限控件。 | 保持声明式布局与宿主骨架；非法/空 payload 不应占空白编辑器列，容器 children 非数组、未知 alert severity、非受信任图片 URL 不能崩溃或偷偷请求外部资源；禁用后已挂载内容消失，桌面/窄屏与面板关闭行为分别验收。插件不能替换预览或时间轴引擎，也不能直接访问 React store。 |
| 可见性与旧响应 | `Slot.tsx:30-70` 才检查 `visibleWhen`，编辑器三栏以未经筛选的 `items.length` 分配宽度；toolbar/timeline/nav 等直接消费原始贡献。`usePluginSlots.ts:29-85,99-183` 失效时清缓存与 inflight，但旧请求可能晚到并回写。 | 宿主占位和内容使用同一经过 kind/slot/可见性/有效布局筛选的集合；其它消费方也按相应上下文检查 visibleWhen。失效后先隐藏旧贡献，以本地请求代际拒绝过期响应；`loadAll` 等会改变贡献的入口统一触发本地失效。保留 TTL，跨标签实时推送仍为 C。 |
| 工具栏与时间轴 | `EditorToolbar.tsx:47-76`、`TimelinePanel.tsx:33-40,310-325,384-397` 从插件 payload 取 endpoint，直接用宿主 API client 发 GET/任意 method；不使用 `authorizePluginCall` 或代理。 | 改为统一校验与服务端受限代理，缺 owner、未知方法/端点、被禁用贡献一律不发目标请求；有加载/失败回执。不要把服务器 403 当成功的编辑操作。 |
| 属性分区与编辑状态 | `PropertiesPanel.tsx:630-645` 按 payload.kinds 过滤；Slot 可回传控件值，但没有标准的插件时间线编辑命令、撤销历史接线。 | 保留只读/声明式分区；需要真正改 clip/timeline 时由宿主已有命令/验证/历史入口执行，先选一个真实插件需求定义有限命令及撤销合同；不开放任意 store mutation 或自报 PATCH/DELETE URL。无需求时不建通用命令总线。 |
| 页面、浮层与快捷键 | `PluginPage.tsx:16-77`、`usePluginShortcuts.ts:37-80`；`overlayActions.ts:33-52` 的 probe/install 虽经过前端 guard 仍直连目标 API；快捷键已走代理。 | 页面/面板按钮 `PluginLayoutRenderer.tsx:140-171` 也仍直连 guard 通过的端点。四处动作共享 owner 归属、服务端代理及用户确认；保留现有白名单、文件控件由宿主上传、卸载时快捷键 disposer。`PluginPage.tsx:21-33` 的 `isAdmin` 固定 true，`admin_only` 只是显示声明，不是访问控制，按本地 token 信任模型表述。`PluginsPanel.tsx:783-795` 的 UI 预览当前挂可执行渲染器，必须显式只读，点击预览不得发起任何 HTTP/上传/编辑命令。 |
| legacy `ui.json` 与资产面板 | `src/features/assets/PluginPanel.tsx:24-137` 在编辑器「插件」tab 用 `usePluginUI` 渲染 `ui.json`；`ai_image_gen`、`ai_music_gen`、`ai_video_gen` 三份 `ui.json` 的按钮 body 为 `{tool: "...", params: ...}`。 | 该 body 与 `/api/tool/execute` 的 `{name, params}` 契约不匹配（`api/tool.py:49-58`），当前点击即 422；走代理后 `toPluginProxyRequest` 只读 `body.name`，会继续失败。适配必须把三份 `ui.json` 改为 `name`（或由前端兼容映射旧 `tool` 并告警），并让 legacy 面板同样带 owner 走代理。这是用户体验现存故障，不是仅迁移风险。 |
| bundle 与代理 | `PluginBundleFrame.tsx:73-125` iframe `sandbox=allow-scripts`，消息走代理，但 `Slot.tsx:42-49` 把贡献 **id** 当插件 id，实际授权应取 `owner`；`api/plugin.py:826-875` 白名单键为 `POST:tool`/`GET:probe`，查找用小写 `method_norm` 拼接，当前静态路径不会匹配；`:863-867` 只看 discover+enabled；`:877-890` 不核对工具 owner。`get_plugin_bundle:329-339` 只查 manifest.signature 非空。 | 用贡献 owner 请求 bundle/代理，缺 owner 拒绝；修方法键大小写并测合法请求真正成功；服务端还须核 active、动作目标工具归属/权限档和资源 owner，禁止调用别的插件或危险工具。验实际 manifest HMAC **并将 bundle.html 内容绑定到可信摘要**，否则签名不能证明 UI 文件完整性；保持 iframe 隔离与 CSP，不执行插件 JS 于宿主。 |
| 数据同步 | `usePluginSlots.ts:64-89,127-140` 全量 30s 缓存，本地启停失效；`usePluginContributions(kind)` 用 `() => true`，会混入别类贡献；`api/plugin.py:445-471` 未过滤 disabled legacy UI。 | 修 kind 与 legacy owner/slot 过滤；现有本页启停刷新保持，跨标签/断线先加明确重取/失效测试，只有真实需求才引入全站 revision/SSE。不把静态测试通过等同于运行中跨标签同步。 |

**动作调用的最低验收**：即使前端已显示插件 UI，执行权仍由后端核验；测试至少覆盖 layout 按钮、编辑器 toolbar、时间轴工具/菜单、浮层 probe/install、快捷键和 iframe 六类入口的合法请求、无 owner、禁用后、跨插件工具和危险方法负例。现有 iframe/shortcut 的前端 guard 不是服务端授权；面板按钮/工具栏/时间轴目前绕过代理为已读代码事实。现有 4 个前端相关测试文件 38 项通过，但没有证明上述跨入口受限代理行为。

### 2.2 Engine 补充缺口与收益筛选

- **本期 F：shortform 成片规格**。`plugins/shortform_category/main.py:85-92` 的 `pre_render` 无条件把 settings 改成 1080×1920，而当前 Hook 上下文只有 `task_id/settings/preset`（`api/render.py:662-666`），`RenderRequest/RenderSettings` 无类别字段（`:1237-1269`）。这是**全局成片规格被插件覆盖**的现存缺陷：任何类别渲染都会被改竖屏。修法：`RenderRequest` 增可选 `category_id`（默认空），按 `CategoryRegistry` 校验；`pre_render` context 传该值；自动渲染从任务/管线已知的 `category_plugin_id` 传入，手动导出若无可靠来源则保持空且不改尺寸，禁止从比例或 metadata 猜测。短期若前端尚无可信来源，可先禁用该 Hook 的强制覆写（保留类型策略），不能让旧客户端继续被全局改造。
- **本期 F：override 受控来源**。仓库 42 份 manifest 当前 **0 份带签名**，其中 9 个 `override_builtin: true`（embedding_providers、llm_anthropic、llm_openai_compatible、rerank_providers、stt_providers、tts_cosyvoice、tts_feature、tts_minimax、tts_qwen）。`base.py:86-95` 仅凭自声明转成 OVERRIDE，`contribution.py:191-200` 不再校验签名或目标。不能直接改成“未签名拒绝”，否则默认启动会失去 9 个能力。可执行方案：新增“随应用发布的受信插件目录 + 代码内 `(kind,id)` 覆盖允许表”，只允许该来源的插件覆盖明确列出的内置项；第三方插件必须验签且目标在允许表，否则拒绝并给可读错误。不得用 manifest 自报 `trusted: true` 授权。验收覆盖受信 9 个仍工作、第三方未签名覆盖被拒、合法验签且在表内通过。
- **事实更正：管理员门禁当前是 no-op**。账号系统剥离后中间件固定写 `user_id=None,user_role=None`（`main.py:525-526`），`authz.require_admin` 对 `uid is None` 放行（`authz.py:49-58`）。因此 `_require_admin`、`admin_only` 过滤在本地 token 模式下不构成权限隔离；`/load-all` 加同一守卫也不会改变现状。产品语义应明确为“持有本地 API token 的单用户/运维信任模型”，文档不得把该守卫写成安全边界。若恢复多用户，须先恢复身份注入与角色校验，再谈管理员门禁。
- **本期 F：Job 隔离**。`services/plugin_jobs.py:196-214` 幂等键全局复用，命中时直接返回旧 JobRecord；`_owned:274-280` 只核 plugin/project，不核 task。把幂等身份限定在 `(plugin_id, project_id, task_id, key)`；跨 task 的 `get/list/cancel` 按产品允许的共享权限精确判断，默认拒绝对其他 task 的读取/取消，且同作用域同 key 才可复用。先在真实 broker 加不同 task 同 key 与跨插件访问的负例。
- **本期 F：离线包资源上限**。`services/install_service.py:14,23-38,46-47` 的 200 MiB 只限制压缩输入，解包成员总字节和数量无限。用 tar header 预检+流式实际计数限制 staging 总量/成员数，拒绝压缩炸弹并清临时目录；市场入口仍已剥离。
- **本期 F：宿主能力执行**。`services/plugin_rpc.py:251-277` 直接 `resolve(name)`→`tool.execute`，跳过 `ToolRegistry.execute` 的路径/URL 校验、trace 和返回/回退口径。授权前置保留，再通过统一受控执行入口实现当前工具权限与成本规则；用实际越权参数测试，不只看 grant。跨插件调用链仍不信任 worker 自报 chain。
- **签名和授权的真实边界**：`get_plugin_bundle` 目前只查 `manifest.signature` 非空（`api/plugin.py:329-339`），不调用 `verify_manifest_signature`；代理 `POST:tool` 接受任意 `payload.name`（`:877-890`），插件 id 的动作白名单不等于目标工具授权。保留 iframe/代理接口形状，但拒绝伪签名、未绑定 bundle 文件及非本插件工具/不允许的权限档。现有代理只登记 tool、浏览器 probe/install 等动作，新插件要执行编辑器动作仍需宿主评审并显式扩展代理，而非自报 endpoint；没有后端编辑命令时仅能增加 UI，不能承诺修改时间线。当前 42 个内置插件没有 `bundle.html`，验签与文件完整性用合成插件测试。
- **子进程可信输入与完整性**：manifest HMAC 只签 manifest 字段（`plugins/loader.py:39-54`），不覆盖 Python 文件或 bundle；`runtime/worker.py:77-90` 的 `extra_read_roots` 来自插件自报 manifest，宿主须拒绝越权根并只传已授权目录；worker 直接启动不会复验签名（`:110-120`），必须明确仅由已校验的宿主启动或增加握手验证。`RuntimeSpec.digest`（`plugin_jobs.py:50-60,119-125`）目前仅存储、执行前未比对；若批准依赖摘要，应拒绝替换过的可执行文件。签名、审计钩子均不能宣称保证所有插件代码完整性或 OS 隔离。
- **存储与运行资源**：`PluginArtifactRegistry` 以内容哈希作 id（`plugin_workspace.py:278-314`），同插件跨 task 同内容可能覆盖 task_id，先定义共享/隔离合同，按合同补负例后再调整旧数据 id。Job 跨进程重启持久化、完整 OS 沙箱与通用 UI 编辑命令仍属 C，不因本次审计自动实施。

## 3. 收益评估与优先级

1. **P0 安全、规格与现有故障，保留**：shortform Hook 全局改尺寸；legacy `ui.json` 按钮 `tool`/`name` 不匹配导致 422；编辑器动作入口直连与服务端代理目标授权；离线安装 ID 路径与展开配额、Job POSIX 进程组/跨作用域幂等、素材 symlink/大文件、RPC 入站限额/worker 超时回收、插件渲染实际输出与路径、插件自报读根。收益是避免越界、资源耗尽和现成按钮不可用；各项以受控负例确认影响。
2. **P1 可用性与恢复，保留**：override 受控来源（0 签名基线下的 9 个既有插件迁移）、Loader 半加载清理、provider schema 幽灵项、renderer 缓存、worker 重载/配置一致性、配置迁移及保存失败假成功、跨插件调用链、bundle 内容完整性、编辑器非法 UI/旧请求失效、legacy 面板删除文案与 `declared_only` 误报警。收益是启停、失败和权限语义可信，低风险改动优先。
3. **P2 诊断与体验，保留最小量**：Hook 错误记 owner、legacy UI 与 kind 过滤、依赖加载真实性、能力目录与直接工具名可用性；只对真实消费路径施工。
4. **条件改造，不列本期实施任务**：全面 ActivationRecord/19-kind disposer、所有调用 generation、全站实时 revision/跨标签推送、全 Hook 协议版本化、Job 持久化、OS 级恶意隔离及通用编辑器命令总线。若有限插件编辑命令有明确需求，另设计宿主校验、撤销历史及并发状态后实施。



## 4. 兼容契约和用户故事

- 用户禁用插件后，新 Tool/Skill/Provider/Hook 调用与 UI 入口不可再使用该 owner；若清理失败，必须报告并阻止新调用，不能仅从列表隐藏旧对象。已在飞调用遵从现有取消语义，不能承诺回滚外部副作用。
- 插件作者加载两项贡献、第二项被拒时，Loader 报失败并清第一项；底层 `ContributionRegistry.register()` 继续返回逐项 `accepted/rejected`，外部旧轨可保留兼容行为。
- 维护者用离线安装函数处理本地包时，非法 id 在拼路径前被拒绝、加载失败时已注册贡献被回收；该函数当前没有生产 API 调用，未来开放安装入口前须另行解决应用主 Loader 接管和成功状态语义，不在本期承诺“安装即刻可用”。
- 管理员修改/删除配置后，实际执行方使用与回显相同的有效值；迁移异常不推进 schema 版本。未加载插件仍可预配置，但响应不得说已生效。
- 本地单用户/令牌部署中，“管理员”不是独立身份：任何持有 `CLIPWRIGHT_API_TOKEN` 的调用者都可管理插件；`admin_only` 仅作为投递过滤，不是权限系统。恢复多用户前，文档与 UI 都不应暗示已有管理员隔离。
- 编辑器内 legacy `ui.json` 面板的按钮点击后应执行对应工具，而不是 422/“缺少工具名”；`ai_image_gen`/`ai_music_gen`/`ai_video_gen` 三份 body 的 `tool` 字段须迁移为 `name`（或宿主兼容旧键并提示），且动作经 owner 代理。
- 子进程插件获取 workspace/material/artifact/timeline/job/能力时保留现有 scope、容量与权限语义；对路径、真实媒体属性和调用链的拒绝要由宿主执行。
- 前端用户启停后已挂载 Slot 同步刷新，离线时不把旧贡献冒充当前状态；保留现有 API `/list` 数组形状及“仅已加载”范围，禁用/失败项由 `/discover` + `/health` 展示。

## 5. 现有插件的验收范围

42 个 manifest 中：素材源 6、类型 4、风格 2、Agent 1、能力/展示/Provider 等 29。按 [Coding Plan 的逐插件迁移任务](plugin-registration-runtime-optimization-coding-plan-2026-11-13.md) 核对贡献声明、真实消费者、改动责任与禁用回收；外网/付费调用使用 stub。**适配不是强制改写 42 个插件**：标记“宿主适配”者由宿主实现，插件保留源码并跑针对性回归；标记“插件修改”者必须改指定入口/manifest 并交付红绿测试；标记“条件”者先复现再裁定。缺 API Key/目录的插件允许返回 `[]`（例如 `gif_sticker`、`pexels_material`、`pixabay_material`、`unsplash_material`、`bgm_library`、`local_material`），`declared_only` 是可诊断的未启用能力而非加载错误；Loader 的失败回滚只针对已尝试注册却被拒或初始化异常，不对正常空贡献报失败。现有 `genui` 已有两份 display_spec，`platform_export` 已提供 6 个导出预设和 Hook，`voice_ext` 已提供 TTS provider，`logic_animations` 的渲染器已在插件内，不能沿用旧“半壳/空壳”数量作为新任务。`cloud_render` 与 `pv_engine` 当前不在 42 份 manifest 内；由外部包提供时另行核对。`sandbox_demo` 存在重复 api_version，`safe_load` 生效值是 v2，须先修样例再严检。

### 5.1 逐插件适配原则与上线门槛

- 先比较 manifest 声明 `(kind,id)` 与真实 `contributions()`；动态生成/条件贡献按实际配置验收，不要求每个声明都在每次加载时出现。未声明的实际贡献才是拒载错误。仅看类定义不算已注册（`whisper_stt` 的 `WhisperTranscribeTool` 类不在贡献列表）。
- 九个 `override_builtin: true` 插件为 `embedding_providers`、`llm_anthropic`、`llm_openai_compatible`、`rerank_providers`、`stt_providers`、`tts_cosyvoice`、`tts_feature`、`tts_minimax`、`tts_qwen`。宿主的受控来源校验必须逐一保留这些既有接管能力，禁用后回退行为逐一核验；不得要求它们统一签名再发现默认启动全失败。
- 配置迁移和插件启停发生时，已加载插件回归“源默认→用户覆盖→新配置实际生效→禁用→恢复”；只需宿主修复的插件不为满足清单而挪动实现。多贡献插件须测第二项失败回滚与第一项消失；子进程插件还须测 worker PID、权限及超时。上线前逐插件登记 `声明/实际/消费方/修改类别/测试/结果/未验证原因`，无可达消费方者明确为待验证或不提供能力，不能谎报通过。
- 需要修改插件代码的确定项：`sandbox_demo` 删除重复 `api_version`（`plugin.yaml:5,16`）；`shortform_category` 的 `pre_render` Hook 在宿主明确传入 category 后只作用自身（`main.py:85-92`），未接通前不得继续全局改尺寸；`ai_image_gen`、`ai_music_gen`、`ai_video_gen` 的 `ui.json` 按钮 body 由 `tool` 改 `name`（当前点击 422）。`logic_animations` 的陈旧 renderer 缓存由宿主 `diagram_svg.py` 修，不重搬渲染器。`mg_animations/plugin.yaml` 无 `id` 是 Loader 以目录名注入 id 的现有受支持方式（`loader.py:925-952`），不是必修缺陷。


### 5.2 全部插件的适配裁定

下表对应现存 42 份 manifest；`S` 必改插件源码/声明，`H` 宿主改动覆盖且插件原实现保留，`R` 保留实现并做行为回归，`C` 仅有实证后再改。**每行须有启用/禁用及消费结果**，逐项执行与测试见 [Coding Plan §5](plugin-registration-runtime-optimization-coding-plan-2026-11-13.md)。条件贡献允许返回空列表，不因“声明未实现”而误杀。

| 插件 | 裁定与插件自身适配 | 关键兼容点 |
|---|---|---|
| `ai_image_gen` | S：保留图像 Tool+素材源，改 `ui.json` 按钮 body `tool`→`name` | 两贡献同退；修后按钮走 owner 代理并成功；缺配置允许不贡献。 |
| `ai_music_gen` | S：保留音乐 Tool+素材源，改 `ui.json` body | 原请求签名与权限档不变；按钮不再 422。 |
| `ai_video_gen` | S：保留视频 Tool+素材源，改 `ui.json` body | 原异步轮询和取消结果不变；按钮可执行。 |
| `bgm_library` | R：按配置贡献 `freesound`、`local_bgm` | 无配置返回 []。 |
| `custom_style` | H：风格解释器不改 | 禁用后按优先级退让。 |
| `diagram_style` | H：主题 Hook 不改 | 主题注销不残留。 |
| `embedding_providers` | H：三种 Embed Provider 不改 | 可信覆盖/配置 schema 回收。 |
| `example_caption_plugin` | H：Tool+Skill 不改 | 第二贡献失败能清第一项。 |
| `example_full` | H：Tool、Slot、Preset 不改 | 多贡献禁用联动，原 Slot 受限。 |
| `gaming_category` | R：保留类型策略 | 启停后类型候选正确。 |
| `genui` | H：Prompt+两份 display_spec 不改 | 仅展示退化，不损害简报。 |
| `gif_sticker` | R：Giphy 源不改 | 未配置 Key 为合法零贡献。 |
| `headless_chrome` | H：渲染 backend 和安装提示不改 | 禁用 backend 与提示同时撤回。 |
| `kinetic_typography` | R：四动画及 Prompt 不改 | 实际成片可消费才算可用。 |
| `llm_anthropic` | H：Anthropic Provider 不改 | 可信覆盖/禁用恢复。 |
| `llm_openai_compatible` | H：OpenAI 与 Ollama 不改 | 两 id 各自配置及恢复。 |
| `local_material` | R：local_folder 保留插件内 | 无目录为合法零贡献。 |
| `logic_animations` | H：插件渲染器不重搬 | 宿主缓存卸载后不得复活。 |
| `lottie_animations` | R：保持仅 Prompt | 不宣称已具备 Lottie 渲染。 |
| `lut_presets` | H：解释器与 Hook 不改 | 风格候选和主题均可撤回。 |
| `mg_animations` | R：动态 JSON 与四声明对账 | manifest 无 id 由 Loader 以目录名注入；不必补写。 |
| `my_animations` | R：保留两动画定义 | 目录启停一致。 |
| `news_category` | R：保留类型策略 | 禁用后不再可选。 |
| `pexels_material` | R：Pexels 源不改 | 缺 Key 为合法零贡献。 |
| `pixabay_material` | R：Pixabay 源不改 | 缺 Key 为合法零贡献。 |
| `platform_export` | H：六预设与两 Hook 不改 | 禁用后保留宿主导出预设。 |
| `rerank_providers` | H：HTTP/local 排序不改 | 可信覆盖及表单卸载。 |
| `sandbox_demo` | S：删重复 `api_version: "1"` | 真 worker 下 Tool/Hook/Slot/Prompt 均可验。 |
| `shortform_category` | S：Hook 仅匹配显式 `category_id` | 未指定或其他类别不改尺寸。 |
| `stt_providers` | H：两 STT backend 不改 | 禁用后不与 whisper_stt Skill 混淆。 |
| `subagent_demo` | R：Agent 不改 | 禁用后不能新派发。 |
| `subtitle_translate` | H：Tool+Skill 不改 | 两贡献同退。 |
| `text_animations` | R：保留 25 个 Tool | 25 个 id 与实际注册一一对应。 |
| `tts_cosyvoice` | H：协议实现不改 | 可信覆盖及 schema 回收。 |
| `tts_feature` | H：dub Skill+create.dub Slot 不改 | 上传继续由宿主执行。 |
| `tts_minimax` | H：协议实现不改 | 可信覆盖及 schema 回收。 |
| `tts_qwen` | H：协议实现不改 | qwen-tts id/音频引用语义保留。 |
| `tutorial_category` | R：保留类型策略 | 禁用后不再可选。 |
| `unsplash_material` | R：Unsplash 源不改 | 缺 Key 为合法零贡献。 |
| `voice_ext` | H：ElevenLabs/Azure Provider 不改 | 两者 schema/候选同退。 |
| `web_media` | H：web_images/fact_need 不改 | 禁用后 Agent 不绕道内核能力。 |
| `whisper_stt` | R：只注册转录对齐 Skill | Tool 类未作为贡献，不补重复工具。 |

未发现需要强制 C 级插件改写的当前证据；如完整渲染/主题回归出现反例，按实际消费方和插件 owner 更新该行再施工，不在本轮凭历史审计预设故障。

## 6. 测试、发布与回退



- 已运行基线：命令 `py -3.14 -m pytest tests/clipwright/test_plugin_review_fixes.py tests/clipwright/test_plugin_contribution.py tests/clipwright/test_plugin_dispatch.py tests/clipwright/test_plugin_runtime_subprocess.py -q` 为 **49 passed / 1 failed**，失败为旧 `_WIRED_KINDS` 期望缺 `CLIP_KIND`；另一独立审查跑 proxy+bundle gate **12 passed**、governance+dispatch **41 passed/1 failed**。前端 Slot 两文件 **12 passed**，四个插件 UI 文件（guard/layout/bundle/slots）**38 passed**（含一条 React key warning）。这些不是新增修复通过的证据；实施前重新记录当前 git 状态与测试版本。
- 每个 F 项须先写可复现的行为/否定用例，测试实际 Loader、HTTP 或 worker 消费，不只断言私有 dict。危险操作限制在临时目录、子进程、stub；POSIX 进程组测试必须确保不会向宿主进程组发送信号。
- 每批执行独立回归和跨域受影响的测试；检查启停/回退/旧数据，失败不标完成。文档和 API 约定同步后端/前端作者指南。既有配置、提示词、任务、材料、导出格式不能因治理修复自动迁移或丢失。
- 完成条件：全功能矩阵每行有“保持/修复/条件”结论、对应可运行测试或明确平台缺测；每个 F 通过针对性测试；42 插件清单有声明/消费/禁用证据；无新增未授权调用和兼容破坏。失败的窄修可独立回退，不引入必须一次上线的全域事务。

## 7. DSH 借鉴的限度

DSH 源码 `vendor/cordis/src/fiber.ts:408-510` 的 effect/disposer、`packages/core/tools/src/index.ts:120-152` 的注册返回注销函数、`packages/client/ui-slots/src/index.ts:1190-1215,1659-1674` 的父子回收体现了生命周期归属。Clipwright 现有 Python 全局注册表、多入口 API 和子进程 Job Broker 与其运行模型不同：**借鉴清理责任与行为测试，不迁 Cordis，不默认给 19 类贡献同时加 disposer**。当前 `test_plugin_contribution.py:114-124` 还依赖逐项接受语义；原子性只在 Loader 激活路径实现。
