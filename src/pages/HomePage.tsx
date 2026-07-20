import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useProjectStore } from '@/stores/projectStore';
import { healthApi } from '@/services/api';
import { projectCache } from '@/services/storage/projectCache';
import type { CachedProject } from '@/services/storage/projectCache';
import { useTimelineStore } from '@/stores/timelineStore';
import { Button, Badge } from '@/components/ui';
import {
  Film, Settings, Sparkles, ArrowRight, Plus, Bot, ListChecks,
  PenLine, PackageCheck, Clock, Layers, Wand2, Mic, Image as ImageIcon,
  History, Trash2, PlayCircle,
} from 'lucide-react';

/* ── demo data ─────────────────────────────────────────── */
const PERSONAS = [
  { id: 'default', name: '默认人格', tone: '通用' },
  { id: 'zamu_knowledge', name: '扎姆·知识区', tone: '批判型' },
  { id: 'hexue_digital', name: '何同学·数码', tone: '创意型' },
  { id: 'yingshi_industrial', name: '影视飓风·工业', tone: '工业型' },
];

const PLUGINS = [
  { id: 'knowledge_longform', name: '知识区长片', desc: '5-15s 镜头 · 硬切', color: '#4F8CFF' },
  { id: 'kichiku_fastcut', name: '鬼畜快剪', desc: '0.3-2s · 闪白', color: '#FF6B6B' },
  { id: 'digital_review', name: '数码评测', desc: '3-8s · 缓入缓出', color: '#A855F7' },
  { id: 'vlog_daily', name: 'Vlog 日常', desc: '3-10s · 混合', color: '#34D399' },
];

const DEMO_PROJECTS = [
  { id: 'p1', name: '骁龙 8 Gen3 深度评测', type: '数码评测', duration: '08:42', tracks: 6, edited: '2 小时前', grad: ['#A855F7', '#4F8CFF'], featured: true },
  { id: 'p2', name: '量子计算到底是什么', type: '知识区长片', duration: '12:05', tracks: 8, edited: '昨天', grad: ['#4F8CFF', '#34D399'] },
  { id: 'p3', name: '【鬼畜】老板语录 remix', type: '鬼畜快剪', duration: '02:31', tracks: 5, edited: '3 天前', grad: ['#FF6B6B', '#FBBF24'] },
  { id: 'p4', name: '京都 Vlog · 秋日', type: 'Vlog 日常', duration: '05:18', tracks: 4, edited: '上周', grad: ['#34D399', '#F59E0B'] },
];

const WORKFLOW = [
  { icon: ListChecks, title: '需求规划', desc: '需求 Agent 梳理创意简报与制作规划书', color: '#4F8CFF' },
  { icon: Bot, title: 'Agent 生成初稿', desc: '六 Agent 管线自动产出多轨时间线', color: '#A855F7' },
  { icon: PenLine, title: '人在时间轴审阅', desc: '逐帧微调，不满意可让 Agent 局部重做', color: '#FBBF24', highlight: true },
  { icon: PackageCheck, title: '渲染导出', desc: '一键导出 B 站 / 抖音 / YouTube 预设', color: '#34D399' },
];

