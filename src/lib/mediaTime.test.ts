import { describe, it, expect } from 'vitest';
import {
  TICKS_PER_SECOND,
  exactTicksPerFrame,
  findAdjacencyIssues,
  formatTimecodeFromTicks,
  frameDistance,
  frameDuration,
  frameRateFps,
  frameRateName,
  frameStep,
  frameToSeconds,
  frameToTicks,
  fromFps,
  isFrameAligned,
  isNtsc,
  nominalFps,
  parseFrameRate,
  secondsToFrame,
  secondsToTicks,
  snapTicks,
  snapToFrame,
  ticksPerFrame,
  ticksToFrame,
  ticksToSeconds,
  timecodeToTicks,
} from './mediaTime';

const NTSC = '30000/1001';

describe('帧率', () => {
  it('整数优先吸附（30 不会变成 30000/1001）', () => {
    expect(frameRateName(fromFps(30))).toBe('30');
    expect(frameRateName(fromFps(24))).toBe('24');
  });

  it('习惯写法吸附到精确有理数', () => {
    expect(frameRateName(fromFps(29.97))).toBe('30000/1001');
    expect(frameRateName(fromFps(23.976))).toBe('24000/1001');
    expect(frameRateName(fromFps(23.98))).toBe('24000/1001');
    expect(frameRateName(fromFps(59.94))).toBe('60000/1001');
  });

  it('分数写法直接解析', () => {
    expect(parseFrameRate('30000/1001')).toEqual({ numerator: 30000, denominator: 1001 });
    expect(frameRateFps('30000/1001')).toBeCloseTo(29.97002997, 8);
  });

  it('非法输入回退 30', () => {
    expect(frameRateName(parseFrameRate('abc'))).toBe('30');
    expect(frameRateName(parseFrameRate(0))).toBe('30');
    expect(frameRateName(parseFrameRate(NaN))).toBe('30');
    expect(frameRateName(parseFrameRate(null))).toBe('30');
    expect(parseFrameRate('30/0')).toEqual({ numerator: 30, denominator: 1 });
  });

  it('非标准帧率用分数近似', () => {
    expect(frameRateName(fromFps(27.5))).toBe('55/2');
  });

  it('NTSC 判定与标称帧率', () => {
    expect(isNtsc(NTSC)).toBe(true);
    expect(nominalFps(NTSC)).toBe(30);
    expect(isNtsc('30')).toBe(false);
    expect(nominalFps('25')).toBe(25);
  });
});

describe('帧周期（tick）', () => {
  it('标准帧率帧周期表与后端一致', () => {
    const table: [string, number][] = [
      ['24', 5000], ['25', 4800], ['30', 4000], ['50', 2400], ['60', 2000],
      ['24000/1001', 5005], ['30000/1001', 4004], ['60000/1001', 2002], ['120000/1001', 1001],
    ];
    for (const [rate, expected] of table) {
      expect(ticksPerFrame(rate), rate).toBe(expected);
      expect(exactTicksPerFrame(rate), rate).toBe(expected);
    }
  });

  it('48000/1001 是非精确帧率（2502.5 → half-even 取 2502，与后端一致）', () => {
    expect(exactTicksPerFrame('48000/1001')).toBeNull();
    expect(ticksPerFrame('48000/1001')).toBe(2502);
  });

  it('frameDuration 等于精确帧周期（29.97 即 1001/30000 秒）', () => {
    expect(frameDuration(NTSC)).toBeCloseTo(4004 / TICKS_PER_SECOND, 12);
    expect(frameDuration('30')).toBeCloseTo(1 / 30, 12);
    // 100 帧累加 == 第 100 帧的起点（tick 相等，与浮点累加无关）
    expect(secondsToTicks(100 * frameDuration(NTSC))).toBe(secondsToTicks(frameToSeconds(100, NTSC)));
  });
});

