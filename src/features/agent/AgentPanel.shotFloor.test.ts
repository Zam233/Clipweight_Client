// @vitest-environment jsdom
/**
 * D23 前端接线：镜头节奏策略要从创作页一路传到管线的 extra_params。
 *
 * 这里做源码级约束断言（和 creativePrompt 的既有做法一致）：这类"参数放错层/
 * 忘了下发"的 bug 用行为测试很难抓，但源码断言能立刻发现。
 *
 * D23 拍板后语义变了：默认档是 `default`（**不显式下发**，跟随后端的
 * merge/split 保总时长策略），不再默认 `off`。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const home = readFileSync(resolve(__dirname, '../../pages/HomePage.tsx'), 'utf-8');
const agent = readFileSync(resolve(__dirname, 'AgentPanel.tsx'), 'utf-8');
const store = readFileSync(resolve(__dirname, '../../stores/projectStore.ts'), 'utf-8');

describe('D23 镜头节奏策略下发链路', () => {
  it('store 有字段、默认 default、有 setter', () => {
    expect(store).toContain('shotFloorPolicy: string;');
    expect(store).toContain("shotFloorPolicy: 'default',");
    expect(store).toContain('setShotFloorPolicy: (v) => set({ shotFloorPolicy: v })');
  });

  it('创作页把选择写进 store', () => {
    expect(home).toContain('st.setShotFloorPolicy(shotFloorPolicy)');
    expect(home).toContain("data-testid=\"shot-floor-policy\"");
  });

  it('五档选项齐全（default 是默认档）', () => {
    for (const value of ['default', 'record', 'extend', 'loop', 'off']) {
      expect(home).toContain(`value="${value}"`);
    }
    expect(home).toContain("useState('default')");
  });

  it('只有非 default 才下发（default 交给后端 merge/split）', () => {
    expect(agent).toContain("st.shotFloorPolicy !== 'default'");
    expect(agent).toContain('shot_floor_policy: st.shotFloorPolicy');
  });

  it('上界策略（V35 切分）也接了线，且默认同样不下发', () => {
    expect(store).toContain('shotCapPolicy: string;');
    expect(store).toContain("shotCapPolicy: 'default',");
    expect(store).toContain('setShotCapPolicy: (v) => set({ shotCapPolicy: v })');
    expect(home).toContain('st.setShotCapPolicy(shotCapPolicy)');
    expect(home).toContain('data-testid="shot-cap-policy"');
    expect(agent).toContain("st.shotCapPolicy !== 'default'");
    expect(agent).toContain('shot_cap_policy: st.shotCapPolicy');
  });

  it('后端默认策略在注释里写清（merge 保总时长）', () => {
    expect(agent).toContain('merge');
  });
});
