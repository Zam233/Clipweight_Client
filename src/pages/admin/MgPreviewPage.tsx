import { useEffect, useRef, useState } from 'react';
import { ConsoleShell, ConsoleHeading } from './ConsoleShell';
import {
  animationApi,
  type MgGenerationInfo,
  type MgGenerationRecord,
  type MgPreviewResult,
  type MgTemplateInfo,
} from '@/services/api/project';
import { Play, X, Loader2, Sparkles, History } from 'lucide-react';

/**
 * MgPreviewPage — 单镜头 MG 动画预览工坊（Phase 2.6）。
 *
 * 列出后端全部内置 MG 模板；选中后填写模板参数（占位符替换），
 * 调用 POST /api/animation/preview 由 Hyperframes 直出 2-3s MP4 即时预览，
 * 全程不进入主渲染队列。Hyperframes 不可用时后端返回 503，这里给出明确提示。
 * M6: 另列出最近 LLM 生成记录（generation_id），可一键回看渲染。
 */
export function MgPreviewPage() {
  const [templates, setTemplates] = useState<MgTemplateInfo[]>([]);
  const [generations, setGenerations] = useState<MgGenerationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 预览状态：{template, params} 弹层
  const [active, setActive] = useState<MgTemplateInfo | null>(null);
  // M6: 生成记录回看弹层（title + 已带 mg_json 的预览回调）
  const [activeGen, setActiveGen] = useState<{ title: string; record: MgGenerationRecord } | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<MgPreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await animationApi.mgList();
        if (alive) setTemplates(res ?? []);
      } catch {
        if (alive) setError('无法连接后端（/api/animation/mg/list 失败）');
      } finally {
        if (alive) setLoading(false);
      }
      try {
        const gens = await animationApi.mgGenerations(12);
        if (alive) setGenerations(gens ?? []);
      } catch { /* 生成记录列表失败不阻塞模板区 */ }
    })();
    return () => { alive = false; };
  }, []);

  const openPreview = (t: MgTemplateInfo) => {
    const defaults: Record<string, string> = {};
    for (const [k, v] of Object.entries(t.params ?? {})) {
      if (v && typeof v === 'object' && 'default' in v && v.default != null) {
        defaults[k] = String(v.default);
      }
    }
    setActive(t);
    setParams(defaults);
    setPreview(null);
    setPreviewError('');
  };

  // M6: 打开一条生成记录回看（无参数占位，直接用存储的 mg_def 渲染）
  const openGeneration = async (g: MgGenerationInfo) => {
    setPreviewing(true);
    setPreviewError('');
    try {
      const record = await animationApi.mgGeneration(g.generation_id);
      setActiveGen({ title: g.animation_id || g.generation_id, record });
      const res = await animationApi.preview({
        mg_json: record.mg_def,
        width: 1280,
        height: 720,
        fps: 30,
      });
      setActive(null);
      setPreview(res);
      requestAnimationFrame(() => {
        videoRef.current?.load();
        void videoRef.current?.play().catch(() => { /* 自动播放被拦截则静音播放 */ });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPreviewError(msg.includes('503') ? 'Hyperframes 渲染器不可用（预览需要本机 Chromium/headless-shell）' : `回看失败：${msg}`);
    } finally {
      setPreviewing(false);
    }
  };

  const runPreview = async () => {
    if (!active) return;
    setPreviewing(true);
    setPreviewError('');
    setPreview(null);
    try {
      const res = await animationApi.preview({
        animation_id: active.animation_id,
        params,
        width: 1280,
        height: 720,
        fps: 30,
      });
      setPreview(res);
      requestAnimationFrame(() => {
        videoRef.current?.load();
        void videoRef.current?.play().catch(() => { /* 自动播放被拦截则静音播放 */ });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPreviewError(msg.includes('503') ? 'Hyperframes 渲染器不可用（预览需要本机 Chromium/headless-shell）' : `预览失败：${msg}`);
    } finally {
      setPreviewing(false);
    }
  };

  // M6: 生成记录重渲染（同一 mg_def 再跑一次 Hyperframes）
  const rerunGeneration = async () => {
    if (!activeGen) return;
    setPreviewing(true);
    setPreviewError('');
    setPreview(null);
    try {
      const res = await animationApi.preview({
        mg_json: activeGen.record.mg_def,
        width: 1280,
        height: 720,
        fps: 30,
      });
      setPreview(res);
      requestAnimationFrame(() => {
        videoRef.current?.load();
        void videoRef.current?.play().catch(() => { /* 自动播放被拦截则静音播放 */ });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPreviewError(msg.includes('503') ? 'Hyperframes 渲染器不可用（预览需要本机 Chromium/headless-shell）' : `回看失败：${msg}`);
    } finally {
      setPreviewing(false);
    }
  };

  const closeDialog = () => {
    setActive(null);
    setActiveGen(null);
    setPreview(null);
    setPreviewError('');
  };

  return (
    <ConsoleShell>
      <ConsoleHeading kicker="Animation / MG Preview" title="MG 动画预览工坊"
        desc="选中内置 MG 模板 → 填写参数 → Hyperframes 直出短视频即时预览，不进入主渲染队列。" />

      {loading && <p className="text-caption text-on-surface-variant">加载模板中…</p>}
      {error && <p className="text-caption text-error">{error}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {templates.map((t) => (
          <button key={t.animation_id} onClick={() => openPreview(t)}
            className="flex flex-col items-start gap-1.5 p-3 rounded-cw-md bg-surface-container border border-outline-variant/30
              hover:border-primary/50 hover:bg-primary/10 transition-all duration-short3 cursor-pointer text-left">
            <span className="flex items-center gap-1.5 text-body-sm font-medium text-on-surface">
              <Sparkles className="w-3.5 h-3.5 text-primary" /> {t.name}
            </span>
            {t.shot_type && <span className="text-caption text-on-surface-variant/70">{t.shot_type}</span>}
            <span className="text-caption text-on-surface-variant/60 line-clamp-2">{t.description || t.animation_id}</span>
            <span className="text-caption text-primary/80 mt-auto pt-1">{t.duration_sec}s · {Object.keys(t.params ?? {}).length} 参数</span>
          </button>
        ))}
      </div>
      {!loading && templates.length === 0 && !error && (
        <p className="text-caption text-on-surface-variant">暂无可用 MG 模板</p>
      )}

      {/* M6: 最近生成记录（管线产出的 LLM MG，按 generation_id 回看） */}
      {generations.length > 0 && (
        <section className="mt-6">
          <h3 className="flex items-center gap-1.5 text-body-sm font-medium text-on-surface mb-2">
            <History className="w-3.5 h-3.5 text-primary" /> 最近生成
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {generations.map((g) => (
              <button key={g.generation_id} onClick={() => openGeneration(g)}
                className="flex flex-col items-start gap-1 p-3 rounded-cw-md bg-surface-container border border-outline-variant/30
                  hover:border-primary/50 hover:bg-primary/10 transition-all duration-short3 cursor-pointer text-left">
                <span className="text-body-sm font-medium text-on-surface truncate w-full">{g.animation_id || g.generation_id}</span>
                <span className="text-caption text-on-surface-variant/60">{new Date(g.created_at).toLocaleString()}</span>
                <span className="text-caption text-primary/80 mt-auto">{g.element_count} 元素 · {g.duration_sec}s</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 预览弹层（模板参数预览 / M6 生成记录回看共用） */}
      {(active || activeGen) && (() => {
        const dialogTitle = active ? active.name : activeGen!.title;
        const hasParams = !!active;
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeDialog}>
          <div className="w-full max-w-[720px] bg-surface-container rounded-cw-lg border border-outline-variant/40 shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/30">
              <span className="text-body-sm font-medium text-on-surface">{dialogTitle}</span>
              <button onClick={closeDialog} className="p-1 rounded-cw-xs hover:bg-surface-container-high cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              {preview ? (
                <video ref={videoRef} src={preview.url} controls autoPlay muted loop
                  className="w-full rounded-cw-md bg-black aspect-video" />
              ) : (
                <div className="w-full aspect-video bg-black rounded-cw-md flex items-center justify-center text-caption text-on-surface-variant/60">
                  {previewing ? '渲染中…' : '点击「生成预览」渲染本镜头'}
                </div>
              )}
              {previewError && <p className="text-caption text-error mt-2">{previewError}</p>}

              {/* 参数编辑（仅模板预览） */}
              {hasParams && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  {Object.keys(active!.params ?? {}).length === 0 && (
                    <p className="col-span-2 text-caption text-on-surface-variant/70">该模板无参数占位符</p>
                  )}
                  {Object.entries(active!.params ?? {}).map(([k, v]) => (
                    <label key={k} className="flex flex-col gap-1">
                      <span className="text-caption text-on-surface-variant">{k}</span>
                      <input value={params[k] ?? ''} onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))}
                        placeholder={v && typeof v === 'object' && 'default' in v ? String(v.default ?? '') : ''}
                        className="bg-surface rounded-cw-sm px-2.5 py-1.5 text-body-sm text-on-surface outline-none border border-outline-variant/30 focus:border-primary" />
                    </label>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2 mt-4">
                <button onClick={hasParams ? runPreview : rerunGeneration} disabled={previewing}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-cw-sm bg-primary text-on-primary text-label-sm hover:bg-primary/90
                    disabled:opacity-50 cursor-pointer">
                  {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {previewing ? '渲染中…' : '生成预览'}
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </ConsoleShell>
  );
}
