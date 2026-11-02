/**
 * MG 预览还原度台账（devplan T2.4）。
 *
 * 为什么要单独记：浏览器渲染 MG spec 与后端 Hyperframes/FFmpeg 成片**不可能 100% 一致**
 * （字体、滤镜、阴影、不支持的属性…）。与其假装一致，不如把"哪些 clip 只能近似"记下来，
 * 在预览头挂一个角标——用户看到角标就知道"这里别拿预览当准"，而不是等成片出来才发现。
 *
 * 纪律（PRD §5.4 / devplan T2.4）：
 * - 只有**真有差异**时才显示角标（默认不打扰）；
 * - 台账按 clip 维度存在内存里，切项目/卸载时清空；
 * - 不做任何网络上报。
 */
import { create } from 'zustand';
import { fidelityHasIssue, type MgFidelity } from './mgRenderer';

interface MgFidelityState {
  /** 有还原度问题的 clip 数 */
  clipCount: number;
  /** 具体问题（去重后的可读标签，最多 6 条） */
  labels: string[];
  /** clip asset_id → 上次上报的问题签名（避免每帧重复 set 造成重渲染风暴） */
  signatures: Record<string, string>;
  report: (assetId: string, fidelity: MgFidelity) => void;
  clear: () => void;
}

function labelsOf(fidelity: MgFidelity): string[] {
  const out: string[] = [];
  if (fidelity.missingSpec) out.push('缺少动画定义（只能显示占位）');
  if (fidelity.unsupportedTypes.length > 0) {
    out.push(`不支持的元素：${fidelity.unsupportedTypes.join('/')}`);
  }
  if (fidelity.blockedResources.length > 0) out.push('外部图片被拦截');
  if (fidelity.unknownEasings.length > 0) {
    out.push(`未知缓动：${fidelity.unknownEasings.slice(0, 3).join('/')}`);
  }
  return out;
}

export const useMgFidelityStore = create<MgFidelityState>((set, get) => ({
  clipCount: 0,
  labels: [],
  signatures: {},
  report: (assetId, fidelity) => {
    const has = fidelityHasIssue(fidelity);
    const labels = has ? labelsOf(fidelity) : [];
    const signature = labels.join('|');
    const prev = get().signatures[assetId] || '';
    // 签名没变就什么也不做：这个函数在合成循环里每帧都会被调用
    if (prev === signature) return;
    const signatures = { ...get().signatures, [assetId]: signature };
    const counts: Record<string, number> = {};
    for (const [id, sig] of Object.entries(signatures)) {
      if (!sig) continue;
      counts[id] = 1;
    }
    const clipCount = Object.keys(counts).length;
    set({ signatures, clipCount, labels });
  },
  clear: () => set({ clipCount: 0, labels: [], signatures: {} }),
}));

/** 合成循环里用的免 React 上报入口。 */
export function reportMgFidelity(assetId: string, fidelity: MgFidelity): void {
  useMgFidelityStore.getState().report(assetId, fidelity);
}

export function resetMgFidelity(): void {
  useMgFidelityStore.getState().clear();
}
