/**
 * 选区快照（PRD W3.1）。
 *
 * 为什么要有这一层：旧实现里"发消息时读一次选区、确认执行时再读一次选段"，
 * 中间用户改了选区，`intent_raw`（按旧选区解析）就会拿新 ID 去执行 —— 典型的
 * "我确认时改的是那三个片段，执行时改的是另外两个"。这里把**发送那一刻**的选区
 * 冻结成一份快照，预览与确认都用同一份。
 *
 * 两条上限（PRD 已定）：
 * - 最多 **20** 个片段：再多基本是误操作（全选），逐条喂模型既贵又抓不到重点；
 * - 摘要最多 **8000** 字符：按行组织，超了截断并标记 `truncated`（服务端会再次收口）。
 */
import type { Clip, ClipKind } from '@/types/timeline';

export const MAX_SELECTED_CLIPS = 20;
export const MAX_SELECTION_SUMMARY_CHARS = 8000;

export interface SelectionSnapshot {
  /** 冻结的 clip id（已截断到上限） */
  ids: string[];
  /** 给模型看的确定性摘要（每行一个 clip） */
  summary: string;
  /** 是否因为上限被截断（前端提示 + 服务端也知道不完整） */
  truncated: boolean;
  /** 总选中数（未截断前的原始数量，用于提示"只带了前 20 个"） */
  total: number;
}

function clipLine(clip: Clip, kind: ClipKind, index: number): string {
  const start = Number.isFinite(clip.start_sec) ? clip.start_sec.toFixed(2) : '?';
  const dur = Number.isFinite(clip.duration_sec) ? clip.duration_sec.toFixed(2) : '?';
  const bits: string[] = [`${index + 1}. id=${clip.id}`, `kind=${kind}`, `t=${start}s+${dur}s`];
  if (clip.track_id) bits.push(`track=${clip.track_id}`);
  const text = typeof clip.text === 'string' ? clip.text.trim() : '';
  if (text) bits.push(`text=${JSON.stringify(text.slice(0, 80))}`);
  if (clip.asset_id) bits.push(`asset=${clip.asset_id}`);
  if (clip.enabled === false) bits.push('disabled');
  return bits.join(' · ');
}

/**
 * 由"当前选中 + 当前时间线"生成快照。
 *
 * 注意：**只认能在这条时间线里找到的 clip**（找不到的说明是过期选区，
 * 不塞进摘要——否则模型会对着一个不存在的 id 动脑筋）。
 */
export function buildSelectionSnapshot(
  selectedIds: string[],
  timeline: { tracks: Array<{ kind: ClipKind; clips: Clip[] }> },
): SelectionSnapshot {
  const found: Array<{ clip: Clip; kind: ClipKind }> = [];
  for (const id of selectedIds) {
    for (const track of timeline.tracks) {
      const clip = track.clips.find((c) => c.id === id);
      if (clip) { found.push({ clip, kind: track.kind }); break; }
    }
  }
  const total = found.length;
  const capped = found.slice(0, MAX_SELECTED_CLIPS);
  const lines = capped.map((x, i) => clipLine(x.clip, x.kind, i));
  let summary = lines.join('\n');
  let truncated = total > capped.length;
  if (summary.length > MAX_SELECTION_SUMMARY_CHARS) {
    summary = summary.slice(0, MAX_SELECTION_SUMMARY_CHARS);
    truncated = true;
  }
  return {
    ids: capped.map((x) => x.clip.id),
    summary,
    truncated,
    total,
  };
}

/** 快照里带了几个片段之外，还能给用户一句人话提示（空选区返回空串）。 */
export function selectionHint(snap: SelectionSnapshot): string {
  if (snap.total === 0) return '';
  if (!snap.truncated) return `已带上所选 ${snap.total} 个片段`;
  return `选中 ${snap.total} 个片段，超过上限只带前 ${snap.ids.length} 个`;
}
