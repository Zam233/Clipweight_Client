import { chromium } from 'playwright';

const api = 'http://127.0.0.1:8080';
const id = 'typeforge_e2e_auto';
const def = {
  id, name: 'E2E 自动类型', description: '自动化详情测试',
  shot_params: { min_shot_sec: 1, max_shot_sec: 3, transition_type: 'cut', transition_duration_sec: 0.2, cut_on_beat: true },
  persona_mapping: {}, post_process: {}, tags: ['e2e'],
  prompts: { genre: { text: '快节奏知识解说' }, anti_patterns: { text: '避免长镜头' } },
  param_rules: [], signature_traits: [], declares: {}, waivers: [],
};
async function cleanup() { await fetch(`${api}/api/type-maker/${id}`, { method: 'DELETE' }).catch(() => {}); }
await cleanup();
const created = await fetch(`${api}/api/type-maker/create`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(def),
});
if (!created.ok) throw new Error(`create failed ${created.status}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(`http://127.0.0.1:5173/settings/type-maker/${id}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('E2E 自动类型').first().waitFor();
  await page.getByRole('button', { name: 'Prompt' }).click();
  const promptValue = await page.locator('textarea').first().inputValue();
  if (!promptValue.includes('快节奏知识解说')) throw new Error('prompt missing');
  await page.getByRole('button', { name: /编辑/ }).click();
  await page.getByRole('button', { name: '参数' }).click();
  await page.locator('input').first().fill('E2E 已修改');
  await page.screenshot({ path: 'docs/e2e/video-type-forge/06-e2e-edit.png' });
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText('E2E 已修改').first().waitFor();
  await page.getByRole('button', { name: /删除/ }).click();
  await page.getByText(/确认删除类型/).waitFor();
  await page.getByRole('button', { name: '确认删除' }).click();
  await page.waitForURL('**/settings/type-maker');
  console.log('e2e ok');
} finally {
  await browser.close();
  await cleanup();
}
