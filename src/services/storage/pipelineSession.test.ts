// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { savePipelineId, loadPipelineId, clearPipelineId } from './pipelineSession';

const TAB_KEY = 'cw_pipeline_id';
const SHARED_KEY = 'cw_pipeline_id_shared';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('轮72: 管线 id 跨标签页持久化', () => {
  it('save 同时写 sessionStorage 与 localStorage 镜像', () => {
    savePipelineId('pl_1');
    expect(sessionStorage.getItem(TAB_KEY)).toBe('pl_1');
    const shared = JSON.parse(localStorage.getItem(SHARED_KEY) || '{}');
    expect(shared.id).toBe('pl_1');
    expect(typeof shared.ts).toBe('number');
  });

  it('load 优先本标签页 sessionStorage', () => {
    sessionStorage.setItem(TAB_KEY, 'pl_tab');
    localStorage.setItem(SHARED_KEY, JSON.stringify({ id: 'pl_shared', ts: Date.now() }));
    expect(loadPipelineId()).toBe('pl_tab');
  });

  it('本标签页为空时回退 localStorage（TTL 内）——第二个标签页可见', () => {
    localStorage.setItem(SHARED_KEY, JSON.stringify({ id: 'pl_shared', ts: Date.now() - 1000 }));
    expect(loadPipelineId()).toBe('pl_shared');
  });

  it('超过 12h TTL 视为过期并清除镜像', () => {
    localStorage.setItem(
      SHARED_KEY,
      JSON.stringify({ id: 'pl_old', ts: Date.now() - 13 * 60 * 60 * 1000 }),
    );
    expect(loadPipelineId()).toBeNull();
    expect(localStorage.getItem(SHARED_KEY)).toBeNull();
  });

  it('镜像损坏时不抛异常并返回 null', () => {
    localStorage.setItem(SHARED_KEY, 'not-json');
    expect(loadPipelineId()).toBeNull();
  });

  it('clear 同时清理两处', () => {
    savePipelineId('pl_2');
    clearPipelineId();
    expect(sessionStorage.getItem(TAB_KEY)).toBeNull();
    expect(localStorage.getItem(SHARED_KEY)).toBeNull();
    expect(loadPipelineId()).toBeNull();
  });
});
