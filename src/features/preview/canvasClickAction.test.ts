// @vitest-environment jsdom
/**
 * P-02/P-03（PRD §2）：画布单击/双击交互语义。
 *
 * P-02（P1）：双击编辑文字会先播放再暂停——单击即 togglePlay()，双击的两次
 *   pointerup 都触发它。
 * P-03（P2）：单击画布切换播放与选中/取消选中冲突——点空白想取消选中，结果
 *   视频开始播放。
 *
 * coding plan §1 默认口径（待产品确认，可推翻）：**画布单击只做选中/取消选中；
 * 播放走显式按钮与空格**。抽一个纯决策函数 `resolveCanvasClickAction` 便于测试。
 */
import { describe, it, expect } from 'vitest';
import { resolveCanvasClickAction } from './canvasClickAction';

describe('P-02/P-03 画布点击语义', () => {
  it('单击（无论命中什么）不再切播放——只产生选中动作', () => {
    expect(resolveCanvasClickAction({ hitsText: false, isDouble: false }).togglePlay).toBe(false);
    expect(resolveCanvasClickAction({ hitsText: true, isDouble: false }).togglePlay).toBe(false);
  });

  it('双击进入文字编辑，不触发播放', () => {
    const d = resolveCanvasClickAction({ hitsText: true, isDouble: true });
    expect(d.action).toBe('edit-text');
    expect(d.togglePlay).toBe(false);
  });

  it('双击空白处也不播放（P-02 的「先播放再暂停」不再发生）', () => {
    const d = resolveCanvasClickAction({ hitsText: false, isDouble: true });
    expect(d.action).toBe('none');
    expect(d.togglePlay).toBe(false);
  });

  it('拖拽（dragging）不算点击，无任何动作', () => {
    const d = resolveCanvasClickAction({ hitsText: false, isDouble: false, dragging: true });
    expect(d.action).toBe('none');
    expect(d.togglePlay).toBe(false);
  });

  it('单击命中文字 → 选中该片段（不进编辑）', () => {
    const d = resolveCanvasClickAction({ hitsText: true, isDouble: false });
    expect(d.action).toBe('select');
  });
});
