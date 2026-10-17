/**
 * Timeline Diff — compares the current timeline against an Agent-proposed
 * timeline and produces a structured change list (added / removed / modified).
 * Powers the Agent co-pilot's "review changes before accepting" flow.
 */
import type { Timeline, Clip, Track } from '@/types/timeline';

export interface ModifiedClip {
  current: Clip;
  proposed: Clip;
  /** Field names that differ */
  fields: string[];
}

export interface TimelineDiff {
  addedClips: Clip[];
  removedClips: Clip[];
  modifiedClips: ModifiedClip[];
  /** True when nothing differs */
  isEmpty: boolean;
  /** Human-readable summary counts */
  summary: { added: number; removed: number; modified: number };
  /** P2-01: 提案时间线本体（mergeTimeline 采纳轨道级/时间线级变更用） */
  proposedTimeline?: Timeline;
}

/**
 * P1-05：改为「clip 全字段深比较（排除 id/track_id）」——旧白名单只有 14 个
 * 基础字段，keyframes/metadata（MG 的 mg_def/mg_html）/字幕样式/fx_* 等改动
 * 会被误判为「无差异」，用户既看不到也接受不了 Agent 的局部重做。
 */
// track_id 必须参与比较：mergeTimeline 的跨轨迁移依赖「track_id 不同 → modified」
const IGNORED_FIELDS = new Set(['id']);

const EPS = 0.001;

function clipFieldNames(a: Clip, b: Clip): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of IGNORED_FIELDS) keys.delete(k);
  return [...keys].sort();
}

function valuesDiffer(va: unknown, vb: unknown): boolean {
  if (typeof va === 'number' && typeof vb === 'number') {
    return Math.abs(va - vb) > EPS;
  }
  if (va === vb) return false;
  // 对象/数组（keyframes、metadata、样式组等）做稳定序列化比较
  try {
    return JSON.stringify(va) !== JSON.stringify(vb);
  } catch {
    return true;
  }
}

function fieldDiffers(a: Clip, b: Clip, field: string): boolean {
  return valuesDiffer(
    (a as unknown as Record<string, unknown>)[field],
    (b as unknown as Record<string, unknown>)[field],
  );
}

/** Index all clips in a timeline by id. */
function indexClips(tl: Timeline): Map<string, Clip> {
  const map = new Map<string, Clip>();
  for (const track of tl.tracks) {
    for (const clip of track.clips) {
      map.set(clip.id, clip);
    }
  }
  return map;
}

/**
 * Compute the diff from `current` to `proposed`.
 * Clips are matched by id; matched clips with differing fields are "modified".
 */
export function computeTimelineDiff(current: Timeline, proposed: Timeline): TimelineDiff {
  const cur = indexClips(current);
  const prop = indexClips(proposed);

  const addedClips: Clip[] = [];
  const removedClips: Clip[] = [];
  const modifiedClips: ModifiedClip[] = [];

  // Added + modified
  for (const [id, pClip] of prop) {
    const cClip = cur.get(id);
    if (!cClip) {
      addedClips.push(pClip);
      continue;
    }
    const fields = clipFieldNames(cClip, pClip).filter((f) => fieldDiffers(cClip, pClip, f));
    if (fields.length > 0) {
      modifiedClips.push({ current: cClip, proposed: pClip, fields });
    }
  }

  // Removed
  for (const [id, cClip] of cur) {
    if (!prop.has(id)) {
      removedClips.push(cClip);
    }
  }

  // Sort for stable display
  addedClips.sort((a, b) => a.start_sec - b.start_sec);
  removedClips.sort((a, b) => a.start_sec - b.start_sec);
  modifiedClips.sort((a, b) => a.current.start_sec - b.current.start_sec);

  return {
    addedClips,
    removedClips,
    modifiedClips,
    isEmpty: addedClips.length === 0 && removedClips.length === 0 && modifiedClips.length === 0,
    summary: {
      added: addedClips.length,
      removed: removedClips.length,
      modified: modifiedClips.length,
    },
    // P2-01: 携带提案本体（浅引用即可，merge 时只读级属性）
    proposedTimeline: proposed,
  };
}