/* ── page ──────────────────────────────────────────────── */
export function HomePage() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [personaId, setPersonaId] = useState('default');
  const [pluginId, setPluginId] = useState('knowledge_longform');
  const [mode, setMode] = useState<'voiceover' | 'visual'>('voiceover');
  const [backend, setBackend] = useState<'checking' | 'online' | 'offline'>('checking');
  const [cached, setCached] = useState<CachedProject | null>(null);

  useEffect(() => {
    healthApi.check()
      .then(() => setBackend('online'))
      .catch(() => setBackend('offline'));
    // Load last auto-saved project for "continue editing"
    projectCache.load('current')
      .then((p) => setCached(p && p.timeline?.tracks?.length ? p : null))
      .catch(() => setCached(null));
  }, []);

  const continueEditing = () => {
    if (!cached) return;
    useTimelineStore.getState().setTimeline(cached.timeline);
    useProjectStore.getState().setProjectName(cached.name);
    navigate({ to: '/editor' });
  };

  const discardCached = async () => {
    await projectCache.remove('current').catch(() => {});
    setCached(null);
  };

  const launch = () => {
    const st = useProjectStore.getState();
    st.setProjectName(topic.trim() || '未命名项目');
    st.setPersonaId(personaId);
    st.setPluginId(pluginId);
    navigate({ to: '/editor' });
  };

  const openBlank = () => {
    useProjectStore.getState().setProjectName('未命名项目');
    navigate({ to: '/editor' });
  };

  const openProject = (name: string) => {
    useProjectStore.getState().setProjectName(name);
    navigate({ to: '/editor' });
  };

  return (
    <div className="relative min-h-full h-full overflow-y-auto bg-surface text-on-surface">
      {/* ambient studio backdrop: faint grid + soft brand light */}
      <Backdrop />

      <div className="relative z-10 flex flex-col min-h-full">
        <TopBar backend={backend} />

        {/* decorative timecode ruler with sweeping playhead */}
        <RulerStrip />

        <main className="flex-1 w-full max-w-[1200px] mx-auto px-8 pb-10">
          {/* ── launch console + workflow ── */}
          <section className="grid grid-cols-12 gap-6 pt-8">
            {/* Launch console */}
            <div className="col-span-12 lg:col-span-7">
              <p className="font-mono text-label-sm tracking-[0.3em] text-primary uppercase mb-3">
                ClipWright · AI 辅助视频创作
              </p>
              <h1 className="font-display text-[44px] leading-[1.15] font-bold text-on-surface mb-2">
                把你的选题，
                <span className="text-primary">剪</span>成一支视频。
              </h1>
              <p className="text-body text-on-surface-variant mb-7 max-w-[480px]">
                Agent 负责结构化与体力活，你负责审美与微调。输入选题，从一份可逐帧编辑的时间线开始。
              </p>

              {/* creation console */}
              <div className="bg-surface-container border border-outline-variant/40 rounded-cw-lg overflow-hidden shadow-2xl shadow-black/40">
                {/* console header */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-container-high border-b border-outline-variant/30">
                  <span className="flex gap-1.5">
                    <i className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]" />
                    <i className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]" />
                    <i className="w-2.5 h-2.5 rounded-full bg-[#28C840]" />
                  </span>
                  <span className="font-mono text-caption text-on-surface-variant ml-2">new_production.session</span>
                  <Badge variant="info" className="ml-auto">需求 Agent 待命</Badge>
                </div>

                <div className="p-5 space-y-5">
                  {/* topic input */}
                  <div>
                    <label className="flex items-center gap-1.5 text-label font-medium text-on-surface-variant mb-2">
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                      视频选题
                    </label>
                    <div className="flex items-center gap-2 bg-surface rounded-cw-sm border border-outline-variant/40 focus-within:border-primary transition-colors px-3">
                      <span className="font-mono text-primary text-body select-none">&gt;</span>
                      <input
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && launch()}
                        placeholder="例如：深度解析某品牌新手机的散热设计…"
                        className="flex-1 bg-transparent outline-none py-3 text-body text-on-surface placeholder:text-on-surface-variant/40 font-mono"
                      />
                    </div>
                  </div>

                  {/* persona selector */}
                  <div>
                    <label className="text-label font-medium text-on-surface-variant block mb-2">创作人格 Persona</label>
                    <div className="flex flex-wrap gap-2">
                      {PERSONAS.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setPersonaId(p.id)}
                          className={`px-3 py-1.5 rounded-cw-full text-label-sm border transition-all duration-short3 cursor-pointer ${
                            personaId === p.id
                              ? 'bg-primary-container border-primary text-on-primary-container shadow-md shadow-primary/20'
                              : 'bg-surface-container-high border-outline-variant/40 text-on-surface-variant hover:border-outline hover:text-on-surface'
                          }`}
                        >
                          {p.name}
                          <span className="opacity-60 ml-1">· {p.tone}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* plugin / video type */}
                  <div>
                    <label className="text-label font-medium text-on-surface-variant block mb-2">视频类型插件</label>
                    <div className="grid grid-cols-2 gap-2">
                      {PLUGINS.map((pl) => (
                        <button
                          key={pl.id}
                          onClick={() => setPluginId(pl.id)}
                          className={`text-left px-3 py-2.5 rounded-cw-sm border transition-all duration-short3 cursor-pointer group ${
                            pluginId === pl.id
                              ? 'border-primary bg-primary/8 shadow-md shadow-primary/10'
                              : 'border-outline-variant/40 bg-surface-container-high hover:border-outline'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <i className="w-2 h-2 rounded-full shrink-0" style={{ background: pl.color }} />
                            <span className={`text-body-sm font-medium ${pluginId === pl.id ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
                              {pl.name}
                            </span>
                          </span>
                          <span className="block text-caption text-on-surface-variant/70 mt-0.5 ml-4 font-mono">{pl.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* video mode */}
                  <div className="flex items-center gap-3">
                    <label className="text-label font-medium text-on-surface-variant">制作模式</label>
                    <div className="flex bg-surface rounded-cw-sm border border-outline-variant/40 p-0.5">
                      <button
                        onClick={() => setMode('voiceover')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-cw-xs text-label-sm transition-colors cursor-pointer ${
                          mode === 'voiceover' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        <Mic className="w-3 h-3" /> 配音驱动
                      </button>
                      <button
                        onClick={() => setMode('visual')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-cw-xs text-label-sm transition-colors cursor-pointer ${
                          mode === 'visual' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'
                        }`}
                      >
                        <ImageIcon className="w-3 h-3" /> 视觉驱动
                      </button>
                    </div>
                  </div>

                  {/* actions */}
                  <div className="flex items-center gap-3 pt-1">
                    <Button size="lg" onClick={launch} className="flex-1 group">
                      <Wand2 className="w-4 h-4" />
                      开始创作
                      <ArrowRight className="w-4 h-4 transition-transform duration-short3 group-hover:translate-x-1" />
                    </Button>
                    <Button size="lg" variant="outline" onClick={openBlank}>
                      <Plus className="w-4 h-4" />
                      空白编辑器
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* workflow stepper */}
            <div className="col-span-12 lg:col-span-5 lg:pl-4">
              <p className="font-mono text-label-sm tracking-[0.25em] text-on-surface-variant uppercase mb-4 mt-1">
                Human-in-the-loop 工作流
              </p>
              <div className="relative space-y-0">
                {/* connecting line */}
                <span className="absolute left-[19px] top-3 bottom-3 w-px bg-gradient-to-b from-track-video via-track-text to-track-audio opacity-40" />
                {WORKFLOW.map((step, i) => (
                  <div key={step.title} className="relative flex gap-4 pb-6 last:pb-0 group">
                    <span
                      className="relative z-10 w-10 h-10 rounded-cw-md flex items-center justify-center shrink-0 border transition-transform duration-short3 group-hover:scale-110"
                      style={{
                        background: `${step.color}1A`,
                        borderColor: `${step.color}66`,
                        color: step.color,
                      }}
                    >
                      <step.icon className="w-4.5 h-4.5" />
                    </span>
                    <div className="pt-0.5">
                      <p className="flex items-center gap-2">
                        <span className="font-mono text-caption text-on-surface-variant">0{i + 1}</span>
                        <span className="text-title-sm font-semibold text-on-surface">{step.title}</span>
                        {step.highlight && <Badge variant="warning">核心</Badge>}
                      </p>
                      <p className="text-body-sm text-on-surface-variant mt-0.5 leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* backend status card */}
              <div className="mt-6 bg-surface-container border border-outline-variant/30 rounded-cw-md p-4">
                <div className="flex items-center justify-between">
                  <span className="text-label font-medium text-on-surface-variant">编排引擎</span>
                  <span className="flex items-center gap-1.5 text-label-sm">
                    <i className={`w-2 h-2 rounded-full ${
                      backend === 'online' ? 'bg-track-audio animate-pulse'
                        : backend === 'offline' ? 'bg-error'
                        : 'bg-track-text animate-pulse'
                    }`} />
                    <span className={
                      backend === 'online' ? 'text-track-audio'
                        : backend === 'offline' ? 'text-error'
                        : 'text-track-text'
                    }>
                      {backend === 'online' ? '已连接 localhost:8000'
                        : backend === 'offline' ? '离线 · 演示模式'
                        : '检测中…'}
                    </span>
                  </span>
                </div>
                <p className="text-caption text-on-surface-variant/70 mt-1.5 leading-relaxed">
                  {backend === 'offline'
                    ? '未检测到后端。编辑器仍可独立使用，Agent 功能将以演示数据运行。'
                    : 'Persona 引擎、六 Agent 管线与渲染队列已就绪。'}
                </p>
              </div>
            </div>
          </section>

          {/* ── recent projects ── */}
          <section className="mt-12">
            <div className="flex items-end justify-between mb-4">
              <div>
                <p className="font-mono text-label-sm tracking-[0.25em] text-on-surface-variant uppercase">Recent</p>
                <h2 className="text-title font-semibold text-on-surface mt-0.5">最近项目</h2>
              </div>
              <button className="text-label-sm text-primary hover:underline cursor-pointer flex items-center gap-1">
                查看全部 <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* resume last session */}
            {cached && (
              <div className="mb-4 flex items-center gap-4 bg-primary-container/25 border border-primary/40 rounded-cw-md px-5 py-4
                hover:border-primary/70 transition-colors duration-short3 group">
                <span className="w-11 h-11 rounded-cw-sm bg-primary-container flex items-center justify-center shrink-0">
                  <History className="w-5 h-5 text-on-primary-container" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-body-sm font-semibold text-on-surface truncate">{cached.name}</p>
                  <p className="text-caption text-on-surface-variant font-mono">
                    上次编辑 {new Date(cached.updatedAt).toLocaleString()} · {cached.timeline.tracks.length} 轨 · 已自动保存
                  </p>
                </div>
                <Button size="sm" onClick={continueEditing} className="group-hover:scale-105 transition-transform">
                  <PlayCircle className="w-3.5 h-3.5" /> 继续编辑
                </Button>
                <button
                  onClick={discardCached}
                  className="p-2 rounded-cw-sm text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors cursor-pointer"
                  title="放弃此草稿"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="grid grid-cols-12 gap-4">
              {DEMO_PROJECTS.map((proj) => (
                <ProjectCard key={proj.id} proj={proj} onOpen={() => openProject(proj.name)} />
              ))}
            </div>
          </section>
        </main>

        {/* footer hint strip */}
        <footer className="border-t border-outline-variant/20 py-3">
          <div className="max-w-[1200px] mx-auto px-8 flex items-center gap-6 text-caption text-on-surface-variant/60 font-mono">
            <span>空格 = 播放/暂停</span>
            <span>S = 分割</span>
            <span>Del = 删除</span>
            <span>Ctrl+滚轮 = 缩放</span>
            <span>M = 标记</span>
            <span className="ml-auto">ClipWright v0.1.0 · Phase 5</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ── decorative components ─────────────────────────────── */
function Backdrop() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
      {/* faint timeline grid */}
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #8D8D99 1px, transparent 1px), linear-gradient(to bottom, #8D8D99 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }}
      />
      {/* soft brand light, top-left */}
      <div
        className="absolute -top-40 -left-40 w-[640px] h-[640px] rounded-full opacity-[0.14]"
        style={{ background: 'radial-gradient(circle, #4F6BED 0%, transparent 65%)' }}
      />
      {/* warm counter-light, bottom-right */}
      <div
        className="absolute -bottom-48 -right-32 w-[560px] h-[560px] rounded-full opacity-[0.08]"
        style={{ background: 'radial-gradient(circle, #D1708E 0%, transparent 65%)' }}
      />
    </div>
  );
}

function RulerStrip() {
  // decorative timecode ruler with an endlessly sweeping playhead
  const ticks = Array.from({ length: 80 });
  return (
    <div className="relative h-7 border-b border-outline-variant/25 bg-ruler-bg overflow-hidden select-none" aria-hidden>
      <div className="absolute inset-0 flex items-end">
        {ticks.map((_, i) => (
          <span
            key={i}
            className={`w-px shrink-0 ${i % 5 === 0 ? 'h-3 bg-ruler-tick' : 'h-1.5 bg-ruler-tick/50'}`}
            style={{ marginRight: i % 5 === 0 ? '34px' : '6px' }}
          />
        ))}
      </div>
      {/* sweeping playhead */}
      <span className="absolute top-0 bottom-0 w-px bg-playhead shadow-[0_0_8px_rgba(255,68,68,0.8)] ruler-sweep" />
      <style>{`
        @keyframes rulerSweep { 0% { left: -2%; } 100% { left: 102%; } }
        .ruler-sweep { animation: rulerSweep 9s linear infinite; }
      `}</style>
    </div>
  );
}

function TopBar({ backend }: { backend: 'checking' | 'online' | 'offline' }) {
  const navigate = useNavigate();
  return (
    <header className="flex items-center gap-3 px-8 py-4 max-w-[1200px] w-full mx-auto">
      <div className="w-9 h-9 rounded-cw-sm bg-primary-container flex items-center justify-center shadow-lg shadow-primary/20">
        <Film className="w-5 h-5 text-on-primary-container" />
      </div>
      <div className="leading-tight">
        <p className="text-title-sm font-bold text-on-surface tracking-wide">帧艺</p>
        <p className="font-mono text-caption text-on-surface-variant tracking-[0.2em]">CLIPWRIGHT</p>
      </div>
      <Badge variant="default" className="ml-2">v0.1.0</Badge>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden md:flex items-center gap-1.5 text-label-sm text-on-surface-variant">
          <Layers className="w-3.5 h-3.5" />
          多轨时间轴 · 六 Agent 管线
        </span>
        <button
          onClick={() => navigate({ to: '/settings' })}
          className="p-2 rounded-cw-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
          title="设置"
        >
          <Settings className="w-4.5 h-4.5" />
        </button>
      </div>
    </header>
  );
}

function ProjectCard({ proj, onOpen }: { proj: (typeof DEMO_PROJECTS)[number]; onOpen: () => void }) {
  const span = proj.featured ? 'col-span-12 md:col-span-6' : 'col-span-12 sm:col-span-6 md:col-span-3';
  return (
    <button
      onClick={onOpen}
      className={`${span} text-left group bg-surface-container border border-outline-variant/30 rounded-cw-md overflow-hidden
        hover:border-primary/60 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/10
        transition-all duration-medium2 cursor-pointer`}
    >
      {/* filmstrip thumbnail */}
      <div
        className={`relative ${proj.featured ? 'h-36' : 'h-24'} overflow-hidden`}
        style={{ background: `linear-gradient(120deg, ${proj.grad[0]}33, ${proj.grad[1]}22)` }}
      >
        {/* sprocket holes */}
        <div className="absolute top-1.5 left-0 right-0 flex gap-2 px-2 opacity-40">
          {Array.from({ length: 14 }).map((_, i) => (
            <i key={i} className="w-3 h-2 rounded-[2px] bg-black/50 shrink-0" />
          ))}
        </div>
        <div className="absolute bottom-1.5 left-0 right-0 flex gap-2 px-2 opacity-40">
          {Array.from({ length: 14 }).map((_, i) => (
            <i key={i} className="w-3 h-2 rounded-[2px] bg-black/50 shrink-0" />
          ))}
        </div>
        {/* center play glyph */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="w-11 h-11 rounded-full flex items-center justify-center bg-black/40 border border-white/20
              group-hover:scale-110 group-hover:bg-primary/80 transition-all duration-short3"
          >
            <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </div>
        {/* duration chip */}
        <span className="absolute bottom-3 right-2 font-mono text-caption bg-black/60 text-white px-1.5 py-0.5 rounded-cw-xs">
          {proj.duration}
        </span>
      </div>

      <div className="p-3.5">
        <p className="text-body-sm font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
          {proj.name}
        </p>
        <div className="flex items-center gap-3 mt-1.5 text-caption text-on-surface-variant">
          <span>{proj.type}</span>
          <span className="flex items-center gap-1"><Layers className="w-3 h-3" />{proj.tracks} 轨</span>
          <span className="flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" />{proj.edited}</span>
        </div>
      </div>
    </button>
  );
}
