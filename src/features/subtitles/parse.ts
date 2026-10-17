/**
 * 字幕导入解析（SRT / WebVTT / ASS / SSA）。
 *
 * 原先只有内联在工具栏里的 SRT/VTT 解析：**ASS 完全不支持**，畸形 cue 也只是静默丢弃
 * （用户看到"未解析到字幕条目"却不知道哪条坏了）。这里把解析独立成模块并补齐：
 * - 多格式识别（按扩展名 + 内容双重判断）；
 * - **逐条告警**：时间戳倒挂、空文本、越界块、被丢弃的样式标签数量——
 *   导入前就能看到"哪一条有问题"，而不是导入后才发现少了几句；
 * - 纯函数、无副作用，返回值可直接驱动「导入预览」UI。
 */
import { parseFrameRate, secondsToFrame, frameToSeconds, snapToFrame } from '@/lib/mediaTime';

export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'unknown';

export interface SubtitleCue {
  /** 源文件里的序号（ASS 用 Dialogue 行序） */
  index: number;
  /** 起止（秒） */
  start: number;
  end: number;
  text: string;
}

export interface SubtitleWarning {
  /** 源文件行号（1 基；能定位就带上） */
  line?: number;
  kind: 'no-time' | 'reversed-time' | 'empty-text' | 'out-of-range' | 'no-events' | 'skipped-tags';
  detail: string;
}

export interface SubtitleParseResult {
  format: SubtitleFormat;
  cues: SubtitleCue[];
  warnings: SubtitleWarning[];
  /** 被剥离的样式/覆盖标签总数（ASS 的 `{...}`、HTML 标签） */
  strippedTags: number;
}

const SRT_TIME_RE = /(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)/;
const ASS_TIME_RE = /^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,2})$/;

/** SRT/VTT 时间戳 → 秒 */
function srtTimeToSec(m: RegExpMatchArray | string[]): number {
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0').slice(0, 3) / 1000;
}

/** ASS 时间戳（`H:MM:SS.cc`，厘秒）→ 秒 */
export function assTimeToSec(value: string): number | null {
  const m = ASS_TIME_RE.exec(value.trim());
  if (!m) return null;
  const cs = +m[4].padEnd(2, '0').slice(0, 2);
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + cs / 100;
}

/** 秒 → ASS 时间戳（导出/往返测试用） */
export function secToAssTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const rem = cs - h * 360000;
  const m = Math.floor(rem / 6000);
  const rem2 = rem - m * 6000;
  const s = Math.floor(rem2 / 100);
  const c = rem2 - s * 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** 识别格式：扩展名优先，其次看内容特征 */
export function detectSubtitleFormat(filename: string, raw: string): SubtitleFormat {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (ext === 'ass' || ext === 'ssa') return 'ass';
  if (ext === 'vtt') return 'vtt';
  if (ext === 'srt') return 'srt';
  const head = raw.slice(0, 4000);
  if (/\[Script Info\]|\[Events\]/i.test(head) || /^Dialogue\s*:/im.test(head)) return 'ass';
  if (/^WEBVTT/i.test(head)) return 'vtt';
  if (SRT_TIME_RE.test(head)) return 'srt';
  return 'unknown';
}

/** 去掉 HTML 标签与 ASS 覆盖标签，并把 `\N` 还原成换行 */
function cleanText(text: string): { text: string; stripped: number } {
  let stripped = 0;
  let out = text
    .replace(/\{[^}]*\}/g, () => { stripped += 1; return ''; })
    .replace(/<[^>]+>/g, () => { stripped += 1; return ''; });
  out = out.replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
  return { text: out.trim(), stripped };
}

/** SRT / WebVTT 解析（沿用原先的块探测逻辑，补告警） */
function parseSrtLike(raw: string, format: SubtitleFormat): SubtitleParseResult {
  const warnings: SubtitleWarning[] = [];
  const cues: SubtitleCue[] = [];
  let strippedTags = 0;

  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks: { text: string; line: number }[] = [];
  let buffer: string[] = [];
  let bufferStart = 1;
  lines.forEach((line, i) => {
    if (line.trim() === '') {
      if (buffer.length > 0) {
        blocks.push({ text: buffer.join('\n'), line: bufferStart });
        buffer = [];
      }
      return;
    }
    if (buffer.length === 0) bufferStart = i + 1;
    buffer.push(line);
  });
  if (buffer.length > 0) blocks.push({ text: buffer.join('\n'), line: bufferStart });

  for (const block of blocks) {
    const blockLines = block.text.split('\n');
    if (/^WEBVTT/i.test(blockLines[0] ?? '')) continue;
    const timeIdx = blockLines.findIndex((l) => SRT_TIME_RE.test(l));
    if (timeIdx < 0) {
      // 只有含文字的无时间块才告警（纯序号行不算）
      if (blockLines.some((l) => l.trim() && !/^\d+$/.test(l.trim()))) {
        warnings.push({ line: block.line, kind: 'no-time', detail: `第 ${block.line} 行起的小节没有时间戳，已跳过` });
      }
      continue;
    }
    const m = blockLines[timeIdx].match(SRT_TIME_RE)!;
    const start = srtTimeToSec(m);
    const end = srtTimeToSec(m.slice(4));
    const cleaned = cleanText(blockLines.slice(timeIdx + 1).join('\n'));
    strippedTags += cleaned.stripped;
    const lineNo = block.line + timeIdx;
    if (end <= start) {
      warnings.push({ line: lineNo, kind: 'reversed-time', detail: `第 ${lineNo} 行时间倒挂（${start.toFixed(2)}s → ${end.toFixed(2)}s），已跳过` });
      continue;
    }
    if (!cleaned.text) {
      warnings.push({ line: lineNo, kind: 'empty-text', detail: `第 ${lineNo} 行的字幕文本为空，已跳过` });
      continue;
    }
    cues.push({ index: +blockLines[0] || cues.length + 1, start, end, text: cleaned.text });
  }
  if (strippedTags > 0) {
    warnings.push({ kind: 'skipped-tags', detail: `已剥离 ${strippedTags} 处样式标签（HTML/覆盖标签），成片按纯文本渲染` });
  }
  return { format, cues, warnings, strippedTags };
}

