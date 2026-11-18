/**
 * Blur 半径标定：6 图 × 8 半径 × 3 scale × 2 dpr = 288 例。
 *
 * 目标：量出 Canvas `ctx.filter = blur(B px)` 与 CSS `filter: blur(R px)` 在同一设计空间
 * （且外层 transform: scale(s)、画布按 dpr 放大）下的等价关系，产出
 * src/features/preview/motionSpecOverlay/blur-calibration.generated.ts 的 BLUR_BUCKETS。
 *
 * 可靠性要点（针对此前 288 例失败的原因）：
 *  1. Canvas 与 CSS 用**同一块 512×512 舞台**、同一套设计坐标，只切换可见层；
 *     不使用并排网格，不存在 tile 排布误差。
 *  2. 两边都以 512 CSS px 固定区域截图：Canvas 侧直接读 backing store
 *     （canvas.width = 512*dpr），CSS 侧 page.screenshot({clip})，尺寸都是 512*dpr，
 *     逐例断言尺寸相等（不再有截图尺寸不一致）。
 *  3. 每张图在每个 (s,dpr) 先用 R=0 测一次质心偏移，把 CSS 层的 left/top 平移过去，
 *     保证 R>0 时两图对齐（文字基线差异被显式测掉，而不是靠猜）。
 *  4. 指标用灰度 SSIM（11×11 高斯窗 σ=1.5，C1/C2 按计划书），ROI = 两图非背景 bbox
 *     的并集外扩 6 device px；alpha 先合成到 #0e101a。
 *  5. 先验证物理模型 B = R*s*dpr（ctx.filter 以 device px 计，与 ctx transform 无关；
 *     CSS blur 在局部坐标里再被 scale(s) 放大），再对每个 (s,dpr) 桶用实测最优 k 做
 *     最小二乘拟合，给出 a / b / maxSsimError。
 *
 * 用法：
 *   node scripts/calibrate-blur-288.mjs           # 完整 288 例
 *   node scripts/calibrate-blur-288.mjs --quick   # 冒烟子集
 *   node scripts/calibrate-blur-288.mjs --no-write# 只打印，不写 generated 表
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const STAGE = 512;
const BG = '#0e101a';
const BG_RGB = [14, 16, 26];
const RADII = [0, 2, 4, 8, 12, 16, 24, 32];
const SCALES = [0.25, 0.5, 1];
const DPRS = [1, 2];

/** 6 张测试图：覆盖文字（大/小）、硬边细条、圆环、实心块、发丝线。 */
const IMAGES = [
  { id: 'text', kind: 'text', text: '并非回应', fontSize: 56 },
  { id: 'text2', kind: 'text', text: '技术中立', fontSize: 24 },
  { id: 'line', kind: 'rect', w: 110, h: 8 },
  { id: 'ring', kind: 'ring', d: 84, stroke: 8 },
  { id: 'rect', kind: 'rect', w: 84, h: 84 },
  { id: 'hairline', kind: 'rect', w: 110, h: 2 },
];

const QUICK = process.argv.includes('--quick');
const NO_WRITE = process.argv.includes('--no-write');
const TS_PATH = 'src/features/preview/motionSpecOverlay/blur-calibration.generated.ts';

const images = QUICK ? IMAGES.filter((i) => ['rect', 'hairline', 'text'].includes(i.id)) : IMAGES;
const radii = QUICK ? [0, 8, 16, 32] : RADII;
const scales = QUICK ? [0.25, 1] : SCALES;
const dprs = QUICK ? [1, 2] : DPRS;

// ---------------------------------------------------------------------------
// 页面：512×512 舞台 + 隐藏的 canvas（只读 getImageData）+ CSS 层
// ---------------------------------------------------------------------------
function shapeCss(img) {
  if (img.kind === 'text') {
    return `<div class="img" data-id="${img.id}" style="display:flex;align-items:center;justify-content:center">`
      + `<span class="el" style="font-size:${img.fontSize}px;line-height:1;font-family:sans-serif;color:#fff">${img.text}</span>`
      + `</div>`;
  }
  if (img.kind === 'rect') {
    return `<div class="img" data-id="${img.id}"><i class="el" style="left:${(STAGE - img.w) / 2}px;top:${(STAGE - img.h) / 2}px;width:${img.w}px;height:${img.h}px;background:#fff"></i></div>`;
  }
  if (img.kind === 'ring') {
    const left = (STAGE - img.d) / 2;
    return `<div class="img" data-id="${img.id}"><i class="el" style="left:${left}px;top:${left}px;width:${img.d}px;height:${img.d}px;border:${img.stroke}px solid #fff;border-radius:50%;box-sizing:border-box"></i></div>`;
  }
  throw new Error(`unknown kind ${img.kind}`);
}

