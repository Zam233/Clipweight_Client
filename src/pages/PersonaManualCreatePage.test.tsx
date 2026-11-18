// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ create: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/stores/toastStore', () => ({ toast: mocks.toast }));
vi.mock('@/services/api', () => ({ personaApi: { create: mocks.create } }));

import { PersonaManualCreatePage } from './PersonaManualCreatePage';

describe('PersonaManualCreatePage', () => {
  beforeEach(() => { mocks.create.mockReset(); mocks.navigate.mockReset(); });
  it('submits canonical manifest without LLM', async () => {
    render(<PersonaManualCreatePage />);
    fireEvent.change(screen.getByLabelText('Persona ID'), { target: { value: 'manual_demo' } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '手动人格' } });
    fireEvent.change(screen.getByLabelText('系统 Prompt'), { target: { value: '你是手工人格' } });
    mocks.create.mockResolvedValue({});
    fireEvent.click(screen.getByText('创建人格'));
    await waitFor(() => expect(mocks.create).toHaveBeenCalled());
    const arg = mocks.create.mock.calls[0][0];
    expect(arg.persona_id).toBe('manual_demo');
    expect(arg.parameter.language.max_sentence_len).toBe(30);
    expect(arg.parameter.rhythm.base_shot_duration_ms).toBeNull();
    expect(arg.prompt).toBe('你是手工人格');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/persona/$personaId', params: { personaId: 'manual_demo' } });
  });
});
