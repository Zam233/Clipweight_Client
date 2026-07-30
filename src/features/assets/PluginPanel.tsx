import { useState } from 'react';
import { getApiClient } from '@/services/api';
import { Button } from '@/components/ui';
import { Sparkles, Image, Video, Music, Loader2, Wand2 } from 'lucide-react';

type PluginTab = 'ai_image' | 'ai_video' | 'ai_music';

const PLUGIN_TABS: { id: PluginTab; label: string; icon: typeof Image }[] = [
  { id: 'ai_image', label: 'AI 图片', icon: Image },
  { id: 'ai_video', label: 'AI 视频', icon: Video },
  { id: 'ai_music', label: 'AI 音乐', icon: Music },
];

/**
 * PluginPanel — 插件编辑器 UI 面板。
 * 二级 TAB 展示各插件的编辑器界面（AI 图片/视频/音乐生成）。
 */
export function PluginPanel() {
  const [activeTab, setActiveTab] = useState<PluginTab>('ai_image');

  return (
    <div className="flex flex-col h-full bg-surface-container-low">
      {/* 二级 TAB 栏 */}
      <div className="flex border-b border-outline-variant/30 shrink-0">
        {PLUGIN_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-label font-medium
              border-b-2 transition-colors duration-short3 cursor-pointer ${
                activeTab === id
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* 插件内容区 */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {activeTab === 'ai_image' && <AIImageGenView />}
        {activeTab === 'ai_video' && <AIVideoGenView />}
        {activeTab === 'ai_music' && <AIMusicGenView />}
      </div>
    </div>
  );
}

function AIImageGenView() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const { data } = await getApiClient().post('/api/tool/execute', {
        tool: 'ai_image_generate',
        params: { prompt: prompt.trim(), width: 1024, height: 576 },
      });
      if (data.success) {
        setResult(data.url);
      } else {
        setError(data.error || '生成失败');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '请求失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-label font-medium text-on-surface-variant">
        <Wand2 className="w-4 h-4 text-primary" />
        AI 文生图
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="描述你想生成的图片，如「赛博朋克城市夜景，霓虹灯，雨天」…"
        rows={3}
        className="w-full bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface
          outline-none border border-outline-variant/30 focus:border-primary resize-none
          placeholder:text-on-surface-variant/40"
      />
      <Button size="sm" onClick={generate} disabled={loading || !prompt.trim()} className="w-full">
        {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 生成中…</> : <><Sparkles className="w-3.5 h-3.5" /> 生成图片</>}
      </Button>
      {error && <p className="text-caption text-error">{error}</p>}
      {result && (
        <div className="rounded-cw-sm overflow-hidden border border-outline-variant/20">
          <img src={result} alt="AI 生成图片" className="w-full" />
          <p className="text-caption text-on-surface-variant p-2 truncate">{result}</p>
        </div>
      )}
    </div>
  );
}

function AIVideoGenView() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setStatus('提交生成任务…');
    setError(null);
    try {
      const { data } = await getApiClient().post('/api/tool/execute', {
        tool: 'ai_video_generate',
        params: { prompt: prompt.trim(), duration_sec: 5 },
      });
      if (data.success) {
        setStatus(`生成完成: ${data.url}`);
      } else {
        setError(data.error || '生成失败');
        setStatus(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '请求失败');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-label font-medium text-on-surface-variant">
        <Video className="w-4 h-4 text-primary" />
        AI 文生视频
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="描述你想生成的视频，如「无人机航拍海岸线，日落金光」…"
        rows={3}
        className="w-full bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface
          outline-none border border-outline-variant/30 focus:border-primary resize-none
          placeholder:text-on-surface-variant/40"
      />
      <Button size="sm" onClick={generate} disabled={loading || !prompt.trim()} className="w-full">
        {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 生成中（30-120s）…</> : <><Sparkles className="w-3.5 h-3.5" /> 生成视频</>}
      </Button>
      {status && <p className="text-caption text-track-video">{status}</p>}
      {error && <p className="text-caption text-error">{error}</p>}
    </div>
  );
}

function AIMusicGenView() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setStatus('正在生成音乐…');
    setError(null);
    try {
      const { data } = await getApiClient().post('/api/tool/execute', {
        tool: 'ai_music_generate',
        params: { prompt: prompt.trim(), duration_sec: 30 },
      });
      if (data.success) {
        setStatus(`生成完成: ${data.url}`);
      } else {
        setError(data.error || '生成失败');
        setStatus(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '请求失败');
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-label font-medium text-on-surface-variant">
        <Music className="w-4 h-4 text-primary" />
        AI 文生音乐
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="描述你想生成的音乐，如「轻快企业风，120bpm，钢琴为主」…"
        rows={3}
        className="w-full bg-surface-container rounded-cw-sm px-3 py-2 text-body-sm text-on-surface
          outline-none border border-outline-variant/30 focus:border-primary resize-none
          placeholder:text-on-surface-variant/40"
      />
      <Button size="sm" onClick={generate} disabled={loading || !prompt.trim()} className="w-full">
        {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 生成中…</> : <><Sparkles className="w-3.5 h-3.5" /> 生成音乐</>}
      </Button>
      {status && <p className="text-caption text-track-audio">{status}</p>}
      {error && <p className="text-caption text-error">{error}</p>}
    </div>
  );
}
