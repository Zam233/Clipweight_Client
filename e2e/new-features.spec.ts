import { test, expect } from '@playwright/test';
import { collectPageErrors } from './helpers';

/**
 * 2026-11-08 新功能浏览器侧验收（插件/engine 边界整改后的前端适配）：
 *
 * 1. VoicePage：TTS provider 的**显示名与上传提示**来自 `/api/providers/available`
 *    的 `provider_meta`，不再按厂商名硬编码（插件 voice_ext 新增 elevenlabs/azure）。
 * 2. ExportPage：插件贡献的 `export_preset`（shape：`title` + `payload{width,height,fps}`）
 *    出现在「导出预设」网格里——P1(A) 修复后 platform_export/example_full 都走这条契约。
 *
 * 全部走 route mock：后端语义由 pytest 覆盖，这里只验前端链路。
 */

const AVAILABLE_WITH_META = {
  llm_provider: ['openai'],
  tts_provider: ['qwen-tts', 'elevenlabs'],
  embedding_provider: ['local'],
  rerank_provider: ['http'],
  role_kinds: { main: 'llm', flash: 'llm', vision: 'llm', embed: 'embedding', rerank: 'rerank', tts: 'tts' },
  tts_aliases: { qwen_tts: 'qwen-tts' },
  provider_meta: {
    tts_provider: {
      'qwen-tts': { name: 'Qwen TTS', needs_uploader: false },
      elevenlabs: { name: 'ElevenLabs', needs_uploader: false, clone_supported: false },
    },
  },
};

const PLUGIN_PRESET = {
  kind: 'export_preset',
  id: 'bilibili_1080p60',
  owner: 'platform_export',
  title: 'B站 1080p60',
  meta: {
    title: 'B站 1080p60',
    name: 'B站 1080p60',
    width: 1920, height: 1080, fps: 60, bitrate: '12M',
    payload: { name: 'B站 1080p60', width: 1920, height: 1080, fps: 60, bitrate: '12M' },
  },
  payload: { name: 'B站 1080p60', width: 1920, height: 1080, fps: 60, bitrate: '12M' },
};

async function mockBase(page: import('@playwright/test').Page) {
  await page.route(/https?:\/\/[^/]+\/health(\?|$)/, (route) =>
    route.fulfill({ json: { status: 'ok', service: 'clipwright-engine' } }),
  );
  await page.route(/https?:\/\/[^/]+\/api\//, (route) => {
    const url = route.request().url();
    if (url.includes('/api/providers/available')) {
      return route.fulfill({ json: AVAILABLE_WITH_META });
    }
    if (url.includes('/api/plugin/contributions')) {
      // 前端 fetchAllContributions 一次拉全量、本地按 kind 过滤（B13），所以这里不按
      // kind 参数筛——始终给全量，否则插件预设会被前端当成"没有贡献"。
      return route.fulfill({ json: { contributions: [PLUGIN_PRESET], total: 1 } });
    }
    if (url.includes('/api/voice/list')) return route.fulfill({ json: [] });
    if (url.includes('/api/render/presets')) return route.fulfill({ json: { presets: {} } });
    if (/\/api\/project\/[^/]+$/.test(url)) {
      return route.fulfill({
        json: {
          id: 'proj_e2e', name: 'E2E 工程', timeline: { tracks: [], fps: 30, duration_sec: 8 },
        },
      });
    }
    if (url.includes('/api/stats/usage')) return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
}

test.describe('插件化整改后的前端适配（2026-11-08）', () => {
  test('VoicePage：provider 显示名/上传提示由 provider_meta 驱动', async ({ page }) => {
    const errors = collectPageErrors(page);
    await mockBase(page);
    await page.goto('/voice');

    await page.getByRole('button', { name: /克隆新音色/ }).first().click();
    await expect(page.getByText('提供者')).toBeVisible({ timeout: 10_000 });

    // 插件 provider 以声明名出现（不是裸 id / 不是内置表里的 Qwen TTS）
    await expect(page.getByRole('button', { name: 'ElevenLabs' })).toBeVisible();
    await page.getByRole('button', { name: 'ElevenLabs' }).click();
    // needs_uploader=false → 不展示"需要公网 URL"，而是直接合成
    await expect(page.getByText(/直接按文本合成/)).toBeVisible();
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('ExportPage：插件 export_preset 贡献进入预设网格（title/payload 契约）', async ({ page }) => {
    const errors = collectPageErrors(page);
    await mockBase(page);
    await page.goto('/export/proj_e2e');

    await expect(page.getByRole('heading', { name: /导出预设/ })).toBeVisible({ timeout: 15_000 });
    const tile = page.getByRole('button', { name: /B站 1080p60/ });
    await expect(tile).toBeVisible();
    await expect(tile).toContainText('1920×1080');
    await expect(tile).toContainText('60fps');
    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
