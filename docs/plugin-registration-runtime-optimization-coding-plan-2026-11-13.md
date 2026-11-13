# Clipwright Engine 插件层全功能治理 Coding Plan

> 配套 [PRD](plugin-registration-runtime-optimization-prd-2026-11-13.md)。本计划只执行 PRD §2 标记 `F` 的有益改动；`B` 功能做回归保护，`C` 方案只有触发证据后另立 PRD。不实施 DSH profile/bundle、Cordis 移植、全域事务或 19 类统一 disposer。Engine 基线 `J:/Clipwright@c396962`，前端 `J:/Clipweight-Client@672a23e`；执行前核对当前分支及用户现有改动。工作目录须分别是两个仓库。

## 0. 实施状态（2026-11-13）

已落地的提交（Engine 分支 `ref/zam_plugin_system_optimization`）：

| 提交 | 覆盖工作包 |
|---|---|
| `c18a75e` | A1 严格 manifest YAML（Loader/worker 共用）+ `sandbox_demo` 重复键 |
| `604b8fa` | P0 legacy `ui.json` `tool`→`name`；shortform 仅在显式类别时改尺寸 |
| `3e50a12` | B2 子进程文件/协议限长；B6 代理方法大小写、目标工具与 owner 校验、bundle 真实验签 + 摘要 |
| `7db969c` | B7 override 受控来源；C1 加载失败回收/依赖/未知 kind；C2 迁移持久化、Provider schema 回收、PUT/DELETE 假成功 |
| `a673f02` | override 来源目录读取修正与迁移门禁兼容 |
| `dcdb2e8` | B1 安装 ID 校验与解压配额；B4 素材 symlink/流式 hash、只读不建目录、artifact 并发、render 路径与实测校验 |
| `deb4105` | B3 Job 幂等作用域/归属/进程组/digest；B5 capability 统一入口与宿主侧调用链 |
| `2ae398c` | C1 渲染器缓存卸载、能力目录/直接名可用性；C2 worker 配置合并与 reload 旧 worker |
| `eeaed87` | 调用链累积祖先（A→B→C→D 可拦）；override 允许表补 tts_feature 槽位（后被 `a4a64b4` 用更正确的规则取代） |
| `cbade04` | B6 代理贡献 id 兼容裸 id / `owner:id` / `<plugin>_legacy`；legacy `ui.json` 只对已加载且启用的 owner 输出 |
| `a4a64b4` | override 只对“可覆盖 kind”校验（附加槽位不再整包拒载）；单插件 `load()` 按需载入已安装依赖 |
| `7b08c72` | 子进程 64KiB 行缓冲上限（70KB 结果不再杀 worker）、worker 只读合并配置并注入贡献对象、`ToolExecResult.status` 正确映射 success |
| `94e22b0` | 渲染类别不可用不再 400；三份 legacy `ui.json` 的 `resultMap` 改 `output.*` |
| `c51ab31` | legacy `/ui` 同样按启用+已加载过滤；Job `list()` 按 task 隔离；插件 UI 文档改 `name`/`output.*` |

前端提交：`b3ad97d`（PRD/Coding Plan）、`7dc867e`（C4 全入口 owner 代理、kind/可见性/旧响应/脏布局/文案）、`01a5db7`（导出透传 `category_id` 并在重试沿用）、`e72104a`（贡献 id 用裸 id、预览只读、删除 tooltip）、`a96eefc`（删除文案测试同步）。

验证（2026-11-13 收尾）：后端插件相关 **292 passed**；前端 `tsc --noEmit` 通过、**1349 passed / 5 skipped**、`npm run build` 成功。两仓工作树干净。

### 0.1 两轮只读审查结论（已处理 / 仍开放）

已处理：`tts_feature` 整插件拒载（P0）、代理 `contribution_id` 契约不一致导致全布局按钮 403（P0）、调用链祖先丢失（P1）、`category_id` 无调用方 + strict 400（P1）、单插件加载带依赖必失败（P1）、70KB 帧杀 worker 与 `status` 误判失败（P2）、legacy `ui.json` 未按启用过滤（P2）、Job `list()` 未按 task 隔离（P2）、`resultMap` 读错层（P1）、预览非只读（P2）、删除 tooltip 不一致（P3）。

仍开放（按报价从高到低，需另立任务）：
1. ~~**可见性统一**~~：已收口（`8e87f93`）。新增 `usableContributions()`（slots.ts）作为宿主侧唯一可见性过滤，Slot / EditorLayout / toolbar / timeline / nav / overlay / page / export 全部接入；入口内容有效性（无 action / 无 layout / to 非法 / payload 非对象）fail-closed。
2. ~~**写操作确认策略**~~：已收口（`7cfc081`/`8e87f93`）。`confirmHandled` 去掉安装双确认；取消走独立 `cancelled` 结果，安装浮层显示「已取消安装」中性文案（`cancelled` 与 `failed` 状态分离）；bundle iframe 接入同一确认。
3. ~~**失效先隐藏**~~：已收口（`7cfc081`）。`invalidatePluginSlots` 先清空挂载态再重取，慢后端/断网也不残留旧贡献。
4. ~~**C2 配置接口真实性**~~：已收口（`a7d7924`）。`reload()` 返回 bool，PUT/DELETE 回滚时返回 500。
5. ~~**B2 宿主审核 `extra_read_roots`**~~：已收口（`a7d7924`）。
6. ~~**协议版本校验**~~：已收口（`a7d7924`）。
7. ~~**C1 失活 owner 拦截**~~：已收口（`a7d7924`）。
8. ~~**B1 解包实际字节计数**~~：已收口（`a7d7924`）。
9. ~~**`resolve_name` 404/503 语义**~~：已收口（`a7d7924`）。
10. ~~**测试债**~~：已收口（`7cfc081`/`8e87f93`）。补齐 pluginApiGuard（contribution_id/旧 tool/显式 params）、usePluginSlots（代际/先隐藏）、EditorToolbar（代理动作 + 可见性）、PluginPage（owner/贡献 id/可见性）、PluginLayoutRenderer（readOnly 预览）、usableContributions（6 例）、sanitizePluginPreset（5 例）红测。

