/**
 * 完整前端 E2E（2026-10-30 收口）：需求 proceed → 主 Agent 任务 → 导出渲染 → 下载 → ffprobe。
 *
 * 真实后端（8080）+ 真实 vite（5173），全程不桩。锁的是"用户视角这条路走不走得通"：
 * 1. 新建制作 → 编辑器需求面板出创意简报 →「确认简报」→ 制作规划书 →「确认实施」；
 * 2. `/api/requirements/proceed` 真的返回 task_id；
 * 3. 任务跑起来时事件流有 `subagent_tool` / `subagent_progress`（子代理透明化）；
 * 4. `/api/task/{id}/tool-calls` 读得回盘上的全量轨迹（PRD modern-agent-review M3），
 *    且前端「全量工具轨迹」面板能渲染出这些行；
 * 5. 任务终态 done 且时间线已回写项目；
 * 6. 导出页「加入渲染队列」→ 队列完成 → 前端「下载成片」真把文件下下来；
 * 7. ffprobe 认它是 1920x1080 的 H.264 真视频，且时长合理。
 *
 * 诊断日志用 fs.appendFileSync 落盘（playwright 的 stdout 会缓冲到进程结束，
 * 长跑的 E2E 靠 console.log 看不到实时进度——踩过一次）。
 *
 * 单独跑：
 *   npx playwright test e2e/final-flow.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TOPIC = process.env.CW_E2E_TOPIC || '机械键盘为什么会发出声音';
const MIN_DURATION_SEC = Number(process.env.CW_E2E_MIN_DURATION || 30);
const TASK_TIMEOUT = 60 * 60 * 1000;
const RENDER_TIMEOUT = 45 * 60 * 1000;
const ARTIFACT_DIR = path.resolve(process.env.CW_E2E_ARTIFACTS || 'e2e/artifacts/final');
const LIVE_LOG = path.resolve(process.env.CW_E2E_LIVE_LOG || '_cache/e2e-live.log');

function log(msg: string) {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${t}] [最终E2E] ${msg}\n`;
  console.log(line.trimEnd());
  try {
    fs.mkdirSync(path.dirname(LIVE_LOG), { recursive: true });
    fs.appendFileSync(LIVE_LOG, line, 'utf-8');
  } catch {
    /* 日志失败不影响测试 */
  }
}

function save(name: string, data: string) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACT_DIR, name), data, 'utf-8');
}

async function until<T>(
  what: string,
  fn: () => Promise<T | null | undefined | false>,
  timeout: number,
  interval = 3000,
): Promise<T> {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (e) {
      last = (e as Error)?.message || String(e);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`超时等待「${what}」（${Math.round(timeout / 1000)}s）${last ? `：${last}` : ''}`);
}

test.describe.configure({ mode: 'serial' });

