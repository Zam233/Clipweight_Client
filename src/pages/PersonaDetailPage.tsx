import { useEffect, useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { personaApi } from '@/services/api';
import { StandardLayout } from '@/layouts/StandardLayout';
import { Button, Badge, Slider } from '@/components/ui';
import type { Persona } from '@/types/persona';
import {
  ArrowLeft, Save, SlidersHorizontal, FileText, Database, GitBranch,
  Fingerprint, MessageSquareText, Timer, Palette, Music, ShieldCheck,
} from 'lucide-react';

type Tab = 'params' | 'prompt' | 'knowledge' | 'versions';

const TABS: { id: Tab; label: string; icon: typeof SlidersHorizontal }[] = [
  { id: 'params', label: '参数层', icon: SlidersHorizontal },
  { id: 'prompt', label: 'Prompt', icon: FileText },
  { id: 'knowledge', label: '知识库', icon: Database },
  { id: 'versions', label: '继承与版本', icon: GitBranch },
];

/**
 * PersonaDetailPage — edit a persona's four layers. The Parameter tab is a
 * visual form bound to the YAML-backed parameter layer.
 */
export function PersonaDetailPage() {
  const { personaId } = useParams({ from: '/persona/$personaId' });
  const navigate = useNavigate();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [tab, setTab] = useState<Tab>('params');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await personaApi.get(personaId);
        if (alive) { setPersona(p); setPrompt(p.prompt ?? ''); }
      } catch {
        // Offline: construct an editable shell
        if (alive) setPersona(makeShell(personaId));
      }
    })();
    return () => { alive = false; };
  }, [personaId]);

  const save = async () => {
    if (!persona) return;
    setSaving(true);
    try { await personaApi.update(persona.persona_id, { ...persona, prompt }); } catch { /* offline */ }
    setTimeout(() => setSaving(false), 400);
  };

  const setParam = (updater: (p: Persona) => Persona) => {
    setPersona((prev) => (prev ? updater(prev) : prev));
  };

  if (!persona) {
    return <StandardLayout title="人格详情"><p className="text-on-surface-variant">加载中…</p></StandardLayout>;
  }

  const P = persona.parameter;

  return (
    <StandardLayout title={persona.persona_name}>
      <button onClick={() => navigate({ to: '/persona' })}
        className="flex items-center gap-1.5 text-label-sm text-on-surface-variant hover:text-primary transition-colors mb-5 cursor-pointer">
        <ArrowLeft className="w-3.5 h-3.5" /> 返回人格库
      </button>

      {/* tabs */}
      <div className="flex gap-1 border-b border-outline-variant/30 mb-6 max-w-[900px]">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-label-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
              tab === id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="max-w-[900px]">
        {tab === 'params' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Section icon={<Fingerprint className="w-4 h-4" />} title="身份 Identity">
              <TextField label="人格名称" value={persona.persona_name}
                onChange={(v) => setParam((p) => ({ ...p, persona_name: v, parameter: { ...p.parameter, identity: { ...p.parameter.identity, persona_name: v } } }))} />
              <TextField label="定位" value={P.identity.positioning ?? ''}
                onChange={(v) => setParam((p) => ({ ...p, parameter: { ...p.parameter, identity: { ...p.parameter.identity, positioning: v } } }))} />
              <TextField label="语气 tone" value={P.identity.tone}
                onChange={(v) => setParam((p) => ({ ...p, parameter: { ...p.parameter, identity: { ...p.parameter.identity, tone: v } } }))} />
            </Section>

            <Section icon={<MessageSquareText className="w-4 h-4" />} title="语言 Language">
              <Slider label="句长上限" min={8} max={50} value={P.language.max_sentence_length ?? 25}
                onChange={(v) => setParam((p) => ({ ...p, parameter: { ...p.parameter, language: { ...p.parameter.language, max_sentence_length: v } } }))} />
              <Slider label="学术密度" min={0} max={1} step={0.05} value={P.language.academic_density ?? 0.5}
                onChange={(v) => setParam((p) => ({ ...p, parameter: { ...p.parameter, language: { ...p.parameter.language, academic_density: v } } }))} />
              <Slider label="口语比例" min={0} max={1} step={0.05} value={P.language.slang_ratio ?? 0.3}
                onChange={(v) => setParam((p) => ({ ...p, parameter: { ...p.parameter, language: { ...p.parameter.language, slang_ratio: v } } }))} />
            </Section>

            <Section icon={<Timer className="w-4 h-4" />} title="节奏 Rhythm">
              <div>
                <label className="block text-label text-on-surface-variant mb-1.5">剪切密度</label>
                <div className="flex gap-1.5">
                  {(['low', 'medium', 'high', 'extreme'] as const).map((tier) => (
                    <button key={tier}
                      onClick={() => setParam((p) => ({ ...p, parameter: { ...p.parameter, rhythm: { ...p.parameter.rhythm, cut_density_tier: tier } } }))}
                      className={`flex-1 px-2 py-1.5 rounded-cw-xs text-label-sm border transition-colors cursor-pointer ${
                        (P.rhythm.cut_density_tier ?? 'medium') === tier
                          ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
                      }`}>
                      {{ low: '低', medium: '中', high: '高', extreme: '极高' }[tier]}
                    </button>
                  ))}
                </div>
              </div>
              <Slider label="基础镜头" min={1} max={20} value={P.rhythm.base_shot_duration_sec ?? 6}
                onChange={(v) => setParam((p) => ({ ...p, parameter: { ...p.parameter, rhythm: { ...p.parameter.rhythm, base_shot_duration_sec: v } } }))} />
            </Section>

            <Section icon={<Palette className="w-4 h-4" />} title="视觉 Visual">
              <TextField label="动画风格" value={P.visual.animation_style ?? ''}
                onChange={(v) => setParam((p) => ({ ...p, parameter: { ...p.parameter, visual: { ...p.parameter.visual, animation_style: v } } }))} />
              <div className="flex gap-3">
                <ColorField label="主色" value={P.visual.color_palette?.primary ?? '#1a1a2e'}
                  onChange={(v) => setParam((p) => ({ ...p, parameter: { ...p.parameter, visual: { ...p.parameter.visual, color_palette: { ...p.parameter.visual.color_palette, primary: v } } } }))} />
                <ColorField label="强调色" value={P.visual.color_palette?.accent ?? '#e94560'}
                  onChange={(v) => setParam((p) => ({ ...p, parameter: { ...p.parameter, visual: { ...p.parameter.visual, color_palette: { ...p.parameter.visual.color_palette, accent: v } } } }))} />
              </div>
            </Section>

            <Section icon={<Music className="w-4 h-4" />} title="音频 Audio">
              <Slider label="响度 LUFS" min={-24} max={-8} value={P.audio.loudness_target_lufs ?? -16}
                onChange={(v) => setParam((p) => ({ ...p, parameter: { ...p.parameter, audio: { ...p.parameter.audio, loudness_target_lufs: v } } }))} />
              <TextField label="声音克隆模型" value={P.audio.voice_clone_model_id ?? '（未绑定）'}
                onChange={(v) => setParam((p) => ({ ...p, parameter: { ...p.parameter, audio: { ...p.parameter.audio, voice_clone_model_id: v } } }))} />
            </Section>

            <Section icon={<ShieldCheck className="w-4 h-4" />} title="约束 Constraints">
              <Slider label="最长时长(s)" min={60} max={3600} step={30} value={P.constraints.max_duration_sec ?? 900}
                onChange={(v) => setParam((p) => ({ ...p, parameter: { ...p.parameter, constraints: { ...p.parameter.constraints, max_duration_sec: v } } }))} />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={P.constraints.source_citation_required ?? false}
                  onChange={(e) => setParam((p) => ({ ...p, parameter: { ...p.parameter, constraints: { ...p.parameter.constraints, source_citation_required: e.target.checked } } }))}
                  className="w-4 h-4 accent-primary" />
                <span className="text-label-sm text-on-surface">要求注明来源</span>
              </label>
            </Section>
          </div>
        )}

        {tab === 'prompt' && (
          <div>
            <p className="text-label-sm text-on-surface-variant mb-2">系统 Prompt（注入 Agent 的人格指令）</p>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={14}
              placeholder="你是「扎姆」，一个批判型知识区 UP 主……"
              className="w-full bg-surface-container rounded-cw-md px-4 py-3 text-body-sm font-mono text-on-surface
                outline-none border border-outline-variant/30 focus:border-primary resize-y leading-relaxed" />
          </div>
        )}

        {tab === 'knowledge' && (
          <div className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-8 text-center">
            <Database className="w-8 h-8 text-on-surface-variant/40 mx-auto mb-2" />
            <p className="text-body-sm text-on-surface font-medium">RAG 知识库</p>
            <p className="text-label-sm text-on-surface-variant mt-1 mb-4">上传 .md / .txt 文档，向量化后供 Agent 检索创作者私有知识。</p>
            <Button variant="outline" size="sm">上传文档并建立索引</Button>
          </div>
        )}

        {tab === 'versions' && (
          <div className="space-y-2">
            {[
              { v: persona.version, date: '当前', note: '最新参数' },
              { v: '2.2.0', date: '2026-06-12', note: '调整剪切密度为 medium' },
              { v: '2.1.0', date: '2026-05-30', note: '新增强调色配置' },
            ].map((ver) => (
              <div key={ver.v} className="flex items-center gap-3 bg-surface-container border border-outline-variant/30 rounded-cw-sm px-4 py-3">
                <GitBranch className="w-4 h-4 text-primary shrink-0" />
                <span className="font-mono text-body-sm text-on-surface">v{ver.v}</span>
                <span className="text-caption text-on-surface-variant">{ver.date}</span>
                <span className="text-label-sm text-on-surface-variant flex-1 truncate">{ver.note}</span>
                {ver.date === '当前' && <Badge variant="success">当前</Badge>}
              </div>
            ))}
          </div>
        )}

        <div className="mt-7 flex justify-end">
          <Button onClick={save} disabled={saving}>
            <Save className="w-4 h-4" /> {saving ? '保存中…' : '保存人格'}
          </Button>
        </div>
      </div>
    </StandardLayout>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-4 space-y-3 self-start">
      <h3 className="flex items-center gap-2 text-on-surface-variant">{icon}<span className="text-title-sm font-medium text-on-surface">{title}</span></h3>
      {children}
    </section>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-label text-on-surface-variant mb-1">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-surface rounded-cw-xs px-2.5 py-1.5 text-body-sm text-on-surface outline-none border border-outline-variant/30 focus:border-primary" />
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex-1">
      <label className="block text-label text-on-surface-variant mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
          className="w-9 h-8 rounded-cw-xs border border-outline-variant/40 bg-transparent cursor-pointer" />
        <span className="font-mono text-label-sm text-on-surface-variant">{value}</span>
      </div>
    </div>
  );
}

function makeShell(personaId: string): Persona {
  return {
    persona_id: personaId, persona_name: personaId, version: '1.0.0',
    parameter: {
      identity: { persona_id: personaId, persona_name: personaId, version: '1.0.0', tone: 'warm_storyteller', positioning: '', knowledge_domains: [] },
      language: { max_sentence_length: 25, academic_density: 0.5, slang_ratio: 0.3 },
      rhythm: { cut_density_tier: 'medium', base_shot_duration_sec: 6 },
      visual: { color_palette: { primary: '#1a1a2e', accent: '#e94560' }, animation_style: '' },
      audio: { loudness_target_lufs: -16 },
      constraints: { max_duration_sec: 900 },
    },
  };
}
