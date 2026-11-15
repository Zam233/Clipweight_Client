# 帧艺 ClipWright 文档

## 架构设计（内容视频编排引擎）

| 文档 | 说明 |
|------|------|
| [架构总览](structure.md) | 五层架构设计：原子能力层 → Agent 编排层 → 类型插件层 → Persona 配置层 → 用户接口层 |
| [Persona 系统](Persona.md) | 四层复合数字人格体系：参数层 / 示例层 / 嵌入层 / 模型层 |
| [Agent 工作流](workflow.md) | 一个主 Agent + 阶段子 Agent：主 Agent 规划并派发结构 → 素材 → 剪辑 → 动画 → 音频 → 质检，结果回主 Agent（黑板/产物/失败回流） |
| [AI 生图 Provider 化 PRD（2026-11-14）](image-provider-plugin-prd-2026-11-14.md) | 下架 `ai_*_gen`、新增 `image_provider` 契约与「AI 生图」Provider Tab、OpenAI gpt-images 插件；区分 Engine 接口与插件能力 |

## 使用指南

| 文档 | 说明 |
|------|------|
| [快速开始](quickstart.md) | 安装、配置、启动、快速验证 |
| [API 参考](api_reference.md) | 全部 REST API 端点说明和示例 |
| [PersonaForge 使用说明](persona_forge.md) | Persona 智能构建器的四种模式和用法 |

## 开发

| 文档 | 说明 |
|------|------|
| [开发指南](development.md) | 技术栈、开发规范、设计约束 |
| [插件作者指南](plugin_authoring.md) | 新契约 `contributions()`：16 类扩展点、UI 槽位、Provider 源与迁移清单 |
| [安全部署指南](security.md) | API 令牌认证、CORS、文件白名单与生产部署清单 |

## 新增模块

| 文档 | 说明 |
|------|------|
| [素材系统](material_system.md) | 多源素材搜索与检索系统 |
| [语音与 TTS](voice_tts.md) | 声音克隆、语音合成与配音 |
| [动画系统](animation_system.md) | 动画编目、渲染管线与 MG 动画 |
| [服务概览](services_overview.md) | 全部后端服务层模块说明 |
| [需求分析 Agent](requirements_agent.md) | Requirements Agent 设计与职责 |
| [前后端缺陷与体验优化 PRD](ux-and-bug-audit-prd-2026-11-09.md) | 代码审计的问题、证据与验收口径 |
| [前后端缺陷与体验优化 Coding Plan](ux-and-bug-audit-coding-plan-2026-11-11.md) | 跨仓实施批次、依赖、回归测试与发布门槛 |
| [缺陷审计实施台账](ux-audit-implementation-log.md) | W00–W14 逐项实施证据、红→绿记录、未完成清单 |
| [Engine 插件层全功能治理 PRD](plugin-registration-runtime-optimization-prd-2026-11-13.md) | 当前功能全景、收益评估、保留与条件改造边界 |
| [Engine 插件层全功能治理 Coding Plan](plugin-registration-runtime-optimization-coding-plan-2026-11-13.md) | 有益窄修工作包、全功能回归与 42 插件验收矩阵 |
| [图片生成 Provider 化 PRD](image-provider-prd-2026-11-14.md) | 第 20 类 `image_provider` 契约、生成落工作区、主 Agent 定点插入；含 `ai_*_gen` 下架清单 |
| [整数时间基座](timebase.md) | 整数 tick + 有理数帧率：换算纪律、时间码、漂移校正与切点的接线点 |
| [素材内容理解与 NL 落位计划](content-understanding-plan-2026-09-14.md) | 内容索引（镜头级）→ 检索 → NL 意图 → 落位校验：让 Agent 知道在剪什么、用户说人话就能达到目的 |
| [内容理解基准集与指标](content-understanding-benchmark.md) | R1–R10 的基准集构成、量化指标（含门槛 vs 实测）、**每个数字的验证边界**；一键复跑 `scripts/verify_all_metrics.py` |
