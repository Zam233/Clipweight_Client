/**
 * 整数时间基座（前端侧，O1 第二阶段）
 *
 * 与后端 `clipwright/utils/timebase.py` **同一份语义**：整数 tick（120000/s）+ 有理数帧率。
 * 浮点秒只用于**边界**（DOM 时间、接口字段、展示文本），内部换算、相邻性判定、
 * 帧步进一律走整数 tick。
 *
 * 为什么要这么做（后端实测，脚本 `scripts/verify_timebase.py`）：
 * - `30000/1001` 帧率下，同一时间点经「上一段 start + duration」与「下一段 start」
 *   两条路径算出时，200000 个帧边界里有 **20.6% 不严格相等**——`===`/`<=` 判相邻全是近似；
 * - `Math.round(sec * 120000)` 之类的直乘在毫秒刻度上约 3.3%、帧刻度约 2.8% 的取值上
 *   会差 1 tick（`1.007 * 120000 = 120839.99999999999`），因此本模块用「直乘后
 *   先按 6 位小数规整再取整」的方式消除二进制噪声，与后端 `Decimal(repr(sec))` 一致。
 *
 * 用法约束：**不要在业务代码里散落 `* fps` / `/ fps`**，改用这里的
 * `secondsToTicks` / `ticksToSeconds` / `frameStep` / `snapToFrame`。
 */

/** 每秒 tick 数（与后端一致） */
export const TICKS_PER_SECOND = 120000;

/** 整数 tick 的时间值（branded type，避免与浮点秒互相误用） */
export type MediaTime = number & { readonly __mediaTime: true };

/** 有理数帧率 */
export interface FrameRate {
  numerator: number;
  denominator: number;
}

/** 标准帧率表（`fromFps` 的吸附目标；与后端 STANDARD_FRAME_RATES 一致） */
const STANDARD_FRAME_RATES: readonly FrameRate[] = [
  { numerator: 24000, denominator: 1001 }, // 23.976
  { numerator: 24, denominator: 1 },
  { numerator: 25, denominator: 1 },
  { numerator: 30000, denominator: 1001 }, // 29.97
  { numerator: 30, denominator: 1 },
  { numerator: 48000, denominator: 1001 }, // 47.952（帧周期非整数 tick）
  { numerator: 50, denominator: 1 },
  { numerator: 60000, denominator: 1001 }, // 59.94
  { numerator: 60, denominator: 1 },
  { numerator: 120000, denominator: 1001 }, // 119.88
  { numerator: 100, denominator: 1 },
  { numerator: 120, denominator: 1 },
  { numerator: 15, denominator: 1 },
  { numerator: 12, denominator: 1 },
  { numerator: 10, denominator: 1 },
];

const SNAP_REL_TOL = 1e-3;

/** 帧率（浮点或分数写法）→ 有理数帧率；非法输入回退 30 */
export function parseFrameRate(spec: number | string | FrameRate | null | undefined): FrameRate {
  if (spec == null) return { numerator: 30, denominator: 1 };
  if (typeof spec === 'object') return normalizeRate(spec);
  if (typeof spec === 'string') {
    const text = spec.trim();
    if (text.includes('/')) {
      const [num, den] = text.split('/');
      const n = Number(num);
      const d = Number(den);
      if (Number.isInteger(n) && Number.isInteger(d) && n > 0 && d > 0) {
        return { numerator: n, denominator: d };
      }
      return { numerator: 30, denominator: 1 };
    }
    return fromFps(Number(text));
  }
  return fromFps(spec);
}

/** 浮点帧率 → 有理数帧率；整数优先（否则 30 会被吸附成 30000/1001，相对差仅 0.0999%） */
export function fromFps(fps: number): FrameRate {
  if (!Number.isFinite(fps) || fps <= 0) return { numerator: 30, denominator: 1 };
  const nearestInt = Math.round(fps);
  if (nearestInt > 0 && Math.abs(fps - nearestInt) < 1e-9) {
    return { numerator: nearestInt, denominator: 1 };
  }
  let best: FrameRate = { numerator: 30, denominator: 1 };
  let bestDiff = Infinity;
  for (const candidate of STANDARD_FRAME_RATES) {
    const diff = Math.abs(frameRateFps(candidate) - fps) / Math.max(1e-9, frameRateFps(candidate));
    if (diff < bestDiff) {
      best = candidate;
      bestDiff = diff;
    }
  }
  if (bestDiff <= SNAP_REL_TOL) return best;
  // 非标准帧率：用一个足够精确的分数近似（与后端 limit_denominator 等价的做法）
  const den = 1000000;
  const num = Math.round(fps * den);
  return reduceRate({ numerator: num, denominator: den });
}