const PAGE_HTML = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#000}
  #stage{position:relative;width:${STAGE}px;height:${STAGE}px;background:${BG};overflow:hidden}
  #cvs{position:absolute;left:0;top:0;width:${STAGE}px;height:${STAGE}px;visibility:hidden}
  #css{position:absolute;left:0;top:0;width:${STAGE}px;height:${STAGE}px;transform-origin:0 0}
  .img{position:absolute;left:0;top:0;width:${STAGE}px;height:${STAGE}px}
  .el{position:absolute;display:block;background:transparent;color:#fff}
</style><div id="stage"><canvas id="cvs"></canvas><div id="css">${IMAGES.map(shapeCss).join('')}</div></div>`;

function installHelpers() {
  const STAGE = 512;
  const BG = [14, 16, 26];

  function gaussKernel(n, sigma) {
    const k = new Float32Array(n);
    const half = (n - 1) / 2;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = i - half;
      k[i] = Math.exp(-(d * d) / (2 * sigma * sigma));
      sum += k[i];
    }
    for (let i = 0; i < n; i++) k[i] /= sum;
    return k;
  }
  const K = gaussKernel(11, 1.5);
  const RAD = 5;

  // 一维高斯（边缘复制），分离式两次即为 11×11 高斯窗。
  function blurH(src, w, h, k) {
    const dst = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let t = -5; t <= 5; t++) {
          let xx = x + t;
          if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
          acc += src[row + xx] * k[t + 5];
        }
        dst[row + x] = acc;
      }
    }
    return dst;
  }
  function blurV(src, w, h, k) {
    const dst = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let t = -5; t <= 5; t++) {
          let yy = y + t;
          if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
          acc += src[yy * w + x] * k[t + 5];
        }
        dst[y * w + x] = acc;
      }
    }
    return dst;
  }
  function filter2(src, w, h) { return blurV(blurH(src, w, h, K), w, h, K); }

  function grayFromRgba(data, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const a = data[i + 3] / 255;
      const r = data[i] * a + BG[0] * (1 - a);
      const gg = data[i + 1] * a + BG[1] * (1 - a);
      const b = data[i + 2] * a + BG[2] * (1 - a);
      g[p] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    }
    return g;
  }

  function canvasGray(imgId, s, B) {
    const img = window.__IMAGES.find((i) => i.id === imgId);
    const c = document.getElementById('cvs');
    const dpr = window.__DPR;
    const W = Math.round(STAGE * dpr);
    if (c.width !== W || c.height !== W) { c.width = W; c.height = W; }
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const shift = (window.__cvShift && window.__cvShift[imgId]) || { x: 0, y: 0 };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0e101a';
    ctx.fillRect(0, 0, STAGE, STAGE);
    if (shift.x || shift.y) ctx.translate(shift.x / dpr, shift.y / dpr);
    ctx.save();
    ctx.scale(s, s);
    ctx.filter = B > 0.0001 ? `blur(${B}px)` : 'none';
    ctx.fillStyle = '#fff';
    if (img.kind === 'text') {
      ctx.font = `${img.fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(img.text, STAGE / 2, STAGE / 2);
    } else if (img.kind === 'rect') {
      ctx.fillRect((STAGE - img.w) / 2, (STAGE - img.h) / 2, img.w, img.h);
    } else if (img.kind === 'ring') {
      ctx.beginPath();
      ctx.arc(STAGE / 2, STAGE / 2, (img.d - img.stroke) / 2, 0, Math.PI * 2);
      ctx.lineWidth = img.stroke;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
    ctx.filter = 'none';
    ctx.restore();
    return { g: grayFromRgba(ctx.getImageData(0, 0, W, W).data, W, W), w: W, h: W };
  }

  function bbox(g, w, h) {
    // 背景取四角像素中位数，避免依赖硬编码灰值。
    const corners = [g[0], g[w - 1], g[(h - 1) * w], g[h * w - 1]].sort((a, b) => a - b);
    const bg = (corners[1] + corners[2]) / 2;
    let minX = w, minY = h, maxX = -1, maxY = -1, sum = 0, cx = 0, cy = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = g[y * w + x] - bg;
        if (v <= 0) continue;
        sum += v;
        cx += x * v;
        cy += y * v;
        if (Math.abs(v) > 3) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { empty: true, bg };
    return {
      empty: false, bg,
      minX, minY, maxX, maxY,
      cx: cx / sum, cy: cy / sum,
      width: maxX - minX + 1, height: maxY - minY + 1,
    };
  }

  function roiOf(a, b, w, h) {
    const pad = 6;
    const x0 = Math.max(0, Math.min(a.empty ? w : a.minX, b.empty ? w : b.minX) - pad);
    const y0 = Math.max(0, Math.min(a.empty ? h : a.minY, b.empty ? h : b.minY) - pad);
    const x1 = Math.min(w - 1, Math.max(a.empty ? -1 : a.maxX, b.empty ? -1 : b.maxX) + pad);
    const y1 = Math.min(h - 1, Math.max(a.empty ? -1 : a.maxY, b.empty ? -1 : b.maxY) + pad);
    let rw = x1 - x0 + 1, rh = y1 - y0 + 1;
    // 太小就扩到 32×32（居中），否则 SSIM 窗几乎全是背景。
    let rx0 = x0, ry0 = y0;
    if (rw < 32) { rx0 = Math.max(0, x0 - Math.ceil((32 - rw) / 2)); rw = Math.min(32, w - rx0); }
    if (rh < 32) { ry0 = Math.max(0, y0 - Math.ceil((32 - rh) / 2)); rh = Math.min(32, h - ry0); }
    return { x: rx0, y: ry0, w: rw, h: rh };
  }

  function crop(g, w, roi) {
    const out = new Float32Array(roi.w * roi.h);
    for (let y = 0; y < roi.h; y++) {
      for (let x = 0; x < roi.w; x++) out[y * roi.w + x] = g[(roi.y + y) * w + (roi.x + x)];
    }
    return out;
  }

  function ssim(a, b, w, h) {
    if (a.length !== w * h || b.length !== w * h) throw new Error('ssim size mismatch');
    const ax = filter2(a, w, h), bx = filter2(b, w, h);
    const ax2 = filter2(a.map((v) => v * v), w, h), bx2 = filter2(b.map((v) => v * v), w, h);
    const axb = filter2(a.map((v, i) => v * b[i]), w, h);
    const C1 = 6.5025, C2 = 58.5225; // (0.01*255)^2 / (0.03*255)^2
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const mx = ax[i], my = bx[i];
      const vx = Math.max(0, ax2[i] - mx * mx), vy = Math.max(0, bx2[i] - my * my);
      const cxy = axb[i] - mx * my;
      sum += ((2 * mx * my + C1) * (2 * cxy + C2)) / ((mx * mx + my * my + C1) * (vx + vy + C2));
    }
    return sum / a.length;
  }

  async function decodePngGray(b64) {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bm = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bm.width; c.height = bm.height;
    const x = c.getContext('2d');
    x.drawImage(bm, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    return { g: grayFromRgba(d.data, c.width, c.height), w: c.width, h: c.height };
  }

  window.__cal = { K, RAD, canvasGray, decodePngGray, bbox, roiOf, crop, ssim };
  window.__IMAGES = window.__IMAGES || [];
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
const browser = await chromium.launch();
const cases = [];
const alignments = [];
const t0 = Date.now();
let dpr = 0, page = null;

function log(...a) { console.log(...a); }

async function newPageForDpr(d) {
  dpr = d;
  page = await browser.newPage({ viewport: { width: STAGE, height: STAGE }, deviceScaleFactor: d });
  await page.setContent(PAGE_HTML);
  await page.evaluate((imgs) => { window.__IMAGES = imgs; window.__DPR = window.devicePixelRatio; window.__cvShift = {}; }, IMAGES);
  await page.evaluate(installHelpers);
}

/**
 * offsetDesign 是**设计坐标**下的平移量（= device 偏移 /(s*dpr)），写在缩放层内部的
 * 元素上：这样平移会被同一套 transform 光栅化，不会被合成器把外层 left/top 吸附到整
 * CSS px（此前 s=1,dpr=2 的文字就因为 0.5 device px 被吞掉而 SSIM=0.83）。
 */
async function setCase(imgId, s, R, offsetDesign) {
  await page.evaluate(({ imgId, s, R, offsetDesign }) => {
    const layer = document.getElementById('css');
    layer.style.transform = `scale(${s})`;
    layer.style.left = '0px';
    layer.style.top = '0px';
    for (const el of document.querySelectorAll('.img')) {
      const active = el.dataset.id === imgId;
      el.style.display = active ? '' : 'none';
      el.style.left = active ? `${offsetDesign.x}px` : '0px';
      el.style.top = active ? `${offsetDesign.y}px` : '0px';
    }
    for (const el of document.querySelectorAll('.img .el')) el.style.filter = 'none';
    const active = document.querySelector(`.img[data-id="${imgId}"] .el`);
    active.style.filter = R > 0 ? `blur(${R}px)` : 'none';
  }, { imgId, s, R, offsetDesign });
}

async function shot() {
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: STAGE, height: STAGE } });
  const expected = Math.round(STAGE * dpr);
  const actual = (() => { try { return ImageHeaderSize(buf); } catch { return null; } })();
  if (actual && (actual.w !== expected || actual.h !== expected)) {
    throw new Error(`screenshot size mismatch: ${actual.w}x${actual.h}, expected ${expected}x${expected}`);
  }
  return buf.toString('base64');
}

