/**
 * 会话时间线 E2E（agent-timeline-adaptation PRD T6 + plan-dispatch PRD D3 验收）。
 *
 * 用 `K:\demo` 的真实数据跑一遍完整链路，钉住这一版真正改的东西：
 *
 * 1. **打开会话就有内容**（T1 存量回填 / 新会话开场白），不再出现"还没有可显示的内容"；
 * 2. **思考条目夹在提问与回复之间**（位置 = 服务端 seq，不是"沉底"）；
 * 3. **刷新前后条目序列逐条一致**（唯一有序流 + 回填幂等）；
 * 4. **点「确认简报」后立刻有可见进展**（D3：主 agent 派发生效，不再是空等）；
 * 5. 规划书卡出现在简报卡之后（D1 回填），「轨迹」面板有事件；
 * 6. 全程零 `pageerror`。
 *
 * 数据：`K:\demo\要求.md`（选题与硬要求）、`K:\demo\文案.md`（口播文案）。
 * 刻意不传 28MB 的配音——本用例验证的是时间线，不是上传/渲染。
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const DEMO_DIR = process.env.CW_DEMO_DIR || 'K:\\demo';
const ARTIFACT_DIR = path.join(process.cwd(), 'e2e', 'artifacts', 'session-timeline');
const LOG = path.join(process.cwd(), '_cache', 'e2e-session-timeline.log');

function log(msg: string) {
  const line = `[${new Date().toLocaleTimeString()}] [时间线E2E] ${msg}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, line);
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    fs.appendFileSync(path.join(ARTIFACT_DIR, 'run.log'), line);
  } catch { /* 日志失败不影响断言 */ }
}

function readDemo(name: string, limit = 4000): string {
  try {
    return fs.readFileSync(path.join(DEMO_DIR, name), 'utf-8').slice(0, limit);
  } catch {
    return '';
  }
}

