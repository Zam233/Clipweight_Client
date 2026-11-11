import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useProjectStore } from '@/stores/projectStore';
import { usePluginSlots } from '@/features/plugins/usePluginSlots';
import { Slot } from '@/features/plugins/Slot';
import { safePluginPath } from '@/features/plugins/slots';
import { clearRequirementsDraft } from '@/stores/agentStore';
import {
  useBackendHealthDetail,
  buildHealthComponents,
} from './useBackendHealth';
import {
  healthApi, personaApi, projectApi, assetApi, typeMakerApi, pipelineApi,
  voiceApi, workspaceApi,
  getApiClient,
} from '@/services/api';
import { WorkspaceMaterialsPanel } from '@/features/workspace/WorkspaceMaterialsPanel';
import type { VoiceRecord } from '@/types/voice';
import { Button, Badge } from '@/components/ui';
import {
  Film, Settings, ArrowRight, Plus, Bot, ListChecks,
  PenLine, PackageCheck, Clock, Layers, Wand2, Mic,
  Upload, X, Check, Loader2, AudioLines,
  Scissors, FileText, FolderOpen, Clapperboard, LayoutTemplate,
  Home, Shapes, User, Puzzle, Sparkles,
  Server, ChevronRight,
} from 'lucide-react';
import { ProjectCard, type ProjectCardData } from '@/components/shared/ProjectCard';
import { TemplateGallery } from '@/components/shared/TemplateGallery';
import { ChatForgeDrawer } from '@/features/chatforge/ChatForgeDrawer';
import { CreativePromptField } from '@/features/creation/CreativePromptField';
import { fmtDur, relTime, uid } from '@/lib/utils';
import { asText } from '@/lib/render';
import { toast } from '@/stores/toastStore';
import { useSettingsStore } from '@/stores/settingsStore';
// 首页四个 tab 与独立页曾经各写一套（能力不同、字段不同、必然漂移）。
// 现在统一复用同一份面板实现：人格 → /persona 的画廊，类型 → 类型总览，
// 插件 → 插件管理页，设置 → 偏好设置面板。
import { PersonaGalleryPanel } from '@/features/settings/PersonaGalleryPanel';
import { TypeCatalogPanel } from '@/features/settings/TypeCatalogPanel';
import { PluginsPanel } from '@/features/settings/PluginsPanel';
import { PreferencesPanel } from '@/features/settings/PreferencesPanel';
import { CONSOLE_NAV } from '@/features/settings/consoleNav';

/* ── 图一：左侧导航 tab ── */
type HomeTab = 'home' | 'types' | 'personas' | 'plugins' | 'create' | 'settings';

/* ── types ─────────────────────────────────────────────── */
interface PersonaOpt { id: string; name: string; tone: string }
interface PluginOpt { id: string; name: string; desc: string; color: string }
interface ProjectOpt {
  id: string; name: string; type: string; duration: string;
  tracks: number; edited: string; grad: [string, string]; featured?: boolean;
  thumbnail?: string;
}
interface DubAudio { path: string; name: string; duration: number }
interface MatSource { id: string; name: string }

const PLUGIN_PALETTE = ['#4F8CFF', '#FF6B6B', '#A855F7', '#34D399', '#FBBF24', '#F59E0B'];
/**
 * F-08：默认类型插件的 id。它作为表单初值存在，但**不算用户显式选择**——
 * 步骤完成度与摘要文案要区分「用了默认」和「用户选过」。
 */
const DEFAULT_PLUGIN_ID = 'knowledge_longform';
const PROJECT_GRADS: [string, string][] = [
  ['#A855F7', '#4F8CFF'], ['#4F8CFF', '#34D399'], ['#FF6B6B', '#FBBF24'], ['#34D399', '#F59E0B'],
];

const WORKFLOW = [
  { icon: ListChecks, title: '需求规划', desc: '需求 Agent 梳理创意简报与制作规划书', color: '#4F8CFF' },
  { icon: Bot, title: 'Agent 生成初稿', desc: '七 Agent 管线自动产出多轨时间线', color: '#A855F7' },
  { icon: PenLine, title: '人在时间轴审阅', desc: '逐帧微调，不满意可让 Agent 局部重做', color: '#FBBF24', highlight: true },
  { icon: PackageCheck, title: '渲染导出', desc: '一键导出 B 站 / 抖音 / YouTube 预设', color: '#34D399' },
];

/* ── helpers ───────────────────────────────────────────── */
export function splitScriptToCaptions(text: string, mode: 'period' | 'punctuation'): string[] {
  const t = text.trim();
  if (!t) return [];
  if (mode === 'punctuation') {
    const parts: string[] = [];
    let buf = '';
    for (const ch of t) {
      if ('，。！；？：'.includes(ch)) {
        if ('？！'.includes(ch)) parts.push((buf + ch).trim());
        else if (buf.trim()) parts.push(buf.trim());
        buf = '';
      } else buf += ch;
    }
    if (buf.trim()) parts.push(buf.trim());
    return parts.filter(Boolean);
  }
  const parts = t.split(/[。！？.!?]/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [t];
}

/** 客户端探测音频文件真实时长（秒）。失败返回 0。 */
function detectAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = 'metadata';
    const cleanup = () => URL.revokeObjectURL(url);
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      cleanup();
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    audio.onerror = () => { cleanup(); resolve(0); };
    audio.src = url;
  });
}

