// @vitest-environment jsdom
/**
 * F4/F5 组件测试：人工改派 / 路由表编辑 / 模式开关。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import type { RoutesResponse } from '@/types/supervisor';

import { DispatchForm } from './DispatchForm';
import { RouteTableEditor } from './RouteTableEditor';
import { SupervisorModeSwitch } from './SupervisorModeSwitch';

beforeEach(() => cleanup());

describe('DispatchForm', () => {
  it('没写理由时不能提交', () => {
    render(<DispatchForm onSubmit={vi.fn()} />);
    const submit = screen.getByRole('button', { name: '提交并重做' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('提交携带目标环节与理由', () => {
    const onSubmit = vi.fn();
    render(<DispatchForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'material' } });
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '第 3 段素材明显不对' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交并重做' }));

    expect(onSubmit).toHaveBeenCalledWith({
      target_stage: 'material',
      reason: '第 3 段素材明显不对',
    });
  });

  it('重跑真起来时如实显示「已开始重做」', () => {
    render(
      <DispatchForm
        onSubmit={vi.fn()}
        result={{
          pipeline_id: 'pl_1',
          order: { id: 'ord_1', target_stage: 'material', reason: 'x', source: 'manual' },
          accepted: true,
          requires_retry: false,
          retry: { retried: true, status: 'retrying' },
        }}
      />,
    );
    expect(screen.getByText(/已开始重做/)).toBeTruthy();
  });

  it('跑不起来时把原因写出来，而不是只说「已登记」', () => {
    render(
      <DispatchForm
        onSubmit={vi.fn()}
        result={{
          pipeline_id: 'pl_1',
          order: { id: 'ord_1', target_stage: 'material', reason: 'x', source: 'manual' },
          accepted: true,
          requires_retry: true,
          retry: { retried: false, reason: '无可用前置成功结果' },
        }}
      />,
    );
    expect(screen.getByText(/没能开始重做/)).toBeTruthy();
    expect(screen.getByText(/无可用前置成功结果/)).toBeTruthy();
  });
});

const routes: RoutesResponse = {
  routes: {
    edit: [{ provider: 'anthropic', model: 'claude-x', tier: 'std' }],
  },
  whitelist: ['anthropic/claude-x'],
  allowed_providers: ['anthropic'],
};

describe('RouteTableEditor', () => {
  it('渲染已有候选与白名单', () => {
    render(<RouteTableEditor initial={routes} />);
    expect(screen.getByDisplayValue('claude-x')).toBeTruthy();
    expect(screen.getByDisplayValue('anthropic/claude-x')).toBeTruthy();
  });

  it('可添加候选并保存', () => {
    const onSave = vi.fn();
    render(<RouteTableEditor initial={routes} onSave={onSave} />);

    const addButtons = screen.getAllByRole('button', { name: '添加候选' });
    fireEvent.click(addButtons[3]); // animation 阶段（structure/material/edit 之后）
    fireEvent.click(screen.getByRole('button', { name: '保存路由表' }));

    const payload = onSave.mock.calls[0][0];
    expect(payload.routes.animation).toHaveLength(1);
    expect(payload.whitelist).toEqual(['anthropic/claude-x']);
  });

  it('可删除候选', () => {
    const onSave = vi.fn();
    render(<RouteTableEditor initial={routes} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    fireEvent.click(screen.getByRole('button', { name: '保存路由表' }));
    expect(onSave.mock.calls[0][0].routes.edit).toHaveLength(0);
  });

  it('保存后显示已保存', () => {
    render(<RouteTableEditor initial={routes} saved />);
    expect(screen.getByText('已保存')).toBeTruthy();
  });
});

describe('SupervisorModeSwitch', () => {
  it('展示三档语义并回传选择', () => {
    const onChange = vi.fn();
    render(<SupervisorModeSwitch mode="off" onChange={onChange} />);

    expect(screen.getByText(/行为与改造前完全一致/)).toBeTruthy();
    expect(screen.getByText(/只记录归因与诊断书/)).toBeTruthy();
    expect(screen.getByText(/按归因派工/)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /影子/ }));
    expect(onChange).toHaveBeenCalledWith('shadow');
  });

  it('按当前模式选中', () => {
    render(<SupervisorModeSwitch mode="shadow" onChange={vi.fn()} />);
    const shadow = screen.getByRole('radio', { name: /影子/ }) as HTMLInputElement;
    expect(shadow.checked).toBe(true);
  });
});
