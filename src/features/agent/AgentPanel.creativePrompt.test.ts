// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * F-04 落点验收：创作页提示词必须真的进请求。
 *
 * 前端请求由 AgentPanel 发起（`requirementsApi.init` 的 extra 与 `proceed` 的 extra_params），
 * 所以这里对源码做约束断言——防止"UI 能填、请求没带"这种假接线。
 */
describe('创作提示词进管线（F-04 落点）', () => {
  const source = readFileSync(resolve(__dirname, 'AgentPanel.tsx'), 'utf-8');

  it('requirements init 的 extra 带上 creative_prompt / creative_avoid', () => {
    expect(source).toContain('creative_prompt: st.creativePrompt');
    expect(source).toContain('creative_avoid: st.creativeAvoid');
  });

  it('proceed 的 extra_params 也兜底带上', () => {
    expect(source).toContain('...(st.creativePrompt ? { creative_prompt: st.creativePrompt } : {})');
    expect(source).toContain('...(st.creativeAvoid.length > 0 ? { creative_avoid: st.creativeAvoid } : {})');
  });

  it('只有非空才传（不污染请求）', () => {
    // creative_prompt 用 `|| undefined` / 条件展开；creative_avoid 用 length>0 判断
    expect(source).not.toContain('creative_prompt: st.creativePrompt,');
  });
});
