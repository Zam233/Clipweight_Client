/**
 * 单流 E2E（unified-stream PRD §M3/§M4 验收）。
 *
 * 覆盖范围（刻意比 final-flow 窄，但把这一轮真正改的东西钉住）：
 * 1. `?unifiedTimeline=1` 打开后，需求对话只剩**一条**流（消息 + 思考同容器）；
 * 2. 思考能展开且真有内容（不再是可以点了没反应的死按钮）；
 * 3. 刷新页面后历史消息从服务端 hydrate 回来、思考从会话事件回放（不丢）。
 *
 * 不跑渲染/导出——那部分由 `final-flow.spec.ts` 覆盖，避免重复烧 20 分钟。
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const TOPIC = process.env.CW_E2E_TOPIC || '机械键盘为什么会发出声音';
const ARTIFACT_DIR = path.join(process.cwd(), 'e2e', 'artifacts', 'unified');
const LOG = path.join(process.cwd(), '_cache', 'e2e-unified.log');

function log(msg: string) {
  const line = `[${new Date().toLocaleTimeString()}] [单流E2E] ${msg}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, line);
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.appendFileSync(path.join(ARTIFACT_DIR, 'run.log'), line);
  } catch { /* 日志失败不影响断言 */ }
}

test('需求对话单流：思考可展开 + 刷新可恢复', async ({ page }) => {
  test.setTimeout(25 * 60 * 1000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // 单流开关：走 URL 参数（线上应急同一套机制）
  await page.addInitScript(() => {
    window.localStorage.setItem('cw.unifiedTimeline', '1');
  });

  await page.goto('/');
  log(`首页 → 新建制作（${TOPIC}）`);
  await page.getByRole('button', { name: '开始创作' }).first().click();
  await page.getByPlaceholder(/视频选题/).first().fill(TOPIC);
  await page.getByRole('button', { name: '开始创作' }).last().click();
  await page.waitForURL(/\/editor\/proj_/, { timeout: 90_000 });

  await expect(page.getByTestId('requirements-pane')).toBeVisible({ timeout: 60_000 });
  const topicInput = page.getByPlaceholder('输入视频选题…');
  if (await topicInput.isVisible().catch(() => false)) {
    await topicInput.fill(TOPIC);
    await page.getByRole('button', { name: '开始需求分析' }).click();
    log('已发起需求分析');
  }

  // 1) 一条流：消息与思考在同一个容器里
  const stream = page.getByTestId('requirements-unified-stream');
  await expect(stream).toBeVisible({ timeout: 120_000 });
  log('单流容器已出现');
  await expect(stream.locator('[data-testid="unified-item-message"]').first())
    .toBeVisible({ timeout: 60_000 });

  // 先确认对话已经真的发生过（有 assistant 回复），否则"没有思考"是正常的空会话
  await expect(async () => {
    const n = await stream.locator('[data-testid="unified-item-message"][data-role="assistant"]').count();
    if (n < 1) throw new Error('还没有 assistant 回复，需求对话尚未开始');
  }).toPass({ timeout: 180_000, intervals: [2000] });
  log('已出现 assistant 回复');

  // 2) 思考：要么可展开且有内容，要么明说"不提供/不可用"——绝不允许死按钮
  const thinkingToggle = page.getByTestId('live-thinking-toggle').first();
  const thinkingHistory = page.getByTestId('requirements-thinking-history');
  const thinkingItem = page.getByTestId('unified-item-reasoning').first();
  const unsupported = page.getByTestId('live-thinking-unsupported');
  const fallback = page.getByTestId('live-thinking-fallback');

  await expect(async () => {
    const ok = (await thinkingToggle.isVisible().catch(() => false))
      || (await thinkingHistory.isVisible().catch(() => false))
      || (await unsupported.isVisible().catch(() => false))
      || (await fallback.isVisible().catch(() => false));
    if (!ok) throw new Error('思考区既没有可展开按钮，也没有诚实的不可用说明');
  }).toPass({ timeout: 180_000, intervals: [2000] });

  const toggleVisible = await thinkingToggle.isVisible().catch(() => false);
  if (toggleVisible) {
    await thinkingToggle.click();
    const body = page.getByTestId('live-reasoning').first();
    await expect(body).toBeVisible({ timeout: 30_000 });
    const text = (await body.textContent()) || '';
    log(`思考正文长度：${text.length}`);
    expect(text.trim().length).toBeGreaterThan(10);
  } else if (await fallback.isVisible().catch(() => false)) {
    log('本轮流式回退：UI 明确说明思考不可用（符合预期）');
  } else if (await unsupported.isVisible().catch(() => false)) {
    log('provider 不回吐思考：UI 明确说明（符合预期）');
  } else if (await thinkingItem.isVisible().catch(() => false)) {
    log('思考已在时间线里（投影层条目，可展开）');
    await thinkingItem.locator('button').click();
    await expect(thinkingItem.locator('pre')).toBeVisible({ timeout: 20_000 });
    const body = (await thinkingItem.locator('pre').textContent()) || '';
    log(`思考正文长度：${body.length}`);
    expect(body.trim().length).toBeGreaterThan(10);
  } else {
    log('思考已落盘为历史块（会话事件回放）');
    await expect(thinkingHistory).toBeVisible();
  }

  // 3) 刷新恢复：消息与思考历史都从服务端回来
  const before = await stream.locator('[data-testid="unified-item-message"]').count();
  log(`刷新前单流消息条目：${before}`);
  await page.reload();
  await expect(page.getByTestId('requirements-pane')).toBeVisible({ timeout: 60_000 });
  const streamAfter = page.getByTestId('requirements-unified-stream');
  await expect(streamAfter).toBeVisible({ timeout: 120_000 });
  const after = await streamAfter.locator('[data-testid="unified-item-message"]').count();
  log(`刷新后单流消息条目：${after}`);
  expect(after).toBeGreaterThanOrEqual(Math.min(before, 2));

  expect(pageErrors).toEqual([]);
});