/** ASS / SSA 解析：读 `[Events]` 段的 Format 行按字段名定位 Start/End/Text */
function parseAss(raw: string): SubtitleParseResult {
  const warnings: SubtitleWarning[] = [];
  const cues: SubtitleCue[] = [];
  let strippedTags = 0;

  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let inEvents = false;
  let fields: string[] | null = null;

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (/^\[.*\]$/.test(trimmed)) {
      inEvents = /^\[events\]$/i.test(trimmed);
      return;
    }
    if (!inEvents || !trimmed) return;
    if (/^Format\s*:/i.test(trimmed)) {
      fields = trimmed.slice(trimmed.indexOf(':') + 1).split(',').map((f) => f.trim().toLowerCase());
      return;
    }
    if (!/^Dialogue\s*:/i.test(trimmed)) return;
    const payload = trimmed.slice(trimmed.indexOf(':') + 1);
    // Text 是最后一个字段且本身可能含逗号：用字段索引切分，只对前 N-1 个字段做 split
    const textIdx = fields ? fields.indexOf('text') : -1;
    let parts: string[];
    if (fields && textIdx >= 0) {
      parts = payload.split(',');
      if (parts.length > fields.length) {
        parts = [...parts.slice(0, textIdx), parts.slice(textIdx).join(',')];
      }
    } else {
      // 没有 Format 行：按 SSA v4 默认顺序 Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      const first = payload.split(',');
      parts = first.length >= 10 ? [...first.slice(0, 9), first.slice(9).join(',')] : first;
    }
    const startRaw = (parts[1] ?? '').trim();
    const endRaw = (parts[2] ?? '').trim();
    const start = assTimeToSec(startRaw);
    const end = assTimeToSec(endRaw);
    const cleaned = cleanText(parts[parts.length - 1] ?? '');
    strippedTags += cleaned.stripped;
    const lineNo = i + 1;
    if (start === null || end === null) {
      warnings.push({ line: lineNo, kind: 'no-time', detail: `第 ${lineNo} 行的 Dialogue 时间戳无法解析（"${startRaw}" / "${endRaw}"），已跳过` });
      return;
    }
    if (end <= start) {
      warnings.push({ line: lineNo, kind: 'reversed-time', detail: `第 ${lineNo} 行时间倒挂（${start.toFixed(2)}s → ${end.toFixed(2)}s），已跳过` });
      return;
    }
    if (!cleaned.text) {
      warnings.push({ line: lineNo, kind: 'empty-text', detail: `第 ${lineNo} 行的对白为空，已跳过` });
      return;
    }
    cues.push({ index: cues.length + 1, start, end, text: cleaned.text });
  });

  if (cues.length === 0 && warnings.length === 0) {
    warnings.push({ kind: 'no-events', detail: '文件里没有 [Events] 段的 Dialogue 行（可能不是 ASS/SSA 字幕）' });
  }
  if (strippedTags > 0) {
    warnings.push({ kind: 'skipped-tags', detail: `已剥离 ${strippedTags} 处 ASS 覆盖标签（{\\...}），成片按纯文本渲染` });
  }
  return { format: 'ass', cues, warnings, strippedTags };
}

/**
 * 解析字幕文件。
 *
 * `format === 'unknown'` 时不抛错，返回空 cues + `no-events` 级告警，由调用方提示用户。
 */
export function parseSubtitles(raw: string, filename = ''): SubtitleParseResult {
  const format = detectSubtitleFormat(filename, raw);
  if (format === 'ass') return parseAss(raw);
  if (format === 'srt' || format === 'vtt') return parseSrtLike(raw, format);
  return {
    format: 'unknown',
    cues: [],
    warnings: [{ kind: 'no-events', detail: '无法识别的字幕格式（支持 .srt / .vtt / .ass / .ssa）' }],
    strippedTags: 0,
  };
}

/**
 * 按帧率把 cue 对齐到帧边界（O1 的 tick 换算）。
 *
 * 用**最近帧**（而不是向下取整）：向下取整会让字幕比原稿早最多一帧出现，
 * 而字幕时间码本身就是"该出现的那一帧"的近似值。对齐后预览的
 * `showFramesInRuler`、播放头步进与后端 ASS 输出才对得齐；极短 cue 至少保留一帧。
 */
export function alignCuesToFrames(cues: SubtitleCue[], fps: number): SubtitleCue[] {
  const rate = parseFrameRate(fps);
  return cues.map((cue) => {
    const start = snapToFrame(cue.start, rate, 'nearest');
    const end = snapToFrame(cue.end, rate, 'nearest');
    const minEnd = frameToSeconds(secondsToFrame(start, rate) + 1, rate);
    return { ...cue, start, end: Math.max(end, minEnd) };
  });
}

/** 解析结果摘要（导入预览标题用） */
export function summarizeParse(result: SubtitleParseResult): string {
  const total = result.cues.reduce((s, c) => s + (c.end - c.start), 0);
  const label = result.format === 'unknown' ? '未知格式' : result.format.toUpperCase();
  return `${label} · ${result.cues.length} 条 · 共 ${total.toFixed(1)}s`;
}