/**
 * Merge only the selected changes from the proposed timeline into the current
 * one. `acceptIds` = clip ids to apply (added or modified); removals are
 * applied only for ids present in `removeIds`.
 */
export function mergeTimeline(
  current: Timeline,
  diff: TimelineDiff,
  acceptIds: Set<string>,
  removeIds: Set<string>,
): Timeline {
  const result: Timeline = structuredClone(current);

  // P2-01: 轨道级/时间线级变更一并采纳——旧实现只处理 clip 增删改，
  // Agent 的 markers/画幅/帧率与轨道属性（locked/muted/hidden/index）被忽略。
  // 仅在本次确有采纳内容时应用（acceptIds 或 removeIds 非空）。
  if (acceptIds.size > 0 || removeIds.size > 0) {
    const prop = diff.proposedTimeline;
    if (prop) {
      if (Array.isArray(prop.markers)) result.markers = structuredClone(prop.markers);
      if (typeof prop.width === 'number' && prop.width > 0) result.width = prop.width;
      if (typeof prop.height === 'number' && prop.height > 0) result.height = prop.height;
      if (typeof prop.fps === 'number' && prop.fps > 0) result.fps = prop.fps;
      for (const pt of prop.tracks) {
        const rt = result.tracks.find((t) => t.id === pt.id);
        if (!rt) continue;
        if (typeof pt.locked === 'boolean') rt.locked = pt.locked;
        if (typeof pt.muted === 'boolean') rt.muted = pt.muted;
        if (typeof pt.hidden === 'boolean') rt.hidden = pt.hidden;
        if (typeof pt.index === 'number') rt.index = pt.index;
        if (typeof pt.name === 'string' && pt.name) rt.name = pt.name;
      }
    }
  }

  // Apply removals
  if (removeIds.size > 0) {
    for (const track of result.tracks) {
      track.clips = track.clips.filter((c) => !removeIds.has(c.id));
    }
  }

  // Apply modifications
  for (const mod of diff.modifiedClips) {
    if (!acceptIds.has(mod.proposed.id)) continue;
    for (const track of result.tracks) {
      const idx = track.clips.findIndex((c) => c.id === mod.proposed.id);
      if (idx < 0) continue;

      if (track.id === mod.proposed.track_id) {
        // Same track: keep it in place but adopt proposed field values
        track.clips[idx] = { ...mod.proposed, track_id: track.id };
      } else {
        // Track migration: Agent moved the clip to a different track_id
        track.clips.splice(idx, 1);

        let target = result.tracks.find((t) => t.id === mod.proposed.track_id);
        if (!target) {
          // Agent 引入了新轨道 → 按片段类型创建一个最小轨道，避免静默丢弃片段
          target = {
            id: mod.proposed.track_id,
            name: `${mod.proposed.kind} ${result.tracks.length + 1}`,
            kind: mod.proposed.kind,
            index: result.tracks.length,
            clips: [],
            locked: false,
            muted: false,
          } satisfies Track;
          result.tracks.push(target);
        }
        target.clips.push(structuredClone(mod.proposed));
        target.clips.sort((a, b) => a.start_sec - b.start_sec);
      }
      break;
    }
  }

  // Apply additions
  for (const add of diff.addedClips) {
    if (!acceptIds.has(add.id)) continue;
    let track = result.tracks.find((t) => t.id === add.track_id);
    if (!track) {
      // Agent 引入了新轨道 → 按片段类型创建一个最小轨道，避免静默丢弃片段
      track = {
        id: add.track_id,
        name: `${add.kind} ${result.tracks.length + 1}`,
        kind: add.kind,
        index: result.tracks.length,
        clips: [],
        locked: false,
        muted: false,
      } satisfies Track;
      result.tracks.push(track);
    }
    track.clips.push(structuredClone(add));
  }

  // Recompute duration
  let maxEnd = 0;
  for (const track of result.tracks) {
    for (const clip of track.clips) {
      maxEnd = Math.max(maxEnd, clip.start_sec + clip.duration_sec);
    }
  }
  result.duration_sec = maxEnd;
  return result;
}