describe('秒 ↔ tick', () => {
  it('消除浮点截断（与后端 Decimal 结果一致）', () => {
    expect(secondsToTicks(1.007)).toBe(120840);
    expect(Math.round(1.007 * TICKS_PER_SECOND)).toBe(120840); // 直乘后 round 也过
    expect(secondsToTicks(65 / 30)).toBe(260000);
    expect(secondsToTicks(1)).toBe(120000);
    expect(secondsToTicks(0)).toBe(0);
  });

  it('帧周期往返无损', () => {
    expect(secondsToTicks(1001 / 30000)).toBe(4004);
    expect(ticksToSeconds(4004)).toBeCloseTo(1001 / 30000, 12);
    expect(ticksToSeconds(180000)).toBe(1.5);
  });

  it('非有限输入按 0 处理', () => {
    expect(secondsToTicks(NaN)).toBe(0);
    expect(secondsToTicks(Infinity)).toBe(0);
  });
});

describe('帧换算与吸附', () => {
  it('帧号 ↔ 秒 ↔ tick', () => {
    expect(frameToTicks(3, NTSC)).toBe(12012);
    expect(ticksToFrame(12012, NTSC)).toBe(3);
    expect(ticksToFrame(12012 + 4003, NTSC)).toBe(3); // 帧内任意 tick 属于该帧
    expect(ticksToFrame(12012 + 4004, NTSC)).toBe(4);
    expect(frameToSeconds(30, NTSC)).toBeCloseTo(30 * 4004 / TICKS_PER_SECOND, 12);
    expect(secondsToFrame(1, 30)).toBe(30);
  });

  it('吸附三种模式', () => {
    expect(snapTicks(4005, NTSC, 'floor')).toBe(4004);
    expect(snapTicks(4005, NTSC, 'ceil')).toBe(8008);
    expect(snapTicks(4005, NTSC, 'nearest')).toBe(4004);
    expect(snapTicks(6007, NTSC, 'nearest')).toBe(8008);
    expect(snapTicks(4004, NTSC, 'nearest')).toBe(4004);
  });

  it('snapToFrame 落在帧边界上', () => {
    const snapped = snapToFrame(3.35, NTSC);
    expect(snapped).not.toBe(3.35);
    expect(isFrameAligned(snapped, NTSC)).toBe(true);
    expect(isFrameAligned(0.001, NTSC)).toBe(false);
  });

  it('frameDistance 给出帧数差', () => {
    expect(frameDistance(0, frameToSeconds(30, NTSC), NTSC)).toBe(30);
    expect(frameDistance(frameToSeconds(30, NTSC), 0, NTSC)).toBe(-30);
  });
});

describe('按帧步进（替换 Math.round(t*fps) ± 1）', () => {
  it('从帧边界步进 N 次落在第 N 帧起点（29.97）', () => {
    let t = 0;
    for (let i = 0; i < 100; i += 1) t = frameStep(t, NTSC, 1);
    expect(t).toBeCloseTo(100 * 4004 / TICKS_PER_SECOND, 12);
    expect(secondsToFrame(t, NTSC)).toBe(100);
    expect(isFrameAligned(t, NTSC)).toBe(true);
  });

  it('帧内位置前进到下一个帧边界（不跳帧）', () => {
    const midFrame = frameToSeconds(10, NTSC) + 0.6 * frameDuration(NTSC);
    expect(secondsToFrame(midFrame, NTSC)).toBe(10);
    expect(frameStep(midFrame, NTSC, 1)).toBeCloseTo(frameToSeconds(11, NTSC), 12);
  });

  it('帧内位置后退到当前帧起点（不跳过当前帧）', () => {
    const midFrame = frameToSeconds(10, NTSC) + 0.6 * frameDuration(NTSC);
    expect(frameStep(midFrame, NTSC, -1)).toBeCloseTo(frameToSeconds(10, NTSC), 12);
  });

  it('对比：Math.round(t*fps) ± 1 在帧内位置会多走一格', () => {
    const fps = 30000 / 1001;
    let mismatches = 0;
    for (let k = 1; k <= 1000; k += 1) {
      const midFrame = frameToSeconds(k, NTSC) + 0.6 * frameDuration(NTSC);
      const naive = (Math.round(midFrame * fps) + 1) / fps;
      if (secondsToFrame(naive, NTSC) !== k + 1) mismatches += 1;
    }
    expect(mismatches).toBe(1000); // 1000/1000 全部跳到了 k+2
    expect(secondsToFrame(frameStep(frameToSeconds(5, NTSC) + 0.6 * frameDuration(NTSC), NTSC, 1), NTSC)).toBe(6);
  });

  it('界限与零步进', () => {
    expect(frameStep(0, NTSC, -1)).toBe(0);
    expect(frameStep(frameToSeconds(1, 30), 30, -1)).toBe(0);
    expect(frameStep(frameToSeconds(10, 30), 30, 0)).toBeCloseTo(frameToSeconds(10, 30), 12);
    expect(frameStep(0.01, 30, 1)).toBeCloseTo(frameToSeconds(1, 30), 12);
  });
});