**本计划的工作包已全部实施完毕。** 后续任何改动（新 slot、新贡献类型、协议升级）按 PRD 的条件改造触发条款另立 PRD。

## 1. 执行总则与门槛

1. 每包先阅读目标文件/当前测试，写失败用例，再修最小模块，再跑对应消费者回归；不得用 mock 掉 Loader、RPC 或执行入口的测试冒充集成验收。每包记录 `基线→红测→绿测→未验证平台`。危险验证只对测试临时目录、隔离 worker 和受控进程执行，绝不向宿主进程组发信号。
2. 不改变 `ContributionRegistry.register()` 返回逐项 `accepted/rejected` 的公开语义（`tests/clipwright/test_plugin_contribution.py:114-124`）。Loader 的 v2 路径负责“失败时清退本轮已接受的贡献”，而非把所有注册表替换成全新框架。对旧 `initialize()` 外部插件保留兼容，明确无法保证与新轨同等原子性。
3. 清理失败时必须报可读错误并禁止新调用命中残留 owner；正常退出才断言零残留。不得只改列表过滤而忽略 `ToolRegistry.execute` 主调用和 fallback（`tool/registry.py:260-312`）。
4. 阶段顺序：A 清单/基线 → B 安全与资源边界（可并行） → C 生命周期与配置（依赖 A，分别增测） → D 前端/文档 → E 全功能/42 插件回归。仅与业务耦合的阶段串行；后端安全包可分别审阅。每包必须可单独回退，不以一次性上线完整系统为前提。

## 2. A：基线与两条现有测试纠偏

- A1 **自动清单**：从 `J:/Clipwright/plugins/*/plugin.yaml` 枚举 id/kind/runtime/api_version/贡献键，记录有效 manifest 与声明差。42 份是当前基线，不是代码常量；`sandbox_demo/plugin.yaml:5,16` 有重复 `api_version`，PyYAML 实际用后者 v2。先用隔离测试钉住现状，再移除旧行，并让 Loader 和 worker 共同拒绝未来重复 YAML 键；不可先启用严格解析致 demo 停用。入口 `main.py` 仍需兼容 worker，不当作进程内合法模块名。
- A2 **现有基线**：后端可复跑命令为 `py -3.14 -m pytest tests/clipwright/test_plugin_review_fixes.py tests/clipwright/test_plugin_contribution.py tests/clipwright/test_plugin_dispatch.py tests/clipwright/test_plugin_runtime_subprocess.py -q`，本轮实测 **49 passed / 1 failed**；失败是 `tests/clipwright/test_plugin_dispatch.py:131` 断言旧九类集合，当前 `_WIRED_KINDS` 已含 `CLIP_KIND`。另有独立审查跑 `test_plugin_proxy_2026_11_12.py`+`test_plugin_bundle_gate.py` 为 12 passed，`test_plugin_governance*.py`+dispatch 为 41 passed/1 failed，可作交叉参考。前端 Slot 两文件 `12 passed`；本轮补跑 `pluginApiGuard`、`PluginLayoutRenderer`、`PluginBundleFrame`、`usePluginSlots` 四文件 `38 passed`（有一条 React 列表 key warning）；这两组测试均未覆盖 toolbar/timeline 直连、owner≠id、代理合法动作、预览误执行与旧请求回写，不能据此宣称新行为已通过。先核查注册/注销真实路径，再更新 `test_plugin_dispatch.py:131` 的旧期望。
- A3 **盘点结果**：对第 4 节 42 行填 `manifest keys, actual registered keys, consumer, disable path, test, result`；无法无副作用实例化时静态标 `unknown`，不得在生产目录批量 load。`plugins/` 目录还有非 manifest 目录，统计以 manifest 为准，Loader 发现另看 `__init__.py`（`loader.py:191-202`）。
- 验收：报告可复跑、重名键拒绝可见，现有针对性套件修正旧断言后通过；`test_plugin_review_fixes.py` 和 `test_plugin_dispatch.py` 不靠跳过变绿。

## 3. B：高收益安全与资源窄修

### B1 本地安装、管理入口（后端）

- `services/install_service.py:41-85` 在读取包/拼目标路径**之前**用 `security.validate_id` 校验 plugin_id，目标必须仍在插件根下；补 `..`、盘符/绝对路径/空 id、symlink/硬链归档、坏 SHA、加载失败残留负例。继续沿用 `_safe_extract`、200 MiB/sha 检查与市场下载已剥离的事实，不添新市场。
- `services/install_service.py:14,23-38,46-47` 的 200 MiB 只限制压缩包，不限制解包后体积。预检成员数量、单成员/总展开大小，解包时按实际写入字节再限额（仅信 tar header 不足以防异常数据），失败清理 staging；在临时磁盘用高压缩比文件和大量小成员验证。此项不启用已剥离的市场入口。
- 全仓当前只见 `install_plugin_from_bytes` 的定义和测试（`install_service.py:41,126`），**没有生产调用点**。本期只修公共函数的 ID 路径校验与临时 Loader 加载失败的注册副作用清理；不新增主 Loader 接入或本地安装 UI。若将来对外启用离线安装，先设计由应用主 Loader 完成激活并返回 `installed_restart_required`/已激活的明确状态；未完成前不得宣称“安装即刻可用”。保留包内安全解压/校验与市场下载已剥离的事实。测试加载失败后目录与注册表无残留。
- `/api/plugin/load-all`（`api/plugin.py:735-741`）与 `/load` 的守卫保持一致；但必须说明：账号系统剥离后 `authz.require_admin` 对 `user_id=None` 一律放行（`authz.py:49-58`、`main.py:525-526`），本地 token 模式下这不是权限隔离，只是接口一致性。文档/UI 不得宣称已有管理员保护；若恢复多用户，先恢复身份注入/角色校验再补真实门禁。`DELETE /{plugin_id}` 仅卸载并清 PluginData，**不删除插件目录**（`api/plugin.py:588-622`）；前端 `PluginsPanel.tsx:255,517` 的“从插件目录移除”文案与行为不符，改为“卸载并清除插件数据（不删除安装目录）”，或另行实现真正的删除并加二次确认与测试。

### B2 子进程文件/协议/超时（后端）