function normalizeRate(rate: FrameRate): FrameRate {
  const { numerator, denominator } = rate;
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator <= 0 || denominator <= 0) {
    return { numerator: 30, denominator: 1 };
  }
  return reduceRate(rate);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

function reduceRate(rate: FrameRate): FrameRate {
  const g = gcd(rate.numerator, rate.denominator);
  return { numerator: rate.numerator / g, denominator: rate.denominator / g };
}

/** 帧率浮点值（仅用于展示/兼容；内部换算请用 tick） */
export function frameRateFps(rate: number | string | FrameRate): number {
  const r = typeof rate === 'object' ? normalizeRate(rate) : parseFrameRate(rate);
  return r.numerator / r.denominator;
}

/** 紧凑名：`30000/1001` 或 `30` */
export function frameRateName(rate: number | string | FrameRate): string {
  const r = typeof rate === 'object' ? normalizeRate(rate) : parseFrameRate(rate);
  return r.denominator === 1 ? String(r.numerator) : `${r.numerator}/${r.denominator}`;
}

/** 是否为 1001 系（非整数）帧率 */
export function isNtsc(rate: number | string | FrameRate): boolean {
  const r = typeof rate === 'object' ? normalizeRate(rate) : parseFrameRate(rate);
  return r.denominator !== 1 && r.numerator % 1000 === 0;
}

/** 时间码标称帧率（29.97 → 30） */
export function nominalFps(rate: number | string | FrameRate): number {
  const r = typeof rate === 'object' ? normalizeRate(rate) : parseFrameRate(rate);
  return Math.round(r.numerator / r.denominator);
}

/** 帧周期的精确 tick 数；无法整除时返回 null（如 48000/1001） */
export function exactTicksPerFrame(rate: number | string | FrameRate): number | null {
  const r = typeof rate === 'object' ? normalizeRate(rate) : parseFrameRate(rate);
  const total = TICKS_PER_SECOND * r.denominator;
  return total % r.numerator === 0 ? total / r.numerator : null;
}

/** 帧周期 tick（不可整除时四舍五入；判精确性用 `exactTicksPerFrame`） */
export function ticksPerFrame(rate: number | string | FrameRate): number {
  const exact = exactTicksPerFrame(rate);
  if (exact !== null) return exact;
  const r = typeof rate === 'object' ? normalizeRate(rate) : parseFrameRate(rate);
  return roundHalfEven((TICKS_PER_SECOND * r.denominator) / r.numerator);
}

