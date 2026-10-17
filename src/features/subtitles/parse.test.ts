// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  alignCuesToFrames,
  assTimeToSec,
  detectSubtitleFormat,
  parseSubtitles,
  secToAssTime,
  summarizeParse,
} from './parse';

const SRT = `1
00:00:01,000 --> 00:00:03,500
第一句

2
00:00:04,000 --> 00:00:06,000
第二句
带上<b>标签</b>
`;

const ASS = `[Script Info]
Title: 示例
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,48

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\an8}第一句\\N换行
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,第二句，带逗号
`;

describe('detectSubtitleFormat', () => {
  it('扩展名优先', () => {
    expect(detectSubtitleFormat('a.srt', '')).toBe('srt');
    expect(detectSubtitleFormat('a.vtt', '')).toBe('vtt');
    expect(detectSubtitleFormat('a.ass', '')).toBe('ass');
    expect(detectSubtitleFormat('a.ssa', '')).toBe('ass');
  });

  it('无扩展名时按内容判断', () => {
    expect(detectSubtitleFormat('', SRT)).toBe('srt');
    expect(detectSubtitleFormat('', ASS)).toBe('ass');
    expect(detectSubtitleFormat('', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi')).toBe('vtt');
    expect(detectSubtitleFormat('', '随便一段文字')).toBe('unknown');
  });
});

describe('parseSubtitles · SRT/VTT', () => {
  it('解析基本 SRT 并剥离 HTML 标签', () => {
    const result = parseSubtitles(SRT, 'demo.srt');
    expect(result.format).toBe('srt');
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0]).toMatchObject({ start: 1, end: 3.5, text: '第一句' });
    expect(result.cues[1].text).toBe('第二句\n带上标签');
    // `<b>` 与 `</b>` 是两个标签，逐个计数
    expect(result.strippedTags).toBe(2);
    expect(result.warnings.some((w) => w.kind === 'skipped-tags')).toBe(true);
  });

  it('WebVTT 头与无序号 cue 都能解析', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n\n00:00:03.000 --> 00:00:04.000\nthere\n';
    const result = parseSubtitles(vtt, 'a.vtt');
    expect(result.format).toBe('vtt');
    expect(result.cues.map((c) => c.text)).toEqual(['hi', 'there']);
  });

  it('时间倒挂 / 空文本 / 无时间戳块都逐条告警并跳过', () => {
    const broken = `1
00:00:05,000 --> 00:00:02,000
倒挂

2
00:00:06,000 --> 00:00:07,000


3
这一块没有时间戳
`;
    const result = parseSubtitles(broken, 'b.srt');
    expect(result.cues).toHaveLength(0);
    const kinds = result.warnings.map((w) => w.kind);
    expect(kinds).toContain('reversed-time');
    expect(kinds).toContain('empty-text');
    expect(kinds).toContain('no-time');
    // 告警带行号，便于定位
    expect(result.warnings.every((w) => w.line === undefined || w.line > 0)).toBe(true);
  });
});

describe('parseSubtitles · ASS/SSA', () => {
  it('按 Format 行定位字段并解析对白（Text 含逗号也正确）', () => {
    const result = parseSubtitles(ASS, 'demo.ass');
    expect(result.format).toBe('ass');
    expect(result.cues).toHaveLength(2);
    expect(result.cues[0].start).toBe(1);
    expect(result.cues[0].end).toBe(3.5);
    expect(result.cues[0].text).toBe('第一句\n换行');   // {\an8} 被剥离、\N 还原为换行
    expect(result.cues[1].text).toBe('第二句，带逗号');
    expect(result.warnings.some((w) => w.kind === 'skipped-tags')).toBe(true);
  });

  it('没有 Format 行时按 SSA v4 默认字段顺序兜底', () => {
    const ssa = `[Events]
Dialogue: Marked=0,0:00:02.00,0:00:04.00,Default,,0,0,0,,无 Format 行
`;
    const result = parseSubtitles(ssa, 'x.ssa');
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0]).toMatchObject({ start: 2, end: 4, text: '无 Format 行' });
  });

  it('剥掉 {\...} 覆盖标签并统计数量', () => {
    const ass = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\pos(1,2)\\c&H00FF00&}彩色
`;
    const result = parseSubtitles(ass, 'c.ass');
    expect(result.cues[0].text).toBe('彩色');
    expect(result.strippedTags).toBe(1);
  });

  it('时间戳坏 / 倒挂 / 空对白都有告警', () => {
    const ass = `[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,坏,也坏,Default,,0,0,0,,坏时间
Dialogue: 0,0:00:05.00,0:00:02.00,Default,,0,0,0,,倒挂
Dialogue: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,
`;
    const result = parseSubtitles(ass, 'd.ass');
    expect(result.cues).toHaveLength(0);
    const kinds = result.warnings.map((w) => w.kind);
    expect(kinds).toContain('no-time');
    expect(kinds).toContain('reversed-time');
    expect(kinds).toContain('empty-text');
  });

  it('没有 [Events] 时给出明确告警', () => {
    const result = parseSubtitles('[Script Info]\nTitle: x\n', 'empty.ass');
    expect(result.cues).toHaveLength(0);
    expect(result.warnings[0].kind).toBe('no-events');
  });
});

describe('时间戳换算', () => {
  it('ASS 时间戳往返', () => {
    expect(assTimeToSec('0:00:01.50')).toBeCloseTo(1.5, 6);
    expect(assTimeToSec('1:02:03.04')).toBeCloseTo(3723.04, 6);
    expect(assTimeToSec('坏')).toBeNull();
    expect(secToAssTime(1.5)).toBe('0:00:01.50');
    expect(secToAssTime(3723.04)).toBe('1:02:03.04');
    for (const sec of [0, 1.5, 61.25, 3723.04]) {
      expect(assTimeToSec(secToAssTime(sec))).toBeCloseTo(sec, 2);
    }
  });

  it('未知格式返回空结果与告警（不抛错）', () => {
    const result = parseSubtitles('就是一段普通文字', 'readme.txt');
    expect(result.format).toBe('unknown');
    expect(result.cues).toEqual([]);
    expect(result.warnings[0].kind).toBe('no-events');
  });
});

describe('alignCuesToFrames', () => {
  it('cue 起止对齐到帧边界（29.97fps 下不再是小数噪声）', () => {
    const aligned = alignCuesToFrames(
      [{ index: 1, start: 1.0, end: 2.0, text: 'x' }], 30000 / 1001,
    );
    const rate = { numerator: 30000, denominator: 1001 };
    const tpf = 4004 / 120000;
    for (const cue of aligned) {
      const frames = cue.start / tpf;
      expect(Math.abs(frames - Math.round(frames))).toBeLessThan(1e-6);
    }
    expect(aligned[0].start).toBeGreaterThan(0.99);
    expect(aligned[0].end).toBeGreaterThan(aligned[0].start);
    expect(rate.numerator).toBe(30000);
  });

  it('极短 cue 至少保留一帧', () => {
    const aligned = alignCuesToFrames([{ index: 1, start: 1.5, end: 1.5001, text: 'x' }], 30);
    expect(aligned[0].end - aligned[0].start).toBeGreaterThanOrEqual(1 / 30 - 1e-9);
  });
});

describe('summarizeParse', () => {
  it('摘要含格式/条数/总时长', () => {
    const result = parseSubtitles(SRT, 'demo.srt');
    const text = summarizeParse(result);
    expect(text).toContain('SRT');
    expect(text).toContain('2 条');
    expect(text).toContain('4.5s');
  });
});
