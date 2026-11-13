// @vitest-environment jsdom
/** PL-01/PL-02：插件调用门禁的负例回归（先红后绿）。 */
import { describe, it, expect } from 'vitest';
import {
  authorizePluginCall, normalizePluginEndpoint, pluginCallNeedsConfirm,
  PLUGIN_ALLOWED_ENDPOINTS,
} from './pluginApiGuard';

describe('normalizePluginEndpoint（站内 /api/ 绝对路径）', () => {
  it('接受已登记的站内绝对路径', () => {
    expect(normalizePluginEndpoint('/api/tool/execute')).toBe('/api/tool/execute');
    expect(normalizePluginEndpoint(' /api/render/browser ')).toBe('/api/render/browser');
  });

  it('拒绝外链、协议相对、反斜杠、query/fragment 与非 /api/ 路径', () => {
    for (const raw of [
      'https://evil.example.com/api/project/x',
      '//evil.example.com/api/x',
      '/api\\project/x',
      '/api/project/x?force=1',
      '/api/project/x#frag',
      '/settings',
      'api/tool/execute',
      '',
      42,
      null,
      undefined,
    ]) {
      expect(normalizePluginEndpoint(raw), String(raw)).toBeNull();
    }
  });

  it('拒绝 .. 穿越与百分号编码绕过', () => {
    for (const raw of [
      '/api/../admin/config',
      '/api/plugin/..%2fproject/delete',
      '/api/%2e%2e/project',
      '/api//project/x',
      '/api/./project/x',
      '/api/%2Fproject',
    ]) {
      expect(normalizePluginEndpoint(raw), raw).toBeNull();
    }
  });
});

describe('authorizePluginCall（默认拒绝）', () => {
  it('放行白名单内的 GET/POST 且 body 归一化为对象', () => {
    const ok = authorizePluginCall({
      endpoint: '/api/tool/execute', method: 'POST', body: { tool: 'x' },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.call).toEqual({
      endpoint: '/api/tool/execute', method: 'POST', body: { tool: 'x' },
    });
    expect(authorizePluginCall({ endpoint: '/api/render/browser', method: 'GET' }).ok).toBe(true);
  });

  it('拒绝任意未登记端点（删项目 / 改配置 / 插件管理）', () => {
    for (const endpoint of [
      '/api/project/abc',
      '/api/plugin/disable',
      '/api/settings',
      '/api/task/cancel',
      '/api/render/browser/install/../project',
    ]) {
      const d = authorizePluginCall({ endpoint, method: 'GET' });
      expect(d.ok, endpoint).toBe(false);
    }
  });

  it('拒绝 DELETE/PUT/PATCH 及大小写/空白变形，也拒绝白名单端点上未登记的方法', () => {
    for (const method of ['DELETE', 'PUT', 'PATCH', 'delete', 'post ', 'HEAD']) {
      const d = authorizePluginCall({ endpoint: '/api/tool/execute', method });
      expect(d.ok, method).toBe(false);
    }
    expect(authorizePluginCall({ endpoint: '/api/render/browser', method: 'POST' }).ok).toBe(false);
  });

  it('非法端点返回稳定错误码，不抛异常', () => {
    for (const spec of [
      { endpoint: 'https://evil/x' },
      { endpoint: '/api/project/x' },
      { endpoint: '/api/tool/execute', method: 'DELETE' },
    ]) {
      const d = authorizePluginCall(spec);
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.reason).toMatch(/invalid_endpoint|invalid_method|not_allowed|unsafe_path/);
    }
  });

  it('非对象 body 被收敛成空对象，不会把数组/字符串塞进请求', () => {
    const d = authorizePluginCall({ endpoint: '/api/tool/execute', method: 'POST', body: ['x'] });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.call.body).toEqual({});
  });
});

describe('二次确认与白名单契约', () => {
  it('可写端点需要显式确认；纯只读探针不需要', () => {
    expect(pluginCallNeedsConfirm('/api/tool/execute')).toBe(true);
    expect(pluginCallNeedsConfirm('/api/render/browser')).toBe(false);
    expect(pluginCallNeedsConfirm('/api/project/x')).toBe(false);
  });

  it('白名单不含任何破坏性方法，且不含宽通配', () => {
    for (const [endpoint, methods] of Object.entries(PLUGIN_ALLOWED_ENDPOINTS)) {
      expect(endpoint.startsWith('/api/')).toBe(true);
      expect(endpoint.includes('*')).toBe(false);
      for (const m of methods) expect(['GET', 'POST']).toContain(m);
    }
  });
});

