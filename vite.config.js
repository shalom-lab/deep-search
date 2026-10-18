import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 * Pages 没有服务端 rewrite：复制 SPA shell，让直链与刷新也能落到应用。
 * 本应用用 HashRouter，深链主要靠 #/路由；404.html 仍覆盖无 hash 的路径访问。
 */
function spaFallbackPlugin(routes = ['fetch', 'history', 'settings']) {
  return {
    name: 'deepsearch-spa-fallback',
    apply: 'build',
    enforce: 'post',
    writeBundle(outputOptions) {
      const dist = resolve(outputOptions.dir || 'dist');
      const index = join(dist, 'index.html');
      const html = readFileSync(index, 'utf8');
      copyFileSync(index, join(dist, '404.html'));
      for (const route of routes) {
        const dir = join(dist, route);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), html);
      }
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
