/**
 * 产物预览标签（用户 2026-10-31 定稿的点击语义）。
 *
 * - **直接点击**产物 → 在应用内**新开一个标签**打开（就是这里）；
 * - **Ctrl/⌘ + 点击** → 交给系统默认程序打开（后端 `/api/workspace/reveal`）。
 *
 * 为什么不用浏览器新窗口：产物是 `J:\...` 本地路径，浏览器既不能直接打开，
 * 也没法用它自己的渲染器显示 mp4/md；而"交给系统"必须由后端调 OS。
 * 所以两条路都走，语义分清楚：应用内看 / 系统里开。
 */

import React from 'react';
import { Copy, ExternalLink, FileText } from 'lucide-react';

import { cn } from '@/lib/utils';
import { workspaceApi } from '@/services/api/workspace';
import { fetchSseToken } from '@/services/api/sse';

const TEXT_SUFFIXES = new Set([
  '.md', '.txt', '.json', '.jsonl', '.log', '.csv', '.yaml', '.yml',
  '.py', '.ts', '.tsx', '.js', '.html', '.css', '.srt', '.vtt', '.edl',
]);
const IMAGE_SUFFIXES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_SUFFIXES = new Set(['.mp4', '.webm', '.mov']);
const AUDIO_SUFFIXES = new Set(['.mp3', '.wav', '.m4a']);

function suffixOf(path: string): string {
  const m = /\.[^./\\]+$/.exec(path);
  return m ? m[0].toLowerCase() : '';
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function CopilotArtifactTab({ path }: { path: string }) {
  const [text, setText] = React.useState('');
  const [meta, setMeta] = React.useState<{ size: number; truncated: boolean; chars: number } | null>(null);
  const [error, setError] = React.useState('');
  const [note, setNote] = React.useState('');
  const [rawUrl, setRawUrl] = React.useState('');
  const suffix = suffixOf(path);
  const isText = TEXT_SUFFIXES.has(suffix);
  const isImage = IMAGE_SUFFIXES.has(suffix);
  const isVideo = VIDEO_SUFFIXES.has(suffix);
  const isAudio = AUDIO_SUFFIXES.has(suffix);

  React.useEffect(() => {
    let alive = true;
    setError(''); setText(''); setMeta(null); setRawUrl('');
    if (!path) return undefined;
    void (async () => {
      if (isText) {
        try {
          const res = await workspaceApi.fileText(path);
          if (!alive) return;
          setText(res.text || '');
          setMeta({ size: res.size, truncated: res.truncated, chars: res.chars });
        } catch (e) {
          if (alive) setError((e as Error)?.message || '读取失败');
        }
        return;
      }
      if (isImage || isVideo || isAudio) {
        // 媒体走原样字节；token 与 SSE 同款（令牌模式下 <img> 也要带）
        const tok = await fetchSseToken().catch(() => '');
        if (alive) setRawUrl(workspaceApi.fileRawUrl(path, tok));
      }
    })();
    return () => { alive = false; };
  }, [path, isText, isImage, isVideo, isAudio]);

  const openSystem = React.useCallback(async () => {
    try {
      await workspaceApi.reveal(path);
      setNote('已交给系统打开');
    } catch (e) {
      setNote(`系统打开失败：${(e as Error)?.message || '未知错误'}`);
    }
  }, [path]);

  if (!path) {
    return <div className="p-3 text-caption text-on-surface-variant">没有指定产物路径。</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="artifact-viewer">
      <div className="shrink-0 border-b border-outline-variant/20 px-3 py-2">
        <div className="flex items-center gap-2 text-label-sm text-on-surface">
          <FileText className="h-3.5 w-3.5 text-primary" />
          <span className="truncate" data-testid="artifact-viewer-name">{basename(path)}</span>
          {meta && (
            <span className="shrink-0 text-caption text-on-surface-variant/60">
              {(meta.size / 1024).toFixed(1)} KB{meta.truncated ? ` · 只显示前 ${meta.chars} 字` : ''}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="artifact-open-system"
            className="rounded-cw-xs border border-outline-variant/40 px-1.5 py-0.5 text-caption text-on-surface-variant hover:bg-surface-container"
            onClick={() => void openSystem()}
          >
            <ExternalLink className="mr-0.5 inline h-3 w-3" />
            在系统中打开
          </button>
          <button
            type="button"
            className="rounded-cw-xs border border-outline-variant/40 px-1.5 py-0.5 text-caption text-on-surface-variant hover:bg-surface-container"
            onClick={() => { void navigator.clipboard?.writeText(path); setNote('路径已复制'); }}
          >
            <Copy className="mr-0.5 inline h-3 w-3" />
            复制路径
          </button>
          <span className="truncate font-mono text-caption text-on-surface-variant/50" title={path}>
            {path}
          </span>
          {note && <span className="text-caption text-on-surface-variant/80">{note}</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {error && <p className="text-caption text-error">{error}</p>}

        {isText && !error && (
          <pre
            data-testid="artifact-viewer-text"
            className="whitespace-pre-wrap break-words font-mono text-caption text-on-surface-variant"
          >
            {text}
          </pre>
        )}

        {isImage && rawUrl && (
          <img
            data-testid="artifact-viewer-image"
            src={rawUrl}
            alt={basename(path)}
            className="max-h-full max-w-full rounded-cw-sm object-contain"
          />
        )}

        {isVideo && rawUrl && (
          <video
            data-testid="artifact-viewer-video"
            src={rawUrl}
            controls
            className="max-h-full max-w-full rounded-cw-sm"
          />
        )}

        {isAudio && rawUrl && (
          <audio data-testid="artifact-viewer-audio" src={rawUrl} controls className="w-full" />
        )}

        {!isText && !isImage && !isVideo && !isAudio && (
          <p className={cn('text-caption text-on-surface-variant')}>
            这种格式（{suffix || '无扩展名'}）应用内不预览。点「在系统中打开」用系统默认程序查看。
          </p>
        )}
      </div>
    </div>
  );
}
