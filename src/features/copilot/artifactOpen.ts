/**
 * 产物的点击语义（用户 2026-10-31 定稿）。
 *
 * - 直接点击 → 在**应用内新开一个标签**打开（能用应用自己的渲染器看 md/图片/视频）；
 * - Ctrl/⌘ + 点击 → 交给**系统默认程序**打开（后端 `/api/workspace/reveal`）。
 *
 * 抽成独立模块而不是散在各组件里：产物入口有三处（时间线的产物条目、轨迹的产物区、
 * 事件流的报告路径），行为必须完全一致，否则用户会得到"有的能开、有的只复制路径"。
 */

import { useCopilotStore } from '@/stores/copilotStore';
import { workspaceApi } from '@/services/api/workspace';

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

/** 应用内打开：新开一个产物标签（同路径只聚焦，不重复开）。 */
export function openArtifactTab(path: string): void {
  const target = String(path || '').trim();
  if (!target) return;
  useCopilotStore.getState().openTab({
    id: `artifact:${target}`,
    kind: 'artifact',
    title: basename(target),
    closable: true,
    payload: { path: target },
  });
}

/** 系统打开：交给 OS 默认程序（失败由调用方提示，不吞）。 */
export async function openArtifactInSystem(path: string): Promise<void> {
  const target = String(path || '').trim();
  if (!target) return;
  await workspaceApi.reveal(target);
}

/**
 * 统一的产物点击处理器。
 *
 * React 的点击事件带 ctrlKey/metaKey，直接传进来即可；返回一个 Promise 方便调用方
 * `catch` 后提示（系统打开失败在过去会被静默吞掉，用户以为"点了没反应"）。
 */
export function handleArtifactClick(
  event: { ctrlKey?: boolean; metaKey?: boolean; preventDefault?: () => void; stopPropagation?: () => void },
  path: string,
): Promise<void> | void {
  const target = String(path || '').trim();
  if (!target) return;
  event.preventDefault?.();
  event.stopPropagation?.();
  if (event.ctrlKey || event.metaKey) {
    return openArtifactInSystem(target);
  }
  openArtifactTab(target);
  return undefined;
}
