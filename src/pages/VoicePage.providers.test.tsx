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

  it('门面不可用时回落内置三项', async () => {
    mocks.available.mockRejectedValue(new Error('offline'));
    await openCloneDialog();
    for (const label of ['Qwen TTS', 'CosyVoice', 'MiniMax']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('门面返回空列表时也保留内置兜底', async () => {
    mocks.available.mockResolvedValue({ tts_provider: [] });
    await openCloneDialog();
    expect(screen.getByRole('button', { name: 'Qwen TTS' })).toBeTruthy();
  });
});
