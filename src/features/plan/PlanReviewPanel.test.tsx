// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PlanReviewPanel, type PlanView, type BriefView } from './PlanReviewPanel';

afterEach(() => cleanup());

const plan: PlanView = {
  type: 'lyric_mv',
  target_duration_sec: 6,
  sections: [
    { id: 'A', name: '套印', t0: 0, t1: 2.5, purpose: '建立舞台', screen_kinds: ['plate'] },
    { id: 'B', name: '腐坏', t0: 2.5, t1: 6, purpose: '错版切入', screen_kinds: ['plate'] },
  ],
  beats: { bpm: 130, beat_zero_sec: 0.344, policy: '切点落拍' },
  material_strategy: { gaps: ['手部特写 x2'] },
};

const brief: BriefView = {
  title: '版画镜头',
  overview: '三墨套印',
  target_audience: '内部验收',
  core_message: '界面是舞台',
  key_elements: ['纸底', '三墨'],
  special_requirements: ['闪光违规为 0'],
};

describe('PlanReviewPanel（F-06）', () => {
  it('双栏展示简报与规划', () => {
    render(<PlanReviewPanel plan={plan} brief={brief} />);
    expect(screen.getByText('创意简报')).toBeTruthy();
    expect(screen.getByText('整体规划')).toBeTruthy();
    expect(screen.getByText('界面是舞台')).toBeTruthy();
    expect(screen.getByText('建立舞台')).toBeTruthy();
  });

  it('显示时长与素材缺口', () => {
    render(<PlanReviewPanel plan={plan} brief={brief} />);
    expect(screen.getByText(/6\.0s \/ 目标 6\.0s/)).toBeTruthy();
    expect(screen.getByText('手部特写 x2')).toBeTruthy();
  });

  it('legacy 规划必须显式标注', () => {
    render(<PlanReviewPanel plan={{ ...plan, legacy: true }} brief={brief} />);
    expect(screen.getByText(/legacy 规划/)).toBeTruthy();
  });

  it('自定义维度缺理由时禁止确认', () => {
    const onConfirm = vi.fn();
    render(
      <PlanReviewPanel
        plan={{ ...plan, custom_sections: [{ name: '母题', reason: '' }] }}
        brief={brief}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText('确认并开始制作'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/自定义维度缺少理由/)).toBeTruthy();
  });

  it('自定义维度有理由时可确认并回传编辑后的 plan', () => {
    const onConfirm = vi.fn();
    render(
      <PlanReviewPanel
        plan={{ ...plan, custom_sections: [{ name: '母题', reason: '复用副歌版画' }] }}
        brief={brief}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.change(screen.getByLabelText('purpose-0'), { target: { value: '新目的' } });
    fireEvent.click(screen.getByText('确认并开始制作'));
    expect(onConfirm).toHaveBeenCalled();
    expect(onConfirm.mock.calls[0][0].sections[0].purpose).toBe('新目的');
  });

  it('时长偏差 >25% 拒绝确认', () => {
    const onConfirm = vi.fn();
    render(
      <PlanReviewPanel
        plan={{ ...plan, target_duration_sec: 12 }}
        brief={brief}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText('确认并开始制作'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/超过 25% 不允许确认/)).toBeTruthy();
  });

  it('只读模式禁用确认', () => {
    render(<PlanReviewPanel plan={plan} brief={brief} readOnly />);
    const button = screen.getByText('只读') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('卡点信息可见', () => {
    render(<PlanReviewPanel plan={plan} brief={brief} />);
    expect(screen.getByText(/BPM 130/)).toBeTruthy();
  });
});
