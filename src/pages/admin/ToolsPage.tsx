import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { ConsoleShell, ConsoleHeading } from './ConsoleShell';
import { toolApi, skillApi } from '@/services/api';
import { toolSurfaceApi, type ToolSurfaceEntry, type ToolCallRecord } from '@/services/api/toolSurface';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Wrench, Sparkles, Terminal, Loader2, ChevronRight, ListOrdered, Bot } from 'lucide-react';

interface ToolItem { name: string; description?: string; }

/** 主 Agent 的一等工具（后端 `tool/surface.py::AGENT_TOOLS`）——目录里要能一眼看到 */
const AGENT_TOOL_NAMES = ['delegate_agent', 'research_agent', 'get_agent_run', 'list_agent_runs', 'cancel_agent_run'];
/** 领域工具（`DOMAIN_TOOLS`）：只在阶段内由模型调用，不是 HTTP 执行入口 */
const DOMAIN_TOOL_NAMES = ['replan_closure', 'validate_stage_plan'];

type ToolsTab = 'tool' | 'skill' | 'surface';

/**
 * ToolsPage — browse & invoke the engine's atomic Tools and composite Skills.
 *
 * PRD B3（2026-10-29 / G5、G12）：新增**只读**「Agent 工具面」页签，展示 Kernel 真正
 * 暴露给主 agent 的工具（`/api/tools`）、模型看到的 schema（`/api/tools/schema`）与
 * 最近调用记录（`/api/tools/records`）。这一页**不提供执行按钮**——目录快照不等于运行许可，
 * 执行仍走左侧既有执行器（`/api/tool/execute`），两者状态不共享。
 */
