import { copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createDeepSeekProxy } from './server/deepseekProxy.js';

/** GitHub Project Pages：https://shalom-lab.github.io/deep-search/ */
const REPO_BASE = '/deep-search/';

/**
 * 把 DeepSeek 代理挂到 dev server 与 preview server 上。
 * GitHub Pages 是纯静态托管，不会挂这份中间件；线上请用「直连」或演示模式。
 */
function deepseekProxyPlugin() {
  return {
    name: 'deepsearch-deepseek-proxy',
    configureServer(server) {
      server.middlewares.use(createDeepSeekProxy());
    },
    configurePreviewServer(server) {
      server.middlewares.use(createDeepSeekProxy());
    },
  };
}

/**
 * HashRouter 深链靠 #/路由，无需为 /fetch /history /settings 再复制 index.html。
 * 仍生成 404.html：覆盖无 hash 的路径直链（GitHub Pages 自定义 404 → SPA shell）。
 */
function spaFallbackPlugin() {
  return {
    name: 'deepsearch-spa-fallback',
    apply: 'build',
    enforce: 'post',
    writeBundle(outputOptions) {
      const dist = resolve(outputOptions.dir || 'dist');
      copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));
    },
  };
}

export default defineConfig({
  base: REPO_BASE,
  plugins: [react(), deepseekProxyPlugin(), spaFallbackPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: false,
    open: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 5274,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
