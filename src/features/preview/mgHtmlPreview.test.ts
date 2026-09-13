import { describe, it, expect } from 'vitest';
import {
  MG_PREVIEW_DRIVER,
  MG_PREVIEW_MSG,
  buildMgPreviewDoc,
  formatPreviewTime,
  mgPreviewMessage,
  parseMgPreviewMessage,
} from './mgHtmlPreview';

describe('mgHtmlPreview', () => {
  it('注入驱动脚本到 </body> 之前', () => {
    const html = '<!DOCTYPE html><html><body><div id="root"></div></body></html>';
    const out = buildMgPreviewDoc(html);
    expect(out).toContain('data-mg-preview-driver="1"');
    expect(out.indexOf('data-mg-preview-driver')).toBeLessThan(out.indexOf('</body>'));
    expect(out).toContain('<div id="root"></div>');
  });

  it('无 </body> 时追加到末尾', () => {
    const out = buildMgPreviewDoc('<div>fragment</div>');
    expect(out.startsWith('<div>fragment</div>')).toBe(true);
    expect(out).toContain(MG_PREVIEW_MSG);
  });

  it('幂等：重复注入不产生第二份', () => {
    const once = buildMgPreviewDoc('<html><body>x</body></html>');
    const twice = buildMgPreviewDoc(once);
    expect(twice).toBe(once);
  });

  it('空输入返回空串', () => {
    expect(buildMgPreviewDoc('')).toBe('');
  });

  it('驱动脚本通过 __timelines 的 seek 驱动画面（不重新渲染）', () => {
    expect(MG_PREVIEW_DRIVER).toContain('__timelines');
    expect(MG_PREVIEW_DRIVER).toContain('.seek(');
    expect(MG_PREVIEW_DRIVER).toContain('data-composition-id');
    expect(MG_PREVIEW_DRIVER).toContain('requestAnimationFrame');
    // 只用 postMessage 与父页面通信（iframe 为不透明源，拿不到父对象）
    expect(MG_PREVIEW_DRIVER).toContain('parent.postMessage');
    expect(MG_PREVIEW_DRIVER).not.toContain('window.parent.document');
  });

  it('控制消息体符合协议', () => {
    expect(mgPreviewMessage('play')).toEqual({ type: MG_PREVIEW_MSG, action: 'play' });
    expect(mgPreviewMessage('seek', 1.25)).toEqual({
      type: MG_PREVIEW_MSG, action: 'seek', time: 1.25,
    });
  });

  it('解析 iframe 状态消息，忽略无关消息', () => {
    expect(parseMgPreviewMessage({ type: 'other' })).toBeNull();
    expect(parseMgPreviewMessage(null)).toBeNull();
    expect(parseMgPreviewMessage({ type: MG_PREVIEW_MSG })).toBeNull(); // 缺 event
    const parsed = parseMgPreviewMessage({
      type: MG_PREVIEW_MSG, event: 'time', duration: 4.5, time: 1.5, playing: true,
    });
    expect(parsed).toEqual({ event: 'time', state: { duration: 4.5, time: 1.5, playing: true } });
    // 非法数值归零而非 NaN
    const bad = parseMgPreviewMessage({
      type: MG_PREVIEW_MSG, event: 'ready', duration: 'x', time: null,
    });
    expect(bad?.state).toEqual({ duration: 0, time: 0, playing: false });
  });

  it('时间格式化', () => {
    expect(formatPreviewTime(0)).toBe('00:00.0');
    expect(formatPreviewTime(3.25)).toBe('00:03.3');
    expect(formatPreviewTime(65)).toBe('01:05.0');
    expect(formatPreviewTime(-1)).toBe('00:00.0');
  });
});