- `runtime/worker.py:77-90` 从插件 manifest 读取 `extra_read_roots`，`PermissionGuard._build_read_roots:97-116` 直接并入读根；由宿主审核该申请并限制为确有授权的模型/素材目录，项目外/用户目录默认拒绝；`sys.path` 导入根也不能顺带扩大到整个项目。worker 独立启动未复验签名/权限（`:110-120`），应绑定宿主前置校验后的受控启动或做一次验证握手，测试直接启动坏清单不能越权，且不把 audit hook 称为 OS 沙箱。
- `runtime/permissions.py:143-161` 当前主要检查 `open`/listdir/scandir，隔离 worker 内用临时文件验证 remove/rename/replace/mkdir/rmdir 与 `os.open(flags)` 的实测绕过，按事件的真实参数和源/目标路径补检查；网络审计仅列有限事件，承认无法当 OS 沙箱，只有可证明的事件才加拦截。保留现有 env 白名单和 host 启动前 audit hook；失败用例不得触碰工作区真实用户文件。测试 `test_plugin_runtime_units.py`, `test_plugin_security_m1.py`。
- `runtime/protocol.py:76-98` 对入站帧也限 `MAX_FRAME_BYTES`（包含多字节 UTF-8），`runtime/host.py:347-355` 在读取请求/响应时检查协议版本与方向；超长行的内存峰值需在读取之前受限或有安全上界，不能只在 decode 后算。非法帧记录并停止当前 worker，不能继续接受其消息。加 hostile worker fixture 测超长、旧/新不支持版本、并发普通消息不回归；保留当前 v1/v2 合法兼容。
- `runtime/host.py:293-311` 超时后除了 mark_dead 必须异步终止并等待真实 worker 退出，清 pending 与线程资源；不得在同一个事件循环线程调用阻塞 `stop()`。重复超时三次 PID/线程不增长。`runtime/worker.py:122-138` 将 `<id>.<module>` 安全映射到自身包目录，兼容 `sandbox_demo` 的 `main.py`；禁止失败后回退其他入口掩盖错误。保留双向 RPC 的请求 ID、并发与 scope。

### B3 Job Broker 进程组与恢复语义（后端）

- `services/plugin_jobs.py:306-313,348-364` POSIX 创建 job 时需要独立 session/process group，只有确认自己是该组 owner 才 `killpg`；Windows 保留现有 taskkill 路径。用 POSIX 专属隔离进程组测试取消/超时只杀 job 子树，不碰测试宿主，Windows 跑有界模拟验证；不可直接在当前进程组复现 killpg。`submit` 的不存在 cwd 不得因 `PluginWorkspace.resolve` 隐式 mkdir；`cancel vs complete` 竞态测终态一次结算。
- 保留运行时审批、argv/env 白名单、并发上限、幂等、job 事件。修复 `plugin_jobs.py:196-214` 以原始字符串全局复用幂等键：按 `(plugin,project,task,key)` 分区，并在复用前核对请求所属 runtime/argv/cwd/outputs，不同作用域同 key 绝不可返回他人 JobRecord；`get/list/cancel`（`:220-280`）以同一作用域授权，明确空 task 的兼容语义。覆盖不同插件、不同任务同 key、相同作用域相同/不同参数、取消其他任务 Job 的负例。`RuntimeSpec.digest` 目前只是字段，`require_approved:119-125` 不校验可执行文件摘要；若批准记录包含 digest，执行前验证文件 hash，不匹配拒绝，未声明 digest 的旧配置按现行规则但不得宣传为已校验；验证替换程序后的拒绝。`recover_interrupted()` 当前只扫描内存记录（`:367-376`），**不承诺进程重启后的持久恢复**；持久 Job 数据源只有将来真实需求/数据规模证据才另立计划。`PluginHost.stop()` 的 listener 清理与 job 取消观察在对应既有测试扩展。

### B4 素材、工作区、产物与渲染（后端）

- `services/plugin_materials.py:53-80` 和 `services/plugin_context.py:122-152` 对同一 materials 树各自 rglob/read_bytes；抽一个共享的只读枚举器：跳过 symlink/realpath 越界，先 stat 并对允许的文件用分块 sha256，限制遍历/单文件资源，不把整个视频读入内存。保留 `read_material` 的读取上限和 PluginScope project 权限。测指向外部的 symlink、巨文件、空目录、扫描次序。
- `services/plugin_workspace.py:89-108` 的 read/list/stat/hash 不创建父目录，写/mkdir 保留当前约定；`PluginArtifactRegistry.register`（`:278-315`）并发写需进程内按 project+plugin 串行并用唯一临时文件替换，测试并发两次均留存；跨进程锁仅有并发部署需求再补。`artifact.get/list` 当前按 project/plugin 登记，是否还要 task 过滤先按现有对外契约核实，确定需要隔离才加入且保留受授权跨任务读取，不能凭字段存在就收紧。
- `services/plugin_render.py:111-130,169-205` 结果给 path 时也必须解析/校验其位于当前插件工作区并符合已登记 artifact/hash（或统一只接受 artifact_id，但需兼容旧插件的合法相对/工作区 path）；实际尺寸/FPS/时长用 ffprobe `info` 比对，不信自报 payload。测试路径逃逸/符号链接/真实 probe 与自报不符/合法旧路径，沿用当前 alpha/mime/容差。

### B5 跨插件与能力调用（后端）

- `services/plugin_rpc.py:296-338` 当前读插件传入的 `chain`。链和深度由宿主可信请求上下文/host call 栈维护，插件不能在 `params` 清空或伪造；保留 manifest.dependencies 与被调插件 `exposes` 双门禁。至少用 A→B→C→A 构造递归负例，保留 A→B 合法调用。若无可靠跨 RPC 调用上下文，先拒绝深链而不是虚报限制已实现。
- `plugin_rpc.py:251-277` 的 `capability.call` 已在静态调用链直接 `resolve(name)`→`tool.execute`，绕过 `ToolRegistry.execute` 的路径/URL安全校验、trace 与结果/回退规则；这不是仅待确认的可能性。先用受控非法路径/URL、`costly` 档和合法只读能力比较三种入口，然后在保留默认能力白名单和显式 grant 的前提下复用统一执行校验/审计与成本口径，不能仅把原始工具对象换成另一层绕过。取消传播 `host.invoke()` 到 worker 当前未保证（`host.py:261-311`）：标明取消边界并测试外层取消与 Job 取消区别；真正长任务抢占须另设计 req_id cancel，不把 `job.cancelled` 通知当自动中止 tool.call。

