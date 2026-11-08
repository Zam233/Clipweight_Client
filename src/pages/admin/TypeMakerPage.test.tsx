// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TypeMakerPage } from './TypeMakerPage';

const { mocks } = vi.hoisted(() => ({
  mocks: { list: vi.fn(), get: vi.fn(), remove: vi.fn(), preview: vi.fn(), genreCheck: vi.fn() },
}));

vi.mock('@/services/api', () => ({
  typeMakerApi: {
    list: mocks.list,
    get: mocks.get,
    remove: mocks.remove,
    preview: mocks.preview,
    genreCheck: mocks.genreCheck,
    create: vi.fn(),
    update: vi.fn(),
  },
  healthApi: { check: vi.fn(async () => ({ status: 'ok' })) },
}));

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/settings/type-maker' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

afterEach(() => cleanup());

const customType = {
  id: 'custom_t1',
  name: '自定义类型',
  shot_duration: '5-15s',
  transition: 'cut',
  animation_density: 'medium',
  cut_interval_ms: 8000,
  color: '#4F8CFF',
  builtin: false,
};

const builtinType = {
  id: 'builtin_doc',
  name: '纪录片',
  shot_duration: '8-20s',
  transition: 'cut',
  animation_density: 'low',
  cut_interval_ms: 12000,
  color: '#34D399',
  builtin: true,
};

describe('TypeMakerPage P10 预览 + 删除确认', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([customType, builtinType]);
    mocks.get.mockResolvedValue({ id: 'custom_t1', name: '自定义类型', shot_params: { min_shot_sec: 2, max_shot_sec: 8, transition_type: 'cut', transition_duration_sec: 0.5, cut_on_beat: false } });
    mocks.preview.mockResolvedValue({
      valid: true,
      errors: [],
      shot_params: { min_shot_sec: 2, max_shot_sec: 8, transition_type: 'cut', transition_duration_sec: 0.5, cut_on_beat: false },
      sample_translation: { beat: 1, shot: 2 },
    });
    mocks.remove.mockResolvedValue(undefined);
  });

  it('预览按钮调用 typeMakerApi.preview 并显示校验结果', async () => {
    render(<TypeMakerPage />);
    const previewBtn = await screen.findAllByTitle('预览');
    fireEvent.click(previewBtn[0]);

    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/定义有效/)).toBeTruthy();
  });

  it('删除按钮先弹确认，确认后调用 remove', async () => {
    render(<TypeMakerPage />);
    const delBtn = await screen.findAllByTitle('删除');
    fireEvent.click(delBtn[0]);

    // 确认弹层出现
    expect(await screen.findByText('删除视频类型？')).toBeTruthy();
    expect(mocks.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /确认删除/ }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('custom_t1'));
  });

  it('内置类型没有删除按钮', async () => {
    render(<TypeMakerPage />);
    const delBtns = await screen.findAllByTitle('删除');
    expect(delBtns.length).toBe(1); // 仅自定义类型
  });
});

describe('V17 类型复核（genre-check 干跑）', () => {
  const mismatchResult = {
    type_id: 'custom_t1',
    traits_declared: 2,
    measured: { avg_shot_ms: 9000, text_overlay_ratio: 0.1 },
    ok: false,
    judge: 'mismatch',
    judge_detail: { reasons: ['满屏口播文案，不像歌词 MV'], confidence: 0.96 },
    summary: '类型符合度 0/2；裁判=mismatch',
    traits: [
      { name: 'avg_shot_ms', mode: 'require_le', threshold: 3200, value: 9000, passed: false, enforce: 'strict' },
      { name: 'text_overlay_ratio', mode: 'require_ge', threshold: 0.4, value: 0.1, passed: false, enforce: 'strict' },
    ],
    mismatches: ['avg_shot_ms 未达标'],
    warnings: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([customType]);
    mocks.genreCheck.mockResolvedValue(mismatchResult);
  });

  it('复核按钮打开弹层，默认不勾选 LLM 裁判（D7 默认关）', async () => {
    render(<TypeMakerPage />);
    fireEvent.click((await screen.findAllByTitle('类型复核'))[0]);

    expect(await screen.findByTestId('genre-check-modal')).toBeTruthy();
    const checkbox = screen.getByTestId('genre-check-use-judge') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('点开始复核 → 调用 genreCheck 并渲染逐条指标与判据', async () => {
    render(<TypeMakerPage />);
    fireEvent.click((await screen.findAllByTitle('类型复核'))[0]);
    fireEvent.click(screen.getByRole('button', { name: /开始复核/ }));

    await waitFor(() => expect(mocks.genreCheck).toHaveBeenCalledTimes(1));
    // 默认不下发 enable_genre_judge（关 = 后端写 judge=skipped）
    const [, payload] = mocks.genreCheck.mock.calls[0];
    expect(payload.enable_genre_judge).toBeUndefined();
    expect(payload.timeline).toBeTruthy();

    expect(await screen.findByTestId('genre-check-result')).toBeTruthy();
    expect(screen.getByText(/avg_shot_ms=9000/)).toBeTruthy();
    expect(screen.getByTestId('genre-judge-detail')).toBeTruthy();
  });

  it('勾选 LLM 复核后才下发 enable_genre_judge', async () => {
    render(<TypeMakerPage />);
    fireEvent.click((await screen.findAllByTitle('类型复核'))[0]);
    fireEvent.click(screen.getByTestId('genre-check-use-judge'));
    fireEvent.click(screen.getByRole('button', { name: /开始复核/ }));

    await waitFor(() => expect(mocks.genreCheck).toHaveBeenCalledTimes(1));
    const [, payload] = mocks.genreCheck.mock.calls[0];
    expect(payload.enable_genre_judge).toBe(true);
  });

  it('时间线 JSON 非法 → 本地报错且不请求后端', async () => {
    render(<TypeMakerPage />);
    fireEvent.click((await screen.findAllByTitle('类型复核'))[0]);
    fireEvent.change(screen.getByTestId('genre-check-timeline'), { target: { value: '{ not json' } });
    fireEvent.click(screen.getByRole('button', { name: /开始复核/ }));

    expect(await screen.findByTestId('genre-check-error')).toBeTruthy();
    expect(mocks.genreCheck).not.toHaveBeenCalled();
  });

  it('后端 400 的 detail 原样展示（不吞异常）', async () => {
    mocks.genreCheck.mockRejectedValue({ response: { data: { detail: '时间线非法: duration_sec' } } });
    render(<TypeMakerPage />);
    fireEvent.click((await screen.findAllByTitle('类型复核'))[0]);
    fireEvent.click(screen.getByRole('button', { name: /开始复核/ }));

    expect(await screen.findByText(/时间线非法: duration_sec/)).toBeTruthy();
  });
});
