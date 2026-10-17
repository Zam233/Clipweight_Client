import { test, expect } from '@playwright/test';
import { collectPageErrors } from './helpers';

/**
 * B8 浏览器侧验收：在插件管理页禁用插件后，**不刷新页面**回到设置页，
 * 该插件的 slot 贡献必须已经消失（缓存失效生效）。
 *
 * 若不调用 invalidatePluginSlots()，30s TTL 缓存会让旧贡献继续显示——
 * 这正是「G7：禁用后 UI 同步消失」此前只在测试里成立的原因。
 * 断言的是 SPA 内跳转（非 page.goto 重载），否则缓存被浏览器重启掩盖。
 */

// 用 nav.settings（ConsoleShell 侧栏项）做观测点：它是 ConsoleShell 常驻区域，
// 两个页面（模型测试 / 插件管理）都挂载同一个侧栏，能真实观察缓存是否失效。
const CONTRIB = {
  kind: 'ui_slot', id: 'inv_nav', owner: 'plug_inv',
  slot: 'nav.settings', title: '示例插件导航', order: 300,
  payload: { to: '/plugin/inv', label: '示例插件导航', icon: 'Puzzle' },
};

async function mockApis(page: import('@playwright/test').Page) {
  let enabled = true;
  const state = {
    setEnabled: (v: boolean) => { enabled = v; },
    disableCalls: 0,
  };
  await page.route(/https?:\/\/[^/]+\/health(\?|$)/, (route) =>
    route.fulfill({ json: { status: 'ok', service: 'clipwright-engine' } }),
  );
  await page.route(/https?:\/\/[^/]+\/api\//, (route) => {
    const url = route.request().url();
    if (url.includes('/api/plugin/list')) {
      return route.fulfill({
        json: [{
          manifest: { id: 'plug_inv', name: '禁用联动插件', kind: 'capability', version: '1.0.0' },
          enabled, loaded: enabled,
        }],
      });
    }
    if (/\/api\/plugin\/[^/]+\/disable$/.test(url)) {
      state.disableCalls += 1;
      state.setEnabled(false);
      return route.fulfill({ json: { status: 'ok', plugin_id: 'plug_inv', enabled: 'false' } });
    }
    if (/\/api\/plugin\/[^/]+\/enable$/.test(url)) {
      state.setEnabled(true);
      return route.fulfill({ json: { status: 'ok', plugin_id: 'plug_inv', enabled: 'true' } });
    }
    if (url.includes('/api/plugin/contributions')) {
      return route.fulfill({
        json: { contributions: enabled ? [CONTRIB] : [], total: enabled ? 1 : 0 },
      });
    }
    if (url.includes('/api/plugin/errors')) return route.fulfill({ json: [] });
    if (url.includes('/api/plugin/discover')) return route.fulfill({ json: [] });
    if (url.includes('/api/stats/usage')) {
      return route.fulfill({ json: { pipelines: 0, renders: 0, llm_tokens_month: 0, llm_tokens_total: 0 } });
    }
    if (url.includes('/api/test/config')) return route.fulfill({ json: { llm: 'test' } });
    if (url.includes('/api/fonts/list')) return route.fulfill({ json: { fonts: [], count: 0 } });
    if (url.includes('/api/webhook/events')) return route.fulfill({ json: { events: [] } });
    return route.fulfill({ json: [] });
  });
  return state;
}

test.describe('插件启停 → Slot 缓存联动（B8）', () => {
  test('禁用后 SPA 内回到设置页，插件分区立即消失', async ({ page }) => {
    const errors = collectPageErrors(page);
    const state = await mockApis(page);

    // 控制台页（侧栏常驻）——插件导航项初始可见
    await page.goto('/settings/models');
    await expect(page.getByText('示例插件导航')).toBeVisible({ timeout: 10_000 });

    // SPA 内跳转到插件管理（点击控制台侧栏，非整页刷新）
    await page.getByRole('button', { name: /插件管理/ }).click();
    await expect(page.getByText('plug_inv')).toBeVisible({ timeout: 10_000 });

    await page.getByTitle('禁用（持久化）').click();
    await expect.poll(() => state.disableCalls).toBe(1);

    // 回到模型测试页（同样是 SPA 内导航）——缓存未失效的话侧栏项仍会残留
    await page.getByRole('button', { name: /模型测试/ }).click();
    await expect(page.getByText('示例插件导航')).toHaveCount(0, { timeout: 10_000 });

    expect(errors).toEqual([]);
  });
});