/** 四舍五入到整数（half-even），与 Python `round()` / 后端的取值一致 */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const remainder = value - floor;
  if (remainder > 0.5) return floor + 1;
  if (remainder < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

// ── 秒 ↔ tick ────────────────────────────────────────────

/**
 * 秒 → 整数 tick。
 *
 * `Math.round(sec * 120000)` 会因为二进制噪声少 1 tick（`1.007 → 120839`，应为 120840），
 * 这里先把乘积规整到 6 位小数再取整，与后端 `Decimal(repr(sec))` 的结果一致。
 * 非有限/负数一律按 0 处理（调用方需要判非法请自行校验）。
 */
export function secondsToTicks(seconds: number): MediaTime {
  if (!Number.isFinite(seconds)) return 0 as MediaTime;
  const raw = seconds * TICKS_PER_SECOND;
  const tidy = Number(raw.toFixed(6));
  return Math.round(tidy) as MediaTime;
}

/** 整数 tick → 秒 */
export function ticksToSeconds(ticks: MediaTime | number): number {
  return Math.trunc(ticks) / TICKS_PER_SECOND;
}

/** 帧号 → 该帧起点的 tick */
export function frameToTicks(frame: number, rate: number | string | FrameRate): MediaTime {
  return (Math.trunc(frame) * ticksPerFrame(rate)) as MediaTime;
}

/** tick → 帧号（向下取整：落在某帧内的任意 tick 都属于该帧） */
export function ticksToFrame(ticks: MediaTime | number, rate: number | string | FrameRate): number {
  return Math.floor(Math.trunc(ticks) / ticksPerFrame(rate));
}

/** 秒 → 帧号 */
export function secondsToFrame(seconds: number, rate: number | string | FrameRate): number {
  return ticksToFrame(secondsToTicks(seconds), rate);
}

/** 帧号 → 该帧起点的秒 */
export function frameToSeconds(frame: number, rate: number | string | FrameRate): number {
  return ticksToSeconds(frameToTicks(frame, rate));
}

/**
 * 一帧的时长（秒）。
 *
 * 替换 `1 / fps`：29.97 的帧周期是 `1001/30000`，`1/29.97` 与之不等，
 * 用它做步进/位移会逐次累积到偏离帧网格。
 */
export function frameDuration(rate: number | string | FrameRate): number {
  return ticksToSeconds(ticksPerFrame(rate));
}

/** 把 tick 吸附到帧边界（`floor` / `ceil` / `nearest`） */
export function snapTicks(
  ticks: MediaTime | number,
  rate: number | string | FrameRate,
  mode: 'floor' | 'ceil' | 'nearest' = 'nearest',
): MediaTime {
  const tpf = ticksPerFrame(rate);
  const value = Math.trunc(ticks);
  const quotient = Math.floor(value / tpf);
  const remainder = value - quotient * tpf;
  if (remainder === 0) return value as MediaTime;
  if (mode === 'floor') return (quotient * tpf) as MediaTime;
  if (mode === 'ceil') return ((quotient + 1) * tpf) as MediaTime;
  return (remainder * 2 <= tpf ? quotient * tpf : (quotient + 1) * tpf) as MediaTime;
}

/** 秒 → 最近的帧边界（秒）；切点/播放头对齐用 */
export function snapToFrame(
  seconds: number,
  rate: number | string | FrameRate,
  mode: 'floor' | 'ceil' | 'nearest' = 'nearest',
): number {
  return ticksToSeconds(snapTicks(secondsToTicks(seconds), rate, mode));
}

/** 秒是否正好落在帧边界上（按 tick 判定，不用 eps） */
export function isFrameAligned(seconds: number, rate: number | string | FrameRate): boolean {
  const tpf = ticksPerFrame(rate);
  return tpf > 0 && secondsToTicks(seconds) % tpf === 0;
}

/**
 * 按帧步进：移动 `delta` 帧并**落在帧边界上**，返回新的秒。
 *
 * 语义（与常见剪辑器一致）：
 * - 播放头已在帧边界：前进/后退各 `delta` 帧；
 * - 播放头在帧内（点击/拖拽/播放到一半的常态）：前进到**下一个**帧边界，
 *   后退到**当前帧**的起点——绝不会因为「离哪一端更近」而跳帧。
 *
 * 这是替换 `Math.round(t * fps) ± 1` 的原因：那个写法用的是**最近**帧，
 * 播放头在帧内时会连同「最近帧」本身的偏移一起多走一格——实测在 60% 帧内位置
 * 前进/后退各 1000 次，1000 次全部与真实相邻帧不符（见测试）。
 */
export function frameStep(seconds: number, rate: number | string | FrameRate, delta: number): number {
  const tpf = ticksPerFrame(rate);
  const ticks = secondsToTicks(seconds);
  const frame = Math.floor(ticks / tpf);
  const aligned = ticks % tpf === 0;
  let target: number;
  if (delta > 0) {
    target = frame + delta;
  } else if (delta < 0) {
    target = aligned ? frame + delta : frame;
  } else {
    target = frame;
  }
  return Math.max(0, ticksToSeconds((target * tpf) as MediaTime));
}

/** 两个时间点之间相差多少帧（正数表示 b 在后） */
export function frameDistance(
  a: number,
  b: number,
  rate: number | string | FrameRate,
): number {
  const tpf = ticksPerFrame(rate);
  return Math.round((secondsToTicks(b) - secondsToTicks(a)) / tpf);
}

// ── 时间码 ──────────────────────────────────────────────

export interface TimecodeOptions {
  /** 强制 drop-frame（默认：NTSC 系自动启用） */
  dropFrame?: boolean;
}

/**
 * 秒 → 时间码 `HH:MM:SS:FF`（drop-frame 用 `;` 分隔最后一组，与后端一致）。
 *
 * 非法输入返回 `00:00:00:00`（保持既有调用方语义）。
 */
export function formatTimecodeFromSeconds(
  seconds: number,
  rate: number | string | FrameRate = 30,
  options: TimecodeOptions = {},
): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00:00';
  return formatTimecodeFromTicks(secondsToTicks(seconds), rate, options);
}

