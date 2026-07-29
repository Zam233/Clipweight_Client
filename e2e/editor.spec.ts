import { test, expect } from '@playwright/test';
import { mockBackendApi, collectPageErrors } from './helpers';

test.describe('编辑器冒烟测试', () => {
  test('编辑器加载项目并渲染四面板', async ({ page }) => {
    const errors = collectPageErrors(page);
    await mockBackendApi(page);
    await page.goto('/editor/e2e-demo');

    // 预览面板
    await expect(page.getByText('节目监视器')).toBeVisible({ timeout: 15_000 });
    // 预览 Canvas 与时间轴 Canvas 均应存在
    await expect(page.locator('canvas').first()).toBeVisible();
    expect(await page.locator('canvas').count()).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test('项目加载失败时回退到首页', async ({ page }) => {
    await page.route('**/health', (route) =>
      route.fulfill({ json: { status: 'ok', service: 'clipwright-engine' } }),
    );
    await page.route('**/api/project/bad-id**', (route) =>
      route.fulfill({ status: 404, json: { detail: 'not found' } }),
    );
    await page.route('**/api/**', (route) => route.fulfill({ json: [] }));

    await page.goto('/editor/bad-id');
    await page.waitForURL('**/', { timeout: 15_000 });
    await expect(page).toHaveURL(/\/$/);
  });
});