### B6 插件代理与受信任 UI 的服务端授权（后端；C4 前置）

- `api/plugin.py:826-902` 保留已发布的 `/proxy/{plugin_id}/{method}` 形状，但把允许映射的 method 大小写统一（当前字典 `POST:tool`、查询 `post:tool`，真实调用不命中）；校验插件**已加载且启用**。现有 42 个插件没有 toolbar/timeline 贡献，当前可迁移的合法 UI 动作是 `POST:tool` 与 headless_chrome 的 probe/install；其他 endpoint 必须先由宿主评审并加入白名单，不能因为插件声明了按钮就自动放行。代理 body 新增可选 `contribution_id` 供新版 UI 发送，验证该 `(ui_slot,id)` 当前属于 URL 中的 owner；旧客户端不带字段仅能调用既有受控动作，仍必须核对工具 id 是该插件声明且当前注册的 Tool，不能借 `example_full` 的代理调用其它插件或内置危险工具。按 `permission_tier` 拒绝不适合 UI 的 `dangerous`/未授权付费调用，成本/审计与普通网关口径一致。probe/install 只允许 `headless_chrome` 所有的受控动作，安装显式确认由宿主调用方执行，服务端不接受插件自报路径。跨插件/内置工具/禁用后/伪 owner/危险档/大小写/合法 tool 七组路由测试必须通过；`test_plugin_proxy_2026_11_12.py` 追加真调用而非仅检查 403。
- `get_plugin_bundle`（`api/plugin.py:300-351`）目前只判断 `signature` 非空，未验证 HMAC，且 HMAC 只签 manifest 不签 bundle.html。当前 42 个内置插件目录未发现 `bundle.html`，因此用临时合成插件测试此边界，不要求迁移不存在的内置 bundle。先在 `PluginManifest` 增显式 bundle SHA-256 字段，使该字段进入 `_canonical_manifest_payload` 的既有签名；签发脚本对含 bundle 的插件计算摘要并签 manifest，读取时调用 `verify_manifest_signature` 且重算文件摘要。禁止只信插件自报的未签 digest；旧无摘要 bundle 在启用档时给可读迁移错误。再核插件已加载且启用、贡献 `(ui_slot,id)` 与 owner 匹配；分别篡改 manifest/bundle、伪 owner、正常签名/禁用后负例。保留 `plugin_allow_ui_bundle` 缺省关、CSP、iframe sandbox 和 Token 模式带凭据取档。
- `plugins/provider_decl.py:121-126` 的 `forget_plugin()` 有实现但卸载未调用，虽由 C2 处理，代理/Slot 的 owner 可见性也要对齐：查询接口可显示的 UI 与工具实际授权不得因 `discover()` 或 `.enabled` 单独为真而绕过已卸载状态。

### B7 `override_builtin` 受控来源（后端；与 B6 同批）

- 现状：42 份 manifest **0 签名**，9 个插件声明 `override_builtin: true`；`base.py:86-95` 仅凭自声明转 OVERRIDE，`contribution.py:191-200` 不再校验签名/目标，loader 也没有针对覆盖的独立授权。直接“未签名拒绝”会让 9 个插件默认失效。
- 实施：定义 `bundled_trust`（随应用发布、路径相对代码安装根而非用户可配 `settings.plugin_dir`）与代码内 `(kind,id)` 覆盖允许表（当前只列这 9 个插件的实际目标）。校验顺序：插件来源为受信 bundled → 目标在允许表 → 允许；否则要求 manifest HMAC 有效且目标在允许表；不满足则拒绝加载并给稳定错误码。禁止 manifest 自报 `trusted: true`；不得按键名/厂商写分支，允许表按 kind:id 数据化。文档需说明 bundled 信任只证明“随应用发布”，不防本机管理员篡改目录，篡改防护由后续内容摘要承担。
- 验收：`test_plugin_security_m1.py`、`test_plugin_contribution.py` 扩展——9 个受信插件正常注册且禁用回退；第三方未签名覆盖拒绝；第三方有效签名+允许目标通过；非允许目标/非允许 kind 拒绝；不得改变普通插件冲突仍拒绝的语义。

## 4. C：加载、配置、消费和界面可靠性

### C1 加载失败、依赖与旧渲染缓存（后端）

- `plugins/base.py:32-106` 接受一些贡献但 report.rejected 时仍返回成功；`loader.py:310-317` initialize 抛错未回收。Loader v2 在加载失败时对本次 owner 的 accepted 项执行现有分表回收、确认真实消费者不可再调用；清理失败错误可见，不能假报成功。底层门面仍保持逐项报告、旧轨兼容。`load_all()`（`:379-388`）只追加非 None 的已加载项；依赖检查（`:848-860`）对需要加载的依赖验证实际加载成功，而非只看目录/enable；当前不引入通用 DAG/DI/无限 pending。先测二贡献第二个失败、安装失败后无 orphan、禁用依赖、循环与一个加载失败的依赖。
- `animation/diagram_svg.py:191,197-205` 的 Hook 渲染器缓存无 owner 回收：先用真实 `logic_animations` 渲染→禁用→同 preset 不可再命中→启用恢复；修缓存时保留公开自定义 renderer。`plugins/shortform_category/main.py:85-92` 的 `pre_render` 当前无条件改 1080×1920，是全局成片规格被覆盖的现存缺陷；`api/render.py:662-666` 的 Hook 上下文只有 `task_id/settings/preset`，`RenderRequest/RenderSettings`（`:1237-1269`）无类别。实施：`RenderRequest` 增 `category_id: str = ""`，非空时按 `CategoryRegistry` 校验、未知值 400；PRE_RENDER context 带 `category_id`；shortform Hook 仅在 `category_id == "shortform_category"` 时改尺寸；自动渲染从任务/管线已有的 `category_plugin_id`（`api/pipeline.py`/`requirements_service` 调用链）传入，手动导出在前端能拿到项目类别前保持空、不改尺寸，禁止用视频比例或 metadata 猜测。前端若无法可靠提供类别，先删除/禁用该 Hook 的强制覆写并保留类型策略，不能让旧客户端继续被全局改造。测试：无 category、其他类别、shortform 匹配三组，断言宽高与 settings 不被误改；`test_hooks_async_dispatch.py` 与 render API 测试回归。Hook 异常仍不阻断兄弟 Hook，但记录 owner/phase 于现有 error_bus。
- `tool/capabilities.py:161-166,213-221` 直接工具名 fallback 若不可用不得返回可执行对象；动态 capability 真有新消费者时纳入 catalog，不为纯展示扩表。清理失败时 `ToolRegistry.execute` 主调用和 fallback、相应 Skill/Provider/Hook 入口实际拒失活 owner；如无法在所有入口以现有归属安全隔离，先保证真实回收并报告无法满足的部分，**不要仅隐藏 `/contributions` 然后宣称安全**。
- **`renderer_backend` 与 `clip_kind` 回归**：这两个 kind 是 PRD §2 新增的显式覆盖项。保留 `providers/render` 的 backend 注册/探测/回退与 `services/clip_kind_registry` 的渲染/预览契约；补禁用后 backend 候选撤回、`is_plugin_kind`/`get` 不再命中、旧 clip 渲染显式降级的测试。当前 42 个内置插件没有 `clip_kind` 贡献，用合成插件（参考 `tests/clipwright/test_clip_kind_subprocess.py`）验证，不要求现有插件改代码。

