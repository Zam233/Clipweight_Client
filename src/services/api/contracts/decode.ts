/**
 * AgentResult v2 前端 decoder（X01a/X01b）。
 *
 * 纪律：**键缺失、合法 null、合法空数组、坏形状必须可区分**。
 * 与后端 `clipwright/schema/run.py` 同源；fixture 在
 * `src/services/api/contracts/agent_result_v2/*.json`（与后端同字节）。
 */

export type DecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; missing: string[]; invalid: string[] };

const STATUSES = new Set([
  'needs', 'ok', 'degraded', 'failed', 'refused', 'cancelled', 'dry_run',
]);
const MODES = new Set(['task', 'inline']);
const REPORT_STATES = new Set(['written', 'unavailable', 'not_applicable']);
const TRACE_STATES = new Set(['complete', 'partial', 'empty', 'unavailable']);

/** 必填键（null 允许与否见 NON_NULLABLE）。 */
const REQUIRED = [
  'schema_version', 'run_id', 'kind', 'mode', 'task_id', 'trace_id', 'attempt',
  'stage', 'role', 'status', 'terminal_reason', 'summary', 'brief',
  'outputs', 'writes', 'needs', 'report_path', 'report_seq', 'report_state',
  'handoff_summary', 'tool_calls', 'tool_calls_total', 'trace_state',
  'replayed', 'replay_of', 'cost_unknown',
] as const;

const NON_NULLABLE = new Set([
  'schema_version', 'run_id', 'kind', 'mode', 'status', 'terminal_reason',
  'summary', 'brief', 'outputs', 'writes', 'needs', 'report_state',
  'handoff_summary', 'tool_calls', 'tool_calls_total', 'trace_state',
  'replayed', 'replay_of', 'cost_unknown',
]);

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function decodeAgentResult(raw: unknown): DecodeResult<Record<string, unknown>> {
  if (!isObj(raw)) {
    return { ok: false, error: 'AgentResult 不是对象', missing: [], invalid: [] };
  }
  const missing = REQUIRED.filter((k) => !(k in raw));
  const invalid: string[] = [];

  for (const key of NON_NULLABLE) {
    if (key in raw && raw[key] === null) invalid.push(`${key}:null`);
  }
  if (raw.schema_version !== 2) invalid.push('schema_version!=2');
  if (typeof raw.run_id !== 'string' || !raw.run_id) invalid.push('run_id');
  if (!STATUSES.has(String(raw.status))) invalid.push(`status=${String(raw.status)}`);
  if (!MODES.has(String(raw.mode))) invalid.push(`mode=${String(raw.mode)}`);
  if (!REPORT_STATES.has(String(raw.report_state))) invalid.push('report_state');
  if (!TRACE_STATES.has(String(raw.trace_state))) invalid.push('trace_state');
  if (typeof raw.brief !== 'string') invalid.push('brief:not-string');
  if (!Array.isArray(raw.needs)) invalid.push('needs:not-array');
  if (!Array.isArray(raw.outputs) && !isObj(raw.outputs)) invalid.push('outputs:bad-shape');
  if (!Array.isArray(raw.tool_calls)) invalid.push('tool_calls:not-array');

  const needs = Array.isArray(raw.needs) ? raw.needs : [];
  for (const n of needs) {
    if (!isObj(n) || typeof n.field !== 'string' || !n.field
        || typeof n.why !== 'string' || !n.why) {
      invalid.push('needs:entry');
      break;
    }
  }

  const redo = raw.redo_request;
  if (redo !== undefined && redo !== null) {
    if (!isObj(redo) || !redo.source_run_id || !redo.base_artifact_sha) {
      invalid.push('redo_request:missing-source-or-base');
    }
    if (needs.length) invalid.push('needs+redo_request:mutually-exclusive');
  }

  if (missing.length || invalid.length) {
    return {
      ok: false,
      error: `契约不符（missing=${missing.join(',') || '-'} invalid=${invalid.join(',') || '-'}）`,
      missing,
      invalid,
    };
  }
  return { ok: true, value: raw };
}
