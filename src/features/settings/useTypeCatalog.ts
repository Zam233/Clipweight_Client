import { useCallback, useEffect, useState } from 'react';
import { typeMakerApi, type TypeListItem } from '@/services/api/typeMaker';

export interface TypeCatalogState {
  types: TypeListItem[];
  loading: boolean;
  /** 后端不可达/解析失败时的原因（空字符串=正常） */
  error: string;
  reload: () => Promise<void>;
}

/**
 * 类型目录的唯一数据源。
 *
 * 为什么抽成 hook：类型列表此前被**两处各自实现**——首页「类型」tab 用
 * `typeMakerApi.list()` 只取 id/name/description 拼成小卡片，独立页各自再拉一遍。
 * 两条路各有各的字段缺失与合成逻辑，改一处必然漏一处。数据源只留一个，
 * 展示层再按需要裁剪。
 */
export function useTypeCatalog(): TypeCatalogState {
  const [types, setTypes] = useState<TypeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await typeMakerApi.list();
      setTypes(Array.isArray(list) ? list : []);
      setError('');
    } catch {
      // 后端离线：不塞演示数据（避免用户把假类型当成真的），只如实说连不上
      setTypes([]);
      setError('无法连接后端类型服务');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => { if (alive) await reload(); })();
    return () => { alive = false; };
  }, [reload]);

  return { types, loading, error, reload };
}
