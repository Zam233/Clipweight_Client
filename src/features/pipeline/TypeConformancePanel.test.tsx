// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TypeConformancePanel } from './TypeConformancePanel';
import realTrace from './__fixtures__/trace-real-floor.json';

afterEach(() => cleanup());

function _event(detail: Record<string, unknown>, type = 'prompt_resolution') {
  return { type, agent: 'edit_agent', time: 1, detail };
}

describe('TypeConformancePanel（F-03 / V3 前端）', () => {
  it('无事件时明确说明，不显示空表', () => {
    render(<TypeConformancePanel events={[]} />);
    expect(screen.getByText(/没有类型规范裁决记录/)).toBeTruthy();
  });

  it('展示参数最终值与来源层', () => {
    render(
      <TypeConformancePanel
        events={[
          _event({
            category_id: 'digital_review',
            stage: 'edit',
            params: {
              min_shot_ms: { value: 1200, source_layer: 'L2_prompt' },
              base_shot_ms: { value: 3000, source_layer: 'L1_user', overridden_by: 'prompt' },
            },
          }),
        ]}
      />,
    );
    expect(screen.getByText('digital_review')).toBeTruthy();
    expect(screen.getByText('1200')).toBeTruthy();
    expect(screen.getByText('类型提示词')).toBeTruthy();
    expect(screen.getByText(/被 prompt 覆盖/)).toBeTruthy();
  });

  it('展示冲突', () => {
    render(
      <TypeConformancePanel
        events={[
          _event({
            conflicts: [{ code: 'C1', key: 'min_shot_ms', message: '被类型规范改回 1200', enforce: 'strict' }],
          }),
        ]}
      />,
    );
    expect(screen.getByText(/\[C1\] 被类型规范改回 1200/)).toBeTruthy();
  });

  it('展示类型变形且说明不提供豁免', () => {
    render(
      <TypeConformancePanel
        events={[
          _event({
            deformation: { code: 'C9', reasons: ['avg_shot_ms 不可满足'], note: '不提供豁免' },
          }),
        ]}
      />,
    );
    expect(screen.getByText(/类型变形（C9）/)).toBeTruthy();
    expect(screen.getByText('不提供豁免')).toBeTruthy();
  });

  it('忽略非 prompt_resolution 事件', () => {
    render(
      <TypeConformancePanel
        events={[
          _event({ category_id: 'x' }, 'system'),
          _event({ category_id: 'lyric_mv', params: {} }),
        ]}
      />,
    );
    expect(screen.getByText('lyric_mv')).toBeTruthy();
  });

  it('strict 冲突出现顶部黄条（V3 前端黄条）', () => {
    render(
      <TypeConformancePanel
        events={[
          _event({
            conflicts: [
              { code: 'C1', key: 'min_shot_ms', message: '被类型规范改回 1200', enforce: 'strict' },
              { code: 'C2', key: 'base_shot_ms', message: 'soft 保留现值', enforce: 'soft' },
            ],
          }),
        ]}
      />,
    );
    const banner = screen.getByTestId('type-conflict-banner');
    expect(banner.textContent).toContain('类型规范改写了 1 处参数');
    expect(banner.textContent).toContain('min_shot_ms');
  });

  it('只有 soft 冲突时不出黄条', () => {
    render(
      <TypeConformancePanel
        events={[
          _event({
            conflicts: [{ code: 'C2', key: 'base_shot_ms', message: 'soft 保留现值', enforce: 'soft' }],
          }),
        ]}
      />,
    );
    expect(screen.queryByTestId('type-conflict-banner')).toBeNull();
  });

  it('类型变形有独立横幅且写明无豁免', () => {
    render(
      <TypeConformancePanel
        events={[_event({ deformation: { code: 'C9', reasons: ['区间不可满足'], note: '不提供豁免' } })]}
      />,
    );
    const banner = screen.getByTestId('type-deformation-banner');
    expect(banner.textContent).toContain('不提供豁免');
  });

  it('用真机 trace 夹具渲染出黄条与 L2 来源（后端 → 前端链路）', () => {
    // 夹具来自真机 dry-run：scripts/e2e_pipeline_probe.py --scenario floor
    // 用户给 min_shot_ms=300，类型规范 strict floor 1200 把它改回来。
    render(<TypeConformancePanel events={realTrace} />);
    const banner = screen.getByTestId('type-conflict-banner');
    expect(banner.textContent).toContain('min_shot_ms');
    expect(screen.getByText(/类型提示词/)).toBeTruthy();
  });

  it('展示超预算丢弃槽位', () => {
    render(
      <TypeConformancePanel
        events={[_event({ dropped_slots: ['edit', 'audio'] })]}
      />,
    );
    expect(screen.getByText(/超预算丢弃槽位：edit, audio/)).toBeTruthy();
  });
});