export function ToolsPage() {
  const [tab, setTab] = useState<ToolsTab>('tool');
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [skills, setSkills] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [demoFallback, setDemoFallback] = useState(false); // P2-20：演示回退可见标记
  const [selected, setSelected] = useState<string | null>(null);
  const [params, setParams] = useState('{}');
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchCalls, setBatchCalls] = useState('[{"name":"video_trim","params":{}}]');
  // PRD B3：Agent 工具面（只读）
  const [surface, setSurface] = useState<ToolSurfaceEntry[]>([]);
  const [surfaceTiers, setSurfaceTiers] = useState<string[]>([]);
  const [records, setRecords] = useState<ToolCallRecord[]>([]);
  const [surfaceLoading, setSurfaceLoading] = useState(false);
  const [surfaceError, setSurfaceError] = useState<string | null>(null);

  // 只在切到该页签时才拉（避免每次进页面多打三个接口）
  useEffect(() => {
    if (tab !== 'surface' || surface.length > 0 || surfaceLoading) return;
    let alive = true;
    setSurfaceLoading(true);
    setSurfaceError(null);
    (async () => {
      try {
        const [catalog, recs] = await Promise.all([
          toolSurfaceApi.listCatalog(),
          toolSurfaceApi.listRecords(),
        ]);
        if (!alive) return;
        setSurface(catalog.items);
        setSurfaceTiers(catalog.tiers);
        setRecords(recs.items.slice(0, 20));
      } catch (e) {
        if (alive) setSurfaceError(e instanceof Error ? e.message : '工具面加载失败');
      } finally {
        if (alive) setSurfaceLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [t, s] = await Promise.all([toolApi.list(), skillApi.list()]);
        if (!alive) return;
        setTools(normalize(t));
        setSkills(normalize(s));
      } catch {
        if (!alive) return;
        // P2-20: 演示回退受设置开关门控（默认关）；回退时明确标记
        if (useSettingsStore.getState().allowDemoFallback) {
          setTools(DEMO_TOOLS);
          setSkills(DEMO_SKILLS);
          setDemoFallback(true);
        } else {
          setTools([]);
          setSkills([]);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const list = tab === 'tool' ? tools : skills;

  const execute = async () => {
    if (batchMode) {
      // 批量模式：JSON 数组 [ {name, params} ] → toolApi.batch（顺序执行，互不影响）
      setRunning(true);
      setOutput(null);
      try {
        const parsed = JSON.parse(batchCalls || '[]');
        if (!Array.isArray(parsed)) throw new Error('批处理必须是 JSON 数组');
        const calls = parsed.map((c, i) => {
          const name = typeof c === 'string' ? c : String((c as Record<string, unknown> | null)?.name ?? '');
          if (!name) throw new Error(`第 ${i + 1} 项缺少 "name"`);
          const params = (c as Record<string, unknown> | null)?.params;
          return { name, params: (params && typeof params === 'object' ? params as Record<string, unknown> : {}) };
        });
        const res = await toolApi.batch(calls);
        setOutput(JSON.stringify(res, null, 2));
      } catch (e: unknown) {
        setOutput(`// 批处理失败（后端可能离线）\n${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setRunning(false);
      }
      return;
    }
    if (!selected) return;
    setRunning(true);
    setOutput(null);
    try {
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(params || '{}'); } catch { /* keep empty */ }
      const res = tab === 'tool'
        ? await toolApi.execute(selected, parsed)
        : await skillApi.execute(selected, parsed);
      setOutput(JSON.stringify(res, null, 2));
    } catch (e: unknown) {
      setOutput(`// 执行失败（后端可能离线）\n${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <ConsoleShell>
      {demoFallback && (
        <div className="mb-3 px-3 py-2 rounded-cw-sm bg-warning/10 border border-warning/40 text-label-sm text-on-surface-variant">
          后端不可达——当前显示的是演示数据（非真实工具/技能列表），执行不可用。
        </div>
      )}
      <ConsoleHeading kicker="Capabilities / Tools & Skills" title="工具与技能"
        desc="工具是原子能力（FFmpeg/OpenCV 封装），技能是多工具组合。选择一项并传入 JSON 参数即可执行。" />

      {/* tab switch */}
      <div className="flex gap-1 mb-5 bg-surface-container rounded-cw-sm p-1 w-fit border border-outline-variant/30">
        {(['tool', 'skill', 'surface'] as const).map((t) => (
          <button key={t} onClick={() => { setTab(t); setSelected(null); setOutput(null); }}
            className={cn('flex items-center gap-1.5 px-4 py-1.5 rounded-cw-xs text-body-sm font-medium transition-colors cursor-pointer',
              tab === t ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface')}>
            {t === 'tool' ? <Wrench className="w-3.5 h-3.5" />
              : t === 'skill' ? <Sparkles className="w-3.5 h-3.5" />
                : <Bot className="w-3.5 h-3.5" />}
            {t === 'tool' ? `工具 (${tools.length})`
              : t === 'skill' ? `技能 (${skills.length})`
                : `Agent 工具面 (${surface.length})`}
          </button>
        ))}
      </div>

      {tab === 'surface' ? (
        <AgentSurfaceTab
          entries={surface}
          tiers={surfaceTiers}
          records={records}
          loading={surfaceLoading}
          error={surfaceError}
        />
      ) : (
      <div className="grid grid-cols-12 gap-5">
        {/* list */}
        <div className="col-span-12 lg:col-span-5">
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 bg-surface-container rounded-cw-sm animate-pulse" />)}</div>
          ) : (
            <div className="space-y-1.5 max-h-[480px] overflow-y-auto pr-1">
              {list.map((item) => (
                <button key={item.name} onClick={() => { setSelected(item.name); setOutput(null); }}
                  className={cn('w-full flex items-center gap-3 px-3.5 py-2.5 rounded-cw-sm border text-left transition-all duration-short3 cursor-pointer group',
                    selected === item.name
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-outline-variant/25 bg-surface-container hover:border-outline/50')}>
                  <span className={cn('w-7 h-7 rounded-cw-xs flex items-center justify-center shrink-0',
                    selected === item.name ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant')}>
                    {tab === 'tool' ? <Wrench className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={cn('block font-mono text-body-sm truncate', selected === item.name ? 'text-primary' : 'text-on-surface')}>{item.name}</span>
                    {item.description && <span className="block text-caption text-on-surface-variant truncate">{item.description}</span>}
                  </span>
                  <ChevronRight className={cn('w-4 h-4 shrink-0 transition-transform', selected === item.name ? 'text-primary translate-x-0.5' : 'text-on-surface-variant/40')} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* executor */}
        <div className="col-span-12 lg:col-span-7">
          <div className="bg-surface-container border border-outline-variant/30 rounded-cw-md overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-container-high border-b border-outline-variant/20">
              <Terminal className="w-4 h-4 text-primary" />
              <span className="font-mono text-label-sm text-on-surface">{selected ? `${tab}.execute("${selected}")` : '执行器'}</span>
            </div>
            <div className="p-4 space-y-3">
              {/* mode toggle: single vs batch */}
              <div className="flex gap-1 w-fit bg-surface rounded-cw-sm p-0.5 border border-outline-variant/30">
                <button onClick={() => setBatchMode(false)}
                  className={cn('flex items-center gap-1 px-3 py-1 rounded-cw-xs text-label-sm font-medium transition-colors cursor-pointer',
                    !batchMode ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface')}>
                  <Terminal className="w-3 h-3" />单个
                </button>
                <button onClick={() => setBatchMode(true)}
                  className={cn('flex items-center gap-1 px-3 py-1 rounded-cw-xs text-label-sm font-medium transition-colors cursor-pointer',
                    batchMode ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface')}>
                  <ListOrdered className="w-3 h-3" />批量
                </button>
              </div>

              {batchMode ? (
                <div>
                  <label className="block text-label text-on-surface-variant mb-1.5">批量调用 (JSON 数组)</label>
                  <textarea value={batchCalls} onChange={(e) => setBatchCalls(e.target.value)} rows={5}
                    className="w-full bg-surface rounded-cw-sm px-3 py-2 font-mono text-body-sm text-on-surface
                      outline-none border border-outline-variant/30 focus:border-primary resize-y"
                    placeholder='[{"name":"video_trim","params":{}},{"name":"scene_detect","params":{}}]' />
                  <p className="text-caption text-on-surface-variant/60 mt-1">顺序批量执行、互不影响。每项需含 "name"，"params" 可选。</p>
                </div>
              ) : (
                <div>
                  <label className="block text-label text-on-surface-variant mb-1.5">参数 (JSON)</label>
                  <textarea value={params} onChange={(e) => setParams(e.target.value)} rows={4}
                    className="w-full bg-surface rounded-cw-sm px-3 py-2 font-mono text-body-sm text-on-surface
                      outline-none border border-outline-variant/30 focus:border-primary resize-y" />
                </div>
              )}
              <Button onClick={execute} disabled={(batchMode ? false : !selected) || running} className="w-full">
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : batchMode ? <ListOrdered className="w-4 h-4" /> : <Terminal className="w-4 h-4" />}
                {running ? '执行中…' : batchMode ? '批量执行' : '执行'}
              </Button>
              {output && (
                <pre className="bg-surface rounded-cw-sm border border-outline-variant/30 px-3 py-2.5 font-mono text-caption
                  text-track-audio leading-relaxed max-h-56 overflow-auto whitespace-pre-wrap">{output}</pre>
              )}
            </div>
          </div>
        </div>
      </div>
      )}
    </ConsoleShell>
  );
}

/**
 * Agent 工具面（只读）——PRD B3。
 *
 * 三条诚实约束：
 * 1. **不给执行按钮**：目录是快照，真正执行需要 Kernel 上下文（`surface.execute`）；
 *    在管理页点一下就执行 = 任意工具执行入口，红线。
 * 2. `available=false` 不隐藏，灰显并给原因（隐藏会让人以为工具不存在）。
 * 3. 分组：agent（一等工具）/ domain（阶段内领域工具）/ 其余。
 */
function AgentSurfaceTab({ entries, tiers, records, loading, error }: {
  entries: ToolSurfaceEntry[];
  tiers: string[];
  records: ToolCallRecord[];
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="space-y-2" data-testid="surface-loading">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 bg-surface-container rounded-cw-sm animate-pulse" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-label-sm text-error" data-testid="surface-error">
        工具面加载失败：{error}
      </p>
    );
  }
  const isAgent = (n: string) => AGENT_TOOL_NAMES.includes(n);
  const isDomain = (n: string) => DOMAIN_TOOL_NAMES.includes(n);
  const groups: Array<{ key: string; title: string; hint: string; items: ToolSurfaceEntry[] }> = [
    { key: 'agent', title: '主 Agent 一等工具', hint: '主 agent 直接调用的派发/查询能力（子 agent 就是工具）',
      items: entries.filter((e) => isAgent(e.name)) },
    { key: 'domain', title: '领域工具', hint: '阶段内由模型调用（不是 HTTP 执行入口）',
      items: entries.filter((e) => isDomain(e.name)) },
    { key: 'other', title: '其余工具', hint: `档位：${tiers.join(' / ') || '—'}`,
      items: entries.filter((e) => !isAgent(e.name) && !isDomain(e.name)) },
  ];
  return (
    <div className="space-y-4" data-testid="agent-surface">
      <p className="text-caption text-on-surface-variant">
        这是 Kernel 真正暴露给主 agent 的工具面（只读快照）。此处
        <strong className="text-on-surface">不提供执行按钮</strong>——
        执行需要任务上下文，请走左侧执行器或由主 agent 调用。
      </p>
      {groups.map((g) => (
        <section key={g.key} data-testid={`surface-group-${g.key}`} data-count={g.items.length}>
          <h4 className="mb-1 text-label-sm text-on-surface">{g.title}（{g.items.length}）</h4>
          <p className="mb-1.5 text-caption text-on-surface-variant/70">{g.hint}</p>
          {g.items.length === 0 ? (
            <p className="text-caption text-on-surface-variant/60">（无）</p>
          ) : (
            <ul className="space-y-1">
              {g.items.map((e) => (
                <li
                  key={e.name}
                  data-tool-name={e.name}
                  data-tier={e.tier}
                  data-available={e.available ? 'true' : 'false'}
                  className={cn(
                    'flex flex-wrap items-baseline gap-2 rounded-cw-sm border px-2.5 py-1.5 text-caption',
                    e.available
                      ? 'border-outline-variant/25 bg-surface-container'
                      : 'border-outline-variant/15 bg-surface-container/50 opacity-70',
                  )}
                >
                  <span className="font-mono text-on-surface">{e.name}</span>
                  <span className="font-mono text-on-surface-variant/70">tier={e.tier}</span>
                  {!e.available && <span className="text-warning">不可用（依赖未就绪）</span>}
                  {e.cost_hint && <span className="text-on-surface-variant/60">{e.cost_hint}</span>}
                  {e.description && (
                    <span className="w-full text-on-surface-variant/70">{e.description}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <section data-testid="surface-records">
        <h4 className="mb-1 text-label-sm text-on-surface">最近调用记录（{records.length}）</h4>
        {records.length === 0 ? (
          <p className="text-caption text-on-surface-variant/60">还没有调用记录。</p>
        ) : (
          <ul className="space-y-0.5">
            {records.map((r, i) => (
              <li key={i} className="font-mono text-caption text-on-surface-variant">
                {String(r.name ?? r.tool ?? 'tool')} · {String(r.status ?? '')}
                {typeof r.duration_ms === 'number' ? ` · ${r.duration_ms}ms` : ''}
                {r.pipeline_id ? ` · ${String(r.pipeline_id)}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function normalize(data: unknown): ToolItem[] {
  if (Array.isArray(data)) {
    return data.map((d) => {
      if (typeof d === 'string') return { name: d };
      const o = d as Record<string, unknown>;
      return { name: String(o.name ?? o.id ?? 'unknown'), description: o.description ? String(o.description) : undefined };
    });
  }
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const arr = o.tools ?? o.skills ?? o.items;
    if (Array.isArray(arr)) return normalize(arr);
  }
  return [];
}

const DEMO_TOOLS: ToolItem[] = [
  { name: 'video_trim', description: '视频裁剪' }, { name: 'video_concat', description: '视频拼接' },
  { name: 'video_speed', description: '变速播放' }, { name: 'audio_mix', description: '多轨混音' },
  { name: 'scene_detect', description: '场景检测' }, { name: 'subtitle_burn', description: '字幕烧录' },
  { name: 'whisper_transcribe', description: '语音转文字' }, { name: 'text_to_speech', description: '文字转语音' },
];
const DEMO_SKILLS: ToolItem[] = [
  { name: 'auto_caption', description: '自动字幕（转写→拆分→同步）' },
  { name: 'broll_matcher', description: 'B-roll 匹配' },
  { name: 'voiceover_sync', description: '配音同步+闪避' },
  { name: 'background_music', description: 'BGM 匹配' },
  { name: 'silence_cut', description: '静音切除' },
];