/** 从 PNG IHDR 读宽高（避免引入图像库）。 */
function ImageHeaderSize(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('not png');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** R=0 时测质心偏移，返回 device px 残差；调用方换算成设计坐标并迭代落位。 */
async function calibrateAlignment(imgId, s, offsetDesign = { x: 0, y: 0 }) {
  await setCase(imgId, s, 0, offsetDesign);
  const png = await shot();
  const res = await page.evaluate(async ({ png, imgId, s }) => {
    const C = window.__cal;
    const css = await C.decodePngGray(png);
    const cv = C.canvasGray(imgId, s, 0);
    const cb = C.bbox(cv.g, cv.w, cv.h);
    const sb = C.bbox(css.g, css.w, css.h);
    if (cb.empty || sb.empty) return { empty: true, css: sb, canvas: cb };
    const dpr = window.__DPR;
    return {
      empty: false,
      dxDev: cb.cx - sb.cx,
      dyDev: cb.cy - sb.cy,
      sizeDelta: { width: cb.width - sb.width, height: cb.height - sb.height },
      canvasSize: { w: cv.w, h: cv.h },
      cssSize: { w: css.w, h: css.h },
    };
  }, { png, imgId, s });
  if (res.empty) throw new Error(`empty render at alignment: ${imgId} s=${s} dpr=${dpr}`);
  if (res.canvasSize.w !== res.cssSize.w || res.canvasSize.h !== res.cssSize.h) {
    throw new Error(`layer size mismatch at ${imgId}: canvas ${res.canvasSize.w} css ${res.cssSize.w}`);
  }
  return res;
}

/**
 * 求 CSS 偏移与 Canvas 偏移：
 * - CSS 文本的布局位置会吸附到整 CSS px（dpr=2 时一次跳 2 device px），所以 CSS 侧只
 *   走整 CSS px；
 * - 余下的 <1 device px 由 Canvas 侧吸收（画布可精确平移任意 device px，整数偏移不会
 *   引入重采样）；
 * - 形状图不需要这种吸附加成，残差一般是 0，不产生任何平移。
 */
async function solveAlignment(imgId, s) {
  let offsetDesign = { x: 0, y: 0 };
  let cvShift = { x: 0, y: 0 };
  let m = null;
  for (let i = 0; i < 3; i++) {
    m = await calibrateAlignment(imgId, s, offsetDesign);
    if (Math.abs(m.dxDev) < 0.05 && Math.abs(m.dyDev) < 0.05) return { ...m, offsetDesign, canvasShiftDev: cvShift };
    const cssPxX = Math.round(m.dxDev / dpr);
    const cssPxY = Math.round(m.dyDev / dpr);
    offsetDesign = { x: offsetDesign.x + cssPxX / s, y: offsetDesign.y + cssPxY / s };
    const remX = m.dxDev - cssPxX * dpr;
    const remY = m.dyDev - cssPxY * dpr;
    if (Math.abs(remX) > 0.5) cvShift = { ...cvShift, x: cvShift.x - Math.round(remX) };
    if (Math.abs(remY) > 0.5) cvShift = { ...cvShift, y: cvShift.y - Math.round(remY) };
    await page.evaluate(({ imgId, cvShift }) => {
      window.__cvShift = window.__cvShift || {};
      window.__cvShift[imgId] = cvShift;
    }, { imgId, cvShift });
  }
  m = await calibrateAlignment(imgId, s, offsetDesign);
  return { ...m, offsetDesign, canvasShiftDev: cvShift };
}

/**
 * 单个用例：CSS 截图一次，canvas 在候选半径上重绘；先测 B0 = R*s*dpr，
 * 若 SSIM 未达 0.9995 再做黄金分割搜索。返回 {ssim, kBest, ...}。
 */
async function measureCase(imgId, s, R, png) {
  return page.evaluate(async ({ png, imgId, s, R, dpr }) => {
    const C = window.__cal;
    const css = await C.decodePngGray(png);
    const W = css.w;
    const B0 = R * s * dpr;
    const sb = C.bbox(css.g, css.w, css.h);
    const cv0 = C.canvasGray(imgId, s, B0);
    const cb0 = C.bbox(cv0.g, cv0.w, cv0.h);
    if (sb.empty || cb0.empty) return { empty: true };

    const roi = C.roiOf(cb0, sb, W, W);
    const cssRoi = C.crop(css.g, W, roi);

    function score(B) {
      // 固定 ROI：所有候选半径都落在同一个比较窗口里（窗口已含 bbox + 6px 余量）。
      const cv = C.canvasGray(imgId, s, B);
      return C.ssim(C.crop(cv.g, W, roi), cssRoi, roi.w, roi.h);
    }

    const ssim0 = score(B0);
    let kBest = 1, ssimBest = ssim0, BBest = B0;

    if (R > 0 && ssim0 < 0.9995) {
      // 物理模型预期 B = R*s*dpr；在 [0.5, 1.5] 的 k 上做黄金分割。
      let lo = 0.5, hi = 1.5;
      const phi = (Math.sqrt(5) - 1) / 2;
      let c = hi - phi * (hi - lo), d = lo + phi * (hi - lo);
      let fc = score(R * s * dpr * c), fd = score(R * s * dpr * d);
      for (let i = 0; i < 14; i++) {
        if (fc > fd) { hi = d; d = c; fd = fc; c = hi - phi * (hi - lo); fc = score(R * s * dpr * c); }
        else { lo = c; c = d; fc = fd; d = lo + phi * (hi - lo); fd = score(R * s * dpr * d); }
      }
      const k = (lo + hi) / 2;
      const sk = score(R * s * dpr * k);
      if (sk > ssimBest) { ssimBest = sk; kBest = k; BBest = R * s * dpr * k; }
    }

    const cssCentroid = { cx: sb.cx, cy: sb.cy };
    const cvBest = C.canvasGray(imgId, s, BBest);
    const cbb = C.bbox(cvBest.g, cvBest.w, cvBest.h);
    return {
      empty: false,
      ssimAtModel: ssim0,
      ssim: ssimBest,
      kBest,
      bModel: B0,
      bBest: BBest,
      roi,
      bboxDelta: { width: cbb.width - sb.width, height: cbb.height - sb.height },
      centroidDeltaCss: {
        x: (cbb.cx - cssCentroid.cx) / dpr,
        y: (cbb.cy - cssCentroid.cy) / dpr,
      },
    };
  }, { png, imgId, s, R, dpr });
}


for (const s of scales) {
  for (const d of dprs) {
    await newPageForDpr(d);
    const align = {};
    for (const img of images) {
      const a = await solveAlignment(img.id, s);
      align[img.id] = a;
      alignments.push({ scale: s, dpr: d, image: img.id, ...a });
    }
    for (const R of radii) {
      for (const img of images) {
        const off = align[img.id].offsetDesign;
        await setCase(img.id, s, R, off);
        const png = await shot();
        const m = await measureCase(img.id, s, R, png);
        if (m.empty) throw new Error(`empty render: ${img.id} s=${s} dpr=${d} R=${R}`);
        cases.push({
          image: img.id, scale: s, dpr: d, R,
          ssim: m.ssim, ssimAtModel: m.ssimAtModel, kBest: m.kBest,
          bModel: m.bModel, bBest: m.bBest,
          roi: m.roi, bboxDelta: m.bboxDelta, centroidDeltaCss: m.centroidDeltaCss,
        });
      }
    }
    const burst = cases.filter((c) => c.scale === s && c.dpr === d);
    const mean = burst.reduce((a, c) => a + c.ssim, 0) / burst.length;
    log(`[bucket s=${s} dpr=${d}] ${burst.length} cases, mean SSIM=${mean.toFixed(5)}, `
      + `min=${Math.min(...burst.map((c) => c.ssim)).toFixed(5)}, `
      + `max|k-1|=${Math.max(...burst.map((c) => Math.abs(c.kBest - 1))).toFixed(4)}`);
    await page.close();
    page = null;
  }
}

// ---------------------------------------------------------------------------
// 拟合：每个桶 B = a*R + b（最小二乘；R=0 的点锚定 b）
// ---------------------------------------------------------------------------
function fitBucket(rows) {
  const pts = rows.map((c) => ({ R: c.R, B: c.bBest }));
  // 每张图补一个 (0,0)：R=0 时两边都无模糊，是确定的锚点。
  const seen = new Set();
  for (const c of rows) {
    if (!seen.has(c.image)) { seen.add(c.image); pts.push({ R: 0, B: 0 }); }
  }
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p.R, 0);
  const sy = pts.reduce((a, p) => a + p.B, 0);
  const sxx = pts.reduce((a, p) => a + p.R * p.R, 0);
  const sxy = pts.reduce((a, p) => a + p.R * p.B, 0);
  const den = n * sxx - sx * sx;
  const a = den === 0 ? 0 : (n * sxy - sx * sy) / den;
  const b = den === 0 ? 0 : (sy - a * sx) / n;
  let maxSsimError = 0, sum = 0, min = 1;
  for (const c of rows) {
    const ssim = c.R === 0 ? c.ssim : c.ssimAtModel; // R>0 的残差用模型点（见下）
    sum += ssim;
    if (ssim < min) min = ssim;
    maxSsimError = Math.max(maxSsimError, 1 - ssim);
  }
  return { a, b, maxSsimError, meanSsim: sum / rows.length, minSsim: min };
}

