# 帧艺 ClipWright — Web 视频编辑器（前端）

> **Phase 5** · 全功能时间轴编辑器 · React 19 + TypeScript + Canvas 2D
>
> 这是 [帧艺 ClipWright](../Clipweight) AI 辅助视频创作系统的**前端子系统**。后端编排引擎位于 `D:\Clipweight`。

---

## 项目定位

ClipWright 前端是一个**独立完整的 Web 视频编辑器**，基础能力对标 Premiere Pro——多轨时间轴、素材拖拽、动画参数面板、关键帧编辑。在此基础上，AI Agent 作为「副驾驶」嵌入编辑器：

> **核心产品逻辑**：Agent 生成初稿 → 人在时间轴上审阅 → 局部不满意让 Agent 重做 → 满意后导出。

它不是「一键生成视频然后只能接受或放弃」，而是**人在回路（Human-in-the-loop）的循环迭代创作环境**。

---

## 技术栈

| 层 | 选型 |
|----|------|
| 框架 | React 19 + TypeScript 5.5 |
| 构建 | Vite 6 |
| 状态 | Zustand 5（9 个 store） |
| 路由 | TanStack Router |
| 数据 | TanStack Query + Axios |
| UI | Radix UI + 自建 shadcn 风格组件 + Tailwind CSS 4 |
| 时间轴 | **自研 Canvas 2D 引擎**（帧级精度） |
| 预览 | Canvas 合成 + 关键帧插值 |
| 实时 | SSE（管线追踪 / 渲染进度）+ WebSocket |

---

## 设计系统

**Material You（动态色彩科学）× Premiere Pro（暗色高密度工作界面）**。

- 源色 `#4F6BED`（ClipWright Blue），衍生 Tonal Palette
- 全暗色主题（`#0E101A` 基底），亮色主题仅用于文档/设置页
- 轨道语义色：视频 `#4F8CFF` / 音频 `#34D399` / 文字 `#FBBF24` / 图片 `#A855F7` / 动画 `#FF6B6B`
- 字体：Inter + Noto Sans SC（UI）· JetBrains Mono（时间码/刻度）
- 完整设计令牌见 `src/styles/globals.css`，规范见 `ClipWright-Design-Specification.md`

---

## 目录结构

```
src/
├── main.tsx / App.tsx / providers.tsx / router.tsx   # 入口与路由
├── pages/            # HomePage(项目工作台) · EditorPage · SettingsPage
├── layouts/          # EditorLayout(四面板) · StandardLayout
├── features/
│   ├── timeline/     # ★ Canvas 2D 时间轴引擎 + 面板
│   │   ├── engine/   #   TimelineEngine · renderers · snap · types
│   │   └── components/  # TimelinePanel · EditorToolbar
│   ├── preview/      # Canvas 合成预览 + 播放循环
│   ├── assets/       # 素材面板（AI匹配/素材库/历史）
│   ├── properties/   # 属性面板（关键帧/转场/文字）
│   └── agent/        # ★ Agent 副驾驶（需求工作流 + 管线）
├── stores/           # timeline · selection · agent · asset · preview
│                     # workspace · settings · project · history(Undo/Redo)
├── services/         # api/(Axios 各端点) · ws/(WebSocket)
├── types/            # 与后端 Schema 对齐的 TS 类型
├── components/ui/    # Button · Panel · Tooltip · Badge · Slider
└── styles/globals.css # 设计令牌 + 主题
```

---

## 核心能力

### 多轨时间轴（Canvas 2D 引擎）
- 无限轨道（视频/音频/文字/图片/字幕/动画），帧级精度
- 自适应密度时间刻度尺、播放头（拖拽刷洗）、标记点（`M`）
- 片段：选择 / Shift 多选 / 框选、拖拽移动（含跨轨）、边缘裁剪、剃刀分割（`S`）
- **吸附系统**：片段边缘 / 播放头 / 标记点 / 零点对齐，青色辅助线反馈
- `Ctrl+滚轮` 以光标为中心缩放、中键平移、Shift+滚轮横向滚动
- 视频胶片孔 / 音频波形 / 文字占位 / 关键帧菱形点可视化

### 实时预览
- Canvas 按播放头实时合成可见片段，关键帧插值（透明度/缩放）
- 播放循环、逐帧步进、安全框、静音、全屏

### Agent 副驾驶
- **需求 Agent 两阶段工作流**：创意简报 → 制作规划书（带 TOC）→ 一键生产
- **六 Agent 管线**：结构→素材→剪辑→动画→音效→质检，SSE 实时追踪
- 初稿时间线预览 + 一键接受载入时间轴
- 离线演示模式：后端未连接时以演示数据运行

### 前后端互操作
- 时间线 JSON 与后端 `clipwright/schema/timeline.py` 完全对齐
- API 客户端覆盖 pipeline / requirements / persona / asset / render 等端点

---

## 快速开始

```bash
# 安装依赖（若 C 盘空间不足，重定向缓存到 D 盘）
npm install --cache "D:\.npm-cache"

# 启动开发服务器
npm run dev            # http://localhost:5173

# 类型检查 + 生产构建
npx tsc --noEmit
npm run build
```

> 后端引擎（`D:\Clipweight`）启动于 `http://localhost:8000` 时，前端会自动连接并启用完整 Agent / 素材 / 渲染能力；未连接时以**演示模式**运行。

### 环境变量
复制 `.env.example` 为 `.env`：
```
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws
```

---

## 快捷键

| 键 | 功能 | | 键 | 功能 |
|----|------|-|----|------|
| `空格` | 播放/暂停 | | `S` | 分割片段 |
| `←` / `→` | 逐帧步进 | | `Del` | 删除选中 |
| `M` | 添加标记 | | `Ctrl+滚轮` | 缩放时间轴 |
| `V` / `B` | 选择/剃刀工具 | | `+` / `-` | 缩放 |

---

## 实施状态

- ✅ Phase 1 脚手架（Vite/TS/Tailwind/令牌/类型/Stores/API/路由/布局）
- ✅ Phase 2 核心时间轴（Canvas 引擎/刻度尺/片段/播放头/缩放/选择/移动/裁剪/吸附/标记）
- ✅ Phase 3 预览与素材（Canvas 合成/播放控制/素材面板/拖入时间轴）
- ✅ Phase 4 属性面板 + Agent 副驾驶（需求工作流/管线/SSE）
- 🔄 Phase 5 Persona 管理 / 导出渲染队列 / WebCodecs 真实解码（后续）

---

## 参考文档

- `ClipWright-Design-Specification.md` — 前端设计规范（色彩/字体/间距/动效/组件）
- `ClipWright-Frontend-Design-Plan.md` — 前端架构与分阶段实施计划
- `D:\Clipweight\docs\api_reference.md` — 后端 API 参考
- `D:\Clipweight\design.md` — 系统总体设计