/* ── page ──────────────────────────────────────────────── */
export function HomePage() {
  const navigate = useNavigate();

  // 图一：左侧导航 tab
  const [activeTab, setActiveTab] = useState<HomeTab>('home');

  const [guardNotice, setGuardNotice] = useState<string | null>(null);
  // 组件级健康：一次轮询同时给出连接状态与各组件状态（避免两个轮询器）。
  const healthState = useBackendHealthDetail();
  const backend = healthState.status;
  const healthComponents = useMemo(
    () => buildHealthComponents(healthState.detail),
    [healthState.detail],
  );
  // F-12（PRD §2 P3）：初值是 'demo' → 接口返回前首屏会闪一个「演示数据」徽标与
  // 「后端未连接」文案，看起来像已经连不上。改为初值 'live'，只有真正离线/空列表
  // 分支才切到 'demo'。
  const [dataMode, setDataMode] = useState<'live' | 'demo'>('live');
  // 人格/类型列表只服务于「创作」表单的下拉选项——展示由共享面板（PersonaGalleryPanel /
  // TypeCatalogPanel）各拉各的，这里不再兼任展示职责，也不再塞演示数据。
  const [personas, setPersonas] = useState<PersonaOpt[]>([]);
  const [plugins, setPlugins] = useState<PluginOpt[]>([]);
  const [projects, setProjects] = useState<ProjectOpt[]>([]);

  const [topic, setTopic] = useState('');
  const [script, setScript] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [pluginId, setPluginId] = useState(DEFAULT_PLUGIN_ID);
  const [mode, setMode] = useState<'voiceover' | 'visual'>('voiceover');
  // F-04：不再让用户二选一——有配音时按台词节奏编排，否则按画面与文案匹配
  const [creativePrompt, setCreativePrompt] = useState('');
  const [creativeAvoid, setCreativeAvoid] = useState<string[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [splitMode, setSplitMode] = useState<'period' | 'punctuation'>('period');
  // P1-26: 首页直接选音色——旧实现音色只能经 /voice 页传递到新项目，管线
  // 拿到空 voice_id 时音频 Agent 不生成旁白
  const [voices, setVoices] = useState<VoiceRecord[]>([]);
  const [voicePick, setVoicePick] = useState('');
  const [autoDubPref, setAutoDubPref] = useState(true);
  // P2-04: 踩点剪辑
  const [cutOnBeat, setCutOnBeatState] = useState(false);
  const [beatBpm, setBeatBpmState] = useState<number | null>(null);

  // 加载可用音色（后端离线时静默为空——下拉不渲染）；回填既有偏好
  useEffect(() => {
    let alive = true;
    voiceApi.list().then((vs) => { if (alive && Array.isArray(vs)) setVoices(vs); }).catch(() => {});
    try {
      const prefs = JSON.parse(localStorage.getItem('clipwright_voice_prefs') || '{}');
      if (prefs.voiceId) setVoicePick(String(prefs.voiceId));
      if (typeof prefs.autoDub === 'boolean') setAutoDubPref(prefs.autoDub);
    } catch (e) {
      // P3-06: 留痕（本地偏好读取失败不影响主流程）
      console.warn('[HomePage] 本地偏好读取失败:', e);
    }
    return () => { alive = false; };
  }, []);
  const [audio, setAudio] = useState<DubAudio | null>(null);

  // F-04 + 本轮修复：编排路径自动派生。
  // 有上传配音 → voiceover；没上传但「自动配音 + 已选音色」→ voiceover（TTS 生成旁白，
  // 字幕按 TTS 实测时间对齐）；两者都没有才是 visual（纯画面）。
  // 旧实现只看 audio，而上传按钮又藏在 voiceover 分支里 —— 没有音频就永远是 visual，
  // 上传按钮永不出现，用户根本没有上传入口。
  useEffect(() => {
    const canTts = autoDubPref && Boolean(voicePick);
    setMode(audio || canTts ? 'voiceover' : 'visual');
  }, [audio, autoDubPref, voicePick]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  // B9：同内容配音重传 → 后端 200 复用（deduplicated=true），提示而非报错
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchErr, setLaunchErr] = useState<string | null>(null);
  // PRD B4：选题建议（后端 topic-suggest）
  const [suggesting, setSuggesting] = useState(false);
  const [topicIdeas, setTopicIdeas] = useState<Array<{ title: string; reason: string }>>([]);
  const [topicSuggestErr, setTopicSuggestErr] = useState<string | null>(null);
  // 工作区（PRD workspace-prd-2026-10-24）：04 步开关 + 已创建路径
  const [wsRoot, setWsRoot] = useState('');
  // PRD §17.8：工作区父目录可选（后端 GET /api/workspace/roots 给白名单）
  const [wsRootChoices, setWsRootChoices] = useState<Array<{ path: string; writable: boolean; default: boolean }>>([]);
  const [wsRootChoice, setWsRootChoice] = useState('');
  const [wsAutoIndex, setWsAutoIndex] = useState(true);
  const [wsVision, setWsVision] = useState(true);
  const projectId = useProjectStore((s) => s.projectId);
  // A3: 模板画廊弹层
  const [templateGalleryOpen, setTemplateGalleryOpen] = useState(false);
  // P8: dry-run 预览模式（只生成粗剪时间线）
  const [dryRun, setDryRun] = useState(false);
  // D23 已拍板：默认 `default` = 不下发，跟随后端 merge（低于下限合并）+ split
  // （高于上限切分），两者都保总时长；其余档位仅供取证/救急。
  const [shotFloorPolicy, setShotFloorPolicy] = useState('default');
  const [shotCapPolicy, setShotCapPolicy] = useState('default');
  const [materialSources, setMaterialSources] = useState<MatSource[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const audioInputRef = useRef<HTMLInputElement>(null);
  // G6: 文稿智能预判（predict-script）——长文稿且后端在线时显示推荐卡片
  const [prediction, setPrediction] = useState<{
    video_type?: string;
    estimated_duration_sec?: number;
    recommended_persona_tone?: string;
    summary?: string;
  } | null>(null);
  /** F-03：预测请求代际号——过期响应必须丢弃（清理函数挡不住已发出的请求）。 */
  const predictionGenRef = useRef(0);

  // PRD §19.6：载入可选工作区父目录（失败静默：只显示默认根）
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await workspaceApi.roots();
        if (!alive) return;
        const items = res?.roots ?? [];
        setWsRootChoices(items);
        const preferred = items.find((r) => r.default && r.writable) ?? items.find((r) => r.writable);
        if (preferred) setWsRootChoice((prev) => prev || preferred.path);
      } catch {
        /* 后端未启动/端点不可用：不阻塞首页 */
      }
    })();
    return () => { alive = false; };
  }, []);

  // G6: 防抖调用 predict-script（800ms），失败静默（不影响启动）
  // F-03（PRD §2 P1）：清理函数只 clearTimeout 挡不住**已经发出**的请求——
  // 粘贴长文稿后马上清空/替换，几秒后旧响应仍会 setPrediction 弹出过期预判。
  // 用代际号 + 内容指纹：响应回来时若文稿已变，直接丢弃。
  useEffect(() => {
    const gen = ++predictionGenRef.current;
    const forScript = script.trim();
    if (backend !== 'online' || forScript.length < 50) {
      setPrediction(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await pipelineApi.predictScript(forScript);
        if (gen !== predictionGenRef.current) return;          // 过期响应
        if (script.trim() !== forScript) return;                // 文稿已改
        if (res && typeof res === 'object') setPrediction(res as typeof prediction);
      } catch (e) {
        // P3-06: 留痕
        console.warn('[HomePage] 操作失败:', e);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [script, backend]);

  useEffect(() => {
    let alive = true;
    // Check for guard notice from router redirect
    const notice = sessionStorage.getItem('cw_guard_notice');
    if (notice) {
      sessionStorage.removeItem('cw_guard_notice');
      queueMicrotask(() => alive && setGuardNotice(notice));
    }

    (async () => {
      try {
        const [ps, projs] = await Promise.all([
          personaApi.list(),
          projectApi.list(),
        ]);
        if (!alive) return;
        setDataMode('live');
        if (Array.isArray(ps) && ps.length) {
          setPersonas(ps.map((p) => ({
            id: p.persona_id,
            name: p.persona_name,
            tone: asText(p.parameter?.identity?.tone) || '通用',
          })));
        }
        if (Array.isArray(projs)) {
          // 过滤无 id 的脏记录（历史遗留），避免 React duplicate-key 警告
          const valid = projs.filter((pr) => pr && pr.id);
          setProjects(valid.length > 0
              ? valid.map((pr, i) => ({
                id: pr.id,
                name: pr.name,
                type: pr.plugin_id ?? '—',
                duration: fmtDur(pr.duration_sec ?? 0),
                tracks: pr.track_count ?? 0,
                edited: relTime(pr.updated_at),
                grad: PROJECT_GRADS[i % PROJECT_GRADS.length],
                featured: i === 0,
                thumbnail: pr.has_thumbnail ? projectApi.getThumbnailUrl(pr.id, pr.updated_at) : undefined,
              }))
            : []);
        }
      } catch {
        if (alive) setDataMode('demo');
      }
    })();

    // 类型列表（= 创作表单的「视频类型」下拉选项）。
    // 展示用的类型总览由 TypeCatalogPanel 自己拉（与类型总览页同源），这里只取下拉需要的字段。
    const loadTypeOptions = async () => {
      try {
        const data = await typeMakerApi.list();
        if (Array.isArray(data) && data.length > 0) {
          return data.map(
            (t: { id: string; name: string; description?: string }, i: number) => ({
              id: t.id,
              name: t.name || t.id,
              desc: t.description || '',
              color: PLUGIN_PALETTE[i % PLUGIN_PALETTE.length],
            }),
          );
        }
      } catch {
        /* types not available */
      }
      return null;
    };

    (async () => {
      const result = await loadTypeOptions();
      if (alive && result) setPlugins(result);
    })();

    assetApi.listSources()
      .then((srcs) => { if (alive && Array.isArray(srcs)) setMaterialSources(srcs); })
      .catch(() => {});

    return () => { alive = false; };
  }, []);

  const captions = useMemo(
    () => splitScriptToCaptions(script, splitMode),
    [script, splitMode],
  );

  // 切分后每段的估算时间窗（按字数比例摊到配音时长）。
  // 预览用：真实成片里 AudioAgent 会用配音实测时间重建字幕（上传配音走
  // STT 对齐，自动配音走 TTS 句级时间戳），所以这里只标"估算"。
  const captionTimes = useMemo(() => {
    const weights = captions.map((c) => Math.max(1, c.length));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const dur = audio?.duration || 0;
    let acc = 0;
    return weights.map((w) => {
      const start = dur ? (acc / total) * dur : 0;
      acc += w;
      return { start, end: dur ? (acc / total) * dur : 0 };
    });
  }, [captions, audio?.duration]);

  /** F-09：一键填入预判的时长覆盖（null = 用文案/音频估算）。 */
  const [durationOverride, setDurationOverride] = useState<number | null>(null);

  const estDuration = useMemo(() => {
    if (audio?.duration) return audio.duration;
    // F-09（PRD §2 P2）：旧实现卡片展示"预估时长"，点「一键填入」却只设了类型，
    // 时长完全没变（按钮文案与行为不一致）。override 优先于文本估算。
    if (durationOverride && durationOverride > 0) {
      return Math.max(30, Math.min(1800, Math.round(durationOverride)));
    }
    if (script.trim()) return Math.max(30, Math.min(1800, script.trim().length / 5));
    return 60;
  }, [audio, script, durationOverride]);

  // 裁定 C（2026-11-02）：03 配音步骤的内容由 TTS 功能插件通过 `create.dub` 贡献；
  // 没有贡献时才回落到下面的内置控件（过渡期，PRD §15.9 第 3 项最终删除内置块）。
  const dubSlotContribs = usePluginSlots('create.dub');
  // 插件贡献的配音控件值（裁定 C）：插件声明 optionsFrom/控件 key，宿主只提供数据与回填。
  const [pluginDub, setPluginDub] = useState<Record<string, unknown>>({});
  const dubOptionSources = useMemo(
    () => ({ voices: voices.map((v) => ({ value: v.voice_id, label: `${asText(v.voice_name)}（${asText(v.provider)}）` })) }),
    [voices],
  );
  // 插件选的音色/自动配音要回填进工程状态（引擎侧仍读这两个字段，不改成插件私有约定）
  useEffect(() => {
    const vid = typeof pluginDub.voice_id === 'string' ? pluginDub.voice_id : '';
    const auto = typeof pluginDub.auto_dub === 'boolean' ? pluginDub.auto_dub : undefined;
    if (vid) {
      setVoicePick(vid);
      useProjectStore.getState().setVoiceId(vid || null);
    }
    if (auto !== undefined) {
      setAutoDubPref(auto);
      useProjectStore.getState().setAutoDub(auto);
    }
  }, [pluginDub]);
  const stepDone = {
    script: Boolean(topic.trim() || script.trim()),
    // F-08（PRD §2 P2）：旧实现 `Boolean(personaId || pluginId)`，而 pluginId 默认
    // 'knowledge_longform' → 用户什么都没选 02 就打了勾；类型列表加载失败时也打勾。
    // 现在必须"显式选择过"才算完成（pluginId 初值不算显式选择）。
    style: Boolean(personaId) || (Boolean(pluginId) && pluginId !== DEFAULT_PLUGIN_ID),
    // 有上传配音，或「自动配音 + 已选音色」才算这一步完成；纯画面模式不需要配音
    // 有插件贡献时以插件控件值为准（否则创作页永远显示「未完成」）
    dub: mode === 'visual'
      ? true
      : (Object.keys(pluginDub).length > 0
          ? Boolean(pluginDub.voice_id) || Boolean(pluginDub.auto_dub) || Boolean(audio)
          : Boolean(audio) || Boolean(voicePick)),
    // 工作区是可选步骤：默认值即可启动（开关会随会话下发）
    workspace: true,
  };

  // G6: 一键填入预判推荐（类型插件 / 时长）。仅映射已知插件；时长覆盖当前估算（无真实音频时）。
  const applyPrediction = () => {
    if (!prediction) return;
    // F-09：类型匹配优先用后端返回的类型列表（含用户自定义类型），
    // 再回落内置 4 个 id 的关键词表——旧实现只认写死的 4 个，自定义类型永远匹配不到。
    const wanted = (prediction.video_type ?? '').trim().toLowerCase();
    if (wanted) {
      const byList = plugins.find((p) =>
        String(p.name ?? '').toLowerCase() === wanted || String(p.id).toLowerCase() === wanted);
      if (byList) {
        setPluginId(byList.id);
      } else {
        const mapping: Record<string, string> = {
          'knowledge': 'knowledge_longform',
          '知识': 'knowledge_longform',
          'long': 'knowledge_longform',
          'fastcut': 'kichiku_fastcut',
          '鬼畜': 'kichiku_fastcut',
          'review': 'digital_review',
          '评测': 'digital_review',
          'vlog': 'vlog_daily',
        };
        // 名称包含匹配也要先考虑后端列表里已有的名字
        const byName = plugins.find((p) => wanted.includes(String(p.name ?? '').toLowerCase())
          || String(p.name ?? '').toLowerCase().includes(wanted));
        if (byName) setPluginId(byName.id);
        else {
          for (const [key, pid] of Object.entries(mapping)) {
            if (wanted.includes(key)) { setPluginId(pid); break; }
          }
        }
      }
    }
    // F-09：时长必须真的生效（有真实音频时以音频为准，不覆盖）
    const est = prediction.estimated_duration_sec;
    if (!audio?.duration && typeof est === 'number' && Number.isFinite(est) && est > 0) {
      setDurationOverride(est);
    }
    setPrediction(null);
  };

  const pickAudio = async (file: File) => {    setUploading(true);
    setUploadErr(null);
    setUploadNote(null);
    try {
      // 客户端检测真实音频时长（不依赖后端 ffprobe——Windows 常缺 ffprobe 会返回 0，
      // 导致时长退化为文案估算值，进而使时间轴远短于配音实际长度）
      const clientDuration = await detectAudioDuration(file);
      const res = await assetApi.upload(file);
      const path = res.file_path ?? res.path ?? '';
      const duration = clientDuration || res.duration_sec || 0;
      setAudio({ path, name: res.filename ?? file.name, duration });
      // 复用既有素材（sha256 命中）不是失败：明确告知，避免用户以为上传没生效
      if (res.deduplicated) setUploadNote('已存在，已复用');
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (e instanceof Error ? e.message : '上传失败');
      setUploadErr(detail);
    } finally {
      setUploading(false);
    }
  };

  /**
   * 裁定 C / PRD §15.9 第 10 项（2026-11-02 补）：上传配音的**入口**也归插件
   * （`create.dub` 的 `file` 控件），但**上传执行与回执归宿主** —— 插件拿不到
   * 上传 API、工作区路径与凭据。宿主只做一件事：插件回传的值里出现 `File`
   * 就交给既有 `pickAudio`（时长探测 → 上传 → 去重提示），并记住已处理的那个
   * `File`（同一对象不重复上传）。
   */
  const pluginPickedFileRef = useRef<File | null>(null);
  useEffect(() => {
    const picked = Object.values(pluginDub).find(
      (v): v is File => typeof File !== 'undefined' && v instanceof File,
    );
    if (!picked || pluginPickedFileRef.current === picked) return;
    pluginPickedFileRef.current = picked;
    void pickAudio(picked);
  }, [pluginDub]);

  /** PRD B4：向后端要几条候选选题（只填候选，不覆盖用户已写的标题） */
  const suggestTopics = async () => {
    setSuggesting(true);
    setTopicSuggestErr(null);
    try {
      const res = await pipelineApi.topicSuggest({ category: pluginId, count: 5 });
      if (!res.topics.length) {
        setTopicSuggestErr('后端没有返回选题建议（LLM 与内置库都不可用）');
        setTopicIdeas([]);
      } else {
        setTopicIdeas(res.topics);
      }
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? (e instanceof Error ? e.message : '生成选题建议失败');
      setTopicSuggestErr(detail);
      setTopicIdeas([]);
    } finally {
      setSuggesting(false);
    }
  };

  const launch = async () => {
    if (!topic.trim() && !script.trim()) {
      setLaunchErr('请填写选题或文案');
      return;
    }
    setLaunching(true);
    setLaunchErr(null);
    const st = useProjectStore.getState();
    st.setProjectName(topic.trim() || '未命名项目');
    st.setPersonaId(personaId || 'default');
    st.setPluginId(pluginId);
    st.setRequirementsTopic(topic.trim());
    st.setRequirementsScript(script.trim());
    st.setRequirementsAudioDuration(estDuration);
    st.setScriptText(script.trim());
    st.setVideoMode(mode);
    // F-04：提示词随任务下发（进入 requirements 草稿，供需求阶段消费）
    st.setCreativePrompt(creativePrompt.trim());
    st.setCreativeAvoid(creativeAvoid);
    st.setSplitMode(splitMode);
    st.setAudioPath(audio?.path || '');
    st.setAudioDurationSec(audio?.duration || 0);
    st.setMaterialSourceIds(selectedSources);
    // 工作区：开关随会话下发；root 等创建成功后回填（见下面 projectApi.create 之后）
    st.setWorkspaceAutoIndex(wsAutoIndex);
    st.setWorkspaceVisionIndex(wsVision);
    st.setWorkspaceRoot('');
    st.setDryRun(dryRun); // P8: 传递 dry-run 预览模式
    st.setShotFloorPolicy(shotFloorPolicy); // D23: 镜头下限策略
    st.setShotCapPolicy(shotCapPolicy); // D23: 镜头上限策略（V35 切分）
    // F-01（PRD §2 P1）：旧实现在这里无条件用 localStorage 的旧偏好覆盖
    // `voiceId/autoDub`，会把插件（`create.dub`）里刚选的音色冲掉。
    // 现在以**当前表单值**为准：只有表单没选过（空）时才用本地偏好补齐。
    const formVoiceId = useProjectStore.getState().voiceId || voicePick || '';
    if (formVoiceId) {
      st.setVoiceId(formVoiceId);
      st.setAutoDub(autoDubPref);
    } else {
      try {
        const prefs = JSON.parse(localStorage.getItem('clipwright_voice_prefs') || '{}');
        if (prefs.voiceId) st.setVoiceId(prefs.voiceId);
        if (typeof prefs.autoDub === 'boolean') st.setAutoDub(prefs.autoDub);
      } catch (e) {
        // P3-06: 留痕（本地偏好读取失败不影响主流程）
        console.warn('[HomePage] 本地偏好读取失败:', e);
      }
    }

    // Create project on backend
    // 若健康检查尚未完成（'checking'），先显式探测一次，避免误判为离线
    if (backend === 'online' || backend === 'checking') {
      let online = backend === 'online';
      if (!online) {
        try { await healthApi.check(); online = true; } catch { online = false; }
      }
      if (online) {
        try {
          const project = await projectApi.create({
            name: topic.trim() || '未命名项目',
            timeline: null,
            persona_id: personaId || undefined,
            plugin_id: pluginId || undefined,
          });
          st.setProjectId(project.id);
          // 工作区（PRD workspace-prd-2026-10-24）：项目一建好就创建，编辑器里的
          // 04 步/素材面板与 proceed 双轨都按同一个 project_id 取；失败不阻断启动。
          try {
            const ws = await workspaceApi.create({
              project_id: project.id,
              name: topic.trim() || project.id,
              auto_index: wsAutoIndex,
              vision: wsVision,
              // 只在用户明确选了父目录时传；留空=后端默认根
              ...(wsRootChoice ? { root: wsRootChoice } : {}),
            });
            if (ws?.root) {
              setWsRoot(ws.root);
              st.setWorkspaceRoot(ws.root);
            }
          } catch (e) {
            // F-06（PRD §2 P2）：旧实现只有 console.warn —— 项目建好了但工作区没建出来，
            // 用户进编辑器上传素材/找 materials 目录时才发现，也不知道原因。
            console.warn('[HomePage] 工作区创建失败（不阻断启动）:', e);
            const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
            toast(
              `项目已创建，但工作区初始化失败${typeof d === 'string' && d ? `：${d}` : ''}`
              + '（可在编辑器资源面板「重建工作区」）',
              'error',
            );
          }
          // 仅在项目创建成功后清除旧 draft，失败则保留草稿
          clearRequirementsDraft();
          navigate({ to: '/editor/$projectId', params: { projectId: project.id } });
          return;
        } catch (e) {
          // 批B：后端在线但创建失败（认证/校验等）→ 显式报错。
          // 旧实现静默滑入本地演示模式，用户以为创建成功但什么都没保存。
          const anyE = e as { response?: { data?: { detail?: string } }; code?: string };
          const isNetwork = anyE?.code === 'ERR_NETWORK' || anyE?.code === 'ECONNABORTED';
          if (!isNetwork) {
            const detail = anyE?.response?.data?.detail;
            toast(`项目创建失败：${typeof detail === 'string' && detail ? detail : '请稍后重试'}`, 'error');
            // P2-40: 失败退出必须复位 launching，否则启动按钮永久 disabled
            setLaunching(false);
            return;
          }
          // 网络断开才落入离线演示模式
        }
      }
    }
    // Offline / backend create failed → 仅当 allowDemoFallback 开启时进本地演示项目。
    // F-05（PRD §2 P2）：旧实现无条件滑进演示项目并把 allowDemoFallback 开关当空气，
    // 用户在离线时会以为自己在正常工作、编辑不会保存。
    if (!useSettingsStore.getState().allowDemoFallback) {
      toast('后端离线，无法创建项目（可在设置里开启离线演示回退）', 'error');
      setLaunching(false);
      return;
    }
    const localId = uid('proj');
    st.setProjectId(localId);
    clearRequirementsDraft();
    navigate({ to: '/editor/$projectId', params: { projectId: localId } });
  };

  const openBlank = async () => {
    setLaunching(true);
    const st = useProjectStore.getState();
    st.setProjectName('未命名项目');
    if (backend === 'online' || backend === 'checking') {
      let online = backend === 'online';
      if (!online) {
        try { await healthApi.check(); online = true; } catch { online = false; }
      }
      if (online) {
        try {
          // F-05：与 launch 同口径——非网络错误（鉴权/校验）要报错并保留在原地，
          // 不能静默滑进一个不会保存的本地项目。
          const project = await projectApi.create({ name: '未命名项目', timeline: null });
          st.setProjectId(project.id);
          navigate({ to: '/editor/$projectId', params: { projectId: project.id } });
          return;
        } catch (e) {
          const anyE = e as { response?: { data?: { detail?: string } }; code?: string };
          const isNetwork = anyE?.code === 'ERR_NETWORK' || anyE?.code === 'ECONNABORTED';
          if (!isNetwork) {
            const detail = anyE?.response?.data?.detail;
            // F-05：失败时清掉残留的 requirements 字段，避免随后点空项目意外启动需求会话（E-04）
            useProjectStore.setState({
              requirementsTopic: '', requirementsScript: '', requirementsAudioDuration: 0,
            });
            toast(`创建空项目失败：${typeof detail === 'string' && detail ? detail : '请稍后重试'}`, 'error');
            setLaunching(false);
            return;
          }
        }
      }
    }
    // Offline → 同 launch：受 allowDemoFallback 控制
    if (!useSettingsStore.getState().allowDemoFallback) {
      toast('后端离线，无法创建空项目（可在设置里开启离线演示回退）', 'error');
      setLaunching(false);
      return;
    }
    const localId = uid('proj');
    st.setProjectId(localId);
    // E-04：清掉首页留下的 requirements 字段，否则编辑器会把残留 topic 当 pendingTopic 自动启动
    useProjectStore.setState({
      requirementsTopic: '', requirementsScript: '', requirementsAudioDuration: 0,
    });
    navigate({ to: '/editor/$projectId', params: { projectId: localId } });
  };

  const openProject = async (proj: ProjectOpt) => {
    navigate({ to: '/editor/$projectId', params: { projectId: proj.id } });
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      // P2-39: 走回收站软删除（与项目页一致），不再绕过回收站硬删
      await projectApi.trashProject(projectId);
      setProjects((prev) => prev.filter((project) => project.id !== projectId));
      toast('已移入回收站（可在项目页回收站中恢复）', 'success');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      toast(`删除失败：${reason}，项目已保留`, 'error');
    }
  };

  const reloadProjects = async () => {
    try {
      const projs = await projectApi.list();
      if (Array.isArray(projs)) {
        const valid = projs.filter((pr) => pr && pr.id);
        setProjects(valid.map((pr, i) => ({
          id: pr.id,
          name: pr.name,
          type: pr.plugin_id ?? '—',
          duration: fmtDur(pr.duration_sec ?? 0),
          tracks: pr.track_count ?? 0,
          edited: relTime(pr.updated_at),
          grad: PROJECT_GRADS[i % PROJECT_GRADS.length],
          featured: i === 0,
          thumbnail: pr.has_thumbnail ? projectApi.getThumbnailUrl(pr.id, pr.updated_at) : undefined,
        })));
      }
    } catch (e) {
      // P3-06: 离线兜底；留痕便于诊断
      console.warn('[HomePage] 离线兜底:', e);
    }
  };

  const handleDuplicateProject = async (project: ProjectOpt) => {
    try {
      await projectApi.duplicate(project.id);
      await reloadProjects();
    } catch {
      toast('复制项目失败 — 后端不可达', 'error');
    }
  };

  return (
    <div className="relative min-h-full h-full overflow-y-auto bg-surface text-on-surface">
      <Backdrop />

      <div className="relative z-10 flex min-h-full">
        {/* ── 图一：左侧栏（品牌 + 导航） ── */}
        <HomeSidebar
          activeTab={activeTab}
          onTab={setActiveTab}
        />

        <main className="flex-1 min-w-0 w-full px-8 pb-10">
          {guardNotice && (
            <div className="mb-4 flex items-center gap-3 rounded-cw-md bg-amber-500/10 border border-amber-500/30 px-4 py-3 text-amber-200 text-body-sm">
              <span className="flex-1">{guardNotice}</span>
              <button
                onClick={() => setGuardNotice(null)}
                className="ml-2 text-amber-200/60 hover:text-amber-200 transition-colors cursor-pointer"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
          )}

          {/* ── 首页 tab：开始创作 + 空项目 + 最近项目（图一） ── */}
          {activeTab === 'home' && (
            <section className="pt-8 max-w-[1080px]">
              <div className="flex items-end justify-between gap-4 mb-8">
                <div>
                  <p className="font-mono text-label-sm tracking-[0.3em] text-primary uppercase mb-2">
                    ClipWright · AI 辅助视频创作
                  </p>
                  <h1 className="font-display text-[40px] leading-[1.15] font-bold text-on-surface mb-1">
                    把你的选题，
                    <span className="text-primary">剪</span>成一支视频。
                  </h1>
                  <p className="text-body text-on-surface-variant mt-1 max-w-[520px]">
                    稿件 → 风格 → 配音 → 启动。Agent 负责结构化与体力活，你负责审美与微调。
                  </p>
                </div>
                <Badge variant={dataMode === 'live' ? 'success' : 'default'}>
                  {dataMode === 'live' ? '实时数据' : '演示数据'}
                </Badge>
              </div>

              {/* 顶部操作入口：开始创作 / 空项目 */}
              <div className="flex flex-wrap items-center gap-3 mb-10">
                <Button size="lg" onClick={() => { setActiveTab('create'); window.scrollTo({ top: 0 }); }} className="min-w-[220px] group">
                  <Sparkles className="w-4.5 h-4.5" /> 开始创作
                  <ArrowRight className="w-4 h-4 transition-transform duration-short3 group-hover:translate-x-1" />
                </Button>
                <Button size="lg" variant="outline" onClick={openBlank} className="min-w-[160px]">
                  <Scissors className="w-4 h-4" /> 空项目
                </Button>
                <Button size="lg" variant="ghost" onClick={() => setTemplateGalleryOpen(true)}
                  className="text-on-surface-variant hover:text-primary">
                  <LayoutTemplate className="w-4 h-4" /> 从模板开始
                </Button>
              </div>

              {/* 最近项目（图一：缩略卡片横向） */}
              <div className="flex items-end justify-between mb-4">
                <div>
                  <p className="font-mono text-label-sm tracking-[0.25em] text-on-surface-variant uppercase">Recent</p>
                  <h2 className="text-title font-semibold text-on-surface mt-0.5">最近项目</h2>
                </div>
                <button
                  onClick={() => navigate({ to: '/projects' })}
                  className="flex items-center gap-1.5 text-label-sm text-primary hover:text-primary/80 transition-colors cursor-pointer"
                >
                  全部项目 <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-12 gap-4">
                {projects.map((proj) => (
                  <ProjectCard
                    key={proj.id}
                    proj={proj}
                    mode="simple"
                    onOpen={() => openProject(proj)}
                    onDelete={() => handleDeleteProject(proj.id)}
                    onDuplicate={() => handleDuplicateProject(proj)}
                  />
                ))}
                {projects.length === 0 && (
                  <div className="col-span-12 flex flex-col items-center justify-center py-12 text-center gap-2
                    border border-dashed border-outline-variant/30 rounded-cw-md">
                    <FolderOpen className="w-8 h-8 text-on-surface-variant/40" />
                    <p className="text-body-sm text-on-surface-variant">
                      {dataMode === 'demo' ? '演示数据 · 暂无后端项目' : '还没有项目'}
                    </p>
                    <p className="text-caption text-on-surface-variant/60">
                      {dataMode === 'demo'
                        ? '后端未连接，当前展示的是演示数据；连接后端后这里会显示你的真实项目'
                        : '点击「开始创作」创建你的第一个视频'}
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── 类型 tab：全部类型的只读总览（与 /settings/types 同一份实现） ── */}
          {activeTab === 'types' && (
            <section className="pt-8 max-w-[1080px]">
              <TypeCatalogPanel />
            </section>
          )}

          {/* ── 人格 tab：完整人格库（与 /persona 同一份实现） ──
              点卡片 = 选中该人格并进入创作表单（首页语义）；查看/编辑参数请到人物详情页 */}
          {activeTab === 'personas' && (
            <section className="pt-8 max-w-[1080px]">
              <PersonaGalleryPanel onPick={(id) => { setPersonaId(id); setActiveTab('create'); }} />
            </section>
          )}

          {/* ── 插件 tab：完整插件管理（与 /settings/plugins 同一份实现） ── */}
          {activeTab === 'plugins' && (
            <section className="pt-8 max-w-[1080px]">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="font-mono text-label-sm tracking-[0.3em] text-primary uppercase mb-2">Extensions</p>
                  <h1 className="font-display text-[32px] font-bold text-on-surface">插件</h1>
                  <p className="text-body-sm text-on-surface-variant mt-1">
                    与「设置 → 插件管理」同一套能力：启停、配置、UI 预览、错误通道、健康与贡献。
                  </p>
                </div>
              </div>
              <PluginsPanel />
            </section>
          )}

          {/* ── 设置 tab：本机偏好 + 控制台入口（与 /settings 同一份实现） ── */}
          {activeTab === 'settings' && (
            <section className="pt-8 max-w-[1080px]">
              <p className="font-mono text-label-sm tracking-[0.3em] text-primary uppercase mb-2">Preferences</p>
              <h1 className="font-display text-[32px] font-bold text-on-surface mb-6">设置</h1>
              <PreferencesPanel
                connection
                usage={false}
                appearance
                timeline
                autosave
                demoMode
                materialSources={false}
                keybindings={false}
              />
              <div className="mt-6 bg-surface-container border border-outline-variant/30 rounded-cw-md p-5">
                <h3 className="flex items-center gap-2 text-title-sm font-medium text-on-surface mb-1">
                  <Server className="w-4 h-4 text-primary" /> 系统控制台
                </h3>
                <p className="text-caption text-on-surface-variant mb-3">
                  模型 / 工具 / 插件 / 类型 / 模板 / 管线监控等 {CONSOLE_NAV.length} 项管理页
                </p>
                <div className="flex flex-wrap gap-2">
                  {CONSOLE_NAV.slice(0, 8).map((item) => (
                    <Button key={item.to} size="sm" variant="outline"
                      onClick={() => navigate({ to: item.to })}>
                      {item.label}
                    </Button>
                  ))}
                  <Button size="sm" variant="ghost" onClick={() => navigate({ to: '/settings' })}>
                    <ChevronRight className="w-3.5 h-3.5" /> 完整设置页（全部 {CONSOLE_NAV.length} 项 + 快捷键 / 用量）
                  </Button>
                </div>
              </div>
            </section>
          )}

          {/* ── 创作 tab：图二创作控制台（由「开始创作」进入） ── */}
          {activeTab === 'create' && (
          <section className="grid grid-cols-12 gap-6 pt-8">
            {/* ── production console ── */}
            <div className="col-span-12 lg:col-span-7">
              <p className="font-mono text-label-sm tracking-[0.3em] text-primary uppercase mb-3">
                ClipWright · AI 辅助视频创作
              </p>
              <h1 className="font-display text-[44px] leading-[1.15] font-bold text-on-surface mb-2">
                把你的选题，
                <span className="text-primary">剪</span>成一支视频。
              </h1>
              <p className="text-body text-on-surface-variant mb-4 max-w-[480px]">
                稿件 → 风格 → 配音 → 启动。Agent 负责结构化与体力活，你负责审美与微调。
              </p>

              {/* 路线 C 入口已按产品决定下线：主 Agent 改由「新建制作」承载
                  （一句话出片按钮、/task 启动页与 /task/$id 详情页均已删除；任务在编辑器副驾驶里跑，
                  新建制作走主 Agent 后跳这里看计划与步骤）。 */}

              <div className="bg-surface-container border border-outline-variant/40 rounded-cw-lg overflow-hidden shadow-2xl shadow-black/40">
                {/* console header — Material You tonal banner */}
                <div className="relative flex items-center gap-3.5 px-5 py-4 bg-surface-container-high border-b border-outline-variant/30 overflow-hidden">
                  {/* ambient tonal wash */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: 'linear-gradient(115deg, var(--cw-primary-container) 0%, transparent 60%)', opacity: 0.3 }}
                  />
                  {/* leading tonal icon */}
                  <span className="relative w-11 h-11 rounded-cw-md bg-primary-container flex items-center justify-center shrink-0 shadow-md shadow-primary/25 ring-1 ring-on-primary-container/15">
                    <Clapperboard className="w-5 h-5 text-on-primary-container" />
                  </span>
                  <div className="relative flex-1 min-w-0">
                    <p className="text-title-sm font-semibold text-on-surface leading-snug">新建制作</p>
                    <p className="font-mono text-caption text-on-surface-variant/80 tracking-[0.08em]">new_production.session</p>
                  </div>
                  <Badge variant={dataMode === 'live' ? 'success' : 'warning'} className="relative shrink-0">
                    {dataMode === 'live' ? '实时数据' : '演示数据'}
                  </Badge>
                </div>

                <div className="p-5 space-y-6">
                  {/* ── 01 稿件 ── */}
                  <ConsoleStep
                    no="01" title="稿件" en="SCRIPT" done={stepDone.script}
                    stat={script.trim()
                      ? `${script.trim().length} 字 · 预估 ${fmtDur(estDuration)}`
                      : undefined}
                  >
                    <div className="flex items-center gap-2 bg-surface rounded-cw-sm border border-outline-variant/40 focus-within:border-primary transition-colors px-3 mb-2.5">
                      <span className="font-mono text-primary text-body select-none">&gt;</span>
                      <input
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        placeholder="视频选题，例如：深度解析某品牌新手机的散热设计…"
                        className="flex-1 bg-transparent outline-none py-3 text-body text-on-surface placeholder:text-on-surface-variant/40 font-mono"
                      />
                      {topic && (
                        <button onClick={() => setTopic('')} className="p-1 text-on-surface-variant/50 hover:text-on-surface cursor-pointer">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {/* PRD B4：选题建议（后端 /api/pipeline/topic-suggest；只填候选，不覆盖已写内容） */}
                      <button
                        type="button"
                        data-testid="topic-suggest"
                        disabled={suggesting}
                        onClick={() => void suggestTopics()}
                        className="shrink-0 px-2 py-1 rounded-cw-xs text-caption text-primary hover:bg-primary/10
                          disabled:opacity-50 cursor-pointer"
                      >
                        {suggesting ? '生成中…' : '选题建议'}
                      </button>
                    </div>
                    {topicIdeas.length > 0 && (
                      <div className="mb-2.5 rounded-cw-sm border border-outline-variant/40 bg-surface px-3 py-2" data-testid="topic-ideas">
                        <p className="mb-1 text-caption text-on-surface-variant/70">候选选题（点击填入标题，可再编辑）</p>
                        <ul className="space-y-1">
                          {topicIdeas.map((t) => (
                            // E-06 线索 6（PRD §5A）：title/reason 来自模型产物，
                            // 运行时可能是对象——直进 JSX 会炸整块表单。
                            <li key={asText(t.title)}>
                              <button
                                type="button"
                                onClick={() => { setTopic(asText(t.title)); setTopicIdeas([]); }}
                                className="w-full text-left text-body-sm text-on-surface hover:text-primary cursor-pointer"
                              >
                                {asText(t.title)}
                                {t.reason && <span className="ml-1 text-caption text-on-surface-variant/60">— {asText(t.reason)}</span>}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {topicSuggestErr && (
                      <p className="mb-2 text-caption text-error" data-testid="topic-suggest-err">{topicSuggestErr}</p>
                    )}
                    <textarea
                      value={script}
                      onChange={(e) => setScript(e.target.value)}
                      rows={4}
                      placeholder="粘贴口播文案 / 旁白稿（可选）。将按所选规则切分为字幕段…"
                      className="w-full bg-surface rounded-cw-sm border border-outline-variant/40 focus:border-primary transition-colors
                        px-3 py-2.5 text-body-sm text-on-surface leading-relaxed outline-none resize-y placeholder:text-on-surface-variant/40"
                    />

                    {/* G6: 文稿智能预判推荐卡片 */}
                    {prediction && (
                      <div className="mt-2.5 bg-primary/5 border border-primary/30 rounded-cw-md p-3">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Wand2 className="w-3.5 h-3.5 text-primary" />
                          <span className="text-label font-medium text-on-surface">智能预判</span>
                          <span className="ml-auto text-caption text-on-surface-variant/60">基于文稿分析</span>
                        </div>
                        {prediction.video_type && (
                          // E-06 线索 6：模型产物字段一律过 asText
                          <p className="text-label-sm text-on-surface"><span className="text-on-surface-variant">推荐类型：</span>{asText(prediction.video_type)}</p>
                        )}
                        {prediction.estimated_duration_sec && (
                          <p className="text-label-sm text-on-surface"><span className="text-on-surface-variant">预估时长：</span>约 {asText(prediction.estimated_duration_sec)}s</p>
                        )}
                        {prediction.recommended_persona_tone && (
                          <p className="text-label-sm text-on-surface"><span className="text-on-surface-variant">风格基调：</span>{asText(prediction.recommended_persona_tone)}</p>
                        )}
                        {prediction.summary && (
                          <p className="text-caption text-on-surface-variant mt-1">{asText(prediction.summary)}</p>
                        )}
                        <button
                          onClick={applyPrediction}
                          className="mt-2 px-2.5 py-1 rounded-cw-xs bg-primary text-on-primary text-label-sm hover:bg-primary/90 transition-colors cursor-pointer"
                        >
                          一键填入推荐类型
                        </button>
                      </div>
                    )}
                  </ConsoleStep>

                  {/* ── 02 风格 ── */}
                  <ConsoleStep no="02" title="风格" en="STYLE" done={stepDone.style}>
                    <label className="text-label text-on-surface-variant block mb-2">创作人格 Persona</label>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {personas.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setPersonaId(p.id)}
                          className={`px-3 py-1.5 rounded-cw-full text-label-sm border transition-all duration-short3 cursor-pointer ${
                            personaId === p.id
                              ? 'bg-primary-container border-primary text-on-primary-container shadow-md shadow-primary/20'
                              : 'bg-surface-container-high border-outline-variant/40 text-on-surface-variant hover:border-outline hover:text-on-surface'
                          }`}
                        >
                          {asText(p.name)}
                          <span className="opacity-60 ml-1">· {asText(p.tone)}</span>
                        </button>
                      ))}
                      <button
                        onClick={() => navigate({ to: '/persona/forge' })}
                        className="w-8 h-8 rounded-cw-full border border-dashed border-outline-variant/40 hover:border-primary/60
                          flex items-center justify-center text-on-surface-variant hover:text-primary
                          bg-surface-container-high hover:bg-primary/5 transition-all cursor-pointer"
                        title="新建人格"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <label className="text-label text-on-surface-variant block mb-2">视频类型插件</label>
                    <div className="grid grid-cols-2 gap-2">
                      {plugins.map((pl) => (
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
                            <span className={`text-body-sm font-medium truncate ${pluginId === pl.id ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
                              {asText(pl.name)}
                            </span>
                          </span>
                          {pl.desc && (
                            <span className="block text-caption text-on-surface-variant/70 mt-0.5 ml-4 font-mono truncate">{pl.desc}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </ConsoleStep>

                  {/* ── 素材源 ── */}
                  {materialSources.length > 0 && (
                    <ConsoleStep no="" title="素材源" en="SOURCES" done={selectedSources.length > 0}
                      stat={selectedSources.length > 0 ? `已选 ${selectedSources.length} 个` : undefined}>
                      <p className="text-caption text-on-surface-variant mb-2">选择 Agent 检索素材时使用的来源。不选则使用全部可用源。</p>
                      <div className="flex flex-wrap gap-1.5">
                        {materialSources.map((s) => {
                          const sel = selectedSources.includes(s.id);
                          return (
                            <button key={s.id}
                              onClick={() => setSelectedSources(sel
                                ? selectedSources.filter((x) => x !== s.id)
                                : [...selectedSources, s.id])}
                              className={`px-2.5 py-1 rounded-cw-full text-label-sm border transition-all duration-short3 cursor-pointer ${
                                sel
                                  ? 'bg-track-video/15 border-track-video/60 text-track-video'
                                  : 'bg-surface-container-high border-outline-variant/40 text-on-surface-variant hover:border-outline'
                              }`}
                            >
                              {s.name || s.id}
                            </button>
                          );
                        })}
                      </div>
                    </ConsoleStep>
                  )}

                  {/* ── 03 配音与字幕 ── */}
                  <ConsoleStep no="03" title="配音与字幕" en="DUB & CAPTION" done={stepDone.dub}
                    stat={audio ? `${audio.name} · ${fmtDur(audio.duration)}` : undefined}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="flex-1 bg-surface/40 rounded-cw-sm border border-outline-variant/40 p-2.5">
                        <p className="text-caption text-on-surface-variant">
                          配音可上传也可不上传：上传后字幕按配音实测时间对齐；不上传时用自动配音生成旁白（可关闭），
                          字幕同样按旁白时间对齐。两者都关闭则为纯画面模式。
                        </p>
                      </div>

                      {dubSlotContribs.length === 0 && voices.length > 0 && (
                        <select
                          value={voicePick}
                          onChange={(e) => {
                            setVoicePick(e.target.value);
                            const st = useProjectStore.getState();
                            st.setVoiceId(e.target.value || null);
                            st.setAutoDub(autoDubPref);
                            try {
                              localStorage.setItem('clipwright_voice_prefs', JSON.stringify({ voiceId: e.target.value || null, autoDub: autoDubPref }));
                            } catch (e) {
      // P3-06: 留痕（本地偏好读取失败不影响主流程）
      console.warn('[HomePage] 本地偏好读取失败:', e);
    }
                          }}
                          className="px-2 py-1.5 rounded-cw-xs bg-surface border border-outline-variant/40 text-label-sm text-on-surface cursor-pointer"
                          title="选择克隆音色（可在「语音克隆」页制作）"
                        >
                          <option value="">不指定音色</option>
                          {voices.map((v) => (
                            <option key={v.id} value={v.voice_id}>{asText(v.voice_name)}（{asText(v.provider)}）</option>
                          ))}
                        </select>
                      )}

                      {/* P2-04: 踩点剪辑入口——开启后 EditAgent 按 BPM 卡点切镜 */}
                      <label className="flex items-center gap-1.5 px-1 text-label-sm text-on-surface-variant cursor-pointer select-none"
                        title="按音乐节拍卡点剪辑（需填写 BPM；留空则用后端检测值）">
                        <input
                          type="checkbox"
                          checked={cutOnBeat}
                          onChange={(e) => { setCutOnBeatState(e.target.checked); useProjectStore.getState().setCutOnBeat(e.target.checked); }}
                          className="accent-primary cursor-pointer"
                        />
                        踩点剪辑
                      </label>
                      {cutOnBeat && (
                        <input
                          type="number" min={40} max={300} step={1}
                          value={beatBpm ?? ''}
                          placeholder="BPM"
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            const v = Number.isFinite(n) && n > 0 ? n : null;
                            setBeatBpmState(v);
                            useProjectStore.getState().setBeatBpm(v);
                          }}
                          className="w-16 px-2 py-1 rounded-cw-xs bg-surface border border-outline-variant/40 text-label-sm text-on-surface"
                        />
                      )}

                      {dubSlotContribs.length === 0 && (
                      <label className="flex items-center gap-1.5 px-1 text-label-sm text-on-surface-variant cursor-pointer select-none" title="关闭后不自动生成旁白（适合纯画面/B-roll 视频）；开启需先选择音色">
                          <input
                            type="checkbox"
                            checked={autoDubPref}
                            onChange={(e) => {
                              setAutoDubPref(e.target.checked);
                              const st = useProjectStore.getState();
                              st.setAutoDub(e.target.checked);
                              try {
                                const prefs = JSON.parse(localStorage.getItem('clipwright_voice_prefs') || '{}');
                                localStorage.setItem('clipwright_voice_prefs', JSON.stringify({ voiceId: prefs.voiceId ?? null, autoDub: e.target.checked }));
                              } catch (e) {
      // P3-06: 留痕（本地偏好读取失败不影响主流程）
      console.warn('[HomePage] 本地偏好读取失败:', e);
    }
                            }}
                            className="accent-primary cursor-pointer"
                          />
                          自动配音
                        </label>
                      )}

                      <div className="flex bg-surface rounded-cw-sm border border-outline-variant/40 p-0.5">
                          <button
                            onClick={() => setSplitMode('period')}
                            className={`px-2.5 py-1.5 rounded-cw-xs text-label-sm transition-colors cursor-pointer ${
                              splitMode === 'period' ? 'bg-secondary-container text-secondary' : 'text-on-surface-variant hover:text-on-surface'
                            }`}
                          >
                            按句号切分
                          </button>
                          <button
                            onClick={() => setSplitMode('punctuation')}
                            className={`px-2.5 py-1.5 rounded-cw-xs text-label-sm transition-colors cursor-pointer ${
                              splitMode === 'punctuation' ? 'bg-secondary-container text-secondary' : 'text-on-surface-variant hover:text-on-surface'
                            }`}
                          >
                            按标点切分
                          </button>
                        </div>
                    </div>

                    {/* 裁定 C：插件通过 create.dub 贡献配音入口时，内置控件整块让位；
                        没有贡献才回落到下面这段（过渡期，PRD §15.9 第 3 项最终删除）。 */}
                    {dubSlotContribs.length > 0 && (
                      <Slot name="create.dub" context={{ mode, hasTimeline: false }}
                        optionSources={dubOptionSources} onValuesChange={setPluginDub} />
                    )}

                    {/* 内置上传入口：只在「无插件贡献」时渲染——插件用 `file` 控件提供同一入口
                        （裁定 C：有贡献时内置配音控件整块让位）。 */}
                    {dubSlotContribs.length === 0 && (
                      <>
                        <input
                          ref={audioInputRef} type="file" accept=".wav,.mp3,.m4a,.mp4" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) pickAudio(f); e.target.value = ''; }}
                        />
                        {!audio && (
                          <button
                            onClick={() => audioInputRef.current?.click()}
                            disabled={uploading}
                            className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-outline-variant/40 hover:border-track-audio/60
                              rounded-cw-sm py-3 text-label-sm text-on-surface-variant hover:text-track-audio transition-colors cursor-pointer disabled:opacity-60"
                          >
                            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            {uploading ? '上传中…' : '上传配音文件（wav / mp3 / m4a）· 也可不上传，用自动配音'}
                          </button>
                        )}
                      </>
                    )}

                    {/* 上传**执行与回执**归宿主（插件只提供入口，拿不到上传 API / 工作区路径 /
                        凭据）：两种模式下渲染同一份回执，空值时不占位。 */}
                    {uploading && dubSlotContribs.length > 0 && (
                      <p className="flex items-center gap-1.5 text-caption text-on-surface-variant mt-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" />上传中…
                      </p>
                    )}
                    {audio && (
                      <div className="flex items-center gap-3 bg-track-audio/8 border border-track-audio/40 rounded-cw-sm px-3 py-2.5">
                        <AudioLines className="w-4 h-4 text-track-audio shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-body-sm text-on-surface truncate">{audio.name}</p>
                          <div className="flex items-end gap-0.5 h-3 mt-1">
                            {Array.from({ length: 32 }).map((_, i) => (
                              <i key={i} className="flex-1 rounded-t-[1px] bg-track-audio/70"
                                style={{ height: `${20 + 70 * Math.abs(Math.sin(i * 1.7))}%` }} />
                            ))}
                          </div>
                        </div>
                        <span className="font-mono text-caption text-track-audio shrink-0">{fmtDur(audio.duration)}</span>
                        <button onClick={() => { setAudio(null); setUploadNote(null); }}
                          className="p-1 rounded-cw-xs text-on-surface-variant hover:text-error cursor-pointer shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    {uploadErr && <p className="text-caption text-error mt-1.5">{uploadErr}</p>}
                    {uploadNote && (
                      <p className="text-caption text-track-audio mt-1.5" data-testid="audio-upload-note">
                        {uploadNote}
                      </p>
                    )}

                    {autoDubPref && !voicePick && !audio && (
                      <p className="text-caption text-on-surface-variant/70 mt-1.5">
                        自动配音需要先选择音色；未选音色时按「画面优先」处理，不生成旁白。也可以直接上传配音文件。
                      </p>
                    )}

                    {captions.length > 0 && (
                      <div className="mt-3">
                        <p className="flex items-center gap-1.5 text-caption text-on-surface-variant mb-1.5">
                          <Scissors className="w-3 h-3 text-track-caption" />
                          字幕切分预览 · {captions.length} 段
                          {audio ? '（起点按配音时长估算，成片按实测时间对齐）' : ''}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {captions.slice(0, 6).map((c, i) => (
                            <span key={i}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-cw-xs bg-surface-container-high border border-outline-variant/30
                                text-caption text-on-surface-variant caption-chip"
                              style={{ animationDelay: `${i * 40}ms` }}
                            >
                              <b className="font-mono text-track-caption">{String(i + 1).padStart(2, '0')}</b>
                              <span className="max-w-[180px] truncate">{c}</span>
                              {audio && (
                                <span className="font-mono text-caption text-on-surface-variant/60 shrink-0">
                                  {fmtDur(captionTimes[i]?.start ?? 0)}
                                </span>
                              )}
                            </span>
                          ))}
                          {captions.length > 6 && (
                            <span className="px-2 py-1 rounded-cw-xs text-caption text-on-surface-variant/60 font-mono">
                              +{captions.length - 6} 段
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {mode === 'visual' && (
                      <p className="text-caption text-on-surface-variant/70 leading-relaxed">
                        画面优先模式：文案每一行视为一个场景描述，由素材 Agent 检索匹配画面。
                      </p>
                    )}
                  </ConsoleStep>

                  {/* ── 04 工作区（PRD workspace-prd-2026-10-24）── */}
                  {/* 项目的一切产物（工程文件/素材/下载/成片/缓存）都落在这里；
                      materials/ 是唯一用户写入区：系统下载与你手动丢进去的文件都在那儿，
                      新文件会被后端自动索引 + 视觉解读。 */}
                  <ConsoleStep no="04" title="工作区" en="WORKSPACE" done={stepDone.workspace}
                    stat={wsRoot || undefined}>
                    <div className="space-y-2.5">
                      <p className="text-caption text-on-surface-variant">
                        项目产物统一保存到工作区：工程文件、素材、下载、成片、缓存都在同一个目录，可整体备份。
                        把视频/图片/音乐直接放进 <code className="font-mono">materials/</code>，
                        系统会发现并自动索引（含视觉解读）。
                      </p>
                      <div className="flex flex-wrap items-center gap-4">
                        <label className="flex items-center gap-1.5 text-label-sm text-on-surface-variant cursor-pointer select-none"
                          title="轮询 materials/ 发现新素材（默认开）">
                          <input type="checkbox" checked={wsAutoIndex}
                            onChange={(e) => { setWsAutoIndex(e.target.checked); useProjectStore.getState().setWorkspaceAutoIndex(e.target.checked); }}
                            className="accent-primary cursor-pointer" />
                          自动索引新素材
                        </label>
                        <label className="flex items-center gap-1.5 text-label-sm text-on-surface-variant cursor-pointer select-none"
                          title="对未索引素材做标签/描述；默认本地 CLIP（零 API 费用），选 llm 才按次计费">
                          <input type="checkbox" checked={wsVision}
                            onChange={(e) => { setWsVision(e.target.checked); useProjectStore.getState().setWorkspaceVisionIndex(e.target.checked); }}
                            className="accent-primary cursor-pointer" />
                          视觉解读
                        </label>
                        {wsRootChoices.length > 0 && (
                          <label className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
                            保存位置
                            <select
                              aria-label="工作区父目录"
                              data-testid="ws-root-select"
                              className="rounded-cw-sm border border-outline-variant/40 bg-surface-container px-1.5 py-1 text-caption"
                              value={wsRootChoice}
                              onChange={(e) => setWsRootChoice(e.target.value)}
                            >
                              {wsRootChoices.map((r) => (
                                <option key={r.path} value={r.path} disabled={!r.writable}>
                                  {r.path}{r.writable ? '' : '（不可写）'}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {wsRoot && (
                          <span className="text-caption text-on-surface-variant/80 font-mono break-all">
                            {wsRoot}
                          </span>
                        )}
                      </div>
                      {/*
                        F-02（PRD §2 P1）：创作表单是「新建项目」表单，但 projectId
                        来自跨页面保留的 projectStore——从编辑器返回首页时它是**上一个**
                        项目的 id。旧实现在这里只要有 projectId 就渲染面板，用户会以为
                        素材已经带进来了，甚至误往旧项目里丢文件。
                        新建态一律只显示说明；真实面板在进入编辑器后由该项目的工作区承载。
                      */}
                      <p className="text-caption text-on-surface-variant/60">
                        启动制作后会按项目名创建：<code className="font-mono">workspaces/&lt;项目名&gt;-&lt;id&gt;/</code>
                        （materials/ 可随时打开丢素材）。
                      </p>
                    </div>
                  </ConsoleStep>

                  {/* ── 05 创作提示词（F-07：按视觉顺序连续编号，旧注释是 03.5）── */}
                  <CreativePromptField
                    value={creativePrompt}
                    avoid={creativeAvoid}
                    onChange={setCreativePrompt}
                    onAvoidChange={setCreativeAvoid}
                    onOpenChat={() => setChatOpen(true)}
                  />

                  {/* ── 06 启动（F-07：此前与工作区同为「04」）── */}
                  <div className="border-t border-outline-variant/25 pt-4">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-4 font-mono text-caption text-on-surface-variant">
                      <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{captions.length || '—'} 段字幕</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />≈ {fmtDur(estDuration)}</span>
                      {/*
                        F-04（PRD §2 P2）：`mode === 'voiceover'` 既包含「已上传配音」，
                        也包含「自动配音 + 已选音色」（见 estDuration 的判定）。
                        旧文案在这两种情况下都写「无配音」，让用户以为设置没生效。
                      */}
                      <span className="flex items-center gap-1" data-testid="launch-summary-dub"><Mic className="w-3 h-3" />{
                        mode !== 'voiceover'
                          ? '画面优先'
                          : audio
                            ? '已上传配音'
                            : voicePick
                              ? `自动配音（${voices.find((v) => v.voice_id === voicePick)?.voice_name ?? voicePick}）`
                              : '无配音'
                      }</span>
                      {/* F-08：未显式选类型时如实说「使用默认」，不要伪装成用户已选 */}
                      <span className="flex items-center gap-1" data-testid="launch-summary-type"><Layers className="w-3 h-3" />{
                        pluginId && pluginId !== DEFAULT_PLUGIN_ID
                          ? (plugins.find((p) => p.id === pluginId)?.name ?? pluginId)
                          : plugins.length === 0
                            ? '类型列表加载失败'
                            : `使用默认：${plugins.find((p) => p.id === pluginId)?.name ?? '知识区长片'}`
                      }</span>
                    </div>
                    {launchErr && (
                      <div className="mb-3 bg-error/10 border border-error/30 rounded-cw-sm px-3 py-2 text-label-sm text-error">
                        {launchErr}
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <Button size="lg" onClick={launch} disabled={launching} className="flex-1 group">
                        {launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                        {launching ? '启动管线中…' : '开始创作'}
                        <ArrowRight className="w-4 h-4 transition-transform duration-short3 group-hover:translate-x-1" />
                      </Button>
                      <Button size="lg" variant="outline" onClick={openBlank}>
                        <Plus className="w-4 h-4" />
                        空白编辑器
                      </Button>
                      <Button size="lg" variant="ghost" onClick={() => setTemplateGalleryOpen(true)}
                        className="text-on-surface-variant hover:text-primary">
                        <LayoutTemplate className="w-4 h-4" />
                        从模板开始
                      </Button>
                    </div>
                    {/* P8: dry-run 预览模式开关 */}
                    <label className="mt-3 flex items-center gap-2 text-label-sm text-on-surface-variant cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={dryRun}
                        onChange={(e) => setDryRun(e.target.checked)}
                        className="accent-primary w-3.5 h-3.5"
                      />
                      仅预览（dry-run）— 只生成粗剪时间线，跳过动画/音频/质检，快速出规划
                    </label>
                    {/* D23: 镜头节奏策略（下限合并 / 上限切分，都保总时长） */}
                    <label className="mt-2 flex items-center gap-2 text-label-sm text-on-surface-variant select-none">
                      <span className="shrink-0">镜头下限</span>
                      <select
                        value={shotFloorPolicy}
                        onChange={(e) => setShotFloorPolicy(e.target.value)}
                        className="bg-surface rounded-cw-xs px-2 py-1 text-label-sm text-on-surface outline-none border border-outline-variant/30 focus:border-primary cursor-pointer"
                        data-testid="shot-floor-policy"
                      >
                        <option value="default">跟随类型节奏（合并达标，保总时长）</option>
                        <option value="record">仅记录冲突（C2）</option>
                        <option value="extend">拉长画面到下限</option>
                        {/* F-11（PRD §2 P2）：后端渲染尚不支持 loop，旧实现允许选中并下发，
                            用户选了却看不到效果 → 明确禁用并说明原因。 */}
                        <option value="loop" disabled>循环填充（暂未支持，渲染端未实现）</option>
                        <option value="off">不处理</option>
                      </select>
                    </label>
                    {/* D23 上界：超过 max_shot_ms 的场景切分成多镜（V35 靠它落地） */}
                    <label className="mt-1.5 flex items-center gap-2 text-label-sm text-on-surface-variant select-none">
                      <span className="shrink-0">镜头上限</span>
                      <select
                        value={shotCapPolicy}
                        onChange={(e) => setShotCapPolicy(e.target.value)}
                        className="bg-surface rounded-cw-xs px-2 py-1 text-label-sm text-on-surface outline-none border border-outline-variant/30 focus:border-primary cursor-pointer"
                        data-testid="shot-cap-policy"
                      >
                        <option value="default">跟随类型节奏（超长切分，保总时长）</option>
                        <option value="record">仅记录冲突（C3）</option>
                        <option value="off">不处理</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* ── workflow stepper + status ── */}
            <div className="col-span-12 lg:col-span-5 lg:pl-4">
              <p className="font-mono text-label-sm tracking-[0.25em] text-on-surface-variant uppercase mb-4 mt-1">
                Human-in-the-loop 工作流
              </p>
              <div className="relative space-y-0">
                <span className="absolute left-[19px] top-3 bottom-3 w-px bg-gradient-to-b from-track-video via-track-text to-track-audio opacity-40" />
                {WORKFLOW.map((step, i) => (
                  <div key={step.title} className="relative flex gap-4 pb-6 last:pb-0 group">
                    <span
                      className="relative z-10 w-10 h-10 rounded-cw-md flex items-center justify-center shrink-0 border transition-transform duration-short3 group-hover:scale-110"
                      style={{ background: `${step.color}1A`, borderColor: `${step.color}66`, color: step.color }}
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
                      {backend === 'online' ? `已连接 ${(() => {
                        // F-10：端口/主机必须读真实 baseURL；失败时如实说「未知」，
                        // 旧实现回落写死的 localhost:8000（后端默认其实是 8080）。
                        try {
                          const raw = getApiClient().defaults.baseURL || '';
                          return raw ? new URL(raw, window.location.origin).host : window.location.host;
                        } catch { return '未知地址'; }
                      })()}`
                        : backend === 'offline' ? '离线 · 演示模式'
                        : '检测中…'}
                    </span>
                  </span>
                </div>
                <p className="text-caption text-on-surface-variant/70 mt-1.5 leading-relaxed">
                  {backend === 'offline'
                    ? '未检测到后端。编辑器仍可独立使用，Agent 功能将以演示数据运行。'
                    : 'Persona 引擎、七 Agent 管线与渲染队列已就绪。'}
                </p>
                {/* 组件级健康：后端 /health 逐项探测 mongodb / llm / ffmpeg /
                    hyperframes / 队列，前端此前只读 status 把这些全丢了。
                    只在拿到响应且在线时展示（离线时组件状态无意义，不编造）。 */}
                {backend === 'online' && healthComponents.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid="health-components">
                    {healthComponents.map((item) => (
                      <span
                        key={item.key}
                        data-testid={`health-component-${item.key}`}
                        title={`${item.label}: ${item.value}`}
                        className={`inline-flex items-center gap-1 rounded-cw-full px-2 py-0.5 text-caption border ${
                          item.tone === 'ok'
                            ? 'text-track-audio border-track-audio/30 bg-track-audio/10'
                            : item.tone === 'warn'
                              ? 'text-track-text border-track-text/30 bg-track-text/10'
                              : item.tone === 'error'
                                ? 'text-error border-error/30 bg-error/10'
                                : 'text-on-surface-variant border-outline-variant/30 bg-surface'
                        }`}
                      >
                        <i className="w-1.5 h-1.5 rounded-full bg-current" />
                        {item.label}
                        <span className="opacity-70">{item.valueLabel}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
          )}

          {/* 底部快捷键提示 */}
          <footer className="border-t border-outline-variant/20 py-3 mt-10">
            <div className="flex items-center gap-6 text-caption text-on-surface-variant/60 font-mono">
              <span>空格 = 播放/暂停</span>
              <span>S = 分割</span>
              <span>Del = 删除</span>
              <span>Ctrl+滚轮 = 缩放</span>
              <span>M = 标记</span>
              {/* F-12：去掉内部版本/阶段标记（v0.1.0 · Phase 5 是开发期信息，对用户无意义） */}
              <span className="ml-auto">ClipWright</span>
            </div>
          </footer>
        </main>
      </div>

      <style>{`
        @keyframes captionChipIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .caption-chip { animation: captionChipIn 0.25s var(--ease-emphasized-decelerate) both; }
      `}</style>

      {/* A3: 模板画廊 */}
      <TemplateGallery
        open={templateGalleryOpen}
        onClose={() => setTemplateGalleryOpen(false)}
        onApplyProject={(projectId) => navigate({ to: '/editor/$projectId', params: { projectId } })}
      />

      {/* F-04/F-05：右侧对话按钮打开的 ChatForge 抽屉 */}
      {chatOpen && (
        <ChatForgeDrawer
          context={{
            type: pluginId,
            topic: topic.trim(),
            has_audio: Boolean(audio),
            existing_prompt: creativePrompt,
            existing_avoid: creativeAvoid,
          }}
          onApply={({ prompt, avoid }) => {
            setCreativePrompt(prompt);
            setCreativeAvoid(avoid);
          }}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}

/* ── 图一：左侧栏（品牌 + 导航）───────────────────────── */
function HomeSidebar({ activeTab, onTab }: {
  activeTab: HomeTab;
  onTab: (t: HomeTab) => void;
}) {
  const navigate = useNavigate();

  // D-3a：插件主导航项
  const pluginNav = usePluginSlots('nav.primary');

  const NAV: { id: HomeTab; label: string; icon: typeof Home }[] = [
    { id: 'home', label: '首页', icon: Home },
    { id: 'types', label: '类型', icon: Shapes },
    { id: 'personas', label: '人格', icon: User },
    { id: 'plugins', label: '插件', icon: Puzzle },
    { id: 'settings', label: '设置', icon: Settings },
  ];

  return (
    <aside className="w-[236px] shrink-0 border-r border-outline-variant/25 bg-surface-container-low/60 flex flex-col sticky top-0 h-screen">
      {/* brand */}
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <div className="w-9 h-9 rounded-cw-sm bg-primary-container flex items-center justify-center shadow-lg shadow-primary/20">
          <Film className="w-5 h-5 text-on-primary-container" />
        </div>
        <div className="leading-tight">
          <p className="text-title-sm font-bold text-on-surface tracking-wide">帧艺</p>
          <p className="font-mono text-caption text-on-surface-variant tracking-[0.2em]">CLIPWRIGHT</p>
        </div>
      </div>

      {/* 导航（图一：首页/类型/人格/插件/设置）——点击直接切换右侧内容区 */}
      <nav className="flex-1 px-3 space-y-1">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-cw-sm text-label-sm font-medium transition-all duration-short3 cursor-pointer ${
              activeTab === id
                ? 'bg-primary-container text-on-primary-container shadow-md shadow-primary/20'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}

        {/* D-3a：插件贡献的主导航项（payload.to 路径跳转；无贡献零渲染） */}
        {pluginNav.map((c) => {
          // B9：路径白名单校验，非法值不渲染（避免 navigate 把用户送进错误页）
          const to = safePluginPath((c.payload as { to?: unknown } | undefined)?.to);
          if (!to) return null;
          return (
            <button
              key={c.id}
              onClick={() => navigate({ to })}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-cw-sm text-label-sm font-medium
                text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-all duration-short3 cursor-pointer"
            >
              <Puzzle className="w-4 h-4" />
              {c.title}
            </button>
          );
        })}
      </nav>

      {/* 底部：其他入口 */}
      <div className="px-3 pb-5 pt-3 space-y-1 border-t border-outline-variant/20">
        <button
          onClick={() => navigate({ to: '/projects' })}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-cw-sm text-label-sm text-on-surface-variant
            hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
        >
          <FolderOpen className="w-4 h-4" /> 我的项目
        </button>
        <button
          onClick={() => navigate({ to: '/voice' })}
          className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-cw-sm text-label-sm text-on-surface-variant
            hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
        >
          <Mic className="w-4 h-4" /> 音色库
        </button>
      </div>
    </aside>
  );
}

/* ── console step header ───────────────────────────────── */
function ConsoleStep({ no, title, en, done, stat, children }: {
  no: string; title: string; en: string; done: boolean;
  stat?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3">
        <span className={`w-6 h-6 rounded-cw-xs flex items-center justify-center font-mono text-caption border transition-all duration-medium2 ${
          done
            ? 'bg-track-audio/15 border-track-audio/60 text-track-audio'
            : 'bg-surface-container-high border-outline-variant/40 text-on-surface-variant'
        }`}>
          {done ? <Check className="w-3.5 h-3.5" /> : no}
        </span>
        <span className="text-title-sm font-semibold text-on-surface">{title}</span>
        <span className="font-mono text-caption tracking-[0.2em] text-on-surface-variant/50 uppercase">{en}</span>
        {stat && (
          <span className="ml-auto font-mono text-caption text-primary/80 bg-primary/8 border border-primary/20 rounded-cw-full px-2 py-0.5">
            {stat}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/* ── decorative components ─────────────────────────────── */
function Backdrop() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #8D8D99 1px, transparent 1px), linear-gradient(to bottom, #8D8D99 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }}
      />
      <div
        className="absolute -top-40 -left-40 w-[640px] h-[640px] rounded-full opacity-[0.14]"
        style={{ background: 'radial-gradient(circle, #4F6BED 0%, transparent 65%)' }}
      />
      <div
        className="absolute -bottom-48 -right-32 w-[560px] h-[560px] rounded-full opacity-[0.08]"
        style={{ background: 'radial-gradient(circle, #D1708E 0%, transparent 65%)' }}
      />
    </div>
  );
}

function RulerStrip() {
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
      <span className="absolute top-0 bottom-0 w-px bg-playhead shadow-[0_0_8px_rgba(255,68,68,0.8)] ruler-sweep" />
      <style>{`
        @keyframes rulerSweep { 0% { left: -2%; } 100% { left: 102%; } }
        .ruler-sweep { animation: rulerSweep 9s linear infinite; }
      `}</style>
    </div>
  );
}

// RulerStrip 与旧 TopBar 已由图一左侧栏（HomeSidebar）替代，不再使用。






