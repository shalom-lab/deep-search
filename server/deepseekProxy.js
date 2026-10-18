/**
 * Shared DeepSeek upstream proxy.
 *
 * BYOK 要点：API Key 从不进入本进程的环境变量或磁盘，它随每个请求的
 * Authorization 头由浏览器（localStorage）透传到 DeepSeek。服务器只是
 * 一个无状态的转发器，用于绕开浏览器跨域限制。
 *
 * 用法：在 vite.config.js 的 configureServer / configurePreviewServer 中挂载。
 */
import { Readable } from 'node:stream';

/**
 * 允许转发的路径白名单，避免这个中间件变成任意请求的开放代理。
 * 同时接受带 /v1 与不带 /v1 的写法（前端走代理时会省略 /v1 前缀）。
 */
const ALLOWED_PATHS = new Set(['/v1/tools/search', '/v1/tools/fetch', '/tools/search', '/tools/fetch']);

/** 不带凭据的探测路径，供前端判断当前是否运行在带代理的开发服务器下。 */
const HEALTH_PATH = '/__deepseek/health';

const PREFIXES = ['/__deepseek/api', '/api'];

function jsonError(status, message, extra = {}) {
  return { status, body: { error: { message, type: 'proxy_error', param: null, code: 'proxy_error', ...extra } } };
}

/**
 * @param {object} [options]
 * @param {string} [options.upstream] 上游基址，默认取环境变量 DEEPSEEK_API_BASE，再退回官方地址。
 * @returns {(req: any, res: any, next: () => void) => void} connect 风格中间件
 */
export function createDeepSeekProxy(options = {}) {
  const upstream = String(
    options.upstream || process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com',
  ).replace(/\/+$/, '');

  return async function deepseekProxy(req, res, next) {
    const rawUrl = String(req.url || '');
    const queryIndex = rawUrl.indexOf('?');
    const pathname = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);

    // 1. 健康检查：告诉前端代理是否可用，以及上游是谁（不含任何密钥）。
    if (pathname === HEALTH_PATH) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: true, proxy: true, upstream, allowed: [...ALLOWED_PATHS] }));
      return;
    }

    // 2. 只处理白名单内的转发路径，其余交给 Vite。
    const prefix = PREFIXES.find((p) => pathname === p || pathname.startsWith(`${p}/`));
    if (!prefix) return next();

    const upstreamPath = pathname.slice(prefix.length) || '/';
    if (!ALLOWED_PATHS.has(upstreamPath)) {
      const { status, body } = jsonError(403, '代理仅允许转发 POST /v1/tools/search 与 POST /v1/tools/fetch', {
        path: upstreamPath,
        allowed: ['/v1/tools/search', '/v1/tools/fetch'],
      });
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
      return;
    }

    if (req.method !== 'POST') {
      const { status, body } = jsonError(405, '仅支持 POST');
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
      return;
    }

    // 3. 逐块读取请求体（不缓冲成字符串再解析，避免多字节截断）。
    let bodyBuffer;
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      bodyBuffer = Buffer.concat(chunks);
    } catch {
      const { status, body } = jsonError(400, '读取请求体失败');
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
      return;
    }

    // 4. BYOK：原样透传浏览器带来的 Authorization。
    const auth =
      req.headers['authorization'] ||
      req.headers['Authorization'] ||
      (() => {
        const key = req.headers['x-deepseek-key'];
        return key ? `Bearer ${key}` : '';
      })();

    if (!auth) {
      const { status, body } = jsonError(401, '缺少 Authorization 头（BYOK：请在设置中填入 API Key）');
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
      return;
    }

    // 5. 转发
    let upstreamRes;
    try {
      upstreamRes = await fetch(`${upstream}${upstreamPath}`, {
        method: 'POST',
        headers: {
          Authorization: String(auth),
          'Content-Type': req.headers['content-type'] || 'application/json',
          Accept: 'application/json',
          'User-Agent': 'deepsearch-byok/1.0 (+vite-dev-proxy)',
        },
        body: bodyBuffer.length ? bodyBuffer : undefined,
      });
    } catch (err) {
      const { status, body } = jsonError(502, `无法连接上游 ${upstream}：${err?.message || err}`);
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
      return;
    }

    res.statusCode = upstreamRes.status;
    const contentType = upstreamRes.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    // 429 时把退避时间透传给前端，便于提示与自动重试
    const retryAfter = upstreamRes.headers.get('retry-after');
    if (retryAfter) res.setHeader('Retry-After', retryAfter);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-DeepSearch-Transport', 'vite-proxy');

    try {
      if (upstreamRes.body) {
        await new Promise((resolve, reject) => {
          const stream = Readable.fromWeb(upstreamRes.body);
          stream.on('error', reject);
          res.on('close', () => stream.destroy());
          stream.pipe(res);
          stream.on('end', resolve);
        });
      } else {
        res.end(await upstreamRes.text());
      }
    } catch {
      if (!res.writableEnded) res.end();
    }
  };
}

export const DEEPSEEK_PROXY_PATH = '/__deepseek/api';
