import {
  Activity, Captions, Clapperboard, Cpu, Film, GraduationCap, LayoutTemplate,
  Layers, Puzzle, Shapes, SlidersHorizontal, Sparkles, Type, Webhook, Wrench,
} from 'lucide-react';

export interface ConsoleNavItem {
  to: string;
  label: string;
  icon: typeof Activity;
  code: string;
  /** 一句话说明（设置页的入口卡片用；控制台左栏不显示） */
  desc: string;
}

/**
 * 系统控制台的导航顺序 —— **单一事实来源**。
 *
 * 为什么必须共享：控制台左栏（`ConsoleShell`）与设置页的入口列表此前各写一份顺序，
 * 实测两边不一致（设置页是 后端配置→模型测试→学习训练→素材预处理→视频编辑器→字幕，
 * 左栏是 模型提供商→模型测试→后端配置→工具→插件→类型→模板→学习→视频→预处理→字幕…），
 * 用户在设置页看到的入口顺序与点进去后的左栏顺序对不上，找不到东西。
 *
 * 插件贡献的页面（`nav.settings` 契约）由 `ConsoleShell` 追加在本列表**之后**——
 * 内核功能固定在前、插件追加在后，顺序稳定且可预期。
 */
export const CONSOLE_NAV: readonly ConsoleNavItem[] = [
  { to: '/settings/providers', label: '模型提供商', icon: Layers, code: 'PROV', desc: '多源模型配置 · API Key · 角色绑定' },
  { to: '/settings/models', label: '模型测试', icon: Cpu, code: 'LLM', desc: '连通性 · 可用模型 · 提示词试跑' },
  { to: '/settings/backend-config', label: '后端配置', icon: SlidersHorizontal, code: 'CONF', desc: '模型密钥 · 渲染 · RAG · TTS · 搜索 · 限流（替代手改 .env）' },
  { to: '/settings/tools', label: '工具与技能', icon: Wrench, code: 'TOOL', desc: '全部原子工具 · 组合技能 · 可用性' },
  { to: '/settings/plugins', label: '插件管理', icon: Puzzle, code: 'PLUG', desc: '启停 · 配置 · UI 预览 · 错误通道 · 健康与贡献' },
  { to: '/settings/types', label: '类型总览', icon: Shapes, code: 'TYPE', desc: '全部视频类型（内置 + 自定义）' },
  { to: '/settings/type-maker', label: '类型制作器', icon: Shapes, code: 'MAKE', desc: '新建 · 编辑 · 复制 · 删除 · 预览类型' },
  { to: '/settings/templates', label: '模板管理', icon: LayoutTemplate, code: 'TMPL', desc: '项目模板 · 批量套用' },
  { to: '/settings/learning', label: '学习训练', icon: GraduationCap, code: 'LRN', desc: '数据集 · 任务 · 模型 · 后端状态' },
  { to: '/settings/video-editor', label: '视频编辑器', icon: Film, code: 'VEDT', desc: '项目/会话 · undo/redo · clips 增删移分 · 导出 · proxy · 波形' },
  { to: '/settings/preprocess', label: '素材预处理', icon: Clapperboard, code: 'PREP', desc: '元数据提取 · 场景检测 · 缩略图 · 音频/BPM · 转写' },
  { to: '/settings/subtitle-tools', label: '字幕与转写', icon: Captions, code: 'SUB', desc: '音频转写 · 文案对齐 · SRT 导入导出 · STT 端点' },
  { to: '/settings/webhooks', label: 'Webhook', icon: Webhook, code: 'HOOK', desc: '事件订阅 · 签名密钥 · 投递记录' },
  { to: '/settings/fonts', label: '字体配置', icon: Type, code: 'FONT', desc: '可用字体 · 默认字体 · 缓存' },
  { to: '/settings/mg-preview', label: 'MG 预览', icon: Sparkles, code: 'MG', desc: 'MG 动画定义与渲染预览' },
  { to: '/pipeline-admin', label: '管线监控', icon: Activity, code: 'PIPE', desc: '运行记录 · Agent 轨迹 · SSE 实时' },
];
