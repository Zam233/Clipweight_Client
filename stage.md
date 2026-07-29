# ClipWright Optimization — Stage Log

## Stage 2: 后端测试可运行性与依赖修复
**Timestamp**: 2026-07-29T14:05:00+08:00

- Fix: `llm.py` isobase 改为惰性导入（ISOBASE_AVAILABLE 守卫），缺依赖时后端仍可启动/导入
- Fix: `test_llm.py` 增加 `pytest.importorskip("isobase")` 守卫
- Fix: pyproject.toml 补充缺失的核心依赖 `pymongo`（context.py 模块级导入但未声明）
- + pyproject.toml 新增可选 extras：openai / openai-whisper / faster-whisper（RAG 与 STT 可选功能）
- Fix: `embedder.py` base_url 三元表达式优先级歧义（加括号明确语义）
- Fix: `test_rag.py` 强制本地 sentence_transformer provider，测试不再依赖开发者 .env 的在线 API
- 基线：后端 pytest 283 passed / 1 skipped（RAG 7 项待 sentence-transformers 安装后验证）

## Stage 1: Critical Bug Fixes
**Timestamp**: 2026-07-29T13:45:00+08:00

- Fix: ESLint 9 flat config missing — `npm run lint` completely broken
- Fix: Default API/WS port mismatch (8080 → 8000) in client.ts, settingsStore.ts, WsClient.ts
- Fix: .env.example had wrong default ports (8080 → 8000)
- Fix: previewStore.setCurrentTime allows negative/out-of-bounds time
- Fix: Playback loop ignores loopRegion and isLooping settings
- Fix: historyStore.maxSize not synced with settingsStore.maxUndoHistory