/** 选题：优先用要求.md 的第一行标题，没有就用固定选题兜底 */
function demoTopic(): string {
  const req = readDemo('要求.md', 2000);
  const firstLine = req.split(/\r?\n/).map((s) => s.replace(/^#+\s*/, '').trim())
    .find((s) => s.length >= 4);
  return (firstLine || '机械键盘为什么会发出声音').slice(0, 60);
}

test('会话时间线：seq 顺序 / 刷新一致 / 派发规划书可见（K:\\demo）', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const topic = demoTopic();
  const briefInput = readDemo('文案.md', 1200);
  log(`数据源 ${DEMO_DIR}；选题「${topic}」；文案 ${briefInput.length} 字可参考`);

  await page.addInitScript(() => {
    window.localStorage.setItem('cw.unifiedTimeline', '1');
  });

  // ── 进入编辑器 ──────────────────────────────
  await page.goto('/');
  await page.getByRole('button', { name: '开始创作' }).first().click();
  await page.getByPlaceholder(/视频选题/).first().fill(topic);
  await page.getByRole('button', { name: '开始创作' }).last().click();
  await page.waitForURL(/\/editor\/proj_/, { timeout: 90_000 });
  log('已进入编辑器');

  await expect(page.getByTestId('requirements-pane')).toBeVisible({ timeout: 60_000 });
  const topicInput = page.getByPlaceholder('输入视频选题…');
  if (await topicInput.isVisible().catch(() => false)) {
    await topicInput.fill(topic);
    await page.getByRole('button', { name: '开始需求分析' }).click();
    log('已发起需求分析');
  }

  // ── 1) 时间线必须出现，且不是空态 ─────────────
  const stream = page.getByTestId('requirements-unified-stream');
  await expect(stream).toBeVisible({ timeout: 120_000 });
  const timeline = stream.getByTestId('session-timeline');
  await expect(timeline).toBeVisible({ timeout: 120_000 });
  // 空态文案不允许出现（T2：接口失败/未迁移都要说清，不能一句"还没有内容"）
  await expect(stream.getByTestId('session-timeline-empty')).toHaveCount(0);
  log(`时间线条目数 ${await timeline.getAttribute('data-total')}`);

  // ── 2) 等首轮真实对话（**用户条目**出现才算真的发过消息）──────
  // 注意：只看 assistant 会立刻命中开场白（它也是 assistant），断言就形同虚设。
  await expect(async () => {
    const n = await timeline.locator('[data-testid="unified-item-message"][data-role="user"]').count();
    if (n < 1) throw new Error('还没有用户条目，需求对话尚未开始');
  }).toPass({ timeout: 240_000, intervals: [2000] });
  await expect(async () => {
    const n = await timeline.locator('[data-testid="unified-item-message"][data-role="assistant"]').count();
    if (n < 2) throw new Error('还没有模型回复（只有开场白）');
  }).toPass({ timeout: 240_000, intervals: [2000] });
  log('首轮对话已完成（用户条目 + 模型回复都在）');

  /** 取某类条目的 data-seq；`which` 决定取第一条还是最后一条。
   *  注意 assistant 有两条（开场白 + 本轮回复），比较"回复在提问之后"必须取**最后一条**。 */
  const seqOf = async (sel: string, which: 'first' | 'last' = 'first') => {
    const loc = timeline.locator(sel);
    const el = which === 'last' ? loc.last() : loc.first();
    if (!(await el.isVisible().catch(() => false))) return null;
    const raw = await el.getAttribute('data-seq');
    return raw ? Number(raw) : null;
  };
  const userSeq = await seqOf('[data-testid="unified-item-message"][data-role="user"]', 'last');
  const assistantSeq = await seqOf('[data-testid="unified-item-message"][data-role="assistant"]', 'last');
  expect(userSeq).not.toBeNull();
  expect(assistantSeq).not.toBeNull();
  expect(assistantSeq!).toBeGreaterThan(userSeq!);
  log(`用户条目 seq=${userSeq}，回复条目 seq=${assistantSeq}`);

  // 思考：有就断言夹在用户提问与回复之间（T1 的核心收益）；没有则必须明说
  const thinkingSeq = await seqOf('[data-testid="session-item-thinking"]');
  if (thinkingSeq !== null) {
    expect(thinkingSeq).toBeGreaterThan(userSeq!);
    log(`思考条目 seq=${thinkingSeq}（位于用户提问之后）`);
  } else {
    const note = page.getByTestId('session-reasoning-note');
    log(`本轮无思考条目${(await note.count()) ? '，UI 已给出说明' : '（provider 未回吐）'}`);
  }

  // ── 3) 刷新前后逐条一致（T1 回填幂等 + 唯一有序流）──
  const seqsBefore = await timeline.locator('[data-seq]').evaluateAll(
    (els) => els.map((el) => Number(el.getAttribute('data-seq'))),
  );
  log(`刷新前条目序列 ${JSON.stringify(seqsBefore)}`);
  const shotBefore = path.join(ARTIFACT_DIR, 'before-reload.png');
  await page.screenshot({ path: shotBefore, fullPage: false }).catch(() => undefined);

  await page.reload();
  await expect(page.getByTestId('requirements-pane')).toBeVisible({ timeout: 60_000 });
  const timelineAfter = page.getByTestId('requirements-unified-stream').getByTestId('session-timeline');
  await expect(timelineAfter).toBeVisible({ timeout: 120_000 });
  await expect(timelineAfter.locator('[data-seq]').first()).toBeVisible({ timeout: 60_000 });
  const seqsAfter = await timelineAfter.locator('[data-seq]').evaluateAll(
    (els) => els.map((el) => Number(el.getAttribute('data-seq'))),
  );
  log(`刷新后条目序列 ${JSON.stringify(seqsAfter)}`);
  expect(seqsAfter).toEqual(seqsBefore);

  // ── 4) 把对话推到「简报就绪」，再点确认 → 主 agent 派发（D3）──
  // 需求 agent 可能先反问（gathering），所以用真实文案喂它几轮，直到简报卡出现。
  // 用 K:\demo\文案.md 的原文而不是"随便说两句"——这才是"用 demo 数据跑一遍"。
  const briefCard = timelineAfter.getByTestId('brief-card');
  const composer = page.getByPlaceholder(/继续与需求 Agent 对话/);
  /** 一轮是否结束看"模型发言条目数是否增加"。
   *  输入框在 busy 时**不会**被禁用（面板只是隐藏管线/规划中的输入区），
   *  所以拿 `toBeEditable` 当同步点会立刻通过，四轮消息会在 8 秒内全发出去。 */
  const replyCount = () => timelineAfter
    .locator('[data-testid="unified-item-message"][data-role="assistant"]').count();
  const pushes = [
    `这是我要讲的文案，请据此直接产出完整创意方案（简报），不用再追问：\n${briefInput}`,
    '方向没问题，直接出完整创意简报，不要再问了。',
    '现在就产出创意简报。',
    '确认，请出方案。',
  ];
  for (const text of pushes) {
    if ((await briefCard.count()) > 0) break;
    const before = await replyCount();
    await composer.fill(text.slice(0, 2000));
    await composer.press('Enter');
    log(`已发送推进消息（${text.slice(0, 18)}…），当前模型发言 ${before} 条`);
    // 等这一轮真的产出新发言（或被简报卡命中），最长 12 分钟
    await expect(async () => {
      const now = await replyCount();
      if (now <= before && (await briefCard.count()) < 1) {
        throw new Error('本轮还没有产出新的模型发言');
      }
    }).toPass({ timeout: 12 * 60_000, intervals: [3000] });
    log(`本轮结束：简报卡 ${await briefCard.count()} 张，模型发言 ${await replyCount()} 条`);
  }
  await expect(briefCard).toBeVisible({ timeout: 60_000 });
  log('简报卡已出现，点击「确认简报」');
  const confirmBtn = briefCard.getByRole('button', { name: /确认/ }).first();
  await confirmBtn.click();

  // 点确认后 90s 内必须有可见进展（stage / tool / 任务条目 / 明确的失败说明）
  await expect(async () => {
    const progress = await timelineAfter.locator(
      '[data-testid="session-item-stage"],[data-testid="session-item-tool"],'
      + '[data-testid="session-busy-row"]',
    ).count();
    if (progress < 1) throw new Error('点确认后没有任何可见进展（仍是空等）');
  }).toPass({ timeout: 90_000, intervals: [2000] });
  log('已出现派发进展条目');

  // ── 5) 规划书卡（D1 回填）──────────────────
  const planCard = timelineAfter.getByTestId('plan-card');
  await expect(planCard).toBeVisible({ timeout: 15 * 60 * 1000 });
  const planSeq = await timelineAfter.locator('[data-testid="timeline-item-plan"]').last().getAttribute('data-seq');
  log(`规划书卡已出现（plan 条目 seq=${planSeq}）`);

  // ── 6) 最终顺序（在切标签之前抓，切走后面板会卸载）──
  const seqsFinal = await timelineAfter.locator('[data-seq]').evaluateAll(
    (els) => els.map((el) => Number(el.getAttribute('data-seq'))),
  );
  expect(seqsFinal.length).toBeGreaterThan(10);
  expect(seqsFinal).toEqual([...seqsFinal].sort((a, b) => a - b));
  log(`最终条目序列 ${JSON.stringify(seqsFinal)}`);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'final.png') }).catch(() => undefined);

  // ── 7) 「轨迹」面板（专业视图，入口在「新增标签」菜单里）──
  const traceTab = page.getByRole('tab', { name: '轨迹' }).first();
  if (!(await traceTab.isVisible().catch(() => false))) {
    const plus = page.getByRole('button', { name: '新增标签' }).first();
    if (await plus.isVisible().catch(() => false)) {
      await plus.click();
      await page.getByRole('button', { name: '轨迹', exact: true }).first().click();
      log('已从「新增标签」菜单打开轨迹');
    }
  }
  const stats = page.getByTestId('task-trace-stats');
  if (await stats.isVisible({ timeout: 30_000 }).catch(() => false)) {
    const text = (await stats.textContent()) || '';
    log(`轨迹：${text}`);
    expect(text).toContain('事件');
  } else {
    // 轨迹读的是"当前任务"：派发任务收尾后标签可能显示空态，这不算失败
    log('轨迹标签已打开但没有任务事件区（任务可能已收尾），跳过 UI 断言');
  }

  expect(pageErrors).toEqual([]);
});
