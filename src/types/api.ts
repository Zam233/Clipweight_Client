/**
 * API types — request/response shapes for backend endpoints
 */

import type { Timeline } from './timeline';
import type { PipelineRequest, PipelineState } from './pipeline';
import type { Persona } from './persona';

// ── Health ──
export interface HealthResponse {
  status: string;
  service: string;
}

// ── Project ──
export interface Project {
  id: string;
  name: string;
  timeline: Timeline;
  created_at: string;
  updated_at: string;
  persona_id?: string;
  plugin_id?: string;
}

export interface ProjectSaveRequest {
  id?: string;
  name: string;
  timeline: Timeline;
  persona_id?: string;
  plugin_id?: string;
}

// ── Asset ──
export interface Asset {
  id: string;
  filename: string;
  path: string;
  kind: 'video' | 'audio' | 'image' | 'text';
  duration_sec?: number;
  width?: number;
  height?: number;
  thumbnail_url?: string;
  tags: string[];
  created_at: string;
}

export interface AssetUploadResponse {
  id: string;
  filename: string;
  path: string;
  kind: string;
  asset_id?: string;
  file_path?: string;
  media_type?: string;
  duration_sec?: number;
}

export interface MaterialSearchRequest {
  query: string;
  source?: string;
  limit?: number;
  offset?: number;
}

export interface MaterialSearchResult {
  id: string;
  title: string;
  url: string;
  thumbnail?: string;
  duration_sec?: number;
  score: number;
  source: string;
  reason?: string;
}

// ── Render ──
export interface ExportSettings {
  preset: string;
  width: number;
  height: number;
  fps: number;
  bitrate: string;
}

export interface RenderRequest {
  timeline: Timeline;
  output_path: string;
  audio_file_path?: string;
  bgm_file_path?: string;
  settings: ExportSettings;
}

export interface RenderProgress {
  task_id: string;
  status: 'pending' | 'rendering' | 'completed' | 'failed';
  progress: number;
  phase?: string;
  detail?: string;
}

export interface RenderPreset {
  id?: string;
  name: string;
  label?: string;
  width: number;
  height: number;
  fps: number;
  bitrate: string;
  icon?: string;
}

// ── Plugin ──
export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  loaded: boolean;
}

// ── Animation ──
export interface AnimationDef {
  id: string;
  name: string;
  category: 'onscreen' | 'text' | 'transition';
  description: string;
  params: Record<string, unknown>;
}

// ── Requirements ──
export interface RequirementsInitRequest {
  topic?: string;
  persona_id?: string;
  category_plugin_id?: string;
  script_text?: string;
  audio_duration_sec?: number;
  extra?: Record<string, unknown>;
}

export interface RequirementsChatRequest {
  session_id: string;
  message: string;
}

// ── Persona Forge ──
export interface PersonaForgeChatStartRequest {
  description?: string;
}

export interface PersonaForgeChatMessageRequest {
  session_id: string;
  message: string;
}

export interface PersonaForgeCommitRequest {
  session_id: string;
  persona_name: string;
}

// ── Edit Session ──
export interface EditSession {
  id: string;
  timeline: Timeline;
  history: EditHistoryEntry[];
}

export interface EditHistoryEntry {
  id: string;
  message: string;
  action: string;
  result: string;
  timestamp: string;
}

// ── Re-export for convenience ──
export type { Timeline, PipelineRequest, PipelineState, Persona };

// ── Plugin Config ──
export interface PluginConfigField {
  type: 'string' | 'int' | 'float' | 'bool' | 'dict' | 'list';
  value: unknown;
  label: string;
  description?: string;
}

export interface PluginConfigResponse {
  fields: Record<string, PluginConfigField>;
}
