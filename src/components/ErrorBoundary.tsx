import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, Home, Copy, Check } from 'lucide-react';
import { reportCrash } from '@/lib/reportCrash';
import { asText } from '@/lib/render';

interface Props {
  children: ReactNode;
  /**
   * 面板名（可选）。给了就表示这是**局部兜底**：只把这一块降级为错误卡，
   * 页面其余部分继续可用，并且错误卡直接说出是哪个面板炸的。
   */
  region?: string;
}
interface State {
  hasError: boolean;
  error: Error | null;
  copied: boolean;
  /** React 给的组件栈：**唯一**能定位「到底哪个组件炸了」的证据，必须留下来 */
  componentStack: string;
}

/** 上一次渲染崩溃的落盘记录（刷新后还能查，用于事后定位）。 */
const LAST_CRASH_KEY = 'cw:lastRenderError';

/** 组件栈只要前几帧（最深的那层才是真正炸的组件）。 */
function componentStackHead(stack: string, limit = 8): string {
  const lines = String(stack || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, limit).join('\n') || '(空)';
}

/**
 * ErrorBoundary — catches render crashes and shows a recoverable "render
 * failed" screen instead of a blank page, with reload / home / copy-details.
 *
 * 2026-10-31：加了组件栈显示与落盘。用户此前只拿到一句
 * `Objects are not valid as a React child (found: object with keys {name})`，
 * 没有组件栈就没法知道是哪一处渲染，只能靠猜——这不叫可诊断。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, copied: false, componentStack: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = String(info.componentStack || '');
    this.setState({ componentStack });
    console.error('[ClipWright] Render error:', error, componentStack);
    try {
      localStorage.setItem(LAST_CRASH_KEY, JSON.stringify({
        at: new Date().toISOString(),
        path: window.location.pathname + window.location.search,
        name: error.name,
        message: error.message,
        stack: error.stack || '',
        componentStack,
      }));
    } catch { /* 存储不可用就不留痕，绝不因此再抛一次 */ }
    // 关键：把组件栈送到后端 logs/client-errors.jsonl —— 崩溃定位不再依赖人复制控制台
    reportCrash({
      source: 'boundary',
      name: error.name,
      message: error.message,
      stack: error.stack || '',
      componentStack,
      extra: this.props.region ? `region=${this.props.region}` : '',
    });
  }

  private reload = () => window.location.reload();
  private goHome = () => { window.location.href = '/'; };

  private copyDetails = async () => {
    const { error, componentStack } = this.state;
    if (!error) return;
    const text = [
      `${error.name}: ${error.message}`,
      `route: ${window.location.pathname}${window.location.search}`,
      error.stack ?? '',
      '--- component stack ---',
      componentStack || '(空)',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 1600);
    } catch { /* clipboard unavailable */ }
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    const { error, copied } = this.state;
    // 局部兜底：只坏这一块，页面其余部分继续可用（并且说清是哪一块坏了）
    if (this.props.region) {
      return (
        <div className="p-3 text-caption" data-testid="region-render-error"
          data-region={this.props.region}>
          <div className="mb-1 flex items-center gap-1.5 text-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="font-medium">「{this.props.region}」这块没渲染出来</span>
          </div>
          <p className="mb-1.5 text-on-surface-variant">
            其余面板不受影响（点别的标签即可继续）。这条崩溃已自动上报后端。
          </p>
          <pre className="mb-1.5 max-h-24 overflow-auto whitespace-pre-wrap rounded-cw-xs bg-surface-container p-1.5 font-mono text-caption text-error/90">
            {asText(error?.message)}
          </pre>
          <div className="flex gap-2">
            <button type="button" onClick={this.copyDetails}
              className="rounded-cw-xs border border-outline-variant/40 px-2 py-0.5 text-on-surface-variant hover:border-primary">
              {copied ? '已复制' : '复制详情'}
            </button>
            <button type="button"
              onClick={() => this.setState({ hasError: false, error: null, componentStack: '' })}
              className="rounded-cw-xs border border-outline-variant/40 px-2 py-0.5 text-on-surface-variant hover:border-primary">
              重试
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="h-full w-full flex items-center justify-center bg-surface relative overflow-hidden">
        {/* ambient broken-signal backdrop */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute inset-0 opacity-[0.05]" style={{
            backgroundImage: 'repeating-linear-gradient(0deg, #FF4444 0px, transparent 1px, transparent 3px)',
          }} />
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[400px] rounded-full opacity-[0.1]"
            style={{ background: 'radial-gradient(circle, #FF4444 0%, transparent 65%)' }} />
        </div>

        <div className="relative z-10 max-w-[520px] w-full mx-6">
          {/* signal-lost header */}
          <div className="flex items-center gap-3 mb-6">
            <span className="w-12 h-12 rounded-cw-md bg-error/15 border border-error/40 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-6 h-6 text-error" />
            </span>
            <div>
              <p className="font-mono text-label-sm tracking-[0.3em] text-error uppercase">Render Interrupted</p>
              <h1 className="text-title font-bold text-on-surface">界面渲染中断</h1>
            </div>
          </div>

          <p className="text-body text-on-surface-variant leading-relaxed mb-5">
            编辑器遇到了一个未预期的错误。时间线保存在后端项目中——请先保存（Ctrl+S）再刷新；未保存的改动可能丢失。
          </p>

          {/* error detail */}
          {error && (
            <div className="bg-surface-container border border-outline-variant/30 rounded-cw-md overflow-hidden mb-6">
              <div className="flex items-center justify-between px-3 py-2 bg-surface-container-high border-b border-outline-variant/20">
                <span className="font-mono text-caption text-on-surface-variant">{error.name}</span>
                <button
                  onClick={this.copyDetails}
                  className="flex items-center gap-1 text-caption text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3 text-track-audio" /> : <Copy className="w-3 h-3" />}
                  {copied ? '已复制' : '复制详情'}
                </button>
              </div>
              <pre className="px-3 py-2.5 font-mono text-caption text-error/90 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
                {error.message}
              </pre>
              {this.state.componentStack && (
                <details className="border-t border-outline-variant/20" data-testid="render-error-stack">
                  <summary className="cursor-pointer px-3 py-1.5 font-mono text-caption text-on-surface-variant hover:text-primary">
                    崩溃位置（组件栈）
                  </summary>
                  <pre className="px-3 pb-2.5 font-mono text-caption text-on-surface-variant/80 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                    {componentStackHead(this.state.componentStack)}
                  </pre>
                </details>
              )}
            </div>
          )}

          {/* recovery actions */}
          <div className="flex gap-3">
            <button
              onClick={this.reload}
              className="flex-1 flex items-center justify-center gap-2 h-11 rounded-cw-sm bg-primary text-on-primary
                font-medium text-body-sm hover:bg-primary/90 active:scale-[0.98] transition-all cursor-pointer shadow-lg shadow-primary/20"
            >
              <RotateCcw className="w-4 h-4" /> 重新加载
            </button>
            <button
              onClick={this.goHome}
              className="flex-1 flex items-center justify-center gap-2 h-11 rounded-cw-sm border border-outline-variant/50
                text-on-surface font-medium text-body-sm hover:bg-surface-container active:scale-[0.98] transition-all cursor-pointer"
            >
              <Home className="w-4 h-4" /> 返回工作台
            </button>
          </div>
        </div>
      </div>
    );
  }
}