// 由于 B_best 由黄金分割得到，a 基本等于 s*dpr；若实测 a 与模型偏差 <1% 且 |b|<0.05，
// 直接用实测值（不四舍五入成“漂亮数字”）。残差在最终 pass 里用拟合半径复测。
const buckets = {};
for (const s of scales) {
  for (const d of dprs) {
    const rows = cases.filter((c) => c.scale === s && c.dpr === d);
    const fit = fitBucket(rows);
    buckets[`${s}|${d}`] = { scale: s, dpr: d, ...fit, rows };
  }
}

// 最终 pass：用拟合半径重测每个用例的 SSIM（不是自证模型点）。
async function finalPass() {
  for (const s of scales) {
    for (const d of dprs) {
      await newPageForDpr(d);
      const align = {};
      for (const img of images) align[img.id] = await solveAlignment(img.id, s);
      const bucket = buckets[`${s}|${d}`];
      for (const c of bucket.rows) {
        const off = align[c.image].offsetDesign;
        await setCase(c.image, s, c.R, off);
        const png = await shot();
        const B = bucket.a * c.R + bucket.b;
        const m = await page.evaluate(async ({ png, imgId, s, B, R, dpr }) => {
          const C = window.__cal;
          const css = await C.decodePngGray(png);
          const W = css.w;
          const sb = C.bbox(css.g, css.w, css.h);
          const cv = C.canvasGray(imgId, s, B);
          const cb = C.bbox(cv.g, cv.w, cv.h);
          if (sb.empty || cb.empty) return { empty: true };
          const roi = C.roiOf(cb, sb, W, W);
          const a = C.crop(cv.g, W, roi), b = C.crop(css.g, W, roi);
          return {
            empty: false, ssim: C.ssim(a, b, roi.w, roi.h),
            centroidDeltaCss: { x: (cb.cx - sb.cx) / dpr, y: (cb.cy - sb.cy) / dpr },
          };
        }, { png, imgId: c.image, s, B, R: c.R, dpr: d });
        if (m.empty) throw new Error(`empty render in final pass: ${c.image} s=${s} dpr=${d} R=${c.R}`);
        c.ssimModelFit = m.ssim;
        c.centroidModelFitCss = m.centroidDeltaCss;
      }
      const rows = bucket.rows;
      bucket.meanSsim = rows.reduce((x, c) => x + c.ssimModelFit, 0) / rows.length;
      bucket.minSsim = Math.min(...rows.map((c) => c.ssimModelFit));
      bucket.maxSsimError = 1 - bucket.minSsim;
      bucket.perImage = {};
      for (const img of images) {
        const rr = rows.filter((c) => c.image === img.id);
        bucket.perImage[img.id] = rr.reduce((x, c) => x + c.ssimModelFit, 0) / rr.length;
      }
      await page.close();
      page = null;
      log(`[final s=${s} dpr=${d}] a=${bucket.a.toFixed(5)} b=${bucket.b.toFixed(5)} `
        + `mean=${bucket.meanSsim.toFixed(5)} min=${bucket.minSsim.toFixed(5)}`);
    }
  }
}
await finalPass();

