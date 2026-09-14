/**
 * 历史条目的可读名称（O3）。
 *
 * 历史压栈时用的是动作键（`pushState(tl, 'nudge')`，约 40 个调用点，键名是内部约定）。
 * 面板与工具栏要显示的是人话，所以在展示层做一层映射——**不去改调用点的键名**，
 * 免得动到 40 处已稳定的代码；未登记的键原样回退（并保留前缀规则处理动态标签）。
 */

/** 动作键 → 显示名 */
export const HISTORY_LABELS: Record<string, string> = {
  edit: '编辑',
  property: '调整属性',
  move: '移动片段',
  trim: '裁剪',
  split: '分割',
  delete: '删除',
  'ripple-delete': '波纹删除',
  cut: '剪切',
  paste: '粘贴',
  'paste-attrs': '粘贴属性',
  duplicate: '复制片段',
  nudge: '微移一帧',
  slip: '滑移素材',
  slide: '滑动片段',
  group: '编组',
  ungroup: '解组',
  gain: '调整音量',
  drop: '拖入素材',
  'add-track': '新增轨道',
  'remove-track': '删除轨道',
  'add-asset': '添加素材',
  'ai-match': 'AI 匹配素材',
  'add-dub': '添加配音',
  'import srt': '导入字幕',
  'import-json': '导入时间线 JSON',
  import: '导入',
  transcribe: '语音转写',
  'proxy-switch': '切换代理',
  'add-keyframe': '添加关键帧',
  'edit-text': '编辑文字',
  'accept-agent': '采纳 Agent 时间线',
  'merge-agent': '合并 Agent 时间线',
};

/** 前缀规则（动态标签，如 `import edl` / `import fcpxml`） */
const PREFIX_LABELS: [string, string][] = [
  ['import ', '导入'],
];

/**
 * 动作键 → 显示名。
 *
 * 未登记时回退到原键（宁可显示 `foo-bar` 也不要显示空白），
 * 动态标签按前缀规则拼装（`import edl` → `导入 edl`）。
 */
export function historyLabel(raw: string | undefined | null): string {
  const key = (raw ?? '').trim();
  if (!key) return '编辑';
  const direct = HISTORY_LABELS[key];
  if (direct) return direct;
  for (const [prefix, name] of PREFIX_LABELS) {
    if (key.startsWith(prefix)) {
      const rest = key.slice(prefix.length).trim();
      return rest ? `${name} ${rest}` : name;
    }
  }
  return key;
}

/** 动作键 → lucide 图标名（面板用；未登记用通用图标） */
export function historyIconKey(raw: string | undefined | null): string {
  const key = (raw ?? '').trim();
  if (key.startsWith('import')) return 'import';
  if (key === 'delete' || key === 'ripple-delete') return 'trash';
  if (key === 'split' || key === 'cut') return 'scissors';
  if (key === 'trim' || key === 'slip' || key === 'slide') return 'trim';
  if (key === 'move' || key === 'nudge' || key === 'drop') return 'move';
  if (key === 'group' || key === 'ungroup') return 'group';
  if (key === 'gain') return 'volume';
  if (key === 'property' || key === 'edit-text' || key === 'paste-attrs') return 'sliders';
  if (key === 'add-keyframe') return 'keyframe';
  if (key === 'accept-agent' || key === 'merge-agent') return 'agent';
  return 'edit';
}

/** 相对时间（面板显示；`<1 分钟` 用「刚刚 / N 秒前」） */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  const sec = Math.floor(delta / 1000);
  if (sec < 5) return '刚刚';
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.floor(hour / 24)} 天前`;
}
