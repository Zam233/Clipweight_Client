// @vitest-environment node
/**
 * X01b：双仓契约 fixture 的前端 decoder 测试。
 * fixture 由后端 `scripts/dump_contracts.py` 生成，两仓同字节。
 */
import { describe, expect, it } from 'vitest';
import { decodeAgentResult } from './decode';

import briefEmpty from './agent_result_v2/brief_empty.json';
import cancelled from './agent_result_v2/cancelled.json';
import degraded from './agent_result_v2/degraded.json';
import dryRun from './agent_result_v2/dry_run.json';
import failed from './agent_result_v2/failed.json';
import needs from './agent_result_v2/needs.json';
import ok from './agent_result_v2/ok.json';
import redo from './agent_result_v2/redo_request.json';
import refused from './agent_result_v2/refused.json';

const FIXTURES = { briefEmpty, cancelled, degraded, dryRun, failed, needs, ok, redo, refused };

describe('AgentResult v2 decoder', () => {
  it('decodes every fixture', () => {
    for (const [name, fixture] of Object.entries(FIXTURES)) {
      const res = decodeAgentResult(fixture);
      expect(res.ok, `${name}: ${res.ok ? '' : res.error}`).toBe(true);
    }
  });

  it('keeps brief key even when empty', () => {
    const res = decodeAgentResult(briefEmpty);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.brief).toBe('');
  });

  it('distinguishes missing key from empty value', () => {
    const clone: Record<string, unknown> = { ...ok };
    delete clone.brief;
    const missing = decodeAgentResult(clone);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.missing).toContain('brief');
  });

  it('rejects null for non-nullable fields', () => {
    const res = decodeAgentResult({ ...ok, needs: null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.invalid.some((x) => x.startsWith('needs:null'))).toBe(true);
  });

  it('rejects wrong schema version and unknown status', () => {
    expect(decodeAgentResult({ ...ok, schema_version: 1 }).ok).toBe(false);
    expect(decodeAgentResult({ ...ok, status: 'running' }).ok).toBe(false);
  });

  it('rejects needs + redo_request together', () => {
    const res = decodeAgentResult({ ...redo, needs: (needs as Record<string, unknown>).needs });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.invalid.some((x) => x.includes('mutually-exclusive'))).toBe(true);
  });

  it('rejects malformed redo_request', () => {
    const res = decodeAgentResult({ ...redo, redo_request: { scope: 'clip:c1' } });
    expect(res.ok).toBe(false);
  });
});
