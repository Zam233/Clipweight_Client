import type { Page } from '@playwright/test';

const demoTimeline = {
  id: 'tl-e2e',
  width: 1920,
  height: 1080,
  fps: 30,
  duration_sec: 8,
  tracks: [
    {
      id: 'track-v1',
      name: 'VIDEO 1',
      kind: 'video',
      index: 0,
      locked: false,
      muted: false,
      clips: [
        {
          id: 'clip-v1',
          kind: 'video',
          asset_id: 'demo-asset',
          track_id: 'track-v1',
          start_sec: 0,
          duration_sec: 5,
          source_offset_sec: 0,
          speed: 1,
          volume: 1,
          opacity: 1,
          image_fit: null,
          image_rect: null,
          text: null,
          font: null,
          font_size: null,
          font_color: null,
          text_align: null,
          transition_in: null,
          transition_out: null,
          transition_duration_sec: null,
          shape: null,
          fill: null,
          bar_count: null,
          bar_width: null,
          keyframes: [],
          metadata: { title: 'E2E 演示片段' },
        },
      ],
    },
    {
      id: 'track-t1',
      name: 'TEXT 1',
      kind: 'text',
      index: 1,
      locked: false,
      muted: false,
      clips: [],
    },
  ],
};

const demoProject = {
  id: 'e2e-demo',
  name: 'E2E 演示项目',
  timeline: demoTimeline,
  created_at: '2026-07-29T00:00:00Z',
  updated_at: '2026-07-29T00:00:00Z',
  persona_id: 'default',
  plugin_id: 'knowledge_longform',
  folder: '',
  tags: [],
};

const demoSummary = {
  id: 'e2e-demo',
  name: 'E2E 演示项目',
  created_at: '2026-07-29T00:00:00Z',
  updated_at: '2026-07-29T00:00:00Z',
  persona_id: 'default',
  plugin_id: 'knowledge_longform',
  folder: '',
  tags: [],
  track_count: 2,
  duration_sec: 8,
  has_thumbnail: false,
};

/**
 * 拦截全部后端请求，使 E2E 不依赖真实后端（hermetic）。
 */
export async function mockBackendApi(page: Page): Promise<void> {
  await page.route('**/health', (route) =>
    route.fulfill({ json: { status: 'ok', service: 'clipwright-engine' } }),
  );

  await page.route('**/api/**', (route) => {
    const url = route.request().url();

    if (/\/api\/project\/e2e-demo(\/|$|\?)/.test(url)) {
      return route.fulfill({ json: demoProject });
    }
    if (/\/api\/project(\/?$|\?)/.test(url)) {
      return route.fulfill({ json: [demoSummary] });
    }
    if (url.includes('/api/plugin/list')) {
      return route.fulfill({ json: [] });
    }
    if (url.includes('/api/persona')) {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: {} });
  });
}

/** 收集页面 JS 错误，测试结束时断言为空。 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}
