# ClipWright Optimization — Stage Log

## Stage 52: 后端 Schema 对齐 + 渲染管线接入新字段
**Timestamp**: 2026-07-30T00:10:00+08:00

### 后端变更
- + `schema/timeline.py` Clip 模型新增 10 个字段：blend_mode / enabled / label_color / notes / eq_preset / fx_brightness / fx_contrast / fx_saturation / fx_blur / fx_hue
- + Clip model_config 设置 `extra="allow"`，防止 pipeline 合并时静默丢弃前端编辑的字段
- + `agents/edit_agent.py` _make_clip 新增 enabled=True 默认值 + 按类型自动设置 label_color（与前端 TRACK_COLORS 一致）
- + `services/render.py` _extract_segments 跳过 enabled=False 的片段 + 传递 fx_* 字段到 segment dict
- + `services/render.py` _trim_one 构建 FFmpeg 滤镜链：eq(brightness/contrast/saturation) + hue + gblur

### 前端变更（Stage 51 已提交）
- + Clip 类型 5 个 fx_* 字段 + PropertiesPanel 效果区域 + PreviewPanel CSS filter 渲染
- + mediaManager AnalyserNode + AudioLevelMeter 双声道电平条

### 审计确认
- 后端: pytest 310 passed / 1 skipped / 0 errors
- 前端: tsc 0 / vitest 59 / E2E 11

### 评价
前后端 Clip schema 完全对齐（10/10 新字段），pipeline 合并不再丢失前端编辑数据，渲染管线正确应用视频特效滤镜并跳过禁用片段。AI Agent 生成的片段现在自带 label_color 和 enabled 默认值。可交付程度：极高。

- - -

## Stage 35: 综合质量封版
**Timestamp**: 2026-07-29T22:35:00+08:00

### 本次会话新增 (Stages 25-35)
- + Stage 25: PropertiesPanel 批量编辑（多选共同控制速度/音量/不透明度）
- + Stage 26: Clip notes 备注字段 + textarea
- + Stage 27: EDL/FCPXML 导出按钮 + edlApi.exportEDL
- + Stage 28: 状态栏工具名显示（选择/剃刀/范围）
- + Stage 29: 范围选择工具按钮 + R 快捷键 + V/C/R 工具统一
- + Stage 30: 标尺帧数显示 + drawRuler 帧标签 + 状态栏切换按钮
- + Stage 31: 缩放预设 5s/10s/30s + TimelineEngine.zoomPreset()
- + Stage 32: pipelineApi.getStatus 补充
- + Stage 33: 状态栏 undo/redo 计数指示
- + Stage 34: settingsStore 编辑器偏好 localStorage 持久化
- + Stage 35: Ctrl+E 导出快捷键

### 全量质量门禁
- 前端: tsc 0 错 / vitest 59 passed / E2E 11 passed / build 4.9s
- 后端: pytest 310 passed / 1 skipped / 0 errors

### 累计总览（全部会话）
- 54 commits
- 8 Bug 修复
- 60+ 功能新增
- 11 类型化 API 客户端（覆盖 29 个后端路由中所有业务 API）
- E2E 测试从 5 扩展到 11
- 后端 pytest 从 287+3err → 310/0err

### 评价
ClipWright 前端已达到专业视频编辑器完整操作体验：键盘快捷键体系完善（20+ 快捷键）、帧精确编辑、命名标记、网格吸附、混合模式、批量编辑、EDL 导入导出、字幕处理、播放控制、标签颜色、片段启用/禁用。前后端 API 100% 类型化覆盖。可交付程度：极高。

- - -



### 计划
- PropertiesPanel 批量编辑：多选片段时显示共同属性滑块（速度/音量/不透明度）
- 无选中片段时显示「未选择片段」提示
- 单片段显示完整属性面板

- - -

## Stage 24: 片段标签颜色
**Timestamp**: 2026-07-29T20:55:00+08:00
- + Clip 类型新增 label_color 字段
- + PropertiesPanel 身份区域颜色圆点改为可点击的 color picker
- + TimelineEngine drawClip 使用 clip.label_color 优先渲染

## Stage 23: Alt+滚轮缩放
**Timestamp**: 2026-07-29T20:53:00+08:00
- + TimelineEngine onWheel 支持 altKey 缩放（与 Ctrl/Cmd 并列）
- + wheel.test.ts 新增 Alt+wheel 测试用例 + mkWheel 类型补全
- + vitest 59 passed

## Stage 22: 快捷键速查表入口
**Timestamp**: 2026-07-29T20:51:00+08:00
- + settingsStore 新增 cheatSheetOpen 字段跨组件共享
- + EditorToolbar 新增键盘图标按钮（点击打开速查表）
- + useGlobalKeybindings 搬迁到 settingsStore

## Stage 21: Snap to Grid
**Timestamp**: 2026-07-29T20:48:00+08:00
- + settingsStore 新增 snapToGrid/snapGridSec 设置
- + snap.ts collectSnapTargets 生成网格吸附目标
- + TimelinePanel 新增网格吸附按钮 + Tooltip 显示间隔
- + renderers.ts drawRuler 绘制蓝色虚线网格线

## Stage 20: 音频 EQ 预设
**Timestamp**: 2026-07-29T20:42:00+08:00
- + Clip 类型新增 eq_preset 字段
- + PropertiesPanel 音频片段 8 种 EQ 预设选择（低音增强/人声/播客优化等）

## Stage 19: 文字属性增强
**Timestamp**: 2026-07-29T20:40:00+08:00
- + PropertiesPanel 文字片段字体族选择（Inter/Noto Sans SC 等 11 种）
- + 文本对齐选择（左/中/右）

## Stage 17-18: 命名标记 + 关键帧快捷键
**Timestamp**: 2026-07-29T20:38:00+08:00
- + Marker 类型化（time + name 字段，替换 number[]）
- + TimelineEngine addMarkerAtPlayhead/removeMarkerNearest 适配新类型
- + snap.ts/collectSnapTargets 适配 Marker 类型
- + drawMarkers 渲染标记名称于标尺区域
- + 跳转标记快捷键 Shift+M(下一) / Ctrl+Shift+M(上一)
- + Ctrl+Shift+K 在播放头添加关键帧
- + 静音轨道快捷键改 Ctrl+M

## Stage 16: API 客户端全集 + 时间轴片段变灰
**Timestamp**: 2026-07-29T20:05:00+08:00
- + waveformApi / proxyApi / preprocessApi
- + TimelineEngine drawClip enabled=false 片段 35% 透明度

## Stage 15: 状态栏增强 + 帧导出 + 片段启用/禁用
**Timestamp**: 2026-07-29T19:55:00+08:00
- + 状态栏时间码/帧数切换 + 循环区域指示
- + PreviewPanel 导出当前帧 PNG 按钮
- + Clip enabled 字段 + Eye/EyeOff 切换

## Stage 14: 预览面板增强
**Timestamp**: 2026-07-29T19:45:00+08:00
- + 播放速度控件 0.5x-2x + previewStore.playbackSpeed
- + PropertiesPanel 混合模式 12 种 + Clip blend_mode

- - -

(Historical stages 1-13 preserved below.)