describe('时间码', () => {
  it('非 drop-frame（整数帧率）', () => {
    expect(formatTimecodeFromTicks(frameToTicks(0, 30), 30)).toBe('00:00:00:00');
    expect(formatTimecodeFromTicks(frameToTicks(1800, 30), 30)).toBe('00:01:00:00');
    expect(formatTimecodeFromTicks(frameToTicks(107892, 30), 30)).toBe('00:59:56:12');
  });

  it('NTSC 默认 drop-frame（与后端取值一致）', () => {
    expect(formatTimecodeFromTicks(frameToTicks(0, NTSC), NTSC)).toBe('00:00:00;00');
    expect(formatTimecodeFromTicks(frameToTicks(1800, NTSC), NTSC)).toBe('00:01:00;02');
    expect(formatTimecodeFromTicks(frameToTicks(17982, NTSC), NTSC)).toBe('00:10:00;00');
    expect(formatTimecodeFromTicks(frameToTicks(107892, NTSC), NTSC)).toBe('01:00:00;00');
  });

  it('可强制关掉 drop-frame', () => {
    expect(formatTimecodeFromTicks(frameToTicks(1800, NTSC), NTSC, { dropFrame: false }))
      .toBe('00:01:00:00');
  });

  it('时间码往返', () => {
    for (const [tc, rate] of [['00:00:00;00', NTSC], ['00:01:00;02', NTSC], ['00:10:00;00', NTSC],
      ['01:00:00;00', NTSC], ['00:00:00:00', 30], ['00:59:56:12', 30]] as [string, string | number][]) {
      const ticks = timecodeToTicks(tc, rate);
      expect(ticks, tc).not.toBeNull();
      expect(formatTimecodeFromTicks(ticks as number, rate), tc).toBe(tc);
    }
  });

  it('非法时间码返回 null', () => {
    expect(timecodeToTicks('1:2:3', 30)).toBeNull();
    expect(timecodeToTicks('aa:bb:cc:dd', 30)).toBeNull();
    expect(timecodeToTicks('00:00:00:30', 30)).toBeNull();
    expect(timecodeToTicks('00:60:00:00', 30)).toBeNull();
  });
});

describe('轨道相邻性（与后端同一判定）', () => {
  const clip = (start_sec: number, duration_sec: number) => ({ start_sec, duration_sec });

  it('严格相接不报问题', () => {
    expect(findAdjacencyIssues([clip(0, 5), clip(5, 5)])).toEqual([]);
  });

  it('浮点噪声不算间隙（tick 量化后恒等）', () => {
    expect(findAdjacencyIssues([clip(0.1, 0.2), clip(0.1 + 0.2 + 1e-13, 0.2)])).toEqual([]);
  });

  it('重叠与间隙各报一条', () => {
    const issues = findAdjacencyIssues([clip(0, 5), clip(4.5, 5), clip(11, 2)]);
    expect(issues.map((i) => i.kind)).toEqual(['overlap', 'gap']);
    expect(issues[0].deltaSeconds).toBeCloseTo(-0.5, 6);
    expect(issues[1].deltaSeconds).toBeCloseTo(1.5, 6);
  });

  it('无序输入先排序', () => {
    expect(findAdjacencyIssues([clip(5, 5), clip(0, 5)])).toEqual([]);
  });

  it('容差可放宽', () => {
    const clips = [clip(0, 5), clip(5.001, 5)];
    expect(findAdjacencyIssues(clips)).toHaveLength(1);
    expect(findAdjacencyIssues(clips, secondsToTicks(0.01))).toEqual([]);
  });
});
