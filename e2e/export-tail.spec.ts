import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROJECT = process.env.CW_E2E_PROJECT || "proj_815062b0b8db";
const DIR = path.resolve("e2e/artifacts/final");

function log(m: string) {
  const t = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  console.log(`[${t}] [尾段E2E] ${m}`);
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(path.resolve("_cache/e2e-live.log"), `[${t}] [尾段E2E] ${m}\n`, "utf-8");
}

test("导出 → 渲染 → 下载 → ffprobe", async ({ page, request }) => {
  test.setTimeout(60 * 60 * 1000);
  const proj = await (await request.get(`/api/project/${PROJECT}`)).json();
  const tracks = proj.timeline?.tracks ?? [];
  const textClips: Array<Record<string, number>> = [];
  for (const t of tracks) {
    for (const c of t.clips ?? []) {
      if (c.kind === "text") textClips.push({ start: c.start_sec, dur: c.duration_sec });
    }
  }
  log(`项目 ${PROJECT}：${tracks.length} 轨，文字动画 ${textClips.length} 条`);
  fs.writeFileSync(path.join(DIR, "text-clips.json"), JSON.stringify(textClips, null, 2), "utf-8");

  await page.goto(`/export/${PROJECT}`);
  await expect(page.getByRole("button", { name: "加入渲染队列" })).toBeVisible({ timeout: 120_000 });
  log("导出页就绪，点「加入渲染队列」");
  await page.getByRole("button", { name: "加入渲染队列" }).click();

  const deadline = Date.now() + 40 * 60 * 1000;
  let output = "";
  while (Date.now() < deadline && !output) {
    await page.waitForTimeout(10_000);
    const body = await (await request.get("/api/render/queue")).json();
    const items: Array<Record<string, string>> = body.tasks ?? body.items ?? [];
    const done = items.find((i) => ["done", "completed", "success"].includes(String(i.status)));
    const failed = items.find((i) => String(i.status) === "failed");
    if (done) {
      output = done.output_path || done.filename || "";
      log(`渲染完成：${output}`);
      break;
    }
    if (failed) throw new Error(`渲染失败：${failed.error || failed.detail || "未知"}`);
  }
  expect(output, "渲染 40 分钟内没完成").toBeTruthy();
  await page.screenshot({ path: path.join(DIR, "render-done.png") });

  await expect(page.getByRole("button", { name: "下载成片" }).first()).toBeVisible({ timeout: 240_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 300_000 }),
    page.getByRole("button", { name: "下载成片" }).first().click(),
  ]);
  const saved = path.join(DIR, `final-${PROJECT}.mp4`);
  await download.saveAs(saved);
  const bytes = fs.statSync(saved).size;
  log(`已下载 ${saved}（${(bytes / 1024 / 1024).toFixed(1)} MB）`);
  expect(bytes).toBeGreaterThan(1024 * 1024);

  const probe = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate,nb_frames",
    "-show_entries", "format=duration,size", "-of", "json", saved], { encoding: "utf-8" });
  fs.writeFileSync(path.join(DIR, "ffprobe.json"), probe, "utf-8");
  const info = JSON.parse(probe);
  const s = info.streams[0];
  log(`ffprobe：${s.codec_name} ${s.width}x${s.height} ${s.r_frame_rate} ${Number(info.format.duration).toFixed(1)}s`);
  expect(s.codec_name).toMatch(/h264|hevc/);
  expect(s.width).toBe(1920);
  expect(Number(info.format.duration)).toBeGreaterThan(30);
});
