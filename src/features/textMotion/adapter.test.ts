import { describe, expect, it } from 'vitest';
import {
  draftFingerprint, motionArtifactOf, motionPreviewState, motionSpecOf,
  specSecondsToUi, uiEasingIndexToSpec, uiToSpecSeconds,
} from './adapter';
import type { Clip } from '@/types/timeline';

const spec = {
  schema: 'motion_spec/1', spec_id: 's1', duration_sec: 2,
  canvas: { width: 1920, height: 1080 }, requires: ['text'],
  layers: [{ id: 't', type: 'text', content: '测试', keyframes: [{ time: 0, opacity: 0 }] }],
};

const clip = (metadata: Record<string, unknown>): Clip => ({
  id: 'c', kind: 'text', asset_id: '', track_id: 't', start_sec: 0,
  duration_sec: 2, text: '测试', metadata,
} as Clip);

describe('motion adapter', () => {
  it('extracts only motion_spec/1', () => {
    expect(motionSpecOf({ motion_spec: spec })?.spec_id).toBe('s1');
    expect(motionSpecOf({ motion_spec: { ...spec, schema: 'motion_spec/2' } })).toBeNull();
  });
  it('fail-closed preview states', () => {
    expect(motionPreviewState(clip({ motion_spec: spec }))).toBe('spec_without_artifact');
    expect(motionPreviewState(clip({ motion_spec: spec, mg_def: { elements: [{}] } }))).toBe('ready');
    expect(motionPreviewState(clip({ motion_spec: { schema: 'bad' } }))).toBe('invalid_spec');
    expect(motionPreviewState(clip({}))).toBe('plain');
  });
  it('maps seconds and easing indices', () => {
    expect(specSecondsToUi(1, 2)).toBe(0.5);
    expect(uiToSpecSeconds(0.5, 2)).toBe(1);
    expect(uiEasingIndexToSpec(2)).toBe(1);
    expect(motionArtifactOf({ preview_ops: [{ kind: 'mg_def', fidelity: 'unsupported' }] }).fidelity)
      .toBe('unsupported');
    expect(draftFingerprint({ ...spec } as never)).toContain('motion_spec/1');
  });
});
