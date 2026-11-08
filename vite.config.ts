import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // 后端实际端口：J:\Clipwright\.env 中 CLIPWRIGHT_PORT=8080
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      // P3-3B: 账号/市场服务（ClipWright Server，K:\Clipwright Server :8090）
      // rewrite：客户端 baseURL 是 /srv，而 Server 的路由在 /api/... 下；
      // 少了这条 /srv/api/auth/refresh 会原样打到 8090 → 404（服务在也没用）。
      '/srv': {
        target: 'http://localhost:8090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/srv/, ''),
      },
    },
  },
  // W18: 包体优化 — vendor 拆分 + 大依赖独立 chunk（长缓存 + 首屏并行加载）
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          'tanstack': ['@tanstack/react-router', '@tanstack/react-virtual'],
          'lucide': ['lucide-react'],
          'zustand': ['zustand'],
          'radix': ['@radix-ui/react-tooltip', '@radix-ui/react-slider', '@radix-ui/react-select',
            '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-popover'],
        },
      },
    },
  },
});