/**
 * W01 跨仓契约：授权后的调用改写为**后端受限代理**请求——服务端按 pluginId
 * 启停 + 清单做最终裁定，插件不能借宿主令牌直达普通业务 API。
 */
describe('toPluginProxyRequest（受限代理改写）', () => {
  it('工具执行 → POST /api/plugin/proxy/{id}/post + action=tool', async () => {
    const { toPluginProxyRequest } = await import('./pluginApiGuard');
    const d = authorizePluginCall({
      endpoint: '/api/tool/execute', method: 'POST', body: { name: 'gen', params: { a: 1 } },
    });
    expect(d.ok).toBe(true);
    if (d.ok) {
      const req = toPluginProxyRequest('ai_image_gen', d.call);
      expect(req.url).toBe('/api/plugin/proxy/ai_image_gen/post');
      expect(req.body).toEqual({ action: 'tool', payload: { name: 'gen', params: { a: 1 } } });
    }
  });

  it('探针 GET → 代理统一 POST + action=probe，payload 不带路径', async () => {
    const { toPluginProxyRequest } = await import('./pluginApiGuard');
    const d = authorizePluginCall({ endpoint: '/api/render/browser', method: 'GET' });
    expect(d.ok).toBe(true);
    if (d.ok) {
      const req = toPluginProxyRequest('headless_chrome', d.call);
      expect(req.url).toBe('/api/plugin/proxy/headless_chrome/get');
      expect(req.body.action).toBe('probe');
      expect(JSON.stringify(req.body)).not.toContain('endpoint');
    }
  });

  it('未登记端点没有代理映射（authorize 先拒绝，不存在改写）', async () => {
    const { toPluginProxyRequest, PLUGIN_PROXY_ACTIONS } = await import('./pluginApiGuard');
    expect(PLUGIN_PROXY_ACTIONS['/api/project/x']).toBeUndefined();
    expect(authorizePluginCall({ endpoint: '/api/project/x', method: 'GET' }).ok).toBe(false);
    void toPluginProxyRequest;
  });

  it('contribution_id 只接受裸 id，不会被改写', async () => {
    const { toPluginProxyRequest } = await import('./pluginApiGuard');
    const d = authorizePluginCall({
      endpoint: '/api/tool/execute', method: 'POST', body: { name: 'gen', params: {} },
    });
    expect(d.ok).toBe(true);
    if (d.ok) {
      const req = toPluginProxyRequest('ai_image_gen', d.call, 'ai_image_gen_legacy');
      expect(req.body.contribution_id).toBe('ai_image_gen_legacy');
      // 不传就不发字段（旧客户端语义）
      expect('contribution_id' in toPluginProxyRequest('ai_image_gen', d.call).body).toBe(false);
    }
  });

  it('旧 ui.json 的 body.tool 兼容为 name', async () => {
    const { toPluginProxyRequest } = await import('./pluginApiGuard');
    const d = authorizePluginCall({
      endpoint: '/api/tool/execute', method: 'POST', body: { tool: 'legacy_gen', params: { x: 1 } },
    });
    expect(d.ok).toBe(true);
    if (d.ok) {
      const req = toPluginProxyRequest('ai_image_gen', d.call);
      expect((req.body.payload as { name: string }).name).toBe('legacy_gen');
    }
  });

  it('显式 params 存在时，顶层其它键不会混进工具参数', async () => {
    const { toPluginProxyRequest } = await import('./pluginApiGuard');
    const d = authorizePluginCall({
      endpoint: '/api/tool/execute', method: 'POST',
      body: { name: 'gen', params: { a: 1 }, meta: 'should-not-pass' },
    });
    expect(d.ok).toBe(true);
    if (d.ok) {
      const req = toPluginProxyRequest('ai_image_gen', d.call);
      expect((req.body.payload as { params: Record<string, unknown> }).params).toEqual({ a: 1 });
    }
  });
});
