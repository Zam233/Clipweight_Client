import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // _research/**：外部仓库调研克隆（opencut/video-use/hyperframes，已 gitignore），
      // 内含大量第三方 .test.ts；不排除会被扫进来，令 `npm test` 大面积失败。
      exclude: ['e2e/**', 'node_modules/**', 'dist/**', '.opencode/**', '.omo/**', '_research/**'],
    },
  }),
);
