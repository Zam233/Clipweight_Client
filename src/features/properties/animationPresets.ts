/**
 * Animation presets — ready-made keyframe templates applied to a clip.
 * Property keys match the preview compositor's interpolation
 * (opacity / scale / position_x / position_y / rotation).
 */
import type { Keyframe } from '@/types/timeline';

export interface AnimationPreset {
  id: string;
  name: string;
  category: '入场' | '出场' | '强调' | '循环';
  icon: string;
  keyframes: Keyframe[];
}

export const ANIMATION_PRESETS: AnimationPreset[] = [
  {
    id: 'fade_in', name: '淡入', category: '入场', icon: '◐',
    keyframes: [
      { time: 0, properties: { opacity: 0 } },
      { time: 0.25, properties: { opacity: 1 }, easing: 'ease-out' },
    ],
  },
  {
    id: 'fade_out', name: '淡出', category: '出场', icon: '◑',
    keyframes: [
      { time: 0.75, properties: { opacity: 1 } },
      { time: 1, properties: { opacity: 0 }, easing: 'ease-in' },
    ],
  },
  {
    id: 'slide_up', name: '上滑入场', category: '入场', icon: '⬆',
    keyframes: [
      { time: 0, properties: { opacity: 0, position_y: 0.25 } },
      { time: 0.25, properties: { opacity: 1, position_y: 0 }, easing: 'ease-out-cubic' },
    ],
  },
  {
    id: 'slide_down', name: '下滑入场', category: '入场', icon: '⬇',
    keyframes: [
      { time: 0, properties: { opacity: 0, position_y: -0.25 } },
      { time: 0.25, properties: { opacity: 1, position_y: 0 }, easing: 'ease-out-cubic' },
    ],
  },
  {
    id: 'slide_left', name: '左滑入场', category: '入场', icon: '⬅',
    keyframes: [
      { time: 0, properties: { opacity: 0, position_x: 0.3 } },
      { time: 0.25, properties: { opacity: 1, position_x: 0 }, easing: 'ease-out-cubic' },
    ],
  },
  {
    id: 'zoom_in', name: '缩放进入', category: '入场', icon: '⊕',
    keyframes: [
      { time: 0, properties: { opacity: 0, scale: 0.6 } },
      { time: 0.3, properties: { opacity: 1, scale: 1 }, easing: 'ease-out-back' },
    ],
  },
  {
    id: 'zoom_out', name: '缩放退出', category: '出场', icon: '⊖',
    keyframes: [
      { time: 0.7, properties: { opacity: 1, scale: 1 } },
      { time: 1, properties: { opacity: 0, scale: 0.6 }, easing: 'ease-in-back' },
    ],
  },
  {
    id: 'pop', name: '弹出', category: '强调', icon: '✦',
    keyframes: [
      { time: 0, properties: { scale: 0.3, opacity: 0 } },
      { time: 0.2, properties: { scale: 1.15, opacity: 1 }, easing: 'ease-out-back' },
      { time: 0.35, properties: { scale: 1 }, easing: 'ease-in-out' },
    ],
  },
  {
    id: 'spin_in', name: '旋转入场', category: '入场', icon: '↻',
    keyframes: [
      { time: 0, properties: { opacity: 0, rotation: -90, scale: 0.5 } },
      { time: 0.35, properties: { opacity: 1, rotation: 0, scale: 1 }, easing: 'ease-out-cubic' },
    ],
  },
  {
    id: 'shake', name: '抖动', category: '强调', icon: '≈',
    keyframes: [
      { time: 0, properties: { position_x: 0 } },
      { time: 0.1, properties: { position_x: -0.02 } },
      { time: 0.2, properties: { position_x: 0.02 } },
      { time: 0.3, properties: { position_x: -0.015 } },
      { time: 0.4, properties: { position_x: 0.015 } },
      { time: 0.5, properties: { position_x: 0 } },
    ],
  },
  {
    id: 'pulse', name: '脉冲', category: '循环', icon: '◉',
    keyframes: [
      { time: 0, properties: { scale: 1 } },
      { time: 0.25, properties: { scale: 1.08 }, easing: 'ease-in-out' },
      { time: 0.5, properties: { scale: 1 }, easing: 'ease-in-out' },
      { time: 0.75, properties: { scale: 1.08 }, easing: 'ease-in-out' },
      { time: 1, properties: { scale: 1 }, easing: 'ease-in-out' },
    ],
  },
  {
    id: 'float', name: '漂浮', category: '循环', icon: '∿',
    keyframes: [
      { time: 0, properties: { position_y: 0 } },
      { time: 0.5, properties: { position_y: -0.03 }, easing: 'ease-in-out' },
      { time: 1, properties: { position_y: 0 }, easing: 'ease-in-out' },
    ],
  },
];

/** Deep-copy a preset's keyframes (so edits don't mutate the template). */
export function presetKeyframes(preset: AnimationPreset): Keyframe[] {
  return preset.keyframes.map((k) => ({
    time: k.time,
    properties: { ...k.properties },
    easing: k.easing,
  }));
}
