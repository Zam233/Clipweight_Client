/**
 * P0-05：persona 保存负载合并——UI 未映射的后端专有字段必须原样保留，
 * 不得被 schema 默认值静默重置。
 */
import { describe, it, expect } from 'vitest';
import { buildUpdatePayload, personaFromBackend, type Persona } from './persona';

// 模拟后端 manifest：包含一批前端 UI 模型不认识的专有字段
const RAW_MANIFEST = {
  persona_id: 'p1',
  persona_name: '测试人格',
  version: '2.0.0',
  owner_id: 'u9',
  inherits: 'base_p',
  created_at: '2026-01-01T00:00:00',
  prompt: '原始 prompt',
  vision_prompt: '原始视觉 prompt',
  parameter: {
    persona_id: 'p1',
    identity: {
      persona_id: 'p1',
      persona_name: '测试人格',
      version: '2.0.0',
      tone: 'warm_storyteller',
      positioning: '科技区UP主',
      class_perspective: '一线工程师视角',
      knowledge_domains: ['数码'],
    },
    language: {
      max_sentence_len: 20,
      variance_target: 0.4,
      academic_density: 0.3,
      slang_ratio: 0.1,
      forbidden_patterns: ['废话'],
      allowed_patterns: ['先说结论'],
    },
    rhythm: {
      cut_density_tier: 'high',
      base_shot_duration_ms: 2500,
      pause_frequency: 0.5,
      cut_profile: 'beat_sync',
    },
    visual: {
      primary_color: '#112233',
      accent_color: '#445566',
      background_color: '#ffffff',
      animation_style: 'mg_dynamic',
      animation_styles: ['title_reveal', 'data_bars'],
      transition_weights: { hard_cut: 0.4, dissolve: 0.6 },
    },
    audio: {
      voice_model: 'v_x',
      target_loudness_lufs: -14,
      subtitle_enabled: false,
      bgm_slots: { opening: ['a.mp3'], ending: ['b.mp3'] },
    },
    constraints: {
      max_duration_sec: 300,
      require_source_citation: true,
      forbidden_topics: ['政治'],
      min_duration_sec: 30,
    },
  },
};

const ui: Persona = personaFromBackend(RAW_MANIFEST);

describe('P0-05: buildUpdatePayload 保留后端专有字段', () => {
  it('UI 未映射的专有字段原样保留', () => {
    const payload = buildUpdatePayload(ui, RAW_MANIFEST) as Record<string, any>;
    const param = payload.parameter;
    expect(param.identity.class_perspective).toBe('一线工程师视角');
    expect(param.language.allowed_patterns).toEqual(['先说结论']);
    expect(param.rhythm.cut_profile).toBe('beat_sync');
    expect(param.visual.animation_styles).toEqual(['title_reveal', 'data_bars']);
    expect(param.audio.subtitle_enabled).toBe(false);
    expect(param.constraints.forbidden_topics).toEqual(['政治']);
    expect(param.constraints.min_duration_sec).toBe(30);
    // 多槽位 bgm_slots 不被一维数组覆盖
    expect(param.audio.bgm_slots).toEqual({ opening: ['a.mp3'], ending: ['b.mp3'] });
    // 顶层元数据保留
    expect(payload.version).toBe('2.0.0');
    expect(payload.owner_id).toBe('u9');
    expect(payload.inherits).toBe('base_p');
    expect(payload.vision_prompt).toBe('原始视觉 prompt');
  });

  it('UI 可编辑字段以 UI 值写回（映射到后端规范键名）', () => {
    const edited: Persona = {
      ...ui,
      persona_name: '改名',
      parameter: {
        ...ui.parameter,
        language: { ...ui.parameter.language, max_sentence_length: 33 },
        rhythm: { ...ui.parameter.rhythm, base_shot_duration_sec: 4 },
        audio: { ...ui.parameter.audio, loudness_target_lufs: -16 },
      },
    };
    const payload = buildUpdatePayload(edited, RAW_MANIFEST) as Record<string, any>;
    const param = payload.parameter;
    expect(payload.persona_name).toBe('改名');
    expect(param.identity.persona_name).toBe('改名');
    expect(param.language.max_sentence_len).toBe(33);
    expect(param.rhythm.base_shot_duration_ms).toBe(4000);
    expect(param.audio.target_loudness_lufs).toBe(-16);
  });

  it('UI undefined 的可选键不产生覆盖（保留 raw 原值）', () => {
    const minimal: Persona = personaFromBackend({ persona_id: 'p2', persona_name: 'x' });
    const payload = buildUpdatePayload(minimal, RAW_MANIFEST) as Record<string, any>;
    const wire = JSON.parse(JSON.stringify(payload));
    // minimal 的 forbidden_patterns / transition_weights 均为 undefined →
    // 不以 undefined/空值覆盖，wire 负载里保留 raw 原值。
    // （identity.tone/positioning/knowledge_domains 是表单字段、无条件回写，
    // 真实流程从同一 raw 加载再保存，无损。）
    expect(wire.parameter.language.forbidden_patterns).toEqual(['废话']);
    expect(wire.parameter.language.allowed_patterns).toEqual(['先说结论']);
    expect(wire.parameter.visual.transition_weights).toEqual({ hard_cut: 0.4, dissolve: 0.6 });
  });
});
