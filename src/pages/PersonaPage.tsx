import { useNavigate } from '@tanstack/react-router';
import { PersonaGalleryPanel } from '@/features/settings/PersonaGalleryPanel';

/**
 * PersonaPage — `/persona`：人格库独立页。
 *
 * 内容全部来自 `PersonaGalleryPanel`（首页「人格」tab 也用同一份），
 * 本文件只负责独立页的外壳：整页滚动 + 返回工作台。
 */
export function PersonaPage() {
  const navigate = useNavigate();

  return (
    <div className="h-full overflow-y-auto bg-surface">
      {/* header band */}
      <div className="relative border-b border-outline-variant/25 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: 'radial-gradient(circle at 20% 30%, #4F6BED 0%, transparent 50%), radial-gradient(circle at 85% 70%, #D1708E 0%, transparent 50%)',
        }} />
        <div className="relative max-w-[1100px] mx-auto px-8 pt-8">
          <button onClick={() => navigate({ to: '/' })}
            className="text-label-sm text-on-surface-variant hover:text-primary transition-colors mb-4 cursor-pointer">
            ← 返回工作台
          </button>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-8 py-8">
        <PersonaGalleryPanel />
      </div>
    </div>
  );
}
