// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CreativePromptField } from './CreativePromptField';

afterEach(() => cleanup());

describe('CreativePromptField（F-04 R2）', () => {
  it('可编辑并显示字数', () => {
    const onChange = vi.fn();
    render(
      <CreativePromptField value="版画质感" avoid={[]} onChange={onChange} onAvoidChange={vi.fn()} onOpenChat={vi.fn()} />,
    );
    const box = screen.getByLabelText('creative-prompt') as HTMLTextAreaElement;
    expect(box.value).toBe('版画质感');
    expect(screen.getByText('4 / 4000')).toBeTruthy();
    fireEvent.change(box, { target: { value: '新版' } });
    expect(onChange).toHaveBeenCalledWith('新版');
  });

  it('避免项可单独移除', () => {
    const onAvoidChange = vi.fn();
    render(
      <CreativePromptField value="" avoid={['花哨转场', '抖动']} onChange={vi.fn()} onAvoidChange={onAvoidChange} onOpenChat={vi.fn()} />,
    );
    expect(screen.getByText(/避免：花哨转场/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('remove-avoid-花哨转场'));
    expect(onAvoidChange).toHaveBeenCalledWith(['抖动']);
  });

  it('「和 AI 聊聊」触发回调', () => {
    const onOpenChat = vi.fn();
    render(
      <CreativePromptField value="" avoid={[]} onChange={vi.fn()} onAvoidChange={vi.fn()} onOpenChat={onOpenChat} />,
    );
    fireEvent.click(screen.getByText('和 AI 聊聊'));
    expect(onOpenChat).toHaveBeenCalled();
  });
});

describe('HomePage 源约束（F-04 R1）', () => {
  const source = readFileSync(resolve(__dirname, '../../pages/HomePage.tsx'), 'utf-8');

  it('不再出现「配音驱动 / 视觉驱动」二选一按钮', () => {
    expect(source).not.toContain('配音驱动');
    expect(source).not.toContain('视觉驱动');
  });

  it('挂载了提示词区与对话抽屉', () => {
    expect(source).toContain('CreativePromptField');
    expect(source).toContain('ChatForgeDrawer');
    expect(source).toContain('setCreativePrompt');
  });

  it('编排路径由材料自动派生（上传配音 / 自动配音+音色 → voiceover）', () => {
    // 旧断言锁死了「只看 audio」的写法：没有音频就永远 visual，而上传入口又被
    // 藏在 voiceover 分支里 → 用户根本没有上传配音的入口。现在两者都参与派生。
    expect(source).toMatch(/const canTts = autoDubPref && Boolean\(voicePick\);/);
    expect(source).toMatch(/setMode\(audio \|\| canTts \? 'voiceover' : 'visual'\)/);
  });
});
