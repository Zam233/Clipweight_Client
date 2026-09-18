import { ConsoleShell, ConsoleHeading } from './ConsoleShell';
import { TypeCatalogPanel } from '@/features/settings/TypeCatalogPanel';

/**
 * TypeCatalogPage — `/settings/types`：只看「有哪些类型」的只读总览。
 *
 * 与「类型制作器」（`/settings/type-maker`）的分工：那边负责新建/编辑/删除/复制/预览，
 * 这边只负责看清全貌。两边共用 `useTypeCatalog`，列表不会出现「一个页有、一个页没有」。
 */
export function TypeCatalogPage() {
  return (
    <ConsoleShell>
      <ConsoleHeading kicker="Catalog / Video Types" title="类型总览"
        desc="全部可用视频类型（内置 + 自定义）。需要新建或修改类型请到「类型制作器」。" />
      <TypeCatalogPanel />
    </ConsoleShell>
  );
}
