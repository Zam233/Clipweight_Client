import { test, expect } from '@playwright/test';
import { mockBackendApi, collectPageErrors } from './helpers';

/**
 * 账号系统剥离验收（2026-11-08）
 *
 * 验收点：
 * 1. 前端不再向 /srv（ClipWright Server，:8090）发任何请求；
 * 2. 导航里没有「登录 / 注册」「市场」，也不再展示 CREADIT；
 * 3. /login、/market 路由已删除 → 落入 404 页；
 * 4. 曾经登录过（cw_had_session=1）也不再被守卫踢去登录页——项目页/编辑器照常打开。
 */

test.describe('账号系统剥离', () => {
  test('首页无账号/市场入口，且不发 /srv 请求', async ({ page }) => {
    const errors = collectPageErrors(page);
    const srvRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/srv/')) srvRequests.push(req.url());
    });

    await mockBackendApi(page);
    await page.goto('/');

    await expect(page.locator('h1')).toContainText('把你的选题');
    // 导航三件套：我的项目 / 音色库在，市场与登录不在
    await expect(page.getByRole('button', { name: /我的项目/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /音色库/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /市场/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /登录/ })).toHaveCount(0);
    await expect(page.getByText('CREADIT')).toHaveCount(0);

    expect(srvRequests).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('已删除的 /login 与 /market 落入 404', async ({ page }) => {
    await mockBackendApi(page);

    await page.goto('/login');
    await expect(page.getByText('页面不存在或已被移动')).toBeVisible();

    await page.goto('/market');
    await expect(page.getByText('页面不存在或已被移动')).toBeVisible();
  });

  test('曾登录过（cw_had_session=1）也能直接进项目页与编辑器', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.addInitScript(() => localStorage.setItem('cw_had_session', '1'));
    await mockBackendApi(page);

    await page.goto('/projects');
    await expect(page.getByText('E2E 演示项目').first()).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain('/projects');

    await page.goto('/editor/proj_e2e_demo');
    await expect(page.getByText('未命名项目').or(page.getByText('E2E 演示项目'))).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain('/editor/proj_e2e_demo');
    expect(errors).toEqual([]);
  });

  test('编辑器不再请求 /srv 或 /api/market', async ({ page }) => {
    const accountCalls: string[] = [];
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('/srv/') || u.includes('/api/market')) accountCalls.push(u);
    });
    await mockBackendApi(page);

    await page.goto('/editor/proj_e2e_demo');
    await expect(page.getByRole('button', { name: /^保存/ })).toBeVisible({ timeout: 10_000 });
    expect(accountCalls).toEqual([]);
  });
});
