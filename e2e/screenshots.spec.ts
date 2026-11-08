import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

/**
 * 新增前端界面截图（2026-11-08 插件化整改专题）。
 *
 * 三个入口各自 route mock，不依赖后端：
 * 1. /voice           —— 克隆弹层：插件 provider 的 label / 上传提示来自 provider_meta；
 * 2. /export/proj_e2e —— 导出预设网格：插件 export_preset 贡献（title/payload 契约）；
 * 3. /settings/providers（语音 TTS tab）—— provider 下拉含插件注册的 elevenlabs。
 */
const OUT = path.resolve('e2e/artifacts/screens');
fs.mkdirSync(OUT, { recursive: true });

const AVAILABLE = {
  llm_provider: ['openai'],
  tts_provider: ['qwen-tts', 'cosyvoice', 'minimax', 'elevenlabs'],
  embedding_provider: ['local'],
  rerank_provider: ['http'],
  role_kinds: { main: 'llm', flash: 'llm', vision: 'llm', embed: 'embedding', rerank: 'rerank', tts: 'tts' },
  tts_aliases: { qwen_tts: 'qwen-tts' },
  provider_meta: {
    tts_provider: {
      'qwen-tts': { name: 'Qwen TTS', needs_uploader: false },
      cosyvoice: { name: 'CosyVoice', needs_uploader: true },
      minimax: { name: 'MiniMax', needs_uploader: true },
      elevenlabs: { name: 'ElevenLabs', needs_uploader: false, clone_supported: false },
    },
  },
};

const PLUGIN_PRESETS = [
  {
    kind: 'export_preset', id: 'bilibili_1080p60', owner: 'platform_export',
    title: 'B站 1080p60',
    payload: { name: 'B站 1080p60', width: 1920, height: 1080, fps: 60, bitrate: '12M' },
    meta: {
      title: 'B站 1080p60', name: 'B站 1080p60', width: 1920, height: 1080, fps: 60, bitrate: '12M',
      payload: { name: 'B站 1080p60', width: 1920, height: 1080, fps: 60, bitrate: '12M' },
    },
  },
  {
    kind: 'export_preset', id: 'douyin_720p30', owner: 'platform_export',
    title: '抖音 720p30',
    payload: { name: '抖音 720p30', width: 1280, height: 720, fps: 30, bitrate: '6M' },
    meta: {
      title: '抖音 720p30', name: '抖音 720p30', width: 1280, height: 720, fps: 30, bitrate: '6M',
      payload: { name: '抖音 720p30', width: 1280, height: 720, fps: 30, bitrate: '6M' },
    },
  },
];

const SOURCES = [
  {
    id: 'src_tts', name: 'Qwen 语音', kind: 'tts', provider: 'qwen-tts',
    base_url: '', timeout_sec: 60, proxy: '', headers: {},
    api_keys_masked: ['sk-q****'], key_count: 1, has_keys: true, models: [],
  },
];

async function mock(page: import('@playwright/test').Page) {
  await page.route(/https?:\/\/[^/]+\/health(\?|$)/, (r) => r.fulfill({ json: { status: 'ok' } }));
  await page.route(/https?:\/\/[^/]+\/api\//, (route) => {
    const url = route.request().url();
    if (url.includes('/api/providers/available')) return route.fulfill({ json: AVAILABLE });
    if (url.includes('/api/providers/schemas')) return route.fulfill({ json: { schemas: {} } });
    if (url.includes('/api/providers/capabilities')) return route.fulfill({ json: {} });
    if (url.includes('/api/providers')) return route.fulfill({ json: { sources: SOURCES, roles: {} } });
    if (url.includes('/api/plugin/contributions')) {
      return route.fulfill({ json: { contributions: PLUGIN_PRESETS, total: PLUGIN_PRESETS.length } });
    }
    if (url.includes('/api/voice/list')) return route.fulfill({ json: [] });
    if (url.includes('/api/render/presets')) return route.fulfill({ json: { presets: {} } });
    if (/\/api\/project\/[^/]+$/.test(url)) {
      return route.fulfill({ json: { id: 'proj_e2e', name: 'E2E 工程', timeline: { tracks: [], fps: 30, duration_sec: 8 } } });
    }
    if (url.includes('/api/stats/usage')) return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
}

test('截图 1：VoicePage 克隆弹层（provider_meta 驱动 label/提示）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mock(page);
  await page.goto('/voice');
  await page.getByRole('button', { name: /克隆新音色/ }).first().click();
  await expect(page.getByText('提供者')).toBeVisible();
  await page.getByRole('button', { name: 'ElevenLabs' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '01-voice-provider-meta.png'), fullPage: false });
});

test('截图 2：ExportPage 导出预设网格（插件 export_preset 贡献）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await mock(page);
  await page.goto('/export/proj_e2e');
  await expect(page.getByRole('heading', { name: /导出预设/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /B站 1080p60/ })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '02-export-plugin-presets.png'), fullPage: true });
});

test('截图 3：ProvidersPage 语音 TTS（provider 下拉含插件 elevenlabs）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await mock(page);
  await page.goto('/settings/providers');
  await page.getByRole('button', { name: '语音 TTS', exact: true }).click();
  await page.getByTestId('source-src_tts').click();
  await page.waitForTimeout(300);
  // 插件注册的 provider 出现在下拉里（native select 的展开层截不进图，选中的值可证）
  await page.getByTestId('f-provider').selectOption('elevenlabs');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '03-providers-tts-tab.png'), fullPage: false });
});


