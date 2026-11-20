// @vitest-environment jsdom
/** F05：doc_write / step_end / subagent_round 的 v2 字段在事件行里可见（点开详情）。 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EventFeed } from './EventFeed';
import type { TaskEvent } from '@/types/task';

const ev = (seq: number, type: TaskEvent['type'], detail: Record<string, unknown>,
  message = ''): TaskEvent => ({ seq, type, ts: '', message, detail });

beforeEach(() => cleanup());

describe('EventFeed · v2 字段（F05）', () => {
  it('doc_write 行内给路径，展开后能看到 bytes/run_id', () => {
    render(<EventFeed events={[
      ev(1, 'doc_write', {
        path: 'reports/01-edit-1.md', bytes: 1234, seq: 1, run_id: 'run_1', status: 'ok',
      }, '报告已写'),
    ]} />);
    expect(document.querySelector('[data-event-path]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-event-detail-toggle="1"]') as HTMLElement);
    const pre = document.querySelector('[data-event-detail="1"]');
    expect(pre?.textContent).toContain('"bytes": 1234');
    expect(pre?.textContent).toContain('"run_id": "run_1"');
  });

  it('subagent_round 与 step_end 可展开（不再只有一行消息）', () => {
    render(<EventFeed events={[
      ev(1, 'subagent_round', { run_id: 'run_1', round: 3, visible_calls: ['a'] }, '第 3 轮'),
      ev(2, 'step_end', { stage: 'edit', status: 'ok', report_state: 'written' }, '阶段 edit 结束'),
    ]} />);
    expect(document.querySelector('[data-event-detail-toggle="1"]') as HTMLElement).toBeTruthy();
    expect(document.querySelector('[data-event-detail-toggle="2"]') as HTMLElement).toBeTruthy();
    fireEvent.click(document.querySelector('[data-event-detail-toggle="1"]') as HTMLElement);
    expect(document.querySelector('[data-event-detail="1"]')?.textContent).toContain('"round": 3');
  });
});
