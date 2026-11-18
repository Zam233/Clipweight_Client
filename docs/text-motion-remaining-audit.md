# MotionSpec 剩余事项审计（2026-11-18）

## 已验证

- 后端 `validate-spec` / `compile` / `author` / `author SSE` / `commit` 路由存在；
- 后端 17 个 MotionSpec/API 测试通过；
- 前端 keyframe/camera/path/tracks/effects 编辑；
- marker 点击/拖动、author SSE、asset pack、原子 store；
- 真实浏览器：keyframe 0.00→0.10 保存 commit、刷新保持；
- 预览 1s 显示黄色「并非回应」；
- Hyperframes 1s 抽帧同一文案；
- 证据：`docs/e2e/*.jpg`。

## 未完成 / 风险

1. `?clip=` 深链接：预览 `t` 生效，但选中仍为 `[]`；需修 EditorPage 选择时序，当前不能宣称深链接可用。
2. 完整 702s 任务级验证未跑；只做了单 clip 编辑/保存/刷新与 1s 抽帧。
3. 前端只跑了 textMotion/preview/timelineStore 定向测试（237），未跑全量 `npm test`；后端只跑 17 个定向测试，未跑全量 `pytest tests`。
4. 3D/mask/blur 仍是 Canvas 近似；`unsupportedProps/approxProps` 有记录，但没有逐原语像素阈值对照。
5. `previewFidelity` 角标仍可能显示“仅渲染后可见”，与现在预览能显示 MG 的事实不一致，需校正。
6. author 本地 JSON 只是任务账本，不是可恢复执行队列；重启中任务 fail-open。
7. 结构化 UI 仍有上限（path 前两个点、tracks 前 3 段、camera 前 6 帧、effects 只增删 glow/blur）。
8. PR #17、#20 均 open，未合并；没有 CI 结论记录。
9. 前端 `__cwStores` 调试入口仅 DEV，但需要确认生产构建不暴露。


## 2026-11-18 追加修复

- keyframe 删除按钮不再依赖 hover 才显示；
- 时间线 keyframe 支持选中 + Delete/Backspace 删除，且不会先删 clip；
- 属性面板 Ctrl+Z 在 `data-app-undo` 范围内交给应用历史；
- approx fidelity 角标改为“文字动效为近似预览”，不再说“仅渲染后可见”；
- author 任务保存 request，重启后状态 queued，首次查询/SSE 可恢复；
- path/tracks/camera/keyframe 的 UI 截断已移除；
- 最新提交仍在本地待 push（GitHub 连接失败）。
