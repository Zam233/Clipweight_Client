import { test, expect } from '@playwright/test';
import { mockBackendApi, collectPageErrors } from './helpers';

test.describe('首页冒烟测试', () => {
  test('首页加载并显示主标题', async ({ page }) => {
    const errors = collectPageErrors(page);
    await mockBackendApi(page);
    await page.goto('/');

    await expect(page.locator('h1')).toContainText('把你的选题');
    expect(errors).toEqual([]);
  });

  test('后端健康检查显示已连接', async ({ page }) => {
    await mockBackendApi(page);
    await page.goto('/');

    // 「编排引擎」健康卡片挂在创建面板（activeTab === 'create'）里，首页默认
    // 停在 home 标签，必须先进入创建面板才能看到连接状态。
    await page.getByRole('button', { name: /开始创作/ }).click();

    await expect(page.getByText(/已连接/)).toBeVisible({ timeout: 10_000 });
  });

  test('项目列表页渲染演示项目卡片', async ({ page }) => {
    const errors = collectPageErrors(page);
    await mockBackendApi(page);
    await page.goto('/projects');

    await expect(page.getByText('E2E 演示项目').first()).toBeVisible({ timeout: 10_000 });
    expect(errors).toEqual([]);
  });
});
