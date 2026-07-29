import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { personaApi, voiceApi, getApiClient } from '@/services/api';
import { StandardLayout } from '@/layouts/StandardLayout';
import { Button, Badge, Slider } from '@/components/ui';
import type { Persona } from '@/types/persona';
import type { VoiceRecord } from '@/types/voice';
import {
  ArrowLeft, Save, SlidersHorizontal, FileText, Database, GitBranch,
  Fingerprint, MessageSquareText, Timer, Palette, Music, ShieldCheck, ExternalLink,
  Search,
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
  const [saveError, setSaveError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [kbBusy, setKbBusy] = useState(false);
  const [kbStatus, setKbStatus] = useState('');
  const [voices, setVoices] = useState<VoiceRecord[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await personaApi.get(personaId);
        if (alive) { setPersona(p); setPrompt(p.prompt ?? ''); }
      } catch {
        if (alive) setPersona(makeShell(personaId));
      }
    })();
    voiceApi.list().then((v) => { if (alive) setVoices(v); }).catch(() => {});
    return () => { alive = false; };
  }, [personaId]);

  const save = async () => {
    if (!persona) return;
    setSaving(true);
    setSaveError('');
    try {
      await personaApi.update(persona.persona_id, { ...persona, prompt });
    } catch {
      setSaveError('保存失败：后端未连接或请求被拒绝');
    }
    setSaving(false);
  };

  const setParam = (updater: (p: Persona) => Persona) => {
    setPersona((prev) => (prev ? updater(prev) : prev));
  };

  const uploadKnowledge = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !persona) return;
    setKbBusy(true);
    setKbStatus('');
    try {
      const content = await file.text();
      await getApiClient().post(`/api/persona/${persona.persona_id}/knowledge`, {
        title: file.name,
        content,
        source: 'upload',
      });
      await getApiClient().post(`/api/persona/${persona.persona_id}/rag/index`, { force_rebuild: false });
      setKbStatus(`已上传「${file.name}」并完成向量索引`);
    } catch {
      setKbStatus('上传失败：后端不可达或索引服务异常');
    } finally {
      setKbBusy(false);
    }
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
              <div>
                <label className="block text-label text-on-surface-variant mb-1">声音克隆模型</label>
                <div className="flex items-center gap-2">
                  <select
                    value={P.audio.voice_clone_model_id ?? ''}
                    onChange={(e) => setParam((p) => ({ ...p, parameter: { ...p.parameter, audio: { ...p.parameter.audio, voice_clone_model_id: e.target.value || null } } }))}
                    className="flex-1 bg-surface rounded-cw-xs px-2.5 py-1.5 text-body-sm text-on-surface
                      outline-none border border-outline-variant/30 focus:border-primary cursor-pointer"
                  >
                    <option value="">（未绑定）</option>
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>{v.voice_name} ({v.provider})</option>
                    ))}
                  </select>
                  <button
                    onClick={() => navigate({ to: '/voice' })}
                    className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                    title="管理音色"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
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
          <div className="space-y-4">
            <div className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-5">
              <h4 className="text-body-sm font-medium text-on-surface mb-2">
                <Search className="w-3.5 h-3.5 inline mr-1.5" />RAG 知识检索
              </h4>
              <p className="text-label-sm text-on-surface-variant mb-3">在已索引的知识库文档中检索相关内容。</p>
              <RagSearch personaId={persona.persona_id} />
            </div>
            <div className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-5 text-center">
              <Database className="w-6 h-6 text-on-surface-variant/40 mx-auto mb-1.5" />
              <p className="text-label-sm text-on-surface-variant">上传 .md / .txt 文档，向量化后供 Agent 检索。</p>
              <input ref={fileInputRef} type="file" accept=".md,.txt" className="hidden" onChange={uploadKnowledge} />
              <Button variant="outline" size="sm" className="mt-2" disabled={kbBusy}
                onClick={() => fileInputRef.current?.click()}>
                {kbBusy ? '上传索引中…' : '上传文档并建立索引'}
              </Button>
              {kbStatus && <p className="text-caption text-on-surface-variant mt-2">{kbStatus}</p>}
            </div>
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

        <div className="mt-7 flex items-center justify-end gap-3">
          {saveError && <span className="text-caption text-error">{saveError}</span>}
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

function RagSearch({ personaId }: { personaId: string }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ text: string; score: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const { data } = await getApiClient().post(`/api/persona/${personaId}/rag/query`, {
        query: query.trim(), top_k: 5, rerank: true,
      });
      if (data?.results) setResults(data.results);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '检索失败');
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="搜索知识库…" className="flex-1 bg-surface rounded-cw-xs px-2.5 py-1.5 text-body-sm text-on-surface
            outline-none border border-outline-variant/30 focus:border-primary placeholder:text-on-surface-variant/50" />
        <Button size="sm" onClick={search} disabled={loading || !query.trim()}>检索</Button>
      </div>
      {error && <p className="text-caption text-error">{error}</p>}
      {results && results.length === 0 && <p className="text-caption text-on-surface-variant">无匹配结果。</p>}
      {results && results.map((r, i) => (
        <div key={i} className="bg-surface rounded-cw-xs border border-outline-variant/20 p-2">
          <p className="text-label-sm text-on-surface leading-relaxed">{r.text.slice(0, 300)}</p>
          <p className="text-caption text-on-surface-variant mt-0.5 font-mono">得分: {(r.score * 100).toFixed(0)}%</p>
        </div>
      ))}
    </div>
  );
}