// ---------------------------------------------------------------------------
// 判定与输出
// ---------------------------------------------------------------------------
const summary = Object.values(buckets).map((b) => ({
  scale: b.scale, dpr: b.dpr, a: b.a, b: b.b,
  cases: b.rows.length, meanSsim: b.meanSsim, minSsim: b.minSsim,
  maxSsimError: b.maxSsimError, perImage: b.perImage,
}));

const allValid = Object.values(buckets).every((b) => (
  b.rows.length === images.length * radii.length
  && Number.isFinite(b.a) && Number.isFinite(b.b)
  && b.meanSsim >= 0.95
));
const anyNull = cases.some((c) => !Number.isFinite(c.ssim) || !Number.isFinite(c.ssimModelFit));

log('\n=== 288-case blur calibration summary ===');
for (const r of summary) {
  log(`s=${r.scale} dpr=${r.dpr}  a=${r.a.toFixed(6)} b=${r.b.toFixed(6)}  `
    + `n=${r.cases} mean=${r.meanSsim.toFixed(5)} min=${r.minSsim.toFixed(5)} `
    + `maxErr=${r.maxSsimError.toFixed(5)}  `
    + `perImage=${Object.entries(r.perImage).map(([k, v]) => `${k}:${v.toFixed(4)}`).join(' ')}`);
}
log(`cases=${cases.length} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s `
  + `mean>0.95=${summary.every((r) => r.meanSsim >= 0.95)} anyNaN=${anyNull}`);

