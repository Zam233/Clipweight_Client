# 动画 agent 的能力收口：判断交给模型，能力交给插件（2026-11-02）

两轮修正的合并记录。

**第一轮**（用户指出）：`_DATA_FACT_RE` 硬编码、`_fetch_url`/`_extract_image_urls`/`_raw_html`/`_take`
写在 agent 里，而且工具不可用时直连 `WebSearchService` / `WebFetchService` 当后门。
**第二轮**（用户补正）：既然 `web_search` / `web_fetch` 是插件，那 `web_media` / `web_images` /
`fact_intent` 也必须是**插件**，不能躺在 `clipwright/services` 里。最终形态：

```
plugins/web_media/
├── plugin.yaml        # api_version 2；贡献 tool:web_images、tool:fact_need
├── __init__.py
├── main.py            # WebMediaPlugin(CapabilityPlugin).contributions()
├── html_images.py     # 抓原 HTML + 抽图地址（纯函数，插件内部）
├── web_images.py      # WebImagesTool —— 能力 web_images
└── fact_need.py       # FactNeedTool —— 能力 fact_need（模型判断，一次批量）
```

原来的 `clipwright/services/web_media.py`、`clipwright/services/fact_intent.py`、
`clipwright/tool/web_images.py` **已删除**，`tool/__init__.py` 里的内置注册也撤掉了
（`web_images` 不在 72 个内置工具里，而在插件贡献里）。

---

## 一、判断权交回模型（能力 `fact_need`）

| 方面 | 旧 | 新 |
|---|---|---|
| 判据 | agent 内一条正则 `_DATA_FACT_RE` | **模型判断**（插件工具 `fact_need`） |
| 粒度 | 每场景现算 | **一次批量**（43 场仍只 1 次模型往返） |
| 可配置 | 无 | `animation_fact_judge = llm（默认）｜heuristic｜off` |
| 可替换 | 只能改源码 | 注册一个 `capability="fact_need"` 的工具即可接管 |

agent 侧只剩三步：拼 `scenes`（`id/title/description/text/keywords`）→
`call_tool("fact_need", scenes=...)` → 拿 `needed_ids` 存成 `self._fact_clip_ids`；
文本动画与 `mg_dynamic` 两条路径都用 `clip_id in self._fact_clip_ids` 判断。
旧正则只作为 `heuristic` 模式的实现，收在插件里（agent 不再持有）。

## 二、能力全部走工具层

| 旧位置（agent 里） | 现在 |
|---|---|
| `_raw_html()` | 插件内 `html_images.fetch_html()`（浏览器 UA、跟随跳转、1.5MB 上限） |
| `_extract_image_urls()` | 插件内 `html_images.extract_image_urls()`（并先剥 `<script>/<style>`） |
| 「抓页面→抽图→下载→落盘」 | 能力 `web_images`（插件工具；落盘复用平台 `web_assets.fetch_and_store`） |
| `_fetch_url()` 的 `WebFetchService` 回退 | 删除，只走能力 `web_fetch` |
| 两处事实检索的 `WebSearchService` 回退 | 删除，只走能力 `web_search` |

`_take` 保留但**只剩记账**（`_image_index` 是动画 agent 自己的选图状态，不属于能力层）。

---

## 三、逐 agent 实测（7 个 agent × 4 个能力）

测试脚本按**真实启动顺序**（先 `settings_store.apply_all(settings)`，再注册内置工具、再 `PluginLoader.load_all()`）：

```
插件 33 个（web_media: True）| 工具 103 个

== 全局能力解析
  web_search   -> web_search   tier=costly
  web_fetch    -> web_fetch    tier=costly
  web_images   -> web_images   tier=costly
  fact_need    -> fact_need    tier=costly

== 逐 agent：能力 → 解析到的工具
  requirements web_search=web_search | web_fetch=web_fetch | web_images=web_images | fact_need=fact_need
  structure    web_search=web_search | web_fetch=web_fetch | web_images=web_images | fact_need=fact_need
  material     web_search=web_search | web_fetch=web_fetch | web_images=web_images | fact_need=fact_need
  edit         web_search=web_search | web_fetch=web_fetch | web_images=web_images | fact_need=fact_need
  animation    web_search=web_search | web_fetch=web_fetch | web_images=web_images | fact_need=fact_need
  audio        web_search=web_search | web_fetch=web_fetch | web_images=web_images | fact_need=fact_need
  quality      web_search=web_search | web_fetch=web_fetch | web_images=web_images | fact_need=fact_need
```

动画 agent 的**真实调用链**（含网络）：

```
① fact_need   -> success | needed_ids=['s2'] | mode=llm
② _fetch_url  -> ok | kind=html                       （走能力 web_fetch）
③ _ingest_web_media -> 入库 3 | 索引 3
   ToolRegistry: 执行 web_search(query=mechanical keyboard switch, max_results=6)
   ToolRegistry: 执行 web_images(url=https://www.alucare.fr/...#1, max_images=3, download=True)
   web_images: 候选 3 / 落盘 3 / 跳过 0（共 399547 字节）
   materials\web\images\Which-switch-should-you-choose-*.jpg
```

运行中的服务侧（`/api/plugin/health`）：`web_media | status=ok | enabled=True | dependency_ok=True`；
`/api/plugin/contributions`：`fact_need` 与 `web_images` 的 `owner` 都是 `web_media`。

---

## 四、测试过程中发现并修掉的真问题

1. **落盘路径重复嵌套**：`fetch_and_store(root=…)` 内部已经拼 `materials/web/<kind>/`
   （`web_assets._materials_root()`），而插件又传了 `<root>/materials/web` →
   落成 `materials/web/materials/web/images/…`。改为传**工作区根**后正确。
2. **`web_search` 能力解析为 None 的假象**：一次测试脚本没先 `settings_store.apply_all()`
   → `enable_web_search` 仍是默认 `False` → `provider_chain()` 空 → `resolve("web_search")` None。
   补齐启动顺序后正常。**结论**：任何"在启动早期解析能力"的代码路径都会看到不同的世界，
   新增启动钩子时必须排在 `apply_all` 之后（`main.py` 已经是这个顺序）。

---

## 五、遗留

1. `capabilities.resolve()` 与「按工具名兼容调用」两套口径仍在：`is_configured()` 为假时能力解析不到，
   但 `call_tool` 仍会按名字执行成功。建议统一为"能力解析是唯一入口"，否则配置与行为会继续错位。
2. `web_images` 默认走 `fetch_and_store` 的 robots 检查；对图库 API 直链是否 `skip_robots=True`
   属于策略决定，需要显式配置。
3. 插件内 `fact_need` 复用 `LLMService().ask(use_flash=True)`：若某天 flash 模型不可用，
   会退回启发式（有日志），但这条降级链没有单测覆盖。
