/**
 * 生产服务器：静态托管 dist/，并把同一份 DeepSeek 转发中间件挂上去。
 *
 *   npm run build
 *   npm start          # 默认 http://127.0.0.1:5273
 *
 * 这样生产环境同样是同源请求，不需要上游放行 CORS，
 * 也不需要把 API Key 放进任何环境变量或服务端存储。
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeepSeekProxy } from './deepseekProxy.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 5273);
const HOST = process.env.HOST || '127.0.0.1';

if (!existsSync(DIST)) {
  console.error('找不到 dist/，请先运行：npm run build');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const proxy = createDeepSeekProxy();

const server = createServer((req, res) => {
  // 先让转发中间件处理 /__deepseek/* 与 /api/*
  proxy(req, res, () => {
    const urlPath = decodeURIComponent(String(req.url || '/').split('?')[0]);
    // 防目录穿越
    const safePath = normalize(urlPath).replace(/^([/\\])+/, '');
    let filePath = join(DIST, safePath);

    if (!filePath.startsWith(DIST)) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    // SPA 回退：任何未命中的路径都返回 index.html
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(DIST, 'index.html');
    }

    if (!existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(filePath).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable');
    createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`DeepSearch 已启动： http://${HOST}:${PORT}`);
  console.log(`静态目录：${DIST}`);
  console.log('转发路径：POST /__deepseek/api/tools/search · POST /__deepseek/api/tools/fetch');
  console.log('API Key 由浏览器在请求头中提供（BYOK），服务端不存储任何密钥。');
});
