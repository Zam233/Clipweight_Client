import { useEffect, useState } from 'react';
import { ConsoleShell, ConsoleHeading } from './ConsoleShell';
import { getApiClient } from '@/services/api';
import { Button, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import { LayoutTemplate, Plus, Braces, Play, Trash2, Film } from 'lucide-react';

interface Template {
  id: string;
  name: string;
  content: string;
  variables: string[];
  kind: 'script' | 'intro' | 'outro';
}

/**
 * TemplatesPage — author reusable {{variable}} templates, inspect their
 * variables, and trigger render / pipeline runs.
 */
export function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspecting, setInspecting] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await getApiClient().get('/api/template/list');
        if (alive) setTemplates(normalize(data));
      } catch {
        if (alive) setTemplates(DEMO_TEMPLATES);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const addNew = () => {
    const id = `tpl_${Date.now().toString(36)}`;
    setTemplates((ts) => [{
      id, name: '新模板', kind: 'script',
      content: '大家好，今天我们来聊聊{{topic}}。\n\n{{intro}}\n\n首先是{{point_1}}……',
      variables: ['topic', 'intro', 'point_1'],
    }, ...ts]);
    setInspecting(id);
  };

  const remove = (id: string) => setTemplates((ts) => ts.filter((t) => t.id !== id));

  return (
    <ConsoleShell>
      <ConsoleHeading kicker="Authoring / Templates" title="模板管理"
        desc="用 {{变量}} 编写可复用的脚本/片头/片尾模板，批量渲染或一键触发管线。" />

      <div className="flex items-center justify-between mb-5 max-w-[900px]">
        <p className="font-mono text-caption text-on-surface-variant">{templates.length} TEMPLATES</p>
        <Button size="sm" onClick={addNew}><Plus className="w-3.5 h-3.5" /> 新建模板</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-[900px]">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-40 bg-surface-container rounded-cw-md animate-pulse" />)
        ) : (
          templates.map((t) => (
            <div key={t.id}
              className="relative bg-surface-container border border-outline-variant/30 rounded-cw-md overflow-hidden
                hover:border-outline/60 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/20 transition-all duration-short3 group">
              <span className={cn('absolute top-0 left-0 w-full h-[3px]',
                t.kind === 'script' ? 'bg-gradient-to-r from-track-video to-transparent'
                  : t.kind === 'intro' ? 'bg-gradient-to-r from-track-text to-transparent'
                  : 'bg-gradient-to-r from-track-audio to-transparent')} />

              <div className="px-4 pt-4 pb-3">
                <div className="flex items-start justify-between mb-2">
                  <span className={cn('w-9 h-9 rounded-cw-sm flex items-center justify-center',
                    t.kind === 'script' ? 'bg-track-video/15 text-track-video'
                      : t.kind === 'intro' ? 'bg-track-text/15 text-track-text'
                      : 'bg-track-audio/15 text-track-audio')}>
                    {t.kind === 'script' ? <LayoutTemplate className="w-4.5 h-4.5" /> : <Film className="w-4.5 h-4.5" />}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={t.kind === 'script' ? 'info' : t.kind === 'intro' ? 'warning' : 'success'}>
                      {t.kind === 'script' ? '脚本' : t.kind === 'intro' ? '片头' : '片尾'}
                    </Badge>
                    <button onClick={() => remove(t.id)}
                      className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-error hover:bg-error/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <h3 className="text-body-sm font-semibold text-on-surface">{t.name}</h3>
                <p className="font-mono text-caption text-on-surface-variant mt-0.5">{t.id}</p>
              </div>

              {/* variables */}
              <div className="px-4 pb-3">
                <button onClick={() => setInspecting(inspecting === t.id ? null : t.id)}
                  className="flex items-center gap-1.5 text-label-sm text-primary hover:underline cursor-pointer mb-2">
                  <Braces className="w-3.5 h-3.5" /> {t.variables.length} 个变量 {inspecting === t.id ? '▾' : '▸'}
                </button>
                {inspecting === t.id && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {t.variables.map((v) => (
                      <span key={v} className="font-mono text-caption px-2 py-0.5 rounded-cw-xs bg-primary/10 text-primary border border-primary/30">
                        {'{{'}{v}{'}}'}
                      </span>
                    ))}
                  </div>
                )}
                <pre className="bg-surface rounded-cw-xs border border-outline-variant/20 px-3 py-2 font-mono text-caption
                  text-on-surface-variant leading-relaxed max-h-20 overflow-hidden whitespace-pre-wrap">{t.content}</pre>
              </div>

              <div className="px-4 pb-4">
                <Button size="sm" variant="outline" className="w-full">
                  <Play className="w-3.5 h-3.5" /> 渲染模板
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </ConsoleShell>
  );
}

function normalize(data: unknown): Template[] {
  if (Array.isArray(data)) {
    return data.map((d, i) => {
      const o = d as Record<string, unknown>;
      const content = String(o.content ?? o.template ?? '');
      const vars = Array.isArray(o.variables)
        ? (o.variables as unknown[]).map(String)
        : [...content.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      return {
        id: String(o.id ?? `tpl_${i}`),
        name: String(o.name ?? '模板'),
        content,
        variables: vars,
        kind: (o.kind as Template['kind']) ?? 'script',
      };
    });
  }
  return [];
}

const DEMO_TEMPLATES: Template[] = [
  {
    id: 'tpl_knowledge_hook', name: '知识区开场钩子', kind: 'script',
    content: '你有没有想过，{{topic}}背后真正的逻辑是什么？\n\n今天这期视频，我们用 {{point_count}} 个角度把它讲透。',
    variables: ['topic', 'point_count'],
  },
  {
    id: 'tpl_standard_intro', name: '标准片头', kind: 'intro',
    content: '大家好，我是{{persona_name}}，欢迎回到我的频道。\n\n今天我们来聊聊{{topic}}。',
    variables: ['persona_name', 'topic'],
  },
  {
    id: 'tpl_triple_outro', name: '三连引导片尾', kind: 'outro',
    content: '如果这期视频对你有帮助，别忘了{{cta}}。\n\n我们下期再见！',
    variables: ['cta'],
  },
];
