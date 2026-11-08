// @vitest-environment jsdom
/**
 * 事件语义映射（PRD §6.2 / §13 / §14）。锁定：这些事实必须在**行内**可读，
 * 而不是藏在"点开 JSON 自己看"里。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { EventFeed } from './EventFeed';
import type { TaskEvent } from '@/types/task';

const ev = (seq: number, type: TaskEvent['type'], detail: Record<string, unknown>,
  message = ''): TaskEvent => ({ seq, type, ts: '', message, detail });

beforeEach(() => { cleanup(); });

describe('EventFeed 语义标签', () => {
  it('tool_result 行内显示"结果已复用（去重）"与来源', () => {
    render(<EventFeed events={[
      ev(1, 'tool_result', {
        tool: 'list_dir', status: 'ok', deduped: true, source: 'kernel',
        remaining_turns: 3,
      }, 'list_dir → 复用上次结果'),
    ]} />);
    const tags = [...document.querySelectorAll('[data-event-tag]')].map((n) => n.textContent);
    expect(tags).toContain('结果已复用（去重）');
    expect(tags).toContain('由内核触发');
    expect(tags).toContain('剩余回合 3');
  });

  it('Skill 调用标「技能」，普通工具不标', () => {
    render(<EventFeed events={[
      ev(1, 'subagent_tool', { tool: 'skill:pv_engine', kind: 'skill' }, 'skill:pv_engine → ok'),
      ev(2, 'subagent_tool', { tool: 'video_trim', kind: 'tool' }, 'video_trim → ok'),
    ]} />);
    const rows = [...document.querySelectorAll('[data-event-type="subagent_tool"]')];
    expect(rows[0].textContent).toContain('技能');
    expect(rows[1].textContent).not.toContain('技能');
  });

  it('narration.kind 翻成中文（kernel_recovery / degradation_gate_continue）', () => {
    render(<EventFeed events={[
      ev(1, 'narration', { kind: 'kernel_recovery' }, 'Kernel 补派 animation'),
      ev(2, 'narration', { kind: 'degradation_gate_continue' }, '降级决策守门'),
    ]} />);
    const rows = [...document.querySelectorAll('[data-event-type="narration"]')];
    expect(rows[0].textContent).toContain('内核正在补派');
    expect(rows[1].textContent).toContain('降级检查后继续');
  });

  it('degradation 收据模式翻成中文，含 replayed_not_fixed 的警示', () => {
    render(<EventFeed events={[
      ev(1, 'degradation', { mode: 'accepted', resolved: 2, reason: '图库无版权素材' },
        '降级接受收据：2 项'),
      ev(2, 'degradation', { mode: 'replayed_not_fixed' }, '重派命中幂等回放'),
    ]} />);
    const rows = [...document.querySelectorAll('[data-event-type="degradation"]')];
    expect(rows[0].textContent).toContain('已接受（写了收据）');
    expect(rows[0].textContent).toContain('处置 2 项');
    expect(rows[1].textContent).toContain('重放命中缓存，不算修复');
  });

  it('progress 事件行内显示 trigger 中文与百分比', () => {
    render(<EventFeed events={[
      ev(1, 'progress', { trigger: 'wrapup', percent: 80 }, '[4/5] 进入收尾'),
    ]} />);
    const row = document.querySelector('[data-event-type="progress"]')!;
    expect(row.textContent).toContain('进入收尾');
    expect(row.textContent).toContain('80%');
  });

  it('question / answer 事件可展开看结构化 detail', () => {
    render(<EventFeed events={[
      ev(1, 'question', { question_id: 'q1', question: '选哪个？' }, '待回答：选哪个？'),
      ev(2, 'answer', { question_id: 'q1', option_id: 'a', source: 'user_option' }, '已回答：a'),
    ]} />);
    expect(document.querySelector('[data-event-detail-toggle="1"]')).toBeTruthy();
    expect(document.querySelector('[data-event-detail-toggle="2"]')).toBeTruthy();
  });
});
