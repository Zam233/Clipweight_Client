// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TypeSpecEditor } from './TypeSpecEditor';

const { api } = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
    validate: vi.fn(),
    resolve: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/services/api/typeMaker', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/typeMaker')>('@/services/api/typeMaker');
  return { ...actual, typeMakerApi: api };
});

afterEach(() => cleanup());

const definition = {
  id: 'demo',
  name: 'Demo',
  description: '',
  shot_params: {
    min_shot_sec: 1,
    max_shot_sec: 5,
    transition_type: 'cut',
    transition_duration_sec: 0.5,
    cut_on_beat: false,
  },
  persona_mapping: {},
  prompts: { genre: { text: '参数说话的评测片' } },
  param_rules: [{ key: 'min_shot_ms', mode: 'floor', value: 1200, reason: '看清参数页', enforce: 'strict' }],
  signature_traits: [{ name: 'chart_count', mode: 'require_ge', value: 1, enforce: 'strict', reason: '要有图表' }],
};

describe('TypeSpecEditor（F-01 规范编辑 / F-02 冲突预览）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue(definition);
  });

  it('渲染身份层与阶段层槽位，并回填已有文本', async () => {
    render(<TypeSpecEditor typeId="demo" onClose={vi.fn()} />);
    const genre = await screen.findByLabelText('slot-genre');
    expect((genre as HTMLTextAreaElement).value).toBe('参数说话的评测片');
    expect(screen.getByLabelText('slot-anti_patterns')).toBeTruthy();
    expect(screen.getByLabelText('slot-quality')).toBeTruthy();
  });

  it('已存在的规则与指标被渲染', async () => {
    render(<TypeSpecEditor typeId="demo" onClose={vi.fn()} />);
    await screen.findByLabelText('slot-genre');
    expect((screen.getByLabelText('rule-key-0') as HTMLInputElement).value).toBe('min_shot_ms');
    expect((screen.getByLabelText('trait-name-0') as HTMLInputElement).value).toBe('chart_count');
  });

  it('校验结果显示错误', async () => {
    api.validate.mockResolvedValue({ ok: false, errors: [{ code: 'dangling_number', message: '含数字但无规则' }], warnings: [] });
    render(<TypeSpecEditor typeId="demo" onClose={vi.fn()} />);
    await screen.findByLabelText('slot-genre');
    fireEvent.click(screen.getByText('校验'));
    await waitFor(() => expect(screen.getByText(/dangling_number/)).toBeTruthy());
  });

  it('类型变形时不提供豁免按钮', async () => {
    api.resolve.mockResolvedValue({
      params: {},
      trace: {},
      conflicts: [],
      traits: [],
      deformation: { code: 'C9', reasons: ['avg_shot_ms 不可满足'], suggested_type: null, note: '不提供豁免' },
      prompts: {},
      dropped_slots: [],
    });
    render(<TypeSpecEditor typeId="demo" onClose={vi.fn()} />);
    await screen.findByLabelText('slot-genre');
    fireEvent.click(screen.getByText('裁决预览'));
    await waitFor(() => expect(screen.getByText(/这不是参数问题/)).toBeTruthy());
    expect(screen.queryByText('豁免')).toBeNull();
  });

  it('校验不通过时不保存', async () => {
    api.validate.mockResolvedValue({ ok: false, errors: [{ code: 'genre_required', message: '缺 genre' }], warnings: [] });
    render(<TypeSpecEditor typeId="demo" onClose={vi.fn()} />);
    await screen.findByLabelText('slot-genre');
    fireEvent.click(screen.getByText('保存规范'));
    await waitFor(() => expect(screen.getByText(/存在错误，未保存/)).toBeTruthy());
    expect(api.update).not.toHaveBeenCalled();
  });

  it('校验通过后保存并关闭', async () => {
    const onClose = vi.fn();
    api.validate.mockResolvedValue({ ok: true, errors: [], warnings: [] });
    api.update.mockResolvedValue({ status: 'updated', id: 'demo' });
    render(<TypeSpecEditor typeId="demo" onClose={onClose} />);
    await screen.findByLabelText('slot-genre');
    fireEvent.click(screen.getByText('保存规范'));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith('demo', expect.objectContaining({ id: 'demo' })));
    expect(onClose).toHaveBeenCalled();
  });

  it('可以新增与删除规则', async () => {
    render(<TypeSpecEditor typeId="demo" onClose={vi.fn()} />);
    await screen.findByLabelText('slot-genre');
    fireEvent.click(screen.getByText('添加规则'));
    expect(screen.getByLabelText('rule-key-1')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('rule-remove-0'));
    expect(screen.queryByLabelText('rule-remove-1')).toBeNull();
  });
});
