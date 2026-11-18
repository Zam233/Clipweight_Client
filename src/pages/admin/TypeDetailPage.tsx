import { useEffect, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { typeMakerApi, type TypeDefinition } from '@/services/api';
import { Button, Badge } from '@/components/ui';
import { toast } from '@/stores/toastStore';
import { ArrowLeft, Pencil, Save, Trash2, X } from 'lucide-react';

const SLOT_KEYS = ['genre','anti_patterns','lexicon','structure','material','edit','animation','audio','subtitle','quality'];

export function TypeDetailPage() {
  const { typeId } = useParams({ from: '/settings/type-maker/$typeId' });
  const navigate = useNavigate();
  const [definition, setDefinition] = useState<TypeDefinition | null>(null);
  const [draft, setDraft] = useState<TypeDefinition | null>(null);
  const [tab, setTab] = useState<'params'|'prompts'|'rules'|'json'>('params');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await typeMakerApi.get(typeId);
        if (alive) { setDefinition(data); setDraft(data); }
      } catch { if (alive) setError('类型读取失败：不存在或后端不可达'); }
    })();
    return () => { alive = false; };
  }, [typeId]);

  if (!definition) return <div className="p-8 text-on-surface-variant">{error || '加载中…'}</div>;
  const d = draft ?? definition;
  const builtin = Boolean((definition as TypeDefinition & { builtin?: boolean }).builtin);

  const save = async () => {
    if (!draft || busy) return;
    setBusy(true); setError('');
    try {
      const clean = { ...draft } as TypeDefinition & { _source_file?: string; builtin?: boolean };
      delete clean._source_file;
      delete clean.builtin;
      const v = await typeMakerApi.validate(clean);
      if (!v.ok) { setError((v.errors ?? []).map((e) => e.message).join('；') || '校验失败'); return; }
      await typeMakerApi.update(typeId, clean);
      setDefinition(draft); setEditing(false); toast('类型已保存', 'success');
    } catch { setError('保存失败：后端不可达或定义不合法'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await typeMakerApi.remove(typeId);
      toast('类型已删除', 'success');
      navigate({ to: '/settings/type-maker' });
    } catch { setError('删除失败：内置类型不可删除，或后端拒绝'); setConfirmDelete(false); }
    finally { setBusy(false); }
  };

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="max-w-[1000px] mx-auto px-8 py-8">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => navigate({ to: '/settings/type-maker' })} className="flex items-center gap-1.5 text-label-sm text-on-surface-variant hover:text-primary"><ArrowLeft className="w-4 h-4" /> 返回类型制作器</button>
          <div className="ml-auto flex gap-2">
            {!editing ? <Button size="sm" onClick={() => setEditing(true)} disabled={builtin} title={builtin ? '内置类型不可修改' : ''}><Pencil className="w-3.5 h-3.5" /> 编辑</Button> : <>
              <Button size="sm" variant="outline" onClick={() => { setDraft(definition); setEditing(false); }}><X className="w-3.5 h-3.5" /> 取消</Button>
              <Button size="sm" onClick={() => void save()} disabled={busy}><Save className="w-3.5 h-3.5" /> 保存</Button>
            </>}
            <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)} disabled={builtin} title={builtin ? '内置类型不可删除' : ''}><Trash2 className="w-3.5 h-3.5" /> 删除</Button>
          </div>
        </div>
        <div className="flex items-center gap-3 mb-1"><h1 className="text-title-lg font-semibold">{definition.name}</h1><Badge variant={builtin ? 'default' : 'success'}>{builtin ? '内置' : '自定义'}</Badge></div>
        <p className="font-mono text-caption text-on-surface-variant mb-1">{definition.id}</p>
        <p className="text-body-sm text-on-surface-variant mb-5">{definition.description || '（无描述）'}</p>
        {error && <div className="mb-4 rounded-cw-sm border border-error/30 bg-error/10 px-3 py-2 text-error text-label-sm">{error}</div>}
        {confirmDelete && <div className="mb-4 rounded-cw-md border border-error/30 bg-error/10 p-3 flex items-center gap-3"><span className="text-label-sm text-error">确认删除类型「{definition.name}」？</span><Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>取消</Button><Button size="sm" onClick={() => void remove()} disabled={busy}>确认删除</Button></div>}
        <div className="flex gap-1 border-b border-outline-variant/25 mb-4">
          {(['params','prompts','rules','json'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-label-sm border-b-2 ${tab===t?'border-primary text-primary':'border-transparent text-on-surface-variant'}`}>{({params:'参数',prompts:'Prompt',rules:'规则',json:'原始 JSON'} as Record<string,string>)[t]}</button>)}
        </div>
        <fieldset disabled={!editing} className="space-y-4">
          {tab === 'params' && <div className="grid md:grid-cols-2 gap-4">
            <Field label="名称"><input value={d.name} onChange={(e) => setDraft({...d, name:e.target.value})} className={inputCls} /></Field>
            <Field label="描述"><input value={d.description} onChange={(e) => setDraft({...d, description:e.target.value})} className={inputCls} /></Field>
            <Field label="最短镜头 sec"><input type="number" step={0.1} value={d.shot_params?.min_shot_sec ?? 1} onChange={(e) => setDraft({...d, shot_params:{...d.shot_params, min_shot_sec:Number(e.target.value)}})} className={inputCls} /></Field>
            <Field label="最长镜头 sec"><input type="number" step={0.1} value={d.shot_params?.max_shot_sec ?? 4} onChange={(e) => setDraft({...d, shot_params:{...d.shot_params, max_shot_sec:Number(e.target.value)}})} className={inputCls} /></Field>
            <Field label="默认转场"><input value={d.shot_params?.transition_type ?? 'cut'} onChange={(e) => setDraft({...d, shot_params:{...d.shot_params, transition_type:e.target.value}})} className={inputCls} /></Field>
            <Field label="转场时长"><input type="number" step={0.1} value={d.shot_params?.transition_duration_sec ?? 0.5} onChange={(e) => setDraft({...d, shot_params:{...d.shot_params, transition_duration_sec:Number(e.target.value)}})} className={inputCls} /></Field>
            <Field label="标签（逗号分隔）"><input value={(d.tags ?? []).join(', ')} onChange={(e) => setDraft({...d, tags:e.target.value.split(',').map((x)=>x.trim()).filter(Boolean)})} className={inputCls} /></Field>
            <div className="md:col-span-2"><JsonField label="persona_mapping（JSON）" value={d.persona_mapping ?? {}} onChange={(v) => setDraft({...d, persona_mapping:v as TypeDefinition['persona_mapping']})} /></div>
            <div className="md:col-span-2"><JsonField label="post_process（JSON）" value={d.post_process ?? {}} onChange={(v) => setDraft({...d, post_process:v as Record<string, unknown>})} /></div>
          </div>}
          {tab === 'prompts' && <div className="space-y-3">{SLOT_KEYS.map((k) => <Field key={k} label={k}><textarea rows={3} value={d.prompts?.[k]?.text ?? ''} onChange={(e) => setDraft({...d, prompts:{...d.prompts, [k]:{...(d.prompts?.[k] ?? {}), text:e.target.value}}})} className={`${inputCls} resize-y`} /></Field>)}</div>}
          {tab === 'rules' && <div className="space-y-4">
            <JsonField label="param_rules（JSON 数组）" value={d.param_rules ?? []} onChange={(v) => setDraft({...d, param_rules:v as TypeDefinition['param_rules']})} />
            <JsonField label="signature_traits（JSON 数组）" value={d.signature_traits ?? []} onChange={(v) => setDraft({...d, signature_traits:v as TypeDefinition['signature_traits']})} />
            <JsonField label="declares（JSON 对象）" value={d.declares ?? {}} onChange={(v) => setDraft({...d, declares:v as TypeDefinition['declares']})} />
            <Field label="waivers（逗号分隔）"><input value={(d.waivers ?? []).join(', ')} onChange={(e) => setDraft({...d, waivers:e.target.value.split(',').map((x)=>x.trim()).filter(Boolean)})} className={inputCls} /></Field>
          </div>}
          {tab === 'json' && <pre className="bg-surface-container border rounded-cw-md p-4 text-caption overflow-auto max-h-[520px]">{JSON.stringify(d, null, 2)}</pre>}
        </fieldset>
      </div>
    </div>
  );
}

const inputCls = 'w-full bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm border border-outline-variant/30 focus:border-primary outline-none';
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="block text-label-sm text-on-surface-variant mb-1.5">{label}</span>{children}</label>; }

function JsonField({ label, value, onChange }: { label: string; value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [error, setError] = useState('');
  useEffect(() => { setText(JSON.stringify(value ?? null, null, 2)); }, [value]);
  return <Field label={label}><textarea rows={5} value={text} onChange={(e) => {
    const next = e.target.value; setText(next);
    try { onChange(JSON.parse(next)); setError(''); } catch { setError('JSON 格式错误，修正后才会写入'); }
  }} className={`${inputCls} resize-y font-mono text-caption`} />{error && <span className="block text-caption text-error mt-1">{error}</span>}</Field>;
}
