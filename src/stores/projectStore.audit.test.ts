// @vitest-environment jsdom
/**
 * E-02（PRD §5A P1）：首页开关进编辑器后被重置回默认 / 上一项目残留带进新项目。
 *   - resetProject 必须清空**全部**字段（旧实现漏了 creativePrompt/shot*Policy 等）
 *   - 首页勾选的 dryRun / workspace* / creative* / cutOnBeat / shot*Policy 随启动带走
 *
 * F-01（PRD §2 P1）：launch() 用 localStorage 旧偏好覆盖当前表单选中的音色。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '@/stores/projectStore';

beforeEach(() => {
  useProjectStore.getState().resetProject();
});

describe('E-02 projectStore.resetProject 覆盖全部字段', () => {
  it('清空此前遗漏的创作提示词 / 踩点 / 镜头策略 / 人格列表', () => {
    const st = useProjectStore.getState();
    st.setCreativePrompt('要冷峻、克制');
    st.setCreativeAvoid(['夸张转场']);
    st.setCutOnBeat(true);
    st.setBeatBpm(128);
    st.setShotFloorPolicy('record');
    st.setShotCapPolicy('off');
    st.setReasoningEffort('high');
    st.setPersonas([{ id: 'p1', name: '人格' } as never]);

    useProjectStore.getState().resetProject();

    const after = useProjectStore.getState();
    expect(after.creativePrompt).toBe('');
    expect(after.creativeAvoid).toEqual([]);
    expect(after.cutOnBeat).toBe(false);
    expect(after.beatBpm).toBeNull();
    expect(after.shotFloorPolicy).toBe('default');
    expect(after.shotCapPolicy).toBe('default');
    expect(after.reasoningEffort).toBe('');
    expect(after.personas).toEqual([]);
  });

  it('同时清空 dryRun 与工作区开关（原有字段不回退）', () => {
    const st = useProjectStore.getState();
    st.setDryRun(true);
    st.setWorkspaceAutoIndex(false);
    st.setWorkspaceVisionIndex(false);
    st.setWorkspaceRoot('J:/ws/old');

    useProjectStore.getState().resetProject();

    const after = useProjectStore.getState();
    expect(after.dryRun).toBe(false);
    expect(after.workspaceAutoIndex).toBe(true);
    expect(after.workspaceVisionIndex).toBe(true);
    expect(after.workspaceRoot).toBe('');
    expect(after.projectId).toBeNull();
  });
});
