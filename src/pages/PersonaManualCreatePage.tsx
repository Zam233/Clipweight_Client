import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { personaApi } from '@/services/api';
import { Button } from '@/components/ui';
import { toast } from '@/stores/toastStore';
import { ArrowLeft, Save } from 'lucide-react';

/** 手动人 Persona 创建：不调用 LLM，直接构造后端 PersonaManifest。 */
export function PersonaManualCreatePage() {
  const navigate = useNavigate();
  const [personaId, setPersonaId] = useState('my_persona');
  const [name, setName] = useState('');
  const [tone, setTone] = useState('neutral');
  const [positioning, setPositioning] = useState('');
  const [domains, setDomains] = useState('');
  const [academic, setAcademic] = useState(0.3);
  const [slang, setSlang] = useState(0.1);
  const [maxSentence, setMaxSentence] = useState(30);
  const [shotMs, setShotMs] = useState('');
  const [palette, setPalette] = useState('#4F8CFF');
  const [animation, setAnimation] = useState('');
  const [bgm, setBgm] = useState('');
  const [loudness, setLoudness] = useState(-16);
  const [maxDuration, setMaxDuration] = useState(900);
  const [prompt, setPrompt] = useState('');
  const [visionPrompt, setVisionPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!personaId.trim() || !name.trim()) {
      setError('Persona ID 与名称必填');
      return;
    }
    setBusy(true); setError('');
    const manifest = {
      persona_id: personaId.trim(),
      persona_name: name.trim(),
      version: '1.0.0',
      parameter: {
        persona_id: personaId.trim(),
        version: '1.0.0',
        identity: {
          tone: tone.trim() || 'neutral',
          positioning: positioning.trim(),
          knowledge_domains: domains.split(',').map((s) => s.trim()).filter(Boolean),
        },
        language: {
          academic_density: academic,
          slang_ratio: slang,
          max_sentence_len: maxSentence,
        },
        rhythm: {
          cut_profile: 'even_flow',
          base_shot_duration_ms: shotMs.trim() ? Number(shotMs) : null,
          cut_density_tier: 'medium',
        },
        visual: {
          palette: 'custom',
          primary_color: palette,
          animation_style: animation.trim(),
        },
        audio: {
          bgm_slots: bgm.trim() ? { default: [bgm.trim()] } : {},
          target_loudness_lufs: loudness,
        },
        constraints: { max_duration_sec: maxDuration },
      },
      prompt,
      vision_prompt: visionPrompt,
    };
    try {
      await personaApi.create(manifest as never);
      toast('人格已创建', 'success');
      navigate({ to: '/persona/$personaId', params: { personaId: personaId.trim() } });
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 409 ? '该 Persona ID 已存在' : '创建失败：后端未连接或字段不合法');
    } finally { setBusy(false); }
  };

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="max-w-[900px] mx-auto px-8 py-8">
        <button onClick={() => navigate({ to: '/persona' })} className="flex items-center gap-1.5 text-label-sm text-on-surface-variant hover:text-primary mb-5 cursor-pointer">
          <ArrowLeft className="w-4 h-4" /> 返回人格库
        </button>
        <h1 className="text-title-lg font-semibold text-on-surface mb-1">手动创建人格</h1>
        <p className="text-body-sm text-on-surface-variant mb-6">直接填写六维参数与 Prompt，不调用模型。</p>
        {error && <div className="mb-4 px-3 py-2 rounded-cw-sm bg-error/10 text-error text-label-sm">{error}</div>}
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Persona ID"><input value={personaId} onChange={(e) => setPersonaId(e.target.value)} className={inputCls} /></Field>
          <Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
          <Field label="语调"><input value={tone} onChange={(e) => setTone(e.target.value)} className={inputCls} placeholder="critical / warm_storyteller" /></Field>
          <Field label="定位"><input value={positioning} onChange={(e) => setPositioning(e.target.value)} className={inputCls} /></Field>
          <Field label="知识领域（逗号分隔）"><input value={domains} onChange={(e) => setDomains(e.target.value)} className={inputCls} /></Field>
          <Field label="主色"><input type="color" value={palette} onChange={(e) => setPalette(e.target.value)} className="h-9 w-full bg-surface rounded-cw-xs border border-outline-variant/30 cursor-pointer" /></Field>
          <Field label="学术密度 0-1"><input type="number" min={0} max={1} step={0.05} value={academic} onChange={(e) => setAcademic(Number(e.target.value))} className={inputCls} /></Field>
          <Field label="网络用语 0-1"><input type="number" min={0} max={1} step={0.05} value={slang} onChange={(e) => setSlang(Number(e.target.value))} className={inputCls} /></Field>
          <Field label="最长句长"><input type="number" min={1} value={maxSentence} onChange={(e) => setMaxSentence(Number(e.target.value))} className={inputCls} /></Field>
          <Field label="基准镜头 ms（可空）"><input value={shotMs} onChange={(e) => setShotMs(e.target.value)} className={inputCls} placeholder="留空=类型插件决定" /></Field>
          <Field label="动画风格"><input value={animation} onChange={(e) => setAnimation(e.target.value)} className={inputCls} /></Field>
          <Field label="BGM 描述"><input value={bgm} onChange={(e) => setBgm(e.target.value)} className={inputCls} /></Field>
          <Field label="响度 LUFS"><input type="number" min={-30} max={-10} value={loudness} onChange={(e) => setLoudness(Number(e.target.value))} className={inputCls} /></Field>
          <Field label="最长时长 sec"><input type="number" min={1} value={maxDuration} onChange={(e) => setMaxDuration(Number(e.target.value))} className={inputCls} /></Field>
        </div>
        <Field label="系统 Prompt"><textarea rows={7} value={prompt} onChange={(e) => setPrompt(e.target.value)} className={`${inputCls} resize-y`} /></Field>
        <Field label="视觉 Prompt（可选）"><textarea rows={4} value={visionPrompt} onChange={(e) => setVisionPrompt(e.target.value)} className={`${inputCls} resize-y`} /></Field>
        <Button onClick={save} disabled={busy} className="mt-4"><Save className="w-4 h-4" /> {busy ? '创建中…' : '创建人格'}</Button>
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface outline-none border border-outline-variant/30 focus:border-primary';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block mb-3"><span className="block text-label-sm text-on-surface-variant mb-1.5">{label}</span>{children}</label>;
}