### C2 配置迁移、Provider schema 与 worker 重载（后端）

- `loader.py:864-909` 的 migration 只改返回字典，异常仍把 `_schema_version` 改到 target。迁移成功先校验输出 dict/schema，原子写到 PluginData（仅有实际用户覆盖时，源码默认保持只读），再提高版本；失败原文件、版本不变并给出可读诊断。测重启后不重复迁移、失败/无密钥/密文字段不泄漏、旧格式兼容；复用已有 `test_plugin_governance3.py:151-174`，不另建迁移框架。
- `plugins/provider_decl.py:97-147` 的 owner schema 随插件失败/卸载清理，别在重载时删除新代；前端 Providers 表单禁用后不出现幽灵项。保持 19 kind 当前 `dispatch/facade-only` 分类，不全面 disposer 化。
- `loader.py:728-780` 子进程 reload 必须 stop/pop 旧 `_hosts`，失败不可把已 shutdown 实例恢复成“成功”；新 worker 原地 reload 不重复保留旧进程。`api/plugin.py:654-732` PUT/DELETE 当前先写盘/删除再 reload 且失败可回 200；保留未加载插件预配置，已加载配置更新前保存旧文件，失败恢复旧配置与旧运行态或明确 `failed_unavailable`，只有 worker/实际执行读到新值才回成功。测 PID、实际配置、异常回滚、只读 API 不暴露 secret。

### C3 API 与前端（双仓）

- `api/plugin.py:445-471` legacy ui.json 从 discover 扫出，无论 owner 是否 active；只在 owner 真加载且启用时给出，并让 `?kind=export_preset` 不追加 ui_slot。保持 `/list` 只列已加载插件的数组响应，`/discover` 与 `/health` 合并显示未加载/失败；保留 `admin_only` 服务端过滤和受控 bundle 签名/CSP/动作代理。`src/features/plugins/usePluginSlots.ts:128-140` 的 `usePluginContributions(kind)` 真过滤 kind，保留原始 slot 名的既有失效广播及 30s 缓存。测试禁用/卸载 legacy、kind 过滤与错误恢复；跨浏览器实时刷新若有可复现用户需求，再用现有焦点重取而不是默认增加 SSE/revision 协议。
- `api/plugin.py:475-576` /health 从现有 error_bus、loaded/worker.alive/贡献差集汇总**当前状态**，历史错误不永久标运行失败；Hook 运行异常有 owner。不要为此额外做全站 generation 或改 `/list` JSON 形状。前端错误文本过 `asText`；编辑器 UI 动作安全由 C4 与 B6 负责。

### C4 编辑器全部扩展入口与交互状态（前端；依赖 B6/C3）

