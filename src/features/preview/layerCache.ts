/**
 * 预览层纹理缓存（O6）。
 *
 * 预览合成每一帧都在重画每个可见片段：视频要 seek + drawImage、文字要重新做字体排版与
 * 描边/发光/阴影多趟绘制。这些绘制里**大部分在播放头落到同一帧内时是重复劳动**：
 * - 60Hz 的 rAF 跑 30fps 的时间线 → 同一源帧至少被画两次；
 * - 暂停/拖动/缩放/显示安全框/媒体加载完成都会触发整帧重绘，而内容没变；
 * - 文字层的时间相关性只来自关键帧变换，静止时内容逐帧完全相同。
 *
 * 做法：按**内容键**把某一层光栅化到离屏画布（OffscreenCanvas 优先），命中则直接
 * `drawImage` 贴上。上下文状态（globalAlpha / 混合模式 / filter / 裁剪 / 蒙版 / 变换）
 * 仍然留在主画布上——它们在贴图时生效，语义与原来一致。
 *
 * 关键约束（正确性）：
 * - **键必须覆盖一切影响像素的输入**（素材、源帧号、几何、变换、文字样式…）；
 *   键算漏 → 画错帧。视频键含 `mediaVersion`，素材重新加载/报错时自动失效。
 * - 占位/降级内容（素材未就绪、加载失败）**不进缓存**：`paint` 返回 false 时立即丢弃，
 *   否则一次早到的占位会被冻结在整帧上。
 * - 复用的离屏画布每次绘制前重置上下文状态（清除 filter/shadow/composite/alpha），
 *   否则上一层的阴影会漏到下一层。
 */

export type LayerCanvas = HTMLCanvasElement | OffscreenCanvas;
/**
 * 层上下文类型。
 *
 * 运行期既可能是 `CanvasRenderingContext2D` 也可能是 `OffscreenCanvasRenderingContext2D`；
 * 类型上统一按 `CanvasRenderingContext2D` 处理——本项目用到的成员
 * （drawImage/fillText/save/restore/setTransform/clearRect/filter/shadow…）两者一致，
 * 若写成联合类型，调用方（drawCover/drawErrorPlaceholder 等既有函数）会因为
 * 参数类型不可赋值而全部报错。
 */
export type Layer2DContext = CanvasRenderingContext2D;

export interface LayerCacheStats {
  hits: number;
  misses: number;
  entries: number;
  evictions: number;
  /** 命中率 0-1；无访问时为 0 */
  hitRate: number;
  /** 粗估占用字节（宽×高×4） */
  approxBytes: number;
}

export interface LayerGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayerCacheOptions {
  /** LRU 上限（条目数） */
  maxEntries?: number;
  /** 自建画布（测试可注入假实现） */
  createCanvas?: (width: number, height: number) => LayerCanvas | null;
}

interface CacheEntry {
  canvas: LayerCanvas;
  width: number;
  height: number;
  bytes: number;
}

/**
 * 内容键哈希（FNV-1a 32 位，再转 36 进制）。
 *
 * 用途是「键相等 ⇒ 像素相同」的快速判等，不需要抗碰撞的密码学强度；
 * 键字符串里保留可读前缀（`media:` / `text:`）以便按前缀失效。
 */
export function contentKey(prefix: string, parts: ReadonlyArray<string | number | boolean | null | undefined>): string {
  const raw = `${prefix}:${parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('|')}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${prefix}:${hash.toString(36)}:${raw.length.toString(36)}`;
}

/** 数值量化到 3 位小数（避免浮点噪声把同一画面拆成两个键） */
export function quantize(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function defaultCreateCanvas(width: number, height: number): LayerCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      /* 落到 HTMLCanvasElement */
    }
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/** 取 2D 上下文（OffscreenCanvas 与 HTMLCanvasElement 的返回类型不同，这里统一断言） */
function context2d(canvas: LayerCanvas): Layer2DContext | null {
  const get = (canvas as unknown as { getContext?: (id: string) => unknown }).getContext;
  if (typeof get !== 'function') return null;
  return (get.call(canvas, '2d') as Layer2DContext | null) ?? null;
}

export class LayerCache {
  private entries = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private maxEntries: number;
  private createCanvas: (width: number, height: number) => LayerCanvas | null;

