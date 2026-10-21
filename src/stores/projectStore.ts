import { create } from 'zustand';
import type { Persona } from '@/types/persona';

interface ProjectState {
  projectId: string | null;
  projectName: string;
  personaId: string | null;
  pluginId: string | null;
  personas: Persona[];
  isSaving: boolean;
  lastSavedAt: string | null;
  saveError: boolean;
  saveNonce: number;

  voiceId: string | null;
  autoDub: boolean;
  scriptText: string;
  videoMode: string;
  splitMode: string;
  audioPath: string;
  audioDurationSec: number;

  requirementsTopic: string;
  requirementsScript: string;
  requirementsAudioDuration: number;
  /** F-04：创作页的「视频提示词」（自由文本，随任务下发） */
  creativePrompt: string;
  /** F-04：提示词里的「不要什么」（映射到类型 anti_patterns / avoid） */
  creativeAvoid: string[];
  materialSourceIds: string[];
  dubSegments: Array<{ start: number; end: number; text: string }> | null;
  /** P8: dry-run 预览模式 — 管线只生成粗剪时间线，不执行动画/音频/质检 */
  dryRun: boolean;
  // P2-04: 踩点剪辑（beat-sync）——音色驱动的需求表单入口
  cutOnBeat: boolean;
  beatBpm: number | null;
  /**
   * D23 镜头节奏策略：`default`（跟随类型节奏——低于下限合并、高于上限切分，
   * 两者都保总时长）/ off / record / extend / loop。
   * 默认 `default` = **不显式下发**，由后端按它自己的默认（merge + split）执行。
   */
  shotFloorPolicy: string;

  // Actions
  setProjectId: (id: string | null) => void;
  setProjectName: (name: string) => void;
  setPersonaId: (id: string | null) => void;
  setPluginId: (id: string | null) => void;
  setPersonas: (personas: Persona[]) => void;
  setSaving: (saving: boolean) => void;
  setLastSaved: (at: string | null) => void;
  setSaveError: (error: boolean) => void;
  requestSave: () => void;
  setVoiceId: (id: string | null) => void;
  setAutoDub: (v: boolean) => void;
  setScriptText: (v: string) => void;
  setVideoMode: (v: string) => void;
  setSplitMode: (v: string) => void;
  setAudioPath: (v: string) => void;
  setAudioDurationSec: (v: number) => void;
  setRequirementsTopic: (v: string) => void;
  setRequirementsScript: (v: string) => void;
  setRequirementsAudioDuration: (v: number) => void;
  setCreativePrompt: (v: string) => void;
  setCreativeAvoid: (v: string[]) => void;
  setMaterialSourceIds: (ids: string[]) => void;
  setDubSegments: (segments: Array<{ start: number; end: number; text: string }> | null) => void;
  setDryRun: (v: boolean) => void;
  setCutOnBeat: (v: boolean) => void;
  setShotFloorPolicy: (v: string) => void;
  setBeatBpm: (v: number | null) => void;
  resetProject: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projectId: null,
  projectName: 'Untitled Project',
  personaId: null,
  pluginId: null,
  personas: [],
  isSaving: false,
  lastSavedAt: null,
  saveError: false,
  saveNonce: 0,

  voiceId: null,
  autoDub: true,
  scriptText: '',
  videoMode: 'voiceover',
  splitMode: 'period',
  audioPath: '',
  audioDurationSec: 0,

  requirementsTopic: '',
  requirementsScript: '',
  requirementsAudioDuration: 0,
  creativePrompt: '',
  creativeAvoid: [],
  materialSourceIds: [],
  dubSegments: null,
  dryRun: false,
  cutOnBeat: false,
  beatBpm: null,
  shotFloorPolicy: 'default',

  setProjectId: (id) => set({ projectId: id }),
  setProjectName: (name) => set({ projectName: name }),
  setPersonaId: (id) => set({ personaId: id }),
  setPluginId: (id) => set({ pluginId: id }),
  setPersonas: (personas) => set({ personas }),
  setSaving: (saving) => set({ isSaving: saving }),
  setLastSaved: (at) => set({ lastSavedAt: at }),
  setSaveError: (error) => set({ saveError: error }),
  requestSave: () => set((s) => ({ saveNonce: s.saveNonce + 1 })),
  setVoiceId: (id) => set({ voiceId: id }),
  setAutoDub: (v) => set({ autoDub: v }),
  setScriptText: (v) => set({ scriptText: v }),
  setVideoMode: (v) => set({ videoMode: v }),
  setSplitMode: (v) => set({ splitMode: v }),
  setAudioPath: (v) => set({ audioPath: v }),
  setAudioDurationSec: (v) => set({ audioDurationSec: v }),
  setRequirementsTopic: (v) => set({ requirementsTopic: v }),
  setRequirementsScript: (v) => set({ requirementsScript: v }),
  setRequirementsAudioDuration: (v) => set({ requirementsAudioDuration: v }),
  setCreativePrompt: (v) => set({ creativePrompt: v }),
  setCreativeAvoid: (v) => set({ creativeAvoid: v }),
  setMaterialSourceIds: (ids) => set({ materialSourceIds: ids }),
  setDubSegments: (segments) => set({ dubSegments: segments }),
  setDryRun: (v) => set({ dryRun: v }),
  setCutOnBeat: (v) => set({ cutOnBeat: v }),
  setBeatBpm: (v) => set({ beatBpm: v }),
  setShotFloorPolicy: (v) => set({ shotFloorPolicy: v }),
  resetProject: () =>
    set({
      projectId: null,
      projectName: 'Untitled Project',
      personaId: null,
      pluginId: null,
      isSaving: false,
      lastSavedAt: null,
      saveError: false,
      saveNonce: 0,
      voiceId: null,
      autoDub: true,
      scriptText: '',
      videoMode: 'voiceover',
      splitMode: 'period',
      audioPath: '',
      audioDurationSec: 0,
      requirementsTopic: '',
      requirementsScript: '',
      requirementsAudioDuration: 0,
      materialSourceIds: [],
      dubSegments: null,
      dryRun: false,
    }),
}));