- **全入口清单**：编辑器面板 `EditorLayout.tsx:218-305`、`Slot.tsx:30-74`；toolbar `EditorToolbar.tsx:47-76`；timeline tool/menu `TimelinePanel.tsx:33-40,310-325,384-397`；属性 `PropertiesPanel.tsx:630-645`；资产面板「插件」tab `src/features/assets/PluginPanel.tsx:24-137`（legacy `ui.json`，含按钮动作）；页面 `PluginPage.tsx:16-77`；浮层 `overlayActions.ts:33-52`；快捷键 `usePluginShortcuts.ts:37-80`；iframe `PluginBundleFrame.tsx:73-125`；管理页 UI 预览 `PluginsPanel.tsx:783-795`。`PluginsPanel.tsx:141-179` 的自检是宿主直接调用 `/api/tool/execute` 的管理动作，不属于插件自报端点，不要误改；但它应走与宿主其他管理动作相同的权限与错误提示。测试按实际挂载位置覆盖所有，不能只测 Slot 类。
- **legacy `ui.json` 动作修复（跨仓）**：`plugins/ai_image_gen|ai_music_gen|ai_video_gen/ui.json` 的按钮 body 是 `{tool: "..."}`，`/api/tool/execute` 要求 `{name, params}`（`api/tool.py:49-58`），现网点击即 422；`pluginApiGuard.toPluginProxyRequest`（`:83-85`）也只读 `body.name`。修正三份 `ui.json` 为 `name`；对已安装的旧版插件，在 `toPluginProxyRequest` 读取 `body.name ?? body.tool` 并记录一次 deprecation 告警（不把 `tool` 写回代理 payload），否则升级用户仍会点坏。测试：修正前 422 基线、修正后直连与代理均成功、旧 `tool` body 经兼容映射成功、非法空名 400。不得只改前端代理而留坏数据，也不得让兼容映射静默接受任意字段。
- **先红测动作矩阵**：给 toolbar、timeline.tool、timeline.context-menu、layout button、overlay、page、shortcut、iframe 各提供 owner≠contribution id 的合法贡献；断言请求统一发到 `/api/plugin/proxy/{owner}/{get|post}` 且带 action/payload 和可选 `contribution_id`（后端核 `(ui_slot,id)` 当前归属），旧业务 endpoint 请求数为 0；缺 owner、未登记端点、DELETE/PUT、编码穿越、插件禁用后请求数均为 0。写操作在用户逐次确认前不发请求；用户拒绝、服务器拒绝与重试明确可见。`PluginBundleFrame` 需要 `Slot.tsx:42-49` 用 `c.owner` 取 bundle；`PluginLayoutRenderer` 的 `page/Slot/PluginPanel` 所有入口传 owner，不得从标题或 id 猜；把现存 `PluginLayoutRenderer.test.tsx:59-61` 断言直连改为代理请求，并补 toolbar/timeline 独立测试。
- **实现**：建立一处纯的 `executePluginAction(owner,spec,options)`（可在 `features/plugins`），复用 `authorizePluginCall`、`toPluginProxyRequest`、`pluginCallNeedsConfirm`、`getApiClient`，返回区分拒绝/取消/成功/失败的结果；所有前述 UI 入口替换直连。插件工具栏/时间轴动作不得直接写 store。对于确需修改 clip/timeline 的产品需求，另以宿主受控命令提交，经 schema 校验、选区/项目归属、`historyStore` 撤销记录及只读状态检查；本期**不**提供通用 store/任意 API 编辑能力，UI 按钮只能使用白名单动作。浮层探针保持无副作用，安装须确认；管理页 preview 增显式只读模式，预览按钮禁用或只显示，绝不发 HTTP/上传。
- **先红测数据与可见性**：`usePluginSlots.ts:88-89` 限 `kind==='ui_slot'` 且 slot 匹配，`usePluginContributions(kind)` 改 `c.kind===kind`；`ExportPage.tsx:224-236` 校验正整数宽高、有限合法 fps、比特率/容器支持值，拒绝任意混入 payload。原始已挂载 Slot 本地失效绿测须保留；构造 A 旧请求晚于 B 禁用刷新返回，断言 A 不回写缓存/组件；`PluginsPanel.loadAll` 也失效贡献。EditorLayout 的列数与 Slot 使用相同经过 `visibleWhen`、合法 layout/bundle 筛选的结果，`visibleWhen=false` 或无渲染内容不占空白列；toolbar、timeline、nav、page、overlay、export 也按宿主可得上下文求值，缺必要上下文 fail-closed，不借任意脚本求值。
- **输入安全与状态文案**：`PluginLayoutRenderer.tsx:23-56,179-205,360-443` 的动态控件与返回数据只允许已声明结果映射；不把任意 response 对象合入输入 state，拒绝原型键和未知目标键。`children` 非数组、非法 alert severity、URL/外链图片、非有限 order/脏 title 均安全降级，展示文本走 `asText`；不同 owner/id 的渲染状态不能串用。保留 `file` 只回调宿主、`optionsFrom` 仅白名单数据源。负例构造恶意对象、外链 URL、两个同 id 不同 owner 插件、错误布局、跨插件 payload，不白屏/不发危险请求。另修 `PluginsPanel.tsx:473-480` 把 `declared_only` 用红色错误 + AlertTriangle 展示：它可能是正常的未配置可选能力（PRD §5），改为中性信息样式与“未启用/可能缺少配置”文案，避免用户误以为插件损坏；删除确认文案按 B1 改为“卸载并清除插件数据，不删除安装目录”。
- **验收**：针对性 Vitest 覆盖 `pluginApiGuard`, `PluginLayoutRenderer`, `PluginBundleFrame`, `usePluginSlots`, `EditorToolbar`, `TimelinePanel`, `PluginPage`, `AppOverlayHost`；Playwright 用后端路由 mock 覆盖启停后编辑器各槽显示/消失及一次合法代理动作、一个非法动作零请求；再跑 `npx tsc --noEmit`、`npm run test`、`npm run build`。已跑四个现有插件 UI 文件共 38 tests passed，只是基线，不能据此宣称新交互通过。移动端/只读窗口保证不执行编辑动作。

## 5. D：42 个现有插件的逐项适配任务

**读表规则**：`S`=插件源码或 manifest 必须修改；`H`=宿主改动覆盖该插件，插件本身不改但必须回归；`C`=先验证，只有证据成立才修改插件；`R`=保持实现、补验收。每行的“声明”取现有 `plugin.yaml`，动态/条件贡献在加载时可以少于声明；测试须记录实测键及缺失原因。`H/R` 仍是明确的适配方案，不是跳过。运行测试用 isolated Loader/真实消费者，外网及付费服务 stub；禁用后核对 API 和实际执行，失败不得冒充已适配。

