# 账号系统剥离 · 验证报告（2026-11-08）

分支：`feat/zam_remove_account_system`（`J:\Clipweight-Client` 与 `J:\Clipwright` 同名分支）

## 1. 改动规模

| 仓库 | 文件 | 变更 |
| --- | --- | --- |
| engine | 21 | +107 / -609（删除 `api/market.py`、`services/market_client.py`、`tests/clipwright/test_authz.py`） |
| 前端 | 21 | +49 / -938（删除 `account.ts`、`market.ts`、`authStore.ts`、`session.ts`、`LoginPage`、`MarketPage`） |

## 2. 单测 / 类型 / 构建

| 检查 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 通过 |
| `npm run test`（前端 vitest） | 140 文件 / **1223 通过**，5 skipped |
| `npm run build` | ✓ built in 7.17s |
| engine `py -3.14 -c "import clipwright.main"` | 通过（`/api/market` 路由数 = 0） |
| engine pytest（auth/settings/render/install 相关 9 个文件） | **72 passed** |

## 3. e2e（Playwright，chromium）

新增 `e2e/no-account-system.spec.ts`：**4/4 通过**

- 首页无「市场」「登录 / 注册」入口，无 CREADIT，且不向 `/srv` 发任何请求；
- `/login`、`/market` 已删除 → 落入 404 页；
- 预置 `cw_had_session=1` 也能直接进 `/projects` 与 `/editor/proj_e2e_demo`；
- 编辑器不再请求 `/srv` 或 `/api/market`。

既有套件（除两个真实重链路 spec）：**62 passed / 4 failed**，失败项均已在基线分支复现：

| 失败用例 | 基线复现 | 归因 |
| --- | --- | --- |
| `agent-edit.spec.ts` ×2（diff 覆盖层） | 失败 | 既有问题，与剥离无关 |
| `session-timeline.spec.ts`（K:\demo） | 失败 | 既有问题（依赖真实后端会话数据） |
| `unified-stream.spec.ts`（需求对话单流） | 失败 | 既有问题（依赖真实 SSE/会话状态） |

`editor-interactions.spec.ts › J/K/L` 首轮失败属并发抖动，单跑通过。

未纳入本次全量：

- `export-tail.spec.ts`：真实渲染 3.7 分钟后在断言处失败——成片已产出（h264 / 1080x1920 / 57.6s / 14.1MB），
  但用例断言宽度 1920，而它读取的历史项目是竖屏（1080x1920）；属测试数据问题，与剥离无关。
- `final-flow.spec.ts`：真实 LLM 生产管线，单跑预计 10 分钟以上，本次未跑完。

## 4. 结论

- engine 与前端均不再有 ClipWright Server 依赖；
- 既有功能回归无新增失败（4 个失败全部在基线复现）；
- 唯一鉴权面收敛为本地 `CLIPWRIGHT_API_TOKEN`。