  constructor(options: LayerCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 48);
    this.createCanvas = options.createCanvas ?? defaultCreateCanvas;
  }

  /**
   * 命中缓存则直接贴到主画布；未命中则用 `paint` 光栅化到离屏画布再贴。
   *
   * `paint(ctx)` 在**离屏画布**上绘制，坐标系与主画布相同（绝对坐标：直接用 x/y/w/h），
   * 因此调用方的绘制代码无需改写。返回 `false` 表示这一层是占位/降级内容，
   * 本次不缓存（但依然会贴上去，保证画面与原来一致）。
   */
  draw(
    ctx: Layer2DContext,
    key: string,
    geometry: LayerGeometry,
    dpr: number,
    paint: (ctx: Layer2DContext) => boolean,
  ): { hit: boolean; painted: boolean } {
    const { x, y, w, h } = geometry;
    if (!(w > 0) || !(h > 0)) return { hit: false, painted: false };
    const scale = dpr > 0 ? dpr : 1;
    const pxW = Math.max(1, Math.ceil(w * scale));
    const pxH = Math.max(1, Math.ceil(h * scale));

    const cached = this.entries.get(key);
    if (cached && cached.width === pxW && cached.height === pxH) {
      this.hits += 1;
      // LRU：命中后移到队尾
      this.entries.delete(key);
      this.entries.set(key, cached);
      ctx.drawImage(cached.canvas as CanvasImageSource, x, y, w, h);
      return { hit: true, painted: false };
    }

    const canvas = cached?.canvas ?? this.createCanvas(pxW, pxH);
    if (!canvas) {
      // 无离屏画布（极端环境）：退化为直接绘制，不缓存
      this.misses += 1;
      paint(ctx);
      return { hit: false, painted: true };
    }
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    const layerCtx = context2d(canvas);
    if (!layerCtx) {
      this.misses += 1;
      paint(ctx);
      return { hit: false, painted: true };
    }

    // 复位上下文状态：复用画布时上一层的阴影/filter/混合模式绝不能漏过来
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.clearRect(0, 0, pxW, pxH);
    layerCtx.globalAlpha = 1;
    layerCtx.globalCompositeOperation = 'source-over';
    layerCtx.filter = 'none';
    layerCtx.shadowColor = 'rgba(0,0,0,0)';
    layerCtx.shadowBlur = 0;
    layerCtx.shadowOffsetX = 0;
    layerCtx.shadowOffsetY = 0;
    layerCtx.textAlign = 'left';
    layerCtx.textBaseline = 'alphabetic';
    // 绝对坐标系：painter 继续用主画布的 x/y/w/h
    layerCtx.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);

    const cacheable = paint(layerCtx) !== false;
    if (!cacheable) {
      this.misses += 1;
      // 丢弃可能残留的占位像素
      layerCtx.setTransform(1, 0, 0, 1, 0, 0);
      layerCtx.clearRect(0, 0, pxW, pxH);
      this.entries.delete(key);
      return { hit: false, painted: false };
    }

    this.misses += 1;
    // width/height 可能被赋过新值，重新读一次
    this.entries.set(key, {
      canvas,
      width: canvas.width,
      height: canvas.height,
      bytes: canvas.width * canvas.height * 4,
    });
    this.prune();
    ctx.drawImage(canvas as CanvasImageSource, x, y, w, h);
    return { hit: false, painted: true };
  }

  /** 按键前缀失效（如素材重新加载后清掉 `media:`） */
  invalidatePrefix(prefix: string): number {
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${prefix}:`)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  getStats(): LayerCacheStats {
    let bytes = 0;
    for (const entry of this.entries.values()) bytes += entry.bytes;
    const accesses = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
      evictions: this.evictions,
      hitRate: accesses > 0 ? this.hits / accesses : 0,
      approxBytes: bytes,
    };
  }

  /** 累计计数清零（保留内容）——诊断面板「重置」用 */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  private prune(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictions += 1;
    }
  }
}

/**
 * 当前生效的预览层缓存实例。
 *
 * 用「取当前实例」而不是导出一个常量：预览循环与诊断面板都通过
 * `getPreviewLayerCache()` 访问，测试可以整体换成注入了假画布的实例
 * （jsdom 没有可用的 2D 上下文，否则缓存路径只能退化）。
 */
let activeLayerCache = new LayerCache({ maxEntries: 48 });

/** 当前预览层缓存 */
export function getPreviewLayerCache(): LayerCache {
  return activeLayerCache;
}

/** 替换预览层缓存实例（测试注入假画布用；生产不调用） */
export function setPreviewLayerCache(cache: LayerCache): void {
  activeLayerCache = cache;
}
