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

  // Actions
  setProjectId: (id: string | null) => void;
  setProjectName: (name: string) => void;
  setPersonaId: (id: string | null) => void;
  setPluginId: (id: string | null) => void;
  setPersonas: (personas: Persona[]) => void;
  setSaving: (saving: boolean) => void;
  setLastSaved: (at: string | null) => void;
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

  setProjectId: (id) => set({ projectId: id }),
  setProjectName: (name) => set({ projectName: name }),
  setPersonaId: (id) => set({ personaId: id }),
  setPluginId: (id) => set({ pluginId: id }),
  setPersonas: (personas) => set({ personas }),
  setSaving: (saving) => set({ isSaving: saving }),
  setLastSaved: (at) => set({ lastSavedAt: at }),
  resetProject: () =>
    set({
      projectId: null,
      projectName: 'Untitled Project',
      personaId: null,
      pluginId: null,
      isSaving: false,
      lastSavedAt: null,
    }),
}));
