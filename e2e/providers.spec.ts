import { test, expect } from '@playwright/test';
import { collectPageErrors } from './helpers';

/**
 * B5 浏览器侧验收：/settings/providers「模型提供商」页
 * 顶部 tab（LLM / 嵌入 / 重排序 / 语音）× 左侧源列表 × 右侧设置 + 模型清单 + 角色，
 * 且 provider 下拉选项来自门面（含插件贡献的 provider）。
 *
 * 后端语义（源存储/角色绑定/密钥加密/模型清单）由
 * tests/clipwright/test_provider_sources.py 覆盖；此处用 route mock 验证前端链路。
 */

const SOURCES = [
  {
    id: 'src_deepseek', name: 'Deepseek', kind: 'llm', provider: 'openai',
    base_url: 'https://api.deepseek.com', timeout_sec: 120, proxy: '',
    headers: { 'X-Tenant': 'cw' },
    models: [
      { id: 'deepseek-chat', name: 'deepseek-chat', enabled: true },
      { id: 'deepseek-reasoner', name: 'deepseek-reasoner', enabled: false },
    ],
    api_keys_masked: ['sk-a****'], key_count: 1, has_keys: true,
  },
];

const ROLES = { main: { source_id: 'src_deepseek', model: 'deepseek-chat' } };

const AVAILABLE = {
  llm_provider: ['anthropic', 'ollama', 'openai', 'plugin-llm'],
  tts_provider: ['cosyvoice', 'minimax', 'qwen-tts'],
  embedding_provider: ['local', 'ollama', 'openai'],
  rerank_provider: ['http', 'local'],
  role_kinds: {
    main: 'llm', flash: 'llm', vision: 'llm',
    embed: 'embedding', rerank: 'rerank', tts: 'tts',
  },
  tts_aliases: { qwen_tts: 'qwen-tts' },
};

async function mockApis(page: import('@playwright/test').Page) {
  await page.route(/https?:\/\/[^/]+\/health(\?|$)/, (route) =>
    route.fulfill({ json: { status: 'ok', service: 'clipwright-engine' } }),
  );
  await page.route(/https?:\/\/[^/]+\/api\//, (route) => {
    const url = route.request().url();
    if (url.includes('/api/providers/available')) return route.fulfill({ json: AVAILABLE });
    if (url.includes('/api/plugin/contributions')) {
      return route.fulfill({ json: { contributions: [], total: 0 } });
    }
    if (url.includes('/api/providers')) {
      return route.fulfill({ json: { sources: SOURCES, roles: ROLES } });
    }
    if (url.includes('/api/stats/usage')) {
      return route.fulfill({ json: { pipelines: 0, renders: 0, llm_tokens_month: 0, llm_tokens_total: 0 } });
    }
    return route.fulfill({ json: [] });
  });
}

test.describe('模型提供商页（B5）', () => {
  test('四个 tab + 源列表 + 设置 + 模型清单 + 角色分配全部渲染', async ({ page }) => {
    const errors = collectPageErrors(page);
    await mockApis(page);

    await page.goto('/settings/providers');

    // 顶部 tab
    for (const label of ['LLM', '嵌入 Embedding', '重排序 Rerank', '语音 TTS']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible({ timeout: 10_000 });
    }
    // 左侧源列表（含密钥/模型计数与已绑定角色）
    await expect(page.getByTestId('source-src_deepseek')).toBeVisible();
    await expect(page.getByTestId('source-src_deepseek')).toContainText('主 LLM');

    // 右侧设置：选中源后回填
    await page.getByTestId('source-src_deepseek').click();
    await expect(page.getByTestId('f-base-url')).toHaveValue('https://api.deepseek.com');
    await expect(page.getByTestId('f-timeout')).toHaveValue('120');
    await expect(page.getByTestId('role-main')).toHaveValue('src_deepseek');

    // 模型清单（含禁用态）与自定义模型入口
    await expect(page.getByText('deepseek-reasoner')).toBeVisible();
    await expect(page.getByTestId('new-model')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('provider 下拉来自门面：插件贡献的 plugin-llm 出现在选项里', async ({ page }) => {
    await mockApis(page);
    await page.goto('/settings/providers');
    await page.getByTestId('source-src_deepseek').click();

    const options = await page.getByTestId('f-provider').locator('option').allTextContents();
    expect(options).toContain('plugin-llm');
    expect(options).toContain('anthropic');
  });

  test('切到「语音 TTS」tab：LLM 源消失，展示 TTS 角色', async ({ page }) => {
    await mockApis(page);
    await page.goto('/settings/providers');
    await expect(page.getByTestId('source-src_deepseek')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: '语音 TTS', exact: true }).click();
    await expect(page.getByTestId('source-src_deepseek')).toHaveCount(0);
    await expect(page.getByTestId('role-tts')).toBeVisible();
    await expect(page.getByText('该类型暂无源')).toBeVisible();
  });

  test('「获取模型列表」失败时给出可读提示而非静默', async ({ page }) => {
    await mockApis(page);
    // 更具体的 route 后注册 → 优先级更高（覆盖 mockApis 的 /api/ 兜底）
    await page.route(/https?:\/\/[^/]+\/api\/providers\/[^/]+\/models\/fetch/, (route) =>
      route.fulfill({ json: { models: [], note: '获取失败：连接超时' } }),
    );
    await page.goto('/settings/providers');
    await page.getByTestId('source-src_deepseek').click();
    await page.getByRole('button', { name: /获取模型列表/ }).click();
    await expect(page.getByText('获取失败：连接超时')).toBeVisible();
  });
});