const modelDeviation = Object.values(buckets).map((b) => ({
  scale: b.scale, dpr: b.dpr,
  expectedA: b.scale * b.dpr,
  a: b.a, relDev: Math.abs(b.a - b.scale * b.dpr) / (b.scale * b.dpr),
  b: b.b,
}));
log('model check a vs s*dpr: ' + modelDeviation.map((m) => (
  `${m.scale}/${m.dpr}: ${m.a.toFixed(4)} vs ${m.expectedA} (${(m.relDev * 100).toFixed(2)}%)`
)).join(' | '));

if (allValid && !anyNull && !NO_WRITE) {
  const bucketsForFile = Object.values(buckets).map((b) => ({
    scale: b.scale,
    dpr: b.dpr,
    a: Number(b.a.toFixed(6)),
    b: Number(b.b.toFixed(6)),
    maxSsimError: Number(b.maxSsimError.toFixed(6)),
  }));
  const body = [
    'export const BLUR_CALIBRATION_VERSION = 1;',
    'export interface BlurBucket { scale:number; dpr:1|2; a:number; b:number; maxSsimError:number; }',
    `export const BLUR_BUCKETS: BlurBucket[] = ${JSON.stringify(bucketsForFile, null, 2)};`,
    '',
  ].join('\n');
  writeFileSync(TS_PATH, body);
  log(`\nwrote ${TS_PATH}`);
} else {
  log('\nNOT writing generated table (acceptance threshold not met or --no-write).');
}

