import { test, expect } from '@playwright/test';
import { collectPageErrors } from './helpers';

/**
 * 方案 D-3 浏览器侧 e2e：示例插件的 slot 贡献在真实浏览器中渲染，
 * 「禁用」（贡献列表变空）后 UI 同步消失（G7 的浏览器侧验收）。
 *
 * 后端语义（贡献注册/回收）已由 tests/clipwright/test_example_plugin_e2e.py
 * 覆盖；此处用 route mock 驱动「已启用 / 已禁用」两种状态，专注前端 Slot 链路。
 */

const EXAMPLE_CONTRIBUTIONS = [
  {
    kind: 'ui_slot', id: 'example_settings', owner: '_example_full',
    slot: 'settings.section', title: '示例插件设置', order: 300,
    layout: {
      title: '示例插件设置',
      widgets: [
        { type: 'string', key: 'endpoint', label: '自定义端点' },
        { type: 'int', key: 'retries', label: '重试次数', value: 1 },
      ],
    },
  },
  {
    kind: 'ui_slot', id: 'example_page', owner: '_example_full',
    slot: 'page', title: '示例页面', order: 150,
    payload: { path: 'example_full' },
    layout: {
      title: '示例页面',
      widgets: [{ type: 'input', key: 'query', label: '查询词' }],
    },
  },
  {
    kind: 'ui_slot', id: 'example_shortcut', owner: '_example_full',
    slot: 'shortcut', title: '示例插件：回显测试',
    payload: { combo: 'alt+shift+e', label: '示例插件：回显测试', action: { endpoint: '/api/tool/execute' } },
  },
  {
    kind: 'export_preset', id: 'example_preset', owner: '_example_full',
    title: '示例竖屏 1080p',
    payload: { name: '示例竖屏 1080p', width: 1080, height: 1920, fps: 30, bitrate: '6M' },
  },
];

async function mockApis(page: import('@playwright/test').Page, enabled: boolean) {
  // 与 e2e/settings.spec.ts 的 mockSettingsApis 对齐（该清单已验证页面无崩溃），
  // 仅额外接管 /api/plugin/contributions
  await page.route(/https?:\/\/[^/]+\/health(\?|$)/, (route) =>
    route.fulfill({ json: { status: 'ok', service: 'clipwright-engine' } }),
  );
  await page.route(/https?:\/\/[^/]+\/api\//, (route) => {
    const url = route.request().url();
    if (url.includes('/api/plugin/contributions')) {
      return route.fulfill({
        json: {
          contributions: enabled ? EXAMPLE_CONTRIBUTIONS : [],
          total: enabled ? EXAMPLE_CONTRIBUTIONS.length : 0,
        },
      });
    }
    if (url.includes('/api/stats/usage')) return route.fulfill({ json: { pipelines: 0, renders: 0, llm_tokens_month: 0, llm_tokens_total: 0 } });
    if (url.includes('/api/fonts/list')) return route.fulfill({ json: { fonts: [{ family: 'Inter', style: 'Regular' }], count: 1 } });
    if (url.includes('/api/webhook/events')) return route.fulfill({ json: { events: ['pipeline.completed', 'render.completed'] } });
    if (url.includes('/api/webhook/list')) return route.fulfill({ json: [] });
    if (url.includes('/api/type-maker/list')) return route.fulfill({ json: [] });
    if (url.includes('/api/template/list')) return route.fulfill({ json: [] });
    if (url.includes('/api/plugin/list')) return route.fulfill({ json: [] });
    if (url.includes('/api/plugin/discover')) return route.fulfill({ json: [] });
    if (url.includes('/api/test/config')) return route.fulfill({ json: { llm: 'test', embed: 'test' } });
    if (url.includes('/api/render/presets')) return route.fulfill({ json: [] });
    if (url.includes('/api/render/queue')) return route.fulfill({ json: { tasks: [] } });
    if (url.includes('/api/tool/list')) return route.fulfill({ json: [] });
    if (url.includes('/api/skill/list')) return route.fulfill({ json: [] });
    if (url.includes('/api/pipeline/runs')) return route.fulfill({ json: [] });
    if (url.includes('/api/persona')) return route.fulfill({ json: [] });
    if (url.includes('/api/asset')) return route.fulfill({ json: [] });
    if (url.includes('/api/material')) return route.fulfill({ json: [] });
    // 兜底用数组：未列出的列表类端点（如素材源）在对 SettingsPage 的实测中
    // 返回 {} 会触发 .map 崩溃，[] 可安全渲染
    return route.fulfill({ json: [] });
  });
}

test.describe('插件插槽 e2e（D-3 / G7）', () => {
  test('启用状态：settings.section 与 page 两个 slot 渲染出来', async ({ page }) => {
    const errors = collectPageErrors(page);
    await mockApis(page, true);

    await page.goto('/settings');
    await expect(page.getByText('示例插件设置').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('自定义端点').first()).toBeVisible();

    await page.goto('/plugin/example_full');
    await expect(page.getByText('示例页面').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('查询词').first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('禁用状态：贡献清空后页面 slot 消失并给出提示（G7）', async ({ page }) => {
    await mockApis(page, false);

    await page.goto('/plugin/example_full');
    await expect(page.getByText('插件页面不存在或已被禁用。')).toBeVisible({ timeout: 10_000 });

    await page.goto('/settings');
    await page.waitForTimeout(800);
    await expect(page.getByText('示例插件设置')).toHaveCount(0);
  });
});
