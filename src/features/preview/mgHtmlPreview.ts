/** MG HTML 即时预览驱动（P2-3）。
 *
 * 后端 `POST /api/animation/mg/html` 返回与主管线同源的合成 HTML（内含 `hf_timeline`
 * 运行时，已把动画暂停并注册 `window.__timelines['main']`）。前端把它放进
 * `sandbox="allow-scripts"` 的 iframe —— **不开启 allow-same-origin**，因此 iframe 处于
 * 不透明源、拿不到父页面任何东西（LLM 生成的 HTML 不得在应用源里执行脚本）。
 *
 * 父页面与 iframe 只能通过 `postMessage` 通信：
 * - 父 → 子：`{type:'mg-preview', action:'seek'|'play'|'pause', time?}`
 * - 子 → 父：`{type:'mg-preview', event:'ready'|'time', duration, time, playing}`
 *
 * iframe 内不做任何渲染：`seek(t)` 是纯函数，拖时间轴即时看到任意时刻画面。
 */

export interface MgPreviewState {
  duration: number;
  time: number;
  playing: boolean;
}

export const MG_PREVIEW_MSG = 'mg-preview';

/** iframe 内运行的驱动脚本（无依赖，postMessage 双向）。 */
export const MG_PREVIEW_DRIVER = `(function(){
  var TIMELINE_ID = 'main';
  var FPS = 30;
  var duration = 0;
  var time = 0;
  var playing = false;
  var raf = 0;
  var last = 0;

  function tl(){
    try {
      var reg = window.__timelines || {};
      var t = reg[TIMELINE_ID];
      if (t) return t;
      for (var k in reg) { if (reg[k] && typeof reg[k].seek === 'function') return reg[k]; }
    } catch (e) { /* 忽略：未注册时退化为静态首帧 */ }
    return null;
  }

  function measure(){
    var t = tl();
    if (t && typeof t.duration === 'function') {
      var d = Number(t.duration()) || 0;
      if (d > 0) return d;
    }
    var root = document.querySelector('[data-composition-id]');
    var d2 = root ? Number(root.getAttribute('data-duration')) || 0 : 0;
    return d2 > 0 ? d2 : 3;
  }

  function seek(t){
    time = Math.max(0, Math.min(duration, Number(t) || 0));
    var h = tl();
    if (h && typeof h.seek === 'function') { try { h.seek(time); } catch (e) {} }
    post();
  }

  function post(){
    try {
      parent.postMessage({
        type: '${MG_PREVIEW_MSG}', event: 'time',
        duration: duration, time: time, playing: playing,
      }, '*');
    } catch (e) {}
  }

  function tick(now){
    if (!playing) return;
    var dt = last ? (now - last) / 1000 : 0;
    last = now;
    var next = time + dt;
    if (next >= duration) { next = duration; playing = false; }
    seek(next);
    if (playing) raf = requestAnimationFrame(tick);
  }

  window.addEventListener('message', function(ev){
    var d = ev && ev.data;
    if (!d || d.type !== '${MG_PREVIEW_MSG}') return;
    if (d.action === 'seek') { playing = false; cancelAnimationFrame(raf); seek(d.time); }
    else if (d.action === 'play') {
      if (time >= duration) time = 0;
      playing = true; last = 0; raf = requestAnimationFrame(tick);
    }
    else if (d.action === 'pause') { playing = false; cancelAnimationFrame(raf); post(); }
  });

  function boot(){
    duration = measure();
    seek(0);
    try {
      parent.postMessage({ type: '${MG_PREVIEW_MSG}', event: 'ready', duration: duration }, '*');
    } catch (e) {}
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 0);
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();`;

/** 把驱动脚本注入合成 HTML（幂等：已注入过则原样返回）。 */
export function buildMgPreviewDoc(html: string): string {
  if (!html) return '';
  if (html.includes(MG_PREVIEW_MSG) && html.includes('mg-preview-driver')) return html;
  const tag = `<script data-mg-preview-driver="1">${MG_PREVIEW_DRIVER}</script>`;
  if (html.includes('</body>')) return html.replace('</body>', `${tag}</body>`);
  return html + tag;
}

/** 父 → 子控制消息体。 */
export function mgPreviewMessage(
  action: 'seek' | 'play' | 'pause',
  time?: number,
): { type: string; action: string; time?: number } {
  return time === undefined
    ? { type: MG_PREVIEW_MSG, action }
    : { type: MG_PREVIEW_MSG, action, time };
}

/** 解析来自 iframe 的消息（非本协议消息返回 null，便于调用方直接忽略）。 */
export function parseMgPreviewMessage(data: unknown): { event: string; state: MgPreviewState } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== MG_PREVIEW_MSG) return null;
  const event = typeof d.event === 'string' ? d.event : '';
  if (!event) return null;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    event,
    state: { duration: num(d.duration), time: num(d.time), playing: d.playing === true },
  };
}

/** 把秒数格式化成 mm:ss.s（预览时间轴用）。 */
export function formatPreviewTime(sec: number): string {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`;
}