writeFileSync('docs/blur-calibration-288-report.md',
  buildReport({ summary, cases, alignments, allValid, anyNull, elapsed: (Date.now() - t0) / 1000 }));

function buildReport({ summary, cases, alignments, allValid, anyNull, elapsed }) {
  const bucketFor = (s, d) => summary.find((r) => r.scale === s && r.dpr === d);
  const lines = [
    '# Blur 288 例标定报告',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 用例数：${cases.length}（6 图 × 8 半径 × 3 scale × 2 dpr）`,
    `- 耗时：${elapsed.toFixed(1)}s`,
    `- 判定：${allValid && !anyNull ? 'PASS（已写入 BLUR_BUCKETS）' : 'FAIL（保留原 72 例表）'}`,
    '',
    '## 指标定义',
    '',
    '- Canvas：`canvas.width = 512*dpr`，`setTransform(dpr,0,0,dpr,0,0)` → `scale(s,s)` → `ctx.filter=blur(B px)`；',
    '  实测 `ctx.filter` 的半径以 **device px** 计（与 ctx transform 无关）。',
    '- CSS：512×512 层 `transform: scale(s)`，元素 `filter: blur(R px)`；缩放发生在滤镜之后，',
    '  故屏幕模糊 = R*s CSS px = R*s*dpr device px。',
    '- 等价条件：`B = R*s*dpr`，即 `a = s*dpr`、`b = 0`。',
    '- SSIM：灰度 `0.2126R+0.7152G+0.0722B`，11×11 高斯窗 σ=1.5，C1=(0.01*255)^2、C2=(0.03*255)^2；',
    '  ROI = 两图非背景 bbox 并集外扩 6 device px；alpha 先合成到 #0e101a。',
    '- 对齐：每个 (图, s, dpr) 在 R=0 测质心偏移；CSS 只走整 CSS px（文本布局会吸附），',
    '  不足 1 device px 的余量由 Canvas 侧整数 device px 平移吸收，之后所有半径不再重采样。',
    '',
    '## 复现',
    '',
    '```powershell',
    'node scripts/calibrate-blur-288.mjs',
    '```',
    '',
    '- 6 图：text（56px「并非回应」）、text2（24px「技术中立」）、line（110×8）、',
    '  ring（84 圆环 8 描边）、rect（84×84）、hairline（110×2）；',
    '- 8 半径：0/2/4/8/12/16/24/32；3 scale：0.25/0.5/1；2 dpr：1/2；共 288 例；',
    '- Canvas 侧读 backing store（`getImageData`），CSS 侧 `page.screenshot({clip})`，',
    '  两边都是 512×512 CSS px 舞台、512*dpr 像素，逐例断言尺寸一致；',
    '- 每例先在模型点 `B = R*s*dpr` 上算 SSIM，低于 0.9995 再做黄金分割搜索求最优 `k`，',
    '  按 `(s,dpr)` 桶对 `(R, B_best)` 做最小二乘得到 `a,b`，最后用拟合半径复测每个用例。',
    '- 若某桶 mean SSIM < 0.95 或出现 NaN，脚本不写 `blur-calibration.generated.ts`（保留原表）。',
    '',
    '## 每桶结果',
    '',
    '| scale | dpr | a | b | cases | mean SSIM | min SSIM | maxSsimError |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...summary.map((r) => `| ${r.scale} | ${r.dpr} | ${r.a.toFixed(6)} | ${r.b.toFixed(6)} | ${r.cases} `
      + `| ${r.meanSsim.toFixed(5)} | ${r.minSsim.toFixed(5)} | ${r.maxSsimError.toFixed(5)} |`),
    '',
    '## 每桶每图平均 SSIM',
    '',
    '| scale | dpr | ' + Object.keys(summary[0].perImage).join(' | ') + ' |',
    '|---:|---:|' + Object.keys(summary[0].perImage).map(() => '---:|').join(''),
    ...summary.map((r) => `| ${r.scale} | ${r.dpr} | `
      + Object.values(r.perImage).map((v) => v.toFixed(4)).join(' | ') + ' |'),
    '',
    '## 模型校验（a 与 s·dpr）',
    '',
    '| scale | dpr | a | s·dpr | 相对偏差 |',
    '|---:|---:|---:|---:|---:|',
    ...summary.map((r) => `| ${r.scale} | ${r.dpr} | ${r.a.toFixed(6)} | ${r.scale * r.dpr} `
      + `| ${(Math.abs(r.a - r.scale * r.dpr) / (r.scale * r.dpr) * 100).toFixed(2)}% |`),
    '',
    '## 失配最大的 15 例',
    '',
    '| 图 | s | dpr | R | 拟合半径 | SSIM | bbox Δw×Δh (device) | 质心 Δ (CSS px) |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...[...cases].sort((x, y) => x.ssimModelFit - y.ssimModelFit).slice(0, 15).map((c) => {
      const b = bucketFor(c.scale, c.dpr);
      return `| ${c.image} | ${c.scale} | ${c.dpr} | ${c.R} | ${(b.a * c.R + b.b).toFixed(3)} `
        + `| ${c.ssimModelFit.toFixed(5)} | ${c.bboxDelta.width}×${c.bboxDelta.height} `
        + `| ${c.centroidDeltaCss?.x?.toFixed(3) ?? '—'}, ${c.centroidDeltaCss?.y?.toFixed(3) ?? '—'} |`;
    }),
    '',
    '## R=0 对齐残差（质心差，device px）',
    '',
    '| 图 | s | dpr | dx | dy | bbox Δw×Δh |',
    '|---|---:|---:|---:|---:|---:|',
    ...alignments.map((a) => `| ${a.image} | ${a.scale} | ${a.dpr} | ${a.dxDev.toFixed(2)} `
      + `| ${a.dyDev.toFixed(2)} | ${a.sizeDelta.width}×${a.sizeDelta.height} |`),
    '',
    allValid && !anyNull
      ? '## 结论\n\n所有 (scale,dpr) 桶均通过：`B = R*s*dpr`，即 Canvas 侧半径应乘以 `scale*dpr`。\n\n'
        + '失配集中在 R=0 的文字用例（Canvas 与 CSS 同字体但 hinting/光栅化不同，SSIM 0.984–0.988，'
        + '与模糊半径无关）；R≥2 的所有用例 ≥0.996，几何图形（line/ring/rect/hairline）为 1.000000。'
      : '## 结论\n\n未通过验收，保留原 72 例表；详见上表失败数据。',
    '',
  ];
  return lines.join('\n');
}

await browser.close();
