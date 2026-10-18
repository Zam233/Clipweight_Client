// @vitest-environment jsdom
/**
 * D23 前端接线：镜头下限策略要从创作页一路传到管线的 extra_params。
 *
 * 这里做源码级约束断言（和 creativePrompt 的既有做法一致）：这类"参数放错层/
 * 忘了下发"的 bug 用行为测试很难抓，但源码断言能立刻发现。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const home = readFileSync(resolve(__dirname, '../../pages/HomePage.tsx'), 'utf-8');
const agent = readFileSync(resolve(__dirname, 'AgentPanel.tsx'), 'utf-8');
const store = readFileSync(resolve(__dirname, '../../stores/projectStore.ts'), 'utf-8');

describe('D23 镜头下限策略下发链路', () => {
  it('store 有字段、默认 off、有 setter', () => {
    expect(store).toContain('shotFloorPolicy: string;');
    expect(store).toContain("shotFloorPolicy: 'off',");
    expect(store).toContain('setShotFloorPolicy: (v) => set({ shotFloorPolicy: v })');
  });

  it('创作页把选择写进 store', () => {
    expect(home).toContain('st.setShotFloorPolicy(shotFloorPolicy)');
    expect(home).toContain("data-testid=\"shot-floor-policy\"");
  });

  it('四档选项齐全（off 是默认）', () => {
    for (const value of ['off', 'record', 'extend', 'loop']) {
      expect(home).toContain(`value="${value}"`);
    }
  });

  it('只有非 off 才下发（保持后端默认行为）', () => {
    expect(agent).toContain("st.shotFloorPolicy !== 'off'");
    expect(agent).toContain('shot_floor_policy: st.shotFloorPolicy');
  });
});
