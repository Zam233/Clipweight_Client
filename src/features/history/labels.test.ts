import { describe, it, expect } from 'vitest';
import { HISTORY_LABELS, historyIconKey, historyLabel, relativeTime } from './labels';

describe('historyLabels', () => {
  it('已登记的动作键给出中文名', () => {
    expect(historyLabel('move')).toBe('移动片段');
    expect(historyLabel('trim')).toBe('裁剪');
    expect(historyLabel('ripple-delete')).toBe('波纹删除');
    expect(historyLabel('nudge')).toBe('微移一帧');
    expect(historyLabel('property')).toBe('调整属性');
    expect(historyLabel('accept-agent')).toBe('采纳 Agent 时间线');
  });

  it('动态标签按前缀规则拼装（import edl / import fcpxml）', () => {
    expect(historyLabel('import edl')).toBe('导入 edl');
    expect(historyLabel('import fcpxml')).toBe('导入 fcpxml');
    expect(historyLabel('import')).toBe('导入');
  });

  it('空值与未登记键回退（不显示空白）', () => {
    expect(historyLabel('')).toBe('编辑');
    expect(historyLabel(undefined)).toBe('编辑');
    expect(historyLabel(null)).toBe('编辑');
    expect(historyLabel('some-unknown-action')).toBe('some-unknown-action');
  });

  it('覆盖代码里实际出现过的全部动作键', () => {
    const usedKeys = [
      'edit', 'property', 'move', 'trim', 'split', 'delete', 'ripple-delete', 'cut', 'paste',
      'paste-attrs', 'duplicate', 'nudge', 'slip', 'slide', 'group', 'ungroup', 'gain', 'drop',
      'add-track', 'remove-track', 'add-asset', 'ai-match', 'add-dub', 'import srt',
      'import-json', 'transcribe', 'proxy-switch', 'add-keyframe', 'edit-text',
      'accept-agent', 'merge-agent',
    ];
    const missing = usedKeys.filter((k) => !(k in HISTORY_LABELS));
    expect(missing).toEqual([]);
  });

  it('图标键分组合理', () => {
    expect(historyIconKey('delete')).toBe('trash');
    expect(historyIconKey('split')).toBe('scissors');
    expect(historyIconKey('nudge')).toBe('move');
    expect(historyIconKey('import srt')).toBe('import');
    expect(historyIconKey('unknown-key')).toBe('edit');
  });
});

describe('relativeTime', () => {
  const now = 1_700_000_000_000;
  it('分档', () => {
    expect(relativeTime(now - 1_000, now)).toBe('刚刚');
    expect(relativeTime(now - 30_000, now)).toBe('30 秒前');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 小时前');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 天前');
  });

  it('时钟回拨不产生负数', () => {
    expect(relativeTime(now + 10_000, now)).toBe('刚刚');
  });
});
