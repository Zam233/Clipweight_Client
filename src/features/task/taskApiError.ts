/**
 * 任务接口错误 → 可读结论（PRD §4.3）。
 *
 * 为什么单独一个模块：`TaskRuns` / `TaskQuestionCard` / `TaskRunDetail` 都会打后端，
 * 每个组件各自 `catch (e) => String(e)` 的结果是"用户看到 AxiosError 三个字"。
 * 这里把 FastAPI 的几形状（字符串 detail / 对象 detail / 422 校验数组）统一收敛，
 * 并把 400/403/404/409/410 映射成**可操作**的中文。
 */

export interface ApiFailure {
  /** HTTP 状态码；网络错误为 0 */
  status: number;
  /** 后端结构化 reason（如 waiting_answer / already_answered / question_expired） */
  reason: string;
  /** 给人看的一句话 */
  message: string;
  /** 是否值得重试（网络错误 / 5xx 才 true） */
  retryable: boolean;
}

interface AxiosLike {
  response?: {
    status?: number;
    data?: { detail?: unknown; message?: unknown };
  };
  code?: string;
  message?: string;
}

function _detail(detail: unknown): { reason: string; message: string } {
  if (typeof detail === 'string' && detail) return { reason: '', message: detail };
  if (detail && typeof detail === 'object') {
    const d = detail as Record<string, unknown>;
    const reason = String(d.reason ?? '');
    const message = String(d.message ?? d.error ?? '');
    if (message) return { reason, message };
    // FastAPI 422：detail 是 [{loc, msg, type}]
    if (Array.isArray(detail)) {
      const first = detail[0] as Record<string, unknown> | undefined;
      const msg = first ? String(first.msg ?? '') : '';
      return { reason, message: msg || '請求参数不合法' };
    }
    if (reason) return { reason, message: reason };
  }
  return { reason: '', message: '' };
}

const STATUS_CN: Record<number, string> = {
  400: '请求参数不合法',
  403: '当前账号无权执行该操作',
  404: '目标不存在（可能是任务/运行记录已被清理）',
  409: '状态冲突（可能已处理过，或任务/运行时已结束）',
  410: '内容已失效（可能已超时，或服务重启过）',
  429: '请求太频繁，稍后再试',
  500: '服务端出错',
  502: '网关出错',
  503: '服务暂不可用',
};

/** 把任意异常收敛成 `ApiFailure`；永远不抛。 */
export function describeApiError(e: unknown, fallback = '请求失败'): ApiFailure {
  const err = (e ?? {}) as AxiosLike;
  const status = Number(err.response?.status ?? 0);
  const detail = err.response?.data?.detail;
  const parsed = _detail(detail);
  const base = STATUS_CN[status] || (status >= 500 ? '服务端出错' : '');
  const message = parsed.message || base || err.message || fallback;
  return {
    status,
    reason: parsed.reason,
    message,
    retryable: status === 0 || status >= 500,
  };
}

/**
 * 场景化文案：同一状态码在不同动作下的正确说法不一样
 * （404 在"看 run 详情"里是"记录没了"，在"重放"里是"运行实例没了"）。
 */
export function describeRunActionError(e: unknown, action: 'detail' | 'message' | 'replay'): ApiFailure {
  const f = describeApiError(e);
  if (f.reason === 'waiting_answer') {
    return { ...f, message: '任务正在等待你的回答，请先回答问题或取消任务' };
  }
  if (action === 'detail' && f.status === 404) {
    return { ...f, message: '该次运行记录已不可用（服务可能重启过）。刷新列表后重试。' };
  }
  if (action === 'replay' && f.status === 409) {
    return { ...f, message: '任务已结束或服务已重启，当前进程里没有可重放的运行实例。' };
  }
  if (action === 'replay' && f.status === 400) {
    return { ...f, message: '该运行记录缺少阶段信息，暂时无法重放。' };
  }
  if (action === 'message' && f.status === 404) {
    return { ...f, message: '该次运行记录已不存在，请刷新任务记录。' };
  }
  return f;
}
