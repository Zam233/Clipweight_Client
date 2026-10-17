/**
 * 调度中枢 fixture —— 前端 F0 起的 mock 数据源。
 *
 * 用途：组件/单测在没有后端时可先跑通渲染；同时作为**契约样例**，
 * 后端字段改名时先在这里对不上，能第一时间发现。
 */

import type {
  Attribution,
  DiagnosisReport,
  ExecRecord,
  LedgerEntry,
  SubagentNode,
} from '@/types/supervisor';

export const sampleLedgerEntries: LedgerEntry[] = [
  {
    id: 'le_structure1',
    stage: 'structure',
    attempt: 1,
    decision: 'pass',
    degradations: [],
    warnings: [],
    model: 'anthropic/claude-sonnet-4-6',
    usage: { input_tokens: 1820, output_tokens: 640 },
    duration_ms: 8420,
    ts: '2026-10-17T10:00:00Z',
  },
  {
    id: 'le_material1',
    stage: 'material',
    attempt: 1,
    decision: 'pass',
    degradations: [
      {
        kind: 'material_placeholder',
        detail: '素材源两次返回空结果，改用占位图',
        scope: 'scene:3',
        impact: '该段将出现占位图',
      },
    ],
    warnings: ['素材源返回空'],
    model: 'anthropic/claude-haiku-x',
    duration_ms: 3120,
    ts: '2026-10-17T10:00:09Z',
  },
  {
    id: 'le_edit1',
    stage: 'edit',
    attempt: 1,
    decision: 'fail',
    failure: {
      category: 'input_insufficient',
      blocking_point: '第 3 段没有可用镜头，无法生成片段',
      retryable: 'needs_upstream',
      needs: [{ from_stage: 'structure', field: 'material_refs', why: '缺镜头引用' }],
    },
    degradations: [],
    warnings: [],
    duration_ms: 2200,
    ts: '2026-10-17T10:00:13Z',
  },
  {
    id: 'le_edit2',
    stage: 'edit',
    attempt: 2,
    decision: 'pass',
    degradations: [],
    warnings: [],
    duration_ms: 2400,
    ts: '2026-10-17T10:00:16Z',
  },
];

export const sampleAttribution: Attribution = {
  primary_stage: 'material',
  upstream_chain: [],
  evidence_refs: ['le_material1'],
  confidence: 'high',
  unrepairable: true,
  reason: '素材选材阶段出现资源缺失：素材源两次返回空结果，改用占位图（scene:3）',
  source: 'rule',
};

export const sampleDiagnosis: DiagnosisReport = {
  conclusion:
    '问题主要来自「素材选材」：素材源两次返回空结果，改用占位图（scene:3）。这是资源确实缺失，重试同一做法不会变好。',
  problems: [
    {
      severity: 'error',
      title: '第 3 段没有可用镜头，无法生成片段',
      location: '',
      stage: 'edit',
      category: 'input_insufficient',
    },
    {
      severity: 'warning',
      title: '素材源两次返回空结果，改用占位图',
      location: 'scene:3',
      stage: 'material',
      category: 'material_placeholder',
    },
  ],
  evidence: [{ text: '素材选材第 1 次尝试降级：素材源两次返回空结果', ref: 'le_material1' }],
  attempted: [{ action: '粗剪第 2 次尝试', outcome: '成功' }],
  suggestions: [
    { id: 's_accept_degraded', label: '接受当前版本（降级已标注）', action: 'accept_degraded' },
    { id: 's_retry_with_model', label: '换一个模型再试该阶段', action: 'retry_with_model' },
    { id: 's_manual', label: '查看账本明细', action: 'manual' },
  ],
  cost: { tokens: 2460, spent_usd: null, budget_usd: null, subagent_tokens: 0 },
  mode: 'shadow',
  pipeline_id: 'pl_demo',
};

export const sampleSubagents: SubagentNode[] = [
  {
    id: 'sa_1',
    parentId: null,
    role: '素材可用性核查员',
    kind: 'ephemeral',
    status: 'running',
    model: { provider: 'anthropic', model: 'claude-haiku-x' },
    durationMs: 1800,
    costUsd: 0.002,
    lastOutput: '正在检查 scene:3 是否为占位图…',
    cancellable: true,
  },
];

export const sampleExecRecords: ExecRecord[] = [
  {
    id: 'ex_1',
    ts: '2026-10-17T10:01:00Z',
    kind: 'shell',
    command: 'ffprobe -v error -show_streams workspace/out.mp4',
    cwd: 'workspace/pl_demo',
    riskLevel: 'low',
    riskReasons: ['只读探测，不修改任何文件'],
    autoMode: false,
    exitCode: 0,
    durationMs: 320,
    outputTail: 'codec_name=h264 …',
  },
  {
    id: 'ex_2',
    ts: '2026-10-17T10:01:30Z',
    command: 'rm -rf workspace/pl_demo/tmp',
    cwd: 'workspace/pl_demo',
    kind: 'shell',
    riskLevel: 'med',
    riskReasons: ['删除既有目录，但限定在管线 workspace 内'],
    dangerExplanation: '会删除本次管线产生的临时目录 tmp；不影响其他项目与系统文件。',
    autoMode: false,
    exitCode: null,
    durationMs: 0,
    rejected: { reason: '等待用户授权' },
  },
];
