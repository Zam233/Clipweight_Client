/** 轮72：管线追踪 id 的跨标签页持久化。
 *
 * sessionStorage 是本标签页的权威来源（刷新恢复，测试也直接断言它）；
 * 同时镜像到 localStorage 带 12h TTL，使第二个标签页也能看到正在运行的管线
 * （旧实现仅 sessionStorage → 新标签页永远看不到进度）。终态清理两处。
 */
const TAB_KEY = 'cw_pipeline_id';
const SHARED_KEY = 'cw_pipeline_id_shared';
const TTL_MS = 12 * 60 * 60 * 1000;

export function savePipelineId(id: string): void {
  try { sessionStorage.setItem(TAB_KEY, id); } catch { /* ignore */ }
  try {
    localStorage.setItem(SHARED_KEY, JSON.stringify({ id, ts: Date.now() }));
  } catch { /* ignore */ }
}

export function loadPipelineId(): string | null {
  try {
    const tab = sessionStorage.getItem(TAB_KEY);
    if (tab) return tab;
  } catch { /* ignore */ }
  try {
    const raw = localStorage.getItem(SHARED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; ts?: number };
    if (!parsed?.id || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > TTL_MS) {
      localStorage.removeItem(SHARED_KEY);
      return null;
    }
    return parsed.id;
  } catch {
    return null;
  }
}

export function clearPipelineId(): void {
  try { sessionStorage.removeItem(TAB_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(SHARED_KEY); } catch { /* ignore */ }
}