/** tick → 时间码 */
export function formatTimecodeFromTicks(
  ticks: MediaTime | number,
  rate: number | string | FrameRate = 30,
  options: TimecodeOptions = {},
): string {
  const r = typeof rate === 'object' ? normalizeRate(rate) : parseFrameRate(rate);
  const nominal = nominalFps(r);
  const fps = r.numerator / r.denominator;
  let frame = ticksToFrame(ticks, r);
  const useDrop = options.dropFrame ?? isNtsc(r);

  if (useDrop) {
    const drop = Math.round(fps * 0.066666) || 2; // 29.97→2、59.94→4
    const framesPerMin = Math.round(fps * 60);
    const framesPer10Min = Math.round(fps * 600);
    const tenMin = Math.floor(frame / framesPer10Min);
    const rest = frame - tenMin * framesPer10Min;
    frame += drop * 9 * tenMin;
    if (rest > drop) frame += drop * Math.floor((rest - drop) / framesPerMin);
  }

  const totalSeconds = Math.floor(frame / nominal);
  const ff = frame % nominal;
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const sep = useDrop ? ';' : ':';
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${sep}${pad(ff)}`;
}

/** 时间码 → tick（`formatTimecodeFromTicks` 的逆）；非法返回 null */
export function timecodeToTicks(
  timecode: string,
  rate: number | string | FrameRate = 30,
  options: TimecodeOptions = {},
): MediaTime | null {
  if (typeof timecode !== 'string') return null;
  const text = timecode.trim();
  const parts = text.replace(/;/g, ':').split(':');
  if (parts.length !== 4) return null;
  const values = parts.map((p) => Number(p));
  if (values.some((v) => !Number.isInteger(v) || v < 0)) return null;
  const [hh, mm, ss, ff] = values;
  const r = typeof rate === 'object' ? normalizeRate(rate) : parseFrameRate(rate);
  const nominal = nominalFps(r);
  if (ss > 59 || mm > 59 || ff >= nominal) return null;
  const fps = r.numerator / r.denominator;
  let useDrop = options.dropFrame ?? isNtsc(r);
  if (text.includes(';')) useDrop = true;
  let frame = ((hh * 60 + mm) * 60 + ss) * nominal + ff;
  if (useDrop) {
    const drop = Math.round(fps * 0.066666) || 2;
    const totalMinutes = hh * 60 + mm;
    frame -= drop * (totalMinutes - Math.floor(totalMinutes / 10));
    if (frame < 0) return null;
  }
  return frameToTicks(frame, r);
}

// ── 轨道相邻性（与后端 Timeline.adjacency_issues 同一判定） ──

export interface AdjacencyEntry {
  kind: 'overlap' | 'gap';
  prevIndex: number;
  nextIndex: number;
  deltaTicks: MediaTime;
  deltaSeconds: number;
}

/**
 * 判断相邻片段是否严格相接（用整数 tick，不用浮点 eps）。
 *
 * 返回非空表示存在重叠/间隙。**相接**（`prev.start + prev.duration === next.start`
 * 在 tick 上成立）不产出条目——浮点秒在这里约 20% 会误判，见文件头说明。
 */
export function findAdjacencyIssues(
  clips: readonly { start_sec: number; duration_sec: number }[],
  toleranceTicks = 0,
): AdjacencyEntry[] {
  const sorted = clips
    .map((clip, index) => ({
      index,
      start: secondsToTicks(clip.start_sec),
      duration: secondsToTicks(clip.duration_sec),
    }))
    .sort((a, b) => a.start - b.start);
  const issues: AdjacencyEntry[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const delta = cur.start - (prev.start + prev.duration);
    if (Math.abs(delta) <= toleranceTicks) continue;
    issues.push({
      kind: delta < 0 ? 'overlap' : 'gap',
      prevIndex: prev.index,
      nextIndex: cur.index,
      deltaTicks: delta as MediaTime,
      deltaSeconds: ticksToSeconds(delta),
    });
  }
  return issues;
}
