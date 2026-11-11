// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DubView } from './DubView';
import { useProjectStore } from '@/stores/projectStore';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    voiceList: vi.fn(),
    voiceDub: vi.fn(),
    getAudioUrl: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  voiceApi: {
    list: mocks.voiceList,
    dub: mocks.voiceDub,
    getAudioUrl: mocks.getAudioUrl,
  },
}));

vi.mock('@/pages/VoicePage', () => ({ VoicePage: () => null }));
vi.mock('@/components/shared/AudioPlayer', () => ({ AudioPlayer: () => null }));
vi.mock('@/stores/toastStore', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.voiceList.mockResolvedValue([]);
  mocks.getAudioUrl.mockReturnValue('http://localhost:8000/audio/x.mp3');
  useProjectStore.setState({
    voiceId: 'v1',
    scriptText: '第一段。第二段。',
    dubSegments: null,
  });
});

afterEach(() => cleanup());

describe('B21: dub segments wired into projectStore', () => {
  it('配音完成后 projectStore.dubSegments 非空且含 start/end/text', async () => {
    mocks.voiceDub.mockResolvedValue({
      segments: [
        { index: 0, text: '第一段', duration_sec: 3 },
        { index: 1, text: '第二段', duration_sec: 4 },
      ],
      total: 2,
      total_duration_sec: 7,
    });

    render(<DubView />);
    // 确认配音
    fireEvent.click(screen.getByText('确认配音'));
    await waitFor(() => expect(mocks.voiceDub).toHaveBeenCalled());

    const segments = useProjectStore.getState().dubSegments;
    expect(segments).not.toBeNull();
    expect(segments!.length).toBe(2);
    expect(segments![0]).toEqual({ start: 0, end: 3, text: '第一段' });
    expect(segments![1]).toEqual({ start: 3, end: 7, text: '第二段' });
  });

  it('配音失败不写 dubSegments（保持 null）', async () => {
    mocks.voiceDub.mockRejectedValue(new Error('dub failed'));

    render(<DubView />);
    fireEvent.click(screen.getByText('确认配音'));
    await waitFor(() => expect(mocks.voiceDub).toHaveBeenCalled());

    expect(useProjectStore.getState().dubSegments).toBeNull();
  });
});

describe('M-07/M-08 空段守卫与失败重试', () => {
  it('M-07：没有可加段时不建空音轨、给出可读提示', async () => {
    render(<DubView />);
    // 所有段都没有 audio_url → 可加段为空
    mocks.voiceDub.mockResolvedValue({
      segments: [{ index: 0, text: '无音频', duration_sec: 3 }],
      total: 1, total_duration_sec: 3,
    });
    fireEvent.click(screen.getByText('确认配音'));
    await waitFor(() => expect(mocks.voiceDub).toHaveBeenCalled());

    // 没有音频时不渲染「加入时间轴」按钮，所以直接从底部找错误/重试入口
    expect(screen.getByTestId('dub-error')).toBeTruthy();
    // 时间线不应多出 audio 轨道
    const tl = await import('@/stores/timelineStore');
    expect(
      tl.useTimelineStore.getState().timeline.tracks.filter((t) => t.kind === 'audio'),
    ).toHaveLength(0);
  });

  it('M-08：音色列表加载失败给出可点重试', async () => {
    mocks.voiceList.mockRejectedValueOnce(new Error('网络中断'));
    mocks.voiceList.mockResolvedValueOnce([{ id: 'v1', voice_name: '小青', provider: 'qwen' }]);

    render(<DubView />);
    const err = await screen.findByTestId('dub-voices-error');
    expect(err.textContent).toContain('音色列表加载失败');

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(mocks.voiceList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('dub-voices-error')).toBeNull());
  });

  it('M-08：配音失败显示可点「重试配音」', async () => {
    mocks.voiceDub.mockRejectedValue(new Error('合成服务不可用'));
    render(<DubView />);
    fireEvent.click(screen.getByText('确认配音'));
    await waitFor(() => expect(screen.getByTestId('dub-error')).toBeTruthy());
    expect(screen.getByRole('button', { name: '重试配音' })).toBeTruthy();

    mocks.voiceDub.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '重试配音' }));
    await waitFor(() => expect(mocks.voiceDub).toHaveBeenCalledTimes(1));
  });
});
