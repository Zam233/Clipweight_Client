// @vitest-environment jsdom
/**
 * F1–F3 组件测试：决策时间线 / 诊断书 / 成本条 / 调度抽屉。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import type { DiagnosisReport, LedgerEntry, BudgetSnapshot } from '@/types/supervisor';
import { useSupervisorStore } from '@/stores/supervisorStore';

import { DecisionTimeline } from './DecisionTimeline';
import { DiagnosisCard } from './DiagnosisCard';
import { BudgetBar } from './BudgetBar';
import { SupervisorDrawer } from './SupervisorDrawer';

const sampleLedgerEntries: LedgerEntry[] = [
  {
    id: 'le_1',
    stage: 'structure',
    attempt: 1,
    decision: 'pass',
    degradations: [],
    warnings: [],
    duration_ms: 800,
    ts: '2026-10-17T10:00:00Z',
  },
  {
    id: 'le_2',
    stage: 'material',
    attempt: 1,
    decision: 'pass',
    degradations: [
      { kind: 'material_placeholder', detail: '素材源无结果，改用占位图', scope: 'scene:3', impact: '该段为占位' },
    ],
    warnings: [],
    duration_ms: 1200,
    ts: '2026-10-17T10:00:02Z',
  },
  {
    id: 'le_3',
    stage: 'edit',
    attempt: 1,
    decision: 'fail',
    failure: {
      category: 'input_insufficient',
      blocking_point: '第 3 段没有可用镜头',
      retryable: 'needs_upstream',
      needs: [{ from_stage: 'structure', field: 'material_refs' }],
    },
    degradations: [],
    warnings: [],
    duration_ms: 900,
    ts: '2026-10-17T10:00:04Z',
  },
];

const sampleDiagnosis: DiagnosisReport = {
  conclusion: '问题主要来自「素材选材」。',
  problems: [
    { severity: 'error', title: '第 3 段没有可用镜头', stage: 'edit', location: '' },
    { severity: 'warning', title: '素材源无结果', stage: 'material', location: 'scene:3' },
  ],
  evidence: [{ text: '素材选材第 1 次尝试降级', ref: 'le_2' }],
  attempted: [{ action: '剪辑第 2 次尝试', outcome: '成功' }],
  suggestions: [
    { id: 's1', label: '接受当前版本', action: 'accept_degraded' },
    { id: 's2', label: '换一个模型再试', action: 'retry_with_model' },
  ],
  cost: { tokens: 1234, spent_usd: 0.42, budget_usd: null, subagent_tokens: 0 },
  mode: 'shadow',
  pipeline_id: 'pl_1',
};

beforeEach(() => {
  cleanup();
  useSupervisorStore.getState().reset();
});

describe('DecisionTimeline', () => {
  it('无记录时给出明确空态', () => {
    render(<DecisionTimeline entries={[]} />);
    expect(screen.getByText(/还没有记录到任何环节/)).toBeTruthy();
  });

  it('折叠正常环节，只展示决策点', () => {
    render(<DecisionTimeline entries={sampleLedgerEntries} />);
    expect(screen.getByText(/1 个环节正常完成/)).toBeTruthy();
    expect(screen.getByText('剪辑')).toBeTruthy();
    expect(screen.getAllByText('第 1 次').length).toBeGreaterThanOrEqual(1);
  });

  it('展开后能看到失败原因与降级明细', () => {
    render(<DecisionTimeline entries={sampleLedgerEntries} />);

    const editRow = screen.getByText('剪辑').closest('button')!;
    fireEvent.click(editRow);
    expect(screen.getByText(/第 3 段没有可用镜头/)).toBeTruthy();

    const materialRow = screen.getByText('素材选材').closest('button')!;
    fireEvent.click(materialRow);
    expect(screen.getByText(/占位图/)).toBeTruthy();
  });
});

describe('DiagnosisCard', () => {
  it('无诊断书时说明原因', () => {
    render(<DiagnosisCard report={null} />);
    expect(screen.getByText(/没有生成诊断书/)).toBeTruthy();
  });

  it('渲染结论/问题/建议，并回传 suggestion', () => {
    const onAction = vi.fn();
    render(<DiagnosisCard report={sampleDiagnosis} onAction={onAction} />);

    expect(screen.getByText('问题主要来自「素材选材」。')).toBeTruthy();
    expect(screen.getByText(/第 3 段没有可用镜头/)).toBeTruthy();
    expect(screen.getByText(/素材选材第 1 次尝试降级/)).toBeTruthy();
    expect(screen.getByText(/1234 tokens/)).toBeTruthy();
    expect(screen.getByText(/仅记录未执行/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '换一个模型再试' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }));
  });
});

describe('BudgetBar', () => {
  const unlimited: BudgetSnapshot = {
    spent_usd: 0.1234,
    budgetEnabled: false,
    level: 'unlimited',
  };

  it('未配置预算时只显示已花金额', () => {
    render(<BudgetBar budget={unlimited} />);
    expect(screen.getByText(/0\.1234/)).toBeTruthy();
    expect(screen.getByText(/无上限/)).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('已配置预算时显示比例与告警', () => {
    render(
      <BudgetBar
        budget={{ spent_usd: 1.6, budgetEnabled: true, budget_usd: 2, ratio: 0.8, level: 'warn' }}
      />,
    );
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText(/预算已用 70% 以上/)).toBeTruthy();
  });

  it('耗尽时提示重做已冻结', () => {
    render(
      <BudgetBar
        budget={{ spent_usd: 2.1, budgetEnabled: true, budget_usd: 2, ratio: 1.05, level: 'blocked' }}
      />,
    );
    expect(screen.getByText(/预算已耗尽/)).toBeTruthy();
  });

  it('数据未就绪时给出占位文案', () => {
    render(<BudgetBar budget={null} />);
    expect(screen.getByText(/成本数据尚未就绪/)).toBeTruthy();
  });
});

describe('SupervisorDrawer', () => {
  it('三段切换与关闭回调', () => {
    const onClose = vi.fn();
    useSupervisorStore.setState({
      ledger: sampleLedgerEntries,
      diagnosis: sampleDiagnosis,
      budget: { spent_usd: 0.5, budgetEnabled: false, level: 'unlimited' },
      decisions: [
        {
          id: 'd1',
          strategy: 'S2_model',
          target_stage: 'edit',
          reason: '同模型失败两次',
          allow_degrade: false,
          aborted: false,
          stage_attempts: { edit: 2 },
          mode: 'on',
        },
      ],
    });

    render(<SupervisorDrawer onClose={onClose} />);

    // 决策记录默认激活
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('决策记录');
    expect(screen.getByText(/换个模型再试 → 剪辑/)).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '诊断书' }));
    expect(screen.getByText('问题主要来自「素材选材」。')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: '成本' }));
    expect(screen.getByText(/0\.5000/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '关闭调度面板' }));
    expect(onClose).toHaveBeenCalled();
  });
});