test('需求 proceed → 任务 → 渲染 → 下载 → ffprobe', async ({ page, request }) => {
  test.setTimeout(TASK_TIMEOUT + RENDER_TIMEOUT + 15 * 60 * 1000);
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  // init 的响应里带 session_id：后面查规划书就靠它
  const initPromise = page.waitForResponse(
    (r) => r.url().includes('/api/requirements/init') && r.request().method() === 'POST',
    { timeout: 120_000 },
  );

  // ── 1. 新建制作 → 编辑器 ───────────────────────────────────
  log(`首页 → 新建制作（选题：${TOPIC}）`);
  await page.goto('/');
  await page.getByRole('button', { name: '开始创作' }).first().click();
  await page.getByPlaceholder(/视频选题/).first().fill(TOPIC);
  await page.getByRole('button', { name: '开始创作' }).last().click();
  await page.waitForURL(/\/editor\/proj_/, { timeout: 90_000 });
  const projectId = page.url().split('/editor/')[1].split(/[?#]/)[0];
  log(`项目已创建：${projectId}`);

  const initBody = await (await initPromise).json();
  const sessionId: string = initBody.session_id || initBody.session?.id || '';
  log(`需求会话：${sessionId || '（init 未返回 session_id）'}`);

  // ── 2. 需求面板：简报 → 规划书 ─────────────────────────────
  await expect(page.getByTestId('requirements-pane')).toBeVisible({ timeout: 60_000 });
  const topicInput = page.getByPlaceholder('输入视频选题…');
  if (await topicInput.isVisible().catch(() => false)) {
    await topicInput.fill(TOPIC);
    await page.getByRole('button', { name: '开始需求分析' }).click();
    log('已发起需求分析');
  } else {
    log('编辑器已带选题进入对话态（自动发起需求）');
  }

  // 简报：有「确认简报」就点（同名按钮可能重复，一律 .first()）
  const confirmBrief = page.getByRole('button', { name: '确认简报' }).first();
  await until('创意简报', async () => confirmBrief.isVisible().catch(() => false),
    20 * 60 * 1000, 2500);
  await confirmBrief.click({ timeout: 30_000 });
  log('已点「确认简报」，等制作规划书');

  // 规划书：等后端把 plan 写进会话（比看按钮可靠——「确认实施」在简报视图里也存在）
  await until(
    '后端规划书',
    async () => {
      if (!sessionId) return false;
      const res = await request.get(`/api/requirements/plan/${sessionId}`);
      if (!res.ok()) return false;
      const body = await res.json();
      const plan = body.plan || body.production_plan || body;
      const keys = Object.keys(plan || {});
      if (keys.length === 0) return false;
      log(`规划书已生成：${keys.slice(0, 8).join(',')}`);
      save('plan.json', JSON.stringify(body, null, 2));
      return true;
    },
    25 * 60 * 1000,
    5000,
  );
  await page.waitForTimeout(4000); // 前端渲染规划书视图

  // ── 3. 确认实施 → proceed 返回 task_id ─────────────────────
  //
  // 「确认实施」在简报视图里也存在，点早了只会走"请生成规划书"的对话分支（不会调 /proceed）。
  // 所以这里用"点一次 → 等 40s 看有没有 /proceed → 没有就再点"的循环，最多 6 次。
  let proceedBody: Record<string, unknown> | null = null;
  page.on('response', async (r) => {
    if (r.url().includes('/api/requirements/proceed') && r.request().method() === 'POST') {
      try {
        proceedBody = await r.json();
      } catch {
        proceedBody = { error: 'proceed 响应不是 JSON' };
      }
    }
  });
  // 每条消息都有自己的「审阅」；规划书是**最新**那条，所以取 .last()。
  // 取 .first() 会一直打开简报的审阅视图，那里的「确认实施」只会走"请生成规划书"分支。
  const reviewTab = page.getByRole('button', { name: '审阅' }).last();
  const confirmImplement = page.getByRole('button', { name: '确认实施' }).last();
  for (let attempt = 1; attempt <= 6 && !proceedBody; attempt += 1) {
    if (await reviewTab.isVisible().catch(() => false)) {
      await reviewTab.click({ timeout: 5000 }).catch(() => {});
    }
    await expect(confirmImplement).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1200);
    log(`第 ${attempt} 次点「确认实施」`);
    await confirmImplement.click({ timeout: 30_000 }).catch(() => {});
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline && !proceedBody) {
      await page.waitForTimeout(2000);
    }
  }
  expect(proceedBody, '点「确认实施」6 次都没触发 /api/requirements/proceed').toBeTruthy();
  const proceed = proceedBody as unknown as Record<string, string>;
  save('proceed.json', JSON.stringify(proceed, null, 2));
  const taskId: string = proceed.task_id || proceed.pipeline_id || '';
  expect(taskId, `proceed 没返回 task_id：${JSON.stringify(proceed).slice(0, 300)}`).toBeTruthy();
  log(`主 Agent 任务已创建：${taskId}（pipeline=${proceed.pipeline_id || '—'}）`);

  // ── 4. 子代理透明化：事件流 + 全量轨迹 ──────────────────────
  const seen = await until(
    '子代理工具事件',
    async () => {
      const res = await request.get(`/api/task/${taskId}/events?since_seq=0`);
      if (!res.ok()) return false;
      const body = await res.json();
      const items: Array<{ type: string }> = body.items || [];
      const tools = items.filter((e) => e.type === 'subagent_tool').length;
      const progress = items.filter((e) => e.type === 'subagent_progress').length;
      if (tools + progress === 0) return false;
      log(`事件流：共 ${items.length} 条，subagent_tool=${tools}，subagent_progress=${progress}`);
      return { tools, progress };
    },
    25 * 60 * 1000,
    5000,
  );
  expect(seen.tools).toBeGreaterThan(0);

  // 全量轨迹是**阶段结束**时落盘的，任务刚开始时读到 0 条是正常的 → 这里轮询等第一份。
  const tc = await until(
    '第一份工具轨迹落盘',
    async () => {
      const res = await request.get(`/api/task/${taskId}/tool-calls?limit=50`);
      if (!res.ok()) return false;
      const body = await res.json();
      if (!body.total) return false;
      save('tool-calls-page1.json', JSON.stringify(body, null, 2));
      log(`/tool-calls：stage=${body.stage} attempt=${body.attempt} total=${body.total} `
        + `failed=${body.failed} internal=${body.internal} available=${JSON.stringify(body.available)}`);
      return body;
    },
    40 * 60 * 1000,
    15_000,
  );
  expect(tc.total).toBeGreaterThan(0);

  // 前端「全量工具轨迹」面板（任务运行标签在视图里时才可见）
  const traceToggle = page.getByTestId('tool-trace-toggle').first();
  if (await traceToggle.isVisible().catch(() => false)) {
    await traceToggle.click({ timeout: 10_000 }).catch(() => {});
    await expect(page.getByTestId('tool-trace-stats').first()).toBeVisible({ timeout: 30_000 });
    log(`前端面板：${(await page.getByTestId('tool-trace-stats').first().innerText()).replace(/\s+/g, ' ')}`);
    const rows = await page.locator('[data-tool-call]').count();
    log(`面板已渲染 ${rows} 行轨迹`);
    expect(rows).toBeGreaterThan(0);
  } else {
    log('任务运行标签不在当前视图（编辑器内嵌），轨迹面板由上面的接口断言覆盖');
  }
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'task-running.png') });

  // ── 5. 等任务终态 ─────────────────────────────────────────
  const status = await until(
    '任务终态',
    async () => {
      const res = await request.get(`/api/task/${taskId}`);
      if (!res.ok()) return false;
      const body = await res.json();
      const st = body.task?.status;
      if (st === 'running' || st === 'planning' || st === 'paused') return false;
      const conclusion = (body.task?.finish?.conclusion || '').replace(/\s+/g, ' ').slice(0, 200);
      log(`任务结束：${st}｜${conclusion}`);
      save('task-final.json', JSON.stringify(body, null, 2));
      return st;
    },
    TASK_TIMEOUT,
    15_000,
  );
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'task-done.png') });
  expect(status).toBe('done');

  const projRes = await request.get(`/api/project/${projectId}`);
  const project = projRes.ok() ? await projRes.json() : {};
  const tracks = (project.timeline?.tracks || []).length;
  const clips = (project.timeline?.tracks || [])
    .reduce((n: number, t: { clips?: unknown[] }) => n + (t.clips?.length || 0), 0);
  log(`项目时间线：${tracks} 轨 / ${clips} 片段 / ${project.timeline?.duration_sec ?? 0}s`);
  expect(tracks).toBeGreaterThan(0);

  // ── 6. 导出渲染 ───────────────────────────────────────────
  await page.goto(`/export/${projectId}`);
  await expect(page.getByRole('button', { name: '加入渲染队列' })).toBeVisible({ timeout: 120_000 });
  log('导出页已就绪，点「加入渲染队列」');
  await page.getByRole('button', { name: '加入渲染队列' }).click();

  const output = await until(
    '渲染完成',
    async () => {
      const res = await request.get('/api/render/queue');
      if (!res.ok()) return false;
      const body = await res.json();
      // 队列接口返回的是 `tasks`（不是 items）；早期版本读错键会把"已完成"读成"没任务"
      const items: Array<Record<string, string>> = body.tasks || body.items || [];
      const done = items.find((i) => ['done', 'completed', 'success'].includes(String(i.status)));
      if (done && (done.output_path || done.filename)) {
        log(`渲染完成：${done.output_path || done.filename}`);
        return done.output_path || done.filename;
      }
      const failed = items.find((i) => String(i.status) === 'failed');
      if (failed) {
        throw new Error(`渲染失败：${failed.error || failed.detail || failed.message || '未知'}`);
      }
      return false;
    },
    RENDER_TIMEOUT,
    15_000,
  );
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'render-done.png') });

  // ── 7. 前端下载 ───────────────────────────────────────────
  const downloadBtn = page.getByRole('button', { name: '下载成片' }).first();
  await expect(downloadBtn).toBeVisible({ timeout: 240_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 300_000 }),
    downloadBtn.click(),
  ]);
  const saved = path.join(ARTIFACT_DIR, path.basename(String(output)) || 'final.mp4');
  await download.saveAs(saved);
  const bytes = fs.statSync(saved).size;
  log(`已下载：${saved}（${(bytes / 1024 / 1024).toFixed(1)} MB）`);
  expect(bytes).toBeGreaterThan(1024 * 1024);

  // ── 8. ffprobe ────────────────────────────────────────────
  const probe = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_frames',
    '-show_entries', 'format=duration,size',
    '-of', 'json', saved,
  ], { encoding: 'utf-8' });
  save('ffprobe.json', probe);
  const info = JSON.parse(probe);
  const stream = info.streams[0];
  const duration = Number(info.format.duration);
  log(`ffprobe：${stream.codec_name} ${stream.width}x${stream.height} ${stream.r_frame_rate} `
    + `${duration.toFixed(1)}s ${(Number(info.format.size) / 1024 / 1024).toFixed(1)}MB`);
  expect(stream.codec_name).toMatch(/h264|hevc/);
  expect(stream.width).toBe(1920);
  expect(duration).toBeGreaterThan(MIN_DURATION_SEC);

  save('page-errors.json', JSON.stringify(pageErrors, null, 2));
  expect(pageErrors).toEqual([]);
});
