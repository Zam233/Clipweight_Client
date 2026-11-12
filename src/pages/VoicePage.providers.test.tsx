// @vitest-environment jsdom
/**
 * P4 测试：语音页的 provider 选项来自门面（含插件注册的 provider），
 * 不再硬编码三项；后端离线时回落到内置三项。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  available: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  voiceApi: {
    list: mocks.list,
    delete: vi.fn(),
    getAudioUrl: (u: string) => u,
    synthesize: vi.fn(),
    clone: vi.fn(),
  },
  providersApi: { available: mocks.available },
}));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

vi.mock('@/components/shared/AudioPlayer', () => ({ AudioPlayer: () => <div /> }));

import { VoicePage } from './VoicePage';

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

async function openCloneDialog() {
  render(<VoicePage />);
  const openBtns = await screen.findAllByRole('button', { name: /克隆新音色/ });
  fireEvent.click(openBtns[0]);
  return screen.findByText('提供者');
}

describe('P4 语音 provider 列表门面驱动', () => {
  it('展示门面返回的 provider（含插件注册项）', async () => {
    mocks.available.mockResolvedValue({ tts_provider: ['qwen-tts', 'plugin-tts-voice'] });
    await openCloneDialog();
    await waitFor(() => expect(screen.getByRole('button', { name: 'plugin-tts-voice' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Qwen TTS' })).toBeTruthy();
  });

  it('门面不可用时不再硬编码厂商：如实提示未获取到 provider（PL-09）', async () => {
    mocks.available.mockRejectedValue(new Error('offline'));
    await openCloneDialog();
    await waitFor(() => expect(screen.getByText(/未获取到可用的 TTS provider/)).toBeTruthy());
    // 旧实现会显示写死的 Qwen TTS / CosyVoice / MiniMax
    expect(screen.queryByRole('button', { name: 'CosyVoice' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'MiniMax' })).toBeNull();
  });

  it('门面返回空列表时同样如实为空，不伪造三项兜底（PL-09）', async () => {
    mocks.available.mockResolvedValue({ tts_provider: [] });
    await openCloneDialog();
    await waitFor(() => expect(screen.getByText(/未获取到可用的 TTS provider/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Qwen TTS' })).toBeNull();
  });

  it('插件 provider 的显示名与能力位由 provider_meta 下发（不按厂商猜）', async () => {
    mocks.available.mockResolvedValue({
      tts_provider: ['qwen-tts', 'elevenlabs'],
      provider_meta: {
        tts_provider: {
          'qwen-tts': { name: 'Qwen TTS', needs_uploader: false },
          elevenlabs: { name: 'ElevenLabs', needs_uploader: false, clone_supported: false },
        },
      },
    });
    await openCloneDialog();
    await waitFor(() => expect(screen.getByRole('button', { name: 'ElevenLabs' })).toBeTruthy());
    // 选中该 provider 后，能力位由 provider_meta 决定（needs_uploader=false）
    fireEvent.click(screen.getByRole('button', { name: 'ElevenLabs' }));
    // needs_uploader=false → 提示"直接按文本合成"，而不是"需要公网 URL"
    expect(screen.getByText(/直接按文本合成/)).toBeTruthy();
  });
});
