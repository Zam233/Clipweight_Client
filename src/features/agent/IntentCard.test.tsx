// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { IntentCard, type IntentPreview } from './IntentCard';

/**
 * R6：意图确认卡。
 *
 * 这张卡的存在意义是"执行前让人看清要改什么"，所以测试断言的重点是**门禁语义**：
 * 有未答问题 / 有硬错误时，确认按钮必须是禁用的——绝不能在信息不全时让人按下确认。
 */

const base: IntentPreview = {
  intent: '目标：去掉黑场，剪到 60 秒\n- 删除匹配的片段：满足条件 is_black=True\n约束：总时长 60s',
  preview: ['remove → c0、c2 等 2 个片段'],
  affected_clip_ids: ['c0', 'c2'],
  questions: [],
  problems: [],
};

describe('IntentCard', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('渲染意图摘要、将改动清单与影响片段数', () => {
    render(<IntentCard data={base} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId('intent-card')).toBeTruthy();
    expect(screen.getByTestId('intent-summary').textContent).toContain('剪到 60 秒');
    expect(screen.getByTestId('intent-preview').textContent).toContain('remove → c0、c2');
    expect(screen.getByTestId('intent-affected').textContent).toContain('2 个片段');
  });

  it('无问题时可直接确认', () => {
    const onConfirm = vi.fn();
    render(<IntentCard data={base} onConfirm={onConfirm} onCancel={vi.fn()} />);
    const btn = screen.getByTestId('intent-confirm') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledWith({});
  });

  it('有未答问题时禁用确认，并提示还差几个', () => {
    const onConfirm = vi.fn();
    render(<IntentCard
      data={{
        ...base,
        questions: [
          { code: 'no_match', text: '「remove」没有找到匹配的片段', options: [
            { value: 'c0', label: '镜头0 @ 0.0s' },
            { value: 'c1', label: '镜头1 @ 3.0s' },
          ] },
        ],
      }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />);
    const btn = screen.getByTestId('intent-confirm') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId('intent-hint').textContent).toContain('1 个问题');
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('回答完问题后确认按钮解禁，且把答案回传', () => {
    const onConfirm = vi.fn();
    render(<IntentCard
      data={{
        ...base,
        questions: [
          { code: 'too_many', text: '匹配到 30 个片段，太多了', options: [
            { value: 'first10', label: '只处理前 10 个' },
            { value: 'all', label: '就按全部处理' },
          ] },
        ],
      }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />);
    fireEvent.click(screen.getByTestId('intent-option-too_many-all'));
    const btn = screen.getByTestId('intent-confirm') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledWith({ too_many: 'all' });
  });

  it('blocked=true 时禁用确认并展示不能执行的操作', () => {
    render(<IntentCard
      data={{
        ...base,
        blocked: true,
        problems: [],
        hardProblems: [{ level: 'error', where: 'ops[0].op', message: "不支持的操作 'explode'" }],
      }}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />);
    expect(screen.getByTestId('intent-blocked').textContent).toContain('不支持的操作');
    expect((screen.getByTestId('intent-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('校验 error 也会拦住确认（不只靠 blocked 字段）', () => {
    render(<IntentCard
      data={{ ...base, hardProblems: [{ level: 'error', where: 'x', message: '字段不可修改' }] }}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />);
    expect((screen.getByTestId('intent-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('warning 只提示、不拦确认', () => {
    const onConfirm = vi.fn();
    render(<IntentCard
      data={{ ...base, hardProblems: [{ level: 'warning', where: 'x', message: '值已钳制：99 → 4' }] }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />);
    expect(screen.getByTestId('intent-warnings').textContent).toContain('值已钳制');
    expect((screen.getByTestId('intent-confirm') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('intent-confirm'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('取消按钮回传 onCancel', () => {
    const onCancel = vi.fn();
    render(<IntentCard data={base} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByTestId('intent-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('没有 onConfirm 时（纯展示）确认不可用', () => {
    render(<IntentCard data={base} onCancel={vi.fn()} />);
    expect((screen.getByTestId('intent-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('空意图也能渲染（不崩）', () => {
    render(<IntentCard
      data={{ intent: '', preview: [], affected_clip_ids: [], questions: [], problems: [] }}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />);
    expect(screen.getByTestId('intent-summary').textContent).toContain('未解析出任何操作');
  });
});