| 插件 | 声明贡献（同 kind 多项合并） | 适配动作与责任 | 必须验证的行为 |
|---|---|---|---|
| `ai_image_gen` | tool:`ai_image_generate`; material:`ai_image_gen` | **S**：`ui.json` 按钮 body `tool`→`name`（当前 422）；Loader 部分注册回收；缺配置分支条件验收 | 修正后图像按钮经 owner 代理成功；两贡献启用/禁用一致；无配置不被误判坏包。 |
| `ai_music_gen` | tool:`ai_music_generate`; material:`ai_music_gen` | **S**：`ui.json` body 同上；插件供应商签名不改 | 代理请求进入原插件并成功；禁用无工具/素材源；原权限档不变。 |
| `ai_video_gen` | tool:`ai_video_generate`; material:`ai_video_gen` | **S**：`ui.json` body 同上；保留异步任务语义 | 创建与轮询经代理成功；中止后不再新发起调用；按钮不再 422。 |
| `bgm_library` | material:`freesound`,`local_bgm` | R：按 key/目录条件贡献，不强制全声明同时出现；插件不改 | 两配置都提供时两源可用；只配一项只现对应源；无配置返回 []；卸载回收。 |
| `custom_style` | style:`custom_style` | H：宿主风格优先级/卸载回归，插件不改 | 启用风格生效，禁用恢复次优/内置解释器。 |
| `diagram_style` | hook:`diagram_style_presets` | H：Hook 错误归属，插件 `presets.py` 保持 | 真实 DIAGRAM_STYLE_PRESET 生效；禁用后该主题不再来自插件。 |
| `embedding_providers` | embed:`openai`,`ollama`,`local` | H：受控 override 名单、Provider schema 卸载；插件不改协议 | 三 id 分别可发现；禁用后表单字段/候选移除或按内置回退。 |
| `example_caption_plugin` | tool:`caption_segment`; skill:`summarize_captions` | H：Loader 双贡献失败清理；插件不改 | 两者可调用；第二贡献拒绝时第一项不可残留。 |
| `example_full` | tool:`example_echo`; UI:`example_panel`,`example_settings`,`example_page`,`example_nav`,`example_shortcut`; preset:`example_preset` | H：多类贡献与前端 C4 统一代理、预览只读及过滤；示例页面原 `/api/tool/execute` 动作由宿主代理适配，插件源码原则上不改 | 各 Slot、Tool、Preset 一次展示/调用；页面按钮和快捷键只调用归属本插件的工具；禁用全移除、内置 UI 不变。 |
| `gaming_category` | category:`gaming_category` | R：保留类型策略 | 类型可选，禁用后不再列入类型选择。 |
| `genui` | prompt:`genui_requirements_prompt`; display:`brief`,`plan` | H：展示纯数据和提示词回收；不再搬 engine 清洗器 | 启用 2 spec 与 prompt；禁用只退化展示，简报/规划正文仍可读。 |
| `gif_sticker` | material:`giphy` | R：缺凭据返回 [] 合法；插件不改 | 未配 key 不显示源；stub 有 key 后 Giphy 可查，禁用源消失。 |
| `headless_chrome` | renderer:`chrome_headless_shell`; UI:`headless_chrome_install_prompt` | H：宿主 backend/Slot 清理；插件 `shell.py` 保持 | 已安装可探测/选择，缺失可见安装入口；禁用 backend/overlay 不再可选。 |
| `kinetic_typography` | prompt:`kinetic_structure_prompt`; animation:`word_emphasis`,`bounce_text`,`elastic_scale`,`stroke_draw` | R：不迁已存在 keyframes；若真实成片无法消费才 C | 四动画能从注册表选取并渲染；禁用目录和 prompt 回落。 |
| `llm_anthropic` | llm:`anthropic` | H：受控 override/schema 回收，插件实现不改 | 模拟请求成功；切停后选择与源配置按内置策略恢复。 |
| `llm_openai_compatible` | llm:`openai`,`ollama` | H：同上，双 id 分别核对 | 请求/模型列表按源配置；两 id 禁用一致，不残留旧字段。 |
| `local_material` | material:`local_material` | R：只有配目录才贡献，已归位 local_folder 不搬迁 | 临时目录搜索；空配置 []；禁用后源不可用。 |
| `logic_animations` | hook:`logic_animations_renderer`; prompt:`logic_animations_structure_prompt` | H：宿主 `diagram_svg` 缓存修复，插件内 12 渲染器保持 | 使用 radar→卸载→不得命中旧 renderer；启用恢复且提示词归属正确。 |
| `lottie_animations` | prompt:`lottie_structure_prompt` | R：刻意 prompt-only，不新增 Lottie 渲染器 | 无动画/render 贡献；提示词明确“未接入渲染”；禁用提示词移除。 |
| `lut_presets` | style:`lut_presets`; hook:`lut_presets_diagram_style` | H：风格/Hook 联动清理，插件不改 | 优先级选择及主题生效；禁用退让且 Hook 不残留。 |
| `mg_animations` | hook:`mg_renderer_extend`,`mg_catalog_extend`; animation:`mg_title_reveal`,`mg_data_counter`,`mg_countdown`,`mg_logo_intro` | R：动态 JSON 对齐四项声明；manifest 可不写 id（Loader 用目录名），无须补 id | 四 JSON→AnimationDef/目录有效，禁用后目录/钩子清退；缺定义报告差集。 |
| `my_animations` | animation:`shake_alert`,`radial_wipe` | R：保留数据驱动实现 | 两定义选取/渲染，禁用不可选。 |
| `news_category` | category:`news_category` | R：保留新闻类型策略 | 类型选择与禁用回退。 |
| `pexels_material` | material:`pexels` | R：无 key 可为 []，不改 API 适配 | stub 搜索；禁用回收；无凭据显示未配置而非加载失败。 |
| `pixabay_material` | material:`pixabay` | R：同上 | 同上，检查 Pixabay 结果归属。 |
| `platform_export` | preset:`bilibili`,`bilibili_4k`,`douyin`,`youtube`,`wechat_channels`,`xiaohongshu`; hook:`platform_export_pre_render`,`platform_export_post_render` | H：宿主预设/Hook 失活与 fallback；插件不重复搬预设 | 六预设可选，两 Hook 只匹配本预设；禁用后宿主默认仍可导出。 |
| `rerank_providers` | rerank:`http`,`local` | H：override/schema 归属，插件不改 | 两路排序入口；禁用候选/字段恢复。 |
| `sandbox_demo` | tool:`sandbox_echo`,`sandbox_write_probe`; hook:`sandbox_pre_render`; UI:`sandbox_panel`; prompt:`sandbox_edit_prompt` | **S**：`plugin.yaml` 删除重复 `api_version: "1"`，保留有效 v2；宿主 B2/C2 修 worker | 真 worker 加载/回显/拒写/Hook/UI/Prompt；重复 reload 旧 PID 退出、失败无孤儿。 |
| `shortform_category` | category:`shortform_category`; hook:`shortform_force_vertical` | **S**：`main.py` Hook 校验显式 `category_id`；宿主渲染请求添加可选来源 | 无 category/其他类别不改尺寸；只有 shortform 改 1080×1920；禁用恢复。 |
| `stt_providers` | stt:`whisper`,`faster-whisper` | H：受控 override/schema；插件不重写转录实现 | 两 backend 可调用，禁用回退或显式不可用，与 whisper_stt Skill 不双注册 Tool。 |
| `subagent_demo` | agent:`demo_summarizer` | R：保留 Agent 注册依赖 | 可派生运行一次；禁用后不可新派发，已有任务按既有取消规则。 |
| `subtitle_translate` | tool:`subtitle_translate`; skill:`bilingual_subtitle` | H：Loader 原子失败回收，插件不改翻译逻辑 | 两贡献 stub 运行、禁用双退场。 |
| `text_animations` | 25 个 `text_*` tool（manifest 全列） | R：保留 25 个现有工具，不为迁移重写渲染 | 25 声明/实际 id 一致；代表动画可渲染，禁用全回收。 |
| `tts_cosyvoice` | tts:`cosyvoice` | H：受控 override、schema 回收；插件不改协议 | 合成 stub、缺 uploader/配置错误可诊断，禁用回退。 |
| `tts_feature` | skill:`dub_script`; UI:`create_dub_entry` | H：既有 override 与宿主 Slot 同步；插件不改编排 | Skill 调用及配音步骤同开同关；上传仍由宿主执行。 |
| `tts_minimax` | tts:`minimax` | H：受控 override、schema 回收；插件不改协议 | 合成 stub；禁用无幽灵 provider。 |
| `tts_qwen` | tts:`qwen-tts` | H：受控 override、schema 回收；插件不改协议 | 合成和 base64 audio ref 正确，禁用后候选恢复。 |
| `tutorial_category` | category:`tutorial_category` | R：保留类型策略 | 类型可选，禁用后不可选。 |
| `unsplash_material` | material:`unsplash` | R：缺 key 返回 [] 合法 | stub 搜索及署名，禁用无旧源。 |
| `voice_ext` | tts:`elevenlabs`,`azure` | H：两个 provider schema/候选清理；不是 tool-only | 两协议 stub 合成，禁用双候选消失。 |
| `web_media` | tool:`web_images`,`fact_need` | H：能力/权限调用入口对账；插件代码不移入 services | 抓图和事实判断 stub；禁用后 Agent 不直连 service 绕过能力缺失。 |
| `whisper_stt` | skill:`transcribe_and_align` | R：`WhisperTranscribeTool` 只是类内 helper，未注册贡献，不补 Tool | Skill 可转写并生成片段；禁用 Skill 消失，stt_providers backend 仍独立。 |

