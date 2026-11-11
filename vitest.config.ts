import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // _research/**：外部仓库调研克隆（opencut/video-use/hyperframes，已 gitignore），
      // 内含大量第三方 .test.ts；不排除会被扫进来，令 `npm test` 大面积失败。
      // .agents/**：本地 git worktree 副本（包含完整 src 与过时测试），
      // 被扫进来会让同一批用例跑两遍、且以旧代码产生假红。
      exclude: ['e2e/**', 'node_modules/**', 'dist/**', '.opencode/**', '.omo/**', '_research/**', '.agents/**'],
    },
  }),
);
