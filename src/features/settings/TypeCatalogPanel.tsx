import { RefreshCw, Shapes, Film } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useTypeCatalog } from './useTypeCatalog';

/**
 * TypeCatalogPanel — 视频类型的**只读总览**。
 *
 * 职责边界（刻意划清）：这里只展示「有哪些类型、各自是什么」，不提供新建/编辑/
 * 删除。类型是会影响全局节奏与 Persona 翻译的配置，写操作集中留在「类型制作器」
 * （`/settings/type-maker`）一个地方——避免两处都能改、改出不一致。
 *
 * 数据与类型制作器同源（`useTypeCatalog`），所以两边列出的类型永远一致。
 */
export function TypeCatalogPanel() {
  const { types, loading, error, reload } = useTypeCatalog();

  const builtinCount = types.filter((t) => t.builtin).length;
  const customCount = types.length - builtinCount;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="font-mono text-label-sm tracking-[0.3em] text-primary uppercase mb-1">Video Types</p>
          <h1 className="font-display text-[32px] font-bold text-on-surface">视频类型</h1>
          <p className="text-body-sm text-on-surface-variant mt-1 max-w-[560px]">
            类型封装品类级的剪辑逻辑差异——同一个 Persona 套用不同类型，产出风格一致但节奏迥异的视频。
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="default" className="font-mono">{types.length} TOTAL</Badge>
          <Badge variant="default" className="font-mono">{builtinCount} 内置 · {customCount} 自定义</Badge>
          <Button size="sm" variant="outline" onClick={reload} disabled={loading}>
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> 刷新
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-error/10 border border-error/30 rounded-cw-sm px-3.5 py-2 max-w-[900px]">
          <span className="font-mono text-caption text-error">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 bg-surface-container rounded-cw-md animate-pulse" />
          ))}
        </div>
      ) : types.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-14 text-center gap-2
          border border-dashed border-outline-variant/30 rounded-cw-md">
          <Shapes className="w-8 h-8 text-on-surface-variant/40" />
          <p className="text-body-sm text-on-surface-variant">
            {error ? '后端未连接，暂无法列出类型' : '还没有任何视频类型'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {types.map((t) => (
            <div key={t.id}
              className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-4
                hover:border-primary/40 transition-all duration-short3">
              <div className="flex items-start gap-3 mb-2.5">
                <span className="w-9 h-9 rounded-cw-sm bg-primary-container flex items-center justify-center shrink-0">
                  <Film className="w-4 h-4 text-on-primary-container" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm font-semibold text-on-surface truncate">{t.name}</p>
                  <p className="font-mono text-caption text-on-surface-variant truncate">{t.id}</p>
                </div>
                <Badge variant={t.builtin ? 'default' : 'success'} className="shrink-0">
                  {t.builtin ? '内置' : '自定义'}
                </Badge>
              </div>
              {t.description
                ? <p className="text-caption text-on-surface-variant">{t.description}</p>
                : <p className="text-caption text-on-surface-variant/50">（无描述）</p>}
              {t.tags && t.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {t.tags.map((tag) => (
                    <span key={tag} className="px-2 py-0.5 rounded-cw-full text-caption
                      bg-surface-container-high text-on-surface-variant border border-outline-variant/30">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