### 5.1 分批实施与验收

1. **先修插件本身与现成故障**：`sandbox_demo` 重复键在 A1 严格解析前改；`shortform_category` 与 C1 的显式 `category_id` 同批改，未接通前不得继续全局改尺寸；`ai_image_gen`/`ai_music_gen`/`ai_video_gen` 的 `ui.json` body 与 C4 代理同批改，修前先钉住 422 基线。三组各有真实 Loader/API 测试，禁止只改 manifest 或只改前端使测试假绿。
2. **再验宿主适配**：H 类分别在 B/C 工作包增真实插件回归；九个 override 插件按 B7 的 bundled 信任/允许表迁移，逐个验证内置候选恢复和 schema，不可把外部未签名插件混同随代码发布的受信插件。多贡献插件至少验第二项拒绝回收；条件贡献同时测“无配置 []”和“有配置可用”。
3. **R/C 类不为改动而改动**：若有真实缺陷再把该行升级为 S 并补实证、代码位置和测试；维护当前功能为目标，不因未改文件判定“未适配”。所有行结果记录 `声明键/运行键/是否条件/修改责任/测试/结果/未证事项`，每个实际注册键至少有消费或合理的无消费解释。
4. **UX 收口**：legacy 面板按钮可用、UI 预览只读、`declared_only` 中性提示、删除文案与 API 行为一致、禁用后旧 UI/旧响应不复活；这些是用户可见验收，不能只靠后端单测。

另有**非 manifest 功能回归**，不能被“42 个插件通过”替代：`test_install_service.py`（本地安装/拒绝/回滚）、`test_plugin_config.py`/`test_plugin_governance3.py`（默认/加密/迁移）、`test_plugin_jobs.py`/`test_plugin_job_rpc.py`（job/cancel/事件）、`test_plugin_workspace*.py`/`test_plugin_materials*.py`（scope/素材/artifact）、`test_plugin_render.py`（渲染事实）、`test_plugin_cross_call_m5.py`（依赖/exposes/链）、`test_plugin_rpc_v2.py`（协议）、`test_plugin_proxy_2026_11_12.py`/`test_plugin_bundle_gate.py`（前端受控动作）、各 Provider/Agent/Hook 消费测试。上述功能保留现有结果；本期仅改关联的 F 项。

## 6. 验证命令、兼容与停止条件

- Engine 用 `py -3.14 -m pytest <本包新增与相邻测试文件> -q` 先测；再在 PowerShell 从 Engine 根枚举插件测试：`$cases = Get-ChildItem tests/clipwright -Filter 'test_plugin_*.py' | ForEach-Object FullName; py -3.14 -m pytest $cases -q`。当前 31 个插件名前缀测试文件，另附安装、渲染、Provider、artifact、Job 测试。`py -3.14 -c "import clipwright.main"`。已有全量套件可能长跑，未跑不写“通过”。
- 前端 `npx vitest run src/features/plugins/usePluginSlots.test.tsx src/features/plugins/slots.test.ts`、`npx tsc --noEmit`、`npm run test`、`npm run build`；相关 Playwright E2E 需真实后端按项目脚本启动。任一命令失败先归因已知基线/本期回归，不能通过删实现或跳过测试掩盖。
- 性能和安全验收分别使用超大素材、受控符号链接、非法帧与临时子进程；**POSIX killpg 测试必须有独立进程组且不在宿主会话真实调用旧实现**。Windows 不支持的信号语义在 POSIX CI 跑，Windows 侧测 taskkill 路径；用例未覆盖时标明平台风险。
- 所有有益修复的停止条件：安全测试无法隔离、改变既有允许路径/权限而无迁移方案、旧客户端接口形状被破坏、已安装插件数据可能被删除、影响任务执行却无取消/费用证据。遇到即暂停该包，保留其他独立包成果，并更新 PRD 风险与实际复现。
- 交付验收：PRD §2 各功能行都能给出当前行为/关联测试/保留或 F 改动结果；42 份 manifest 对账无漏；每个 F 的红绿测试和对应业务路径实测；P0 三项（legacy ui.json 按钮、shortform 成片规格、编辑器动作代理）必须有真实点击/渲染证据；`git diff --check` 两仓通过；相关后端/前端文档同步。**不以完成 C 项为验收条件**。
