/**
 * DeepSeek 网页搜索 / 网页抓取 API 客户端（BYOK）。
 *
 *   POST {base}/v1/tools/search   { query, count, ori_question, localization, need_content }
 *   POST {base}/v1/tools/fetch    { url }
 *
 * 传输层默认浏览器直连 api.deepseek.com。本地 dev/preview 若挂了同源转发
 * （/__deepseek/api/*），仅在直连失败时作为静默备用，UI 不提供传输方式选择。
 * API Key 始终由本模块从 localStorage 读取后放进 Authorization 头，服务端不持有任何密钥。
 */
import { countChars, daysAgoISO, hostOf, seededInt } from './util.js';

export const DEFAULT_BASE = 'https://api.deepseek.com';
export const PROXY_PREFIX = '/__deepseek/api';
export const HEALTH_PATH = '/__deepseek/health';

export const SEARCH_PATH = '/v1/tools/search';
export const FETCH_PATH = '/v1/tools/fetch';

export const QUERY_MAX = 128;
export const COUNT_MIN = 1;
export const COUNT_MAX = 50;

/** 计费：Search / Fetch 均为每 1000 次「成功且产生结果」的请求 5 元。 */
export const PRICE_PER_1000 = 5;
export const PRICE_CURRENCY = '¥';

export const ERROR_META = {
  invalid_request: {
    label: '请求不合法',
    hint: '检查 query 长度（1–128 字符且不全为空白）、count 是否在 1–50，或 URL 是否合法。',
    retryable: false,
  },
  unauthorized: {
    label: '鉴权失败',
    hint: 'API Key 缺失或无效。到「设置」重新粘贴，注意不要带多余空格或换行。',
    retryable: false,
    action: 'settings',
  },
  insufficient_balance: {
    label: '余额不足',
    hint: '账号余额不足，请先到 platform.deepseek.com 充值后重试。',
    retryable: false,
  },
  forbidden: {
    label: '被安全策略拒绝',
    hint: '该网页被安全策略拦截，换一个来源或改用其他结果。',
    retryable: false,
  },
  not_found: {
    label: '未获取到可用内容',
    hint: 'URL 不可用、被站点策略拦截、目标站点报错，或页面没有可提取的正文。',
    retryable: false,
  },
  timeout: { label: '请求超时', hint: '读取请求体或下游请求超时，稍后重试。', retryable: true },
  too_large: { label: '请求体过大', hint: '请求体超过大小限制。', retryable: false },
  rate_limited: {
    label: '触发限速',
    hint: 'Search 与 Fetch 各自独立限速 5 QPS（按账号计算），稍等片刻再试。',
    retryable: true,
  },
  server_error: { label: '服务端错误', hint: 'DeepSeek 服务端异常，稍后重试。', retryable: true },
  gateway_timeout: { label: '上游超时', hint: '下游请求超时，稍后重试。', retryable: true },
  proxy_error: { label: '本地代理错误', hint: '开发服务器转发失败，检查终端日志与网络。', retryable: true },
  network: {
    label: '网络不可达',
    hint: '无法连接到 api.deepseek.com。可能是网络中断或被浏览器跨域策略拦截。',
    retryable: true,
  },
  cors: {
    label: '跨域被拦截',
    // hint 由 describeError → corsHintForHost() 按 hostname 分流覆盖
    hint: '浏览器直连 api.deepseek.com 被 CORS 策略拦截。',
    retryable: false,
  },
  aborted: { label: '已取消', hint: '请求被取消。', retryable: false },
  empty_response: { label: '响应为空', hint: '接口返回了空响应体。', retryable: true },
  bad_json: { label: '响应解析失败', hint: '接口返回的内容不是合法 JSON。', retryable: true },
};

export class DeepSeekError extends Error {
  constructor(code, message, extra = {}) {
    super(message || ERROR_META[code]?.label || '请求失败');
    this.name = 'DeepSeekError';
    this.code = code;
    this.status = extra.status ?? null;
    this.detail = extra.detail ?? null;
    this.retryAfter = extra.retryAfter ?? null;
    this.endpoint = extra.endpoint ?? null;
    this.transport = extra.transport ?? null;
    this.meta = ERROR_META[code] || ERROR_META.server_error;
  }

  get retryable() {
    return Boolean(this.meta?.retryable);
  }
}

export function statusToCode(status) {
  switch (status) {
    case 400:
      return 'invalid_request';
    case 401:
      return 'unauthorized';
    case 402:
      return 'insufficient_balance';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 408:
      return 'timeout';
    case 413:
      return 'too_large';
    case 429:
      return 'rate_limited';
    case 504:
      return 'gateway_timeout';
    default:
      return status >= 500 ? 'server_error' : status >= 400 ? 'invalid_request' : 'server_error';
  }
}

/** 是否为 GitHub Pages 静态托管（无本地转发中间件）。 */
export function isGitHubPagesHost(hostname) {
  const rawHost = hostname ?? (typeof location !== 'undefined' ? location.hostname : '');
  const host = String(rawHost || '').toLowerCase();
  return host.endsWith('.github.io') || host === 'github.io';
}

/** 直连真正失败时的简短提示（Pages vs 本地可区分，但都不暗示「搜不了」）。 */
export function corsHintForHost(hostname) {
  if (isGitHubPagesHost(hostname)) {
    return '浏览器直连失败（网络或跨域）。可稍后重试；本机 npm run dev 也可作可选备用。';
  }
  const rawHost = hostname ?? (typeof location !== 'undefined' ? location.hostname : '');
  const host = String(rawHost || '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
    return '浏览器直连失败（网络或跨域）。本地可用 npm run dev 的同源转发作备用。';
  }
  return '浏览器直连失败（网络或跨域）。请检查网络后重试；本地开发可用 npm run dev 作可选备用。';
}

export function describeError(error) {
  const code = error?.code || 'server_error';
  const meta = ERROR_META[code] || ERROR_META.server_error;
  const statusPart = error?.status ? `HTTP ${error.status}` : '请求失败';
  let hint = meta.hint;
  if (code === 'cors' || code === 'network') {
    const hostHint = corsHintForHost();
    hint = code === 'cors' ? hostHint : `${meta.hint} ${hostHint}`;
  }
  return {
    code,
    label: meta.label,
    hint,
    retryable: Boolean(meta.retryable),
    status: error?.status ?? null,
    action: meta.action || null,
    detail: error?.detail || error?.message || '',
    title: `${statusPart} · ${meta.label}`,
  };
}

export function buildUrl(base, path, transport) {
  const root = String(base || DEFAULT_BASE).trim().replace(/\/+$/, '');
  if (transport === 'proxy') {
    const pathname = path.replace(/^\/v1/, '');
    return `${PROXY_PREFIX}${pathname}`;
  }
  return `${root}${path}`;
}

/** 探测同源代理是否可用（只在开发/预览服务器下返回 ok）。 */
export async function probeProxy(timeoutMs = 2500) {
  if (typeof fetch !== 'function') return { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(HEALTH_PATH, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    return { ok: Boolean(data?.ok), upstream: data?.upstream || DEFAULT_BASE };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/** 读取可能存在的 Retry-After（秒或 HTTP 日期）。 */
function parseRetryAfter(res) {
  const raw = res?.headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const when = new Date(raw).getTime();
  if (Number.isNaN(when)) return null;
  return Math.max(0, Math.round((when - Date.now()) / 1000));
}

/** 429 / 5xx / timeout：最多自动退避重试 1 次（可被 AbortSignal 取消）。 */
const AUTO_RETRY_CODES = new Set(['rate_limited', 'timeout', 'server_error', 'gateway_timeout']);
const AUTO_RETRY_DEFAULT_MS = 600;
const AUTO_RETRY_MAX_MS = 30_000;

function backoffMs(err) {
  const sec = err?.retryAfter;
  if (sec != null && Number.isFinite(sec)) {
    return Math.min(AUTO_RETRY_MAX_MS, Math.max(0, Math.round(sec * 1000)));
  }
  return AUTO_RETRY_DEFAULT_MS;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DeepSeekError('aborted', '请求已取消'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DeepSeekError('aborted', '请求已取消'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function realCallWithAutoRetry(args) {
  try {
    return await realCall(args);
  } catch (err) {
    const error = err instanceof DeepSeekError ? err : new DeepSeekError('network', err?.message || String(err));
    if (error.code === 'aborted' || args.signal?.aborted) throw error;
    if (!AUTO_RETRY_CODES.has(error.code)) throw error;
    await sleep(backoffMs(error), args.signal);
    return await realCall(args);
  }
}

async function readErrorMessage(res) {
  try {
    const text = await res.text();
    if (!text) return '';
    try {
      const data = JSON.parse(text);
      return data?.error?.message || data?.message || text.slice(0, 400);
    } catch {
      return text.slice(0, 400);
    }
  } catch {
    return '';
  }
}

function isAbortError(err) {
  return err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
}

/**
 * 统一请求入口。
 * @param {object} params
 * @param {string} params.path         /v1/tools/search | /v1/tools/fetch
 * @param {object} params.body         请求体
 * @param {string} params.apiKey       BYOK key
 * @param {string} [params.base]
 * @param {'auto'|'proxy'|'direct'} [params.transport] 内部用；默认 auto=直连优先，代理仅备用
 * @param {boolean} [params.proxyAvailable]
 * @param {boolean} [params.demo]
 * @param {AbortSignal} [params.signal]
 * @param {number} [params.timeoutMs]
 */
export async function callTool(params) {
  const {
    path,
    body,
    apiKey,
    base = DEFAULT_BASE,
    transport = 'auto',
    proxyAvailable = false,
    demo = false,
    signal,
    timeoutMs = 60_000,
  } = params;

  const startedAt = performance.now();

  if (!demo && !String(apiKey || '').trim()) {
    throw new DeepSeekError('unauthorized', '未配置 API Key', { endpoint: path });
  }

  const chain = resolveTransportChain(transport, proxyAvailable);
  let lastError = null;

  for (let i = 0; i < chain.length; i += 1) {
    const mode = chain[i];
    try {
      const payload = demo
        ? await demoCall(path, body, signal)
        : await realCallWithAutoRetry({ path, body, apiKey, base, mode, signal, timeoutMs });
      return {
        ...payload,
        transport: demo ? 'demo' : mode,
        latencyMs: Math.round(performance.now() - startedAt),
        ok: true,
        demo,
      };
    } catch (err) {
      lastError = err instanceof DeepSeekError ? err : new DeepSeekError('network', err?.message || String(err));
      const canFallback =
        i < chain.length - 1 &&
        (lastError.code === 'network' || lastError.code === 'cors' || lastError.code === 'proxy_error') &&
        !isAbortError(err);
      if (!canFallback) break;
    }
  }

  if (lastError) {
    lastError.latencyMs = Math.round(performance.now() - startedAt);
    throw lastError;
  }
  throw new DeepSeekError('server_error', '未知错误', { endpoint: path });
}

function resolveTransportChain(transport, proxyAvailable) {
  if (transport === 'proxy') return ['proxy'];
  if (transport === 'direct') return ['direct'];
  // 默认直连；本地转发仅在探测可用时作为静默备用
  return proxyAvailable ? ['direct', 'proxy'] : ['direct'];
}

async function realCall({ path, body, apiKey, base, mode, signal, timeoutMs }) {
  const url = buildUrl(base, path, mode);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) throw new DeepSeekError('aborted', '请求已取消');
    signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(apiKey).trim()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (err) {
    if (isAbortError(err)) {
      if (signal?.aborted) throw new DeepSeekError('aborted', '请求已取消', { transport: mode, endpoint: path });
      throw new DeepSeekError('timeout', `请求超过 ${Math.round(timeoutMs / 1000)} 秒未返回`, {
        endpoint: path,
        transport: mode,
      });
    }
    // fetch 抛错通常意味着网络不可达或被 CORS 拦截，两者在浏览器里不可区分。
    const guess = mode === 'direct' ? 'cors' : 'network';
    throw new DeepSeekError(guess, err?.message || '网络错误', { endpoint: path, transport: mode });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  if (!res.ok) {
    const detail = await readErrorMessage(res);
    const code = statusToCode(res.status);
    throw new DeepSeekError(code, detail || ERROR_META[code].label, {
      status: res.status,
      detail,
      retryAfter: parseRetryAfter(res),
      endpoint: path,
      transport: mode,
    });
  }

  let data;
  try {
    const text = await res.text();
    if (!text) throw new DeepSeekError('empty_response', '空响应体', { endpoint: path, transport: mode });
    data = JSON.parse(text);
  } catch (err) {
    if (err instanceof DeepSeekError) throw err;
    throw new DeepSeekError('bad_json', '响应不是合法 JSON', { endpoint: path, transport: mode });
  }

  return data;
}

/* ──────────────────────────── 业务封装 ──────────────────────────── */

/**
 * 网页搜索。
 * @param {object} input
 * @param {string} input.query
 * @param {number} [input.count]
 * @param {string|null} [input.oriQuestion]
 * @param {string} [input.localization]
 * @param {boolean} [input.needContent]
 */
export async function searchWeb(input) {
  const query = String(input.query ?? '').trim();
  const validation = validateQuery(query);
  if (!validation.ok) throw new DeepSeekError('invalid_request', validation.message);

  const body = { query, count: clampCount(input.count) };
  if (input.needContent) body.need_content = true;
  const ori = String(input.oriQuestion ?? '').trim();
  if (ori) body.ori_question = [...ori].slice(0, QUERY_MAX).join('');
  const loc = String(input.localization ?? '').trim();
  if (loc) body.localization = loc;

  const payload = await callTool({
    path: SEARCH_PATH,
    body,
    apiKey: input.apiKey,
    base: input.base,
    transport: input.transport,
    proxyAvailable: input.proxyAvailable,
    demo: input.demo,
    signal: input.signal,
  });

  const results = Array.isArray(payload.results) ? payload.results.map(normalizeResult) : [];
  return {
    query,
    count: body.count,
    needContent: Boolean(input.needContent),
    usedOri: Boolean(ori),
    localization: loc || null,
    results,
    transport: payload.transport,
    latencyMs: payload.latencyMs,
    demo: payload.demo,
    fetchedAt: new Date().toISOString(),
  };
}

/** 网页抓取。 */
export async function fetchWeb(input) {
  const url = String(input.url ?? '').trim();
  const validation = validateUrl(url);
  if (!validation.ok) throw new DeepSeekError('invalid_request', validation.message);

  const payload = await callTool({
    path: FETCH_PATH,
    body: { url },
    apiKey: input.apiKey,
    base: input.base,
    transport: input.transport,
    proxyAvailable: input.proxyAvailable,
    demo: input.demo,
    signal: input.signal,
  });

  const title = typeof payload.title === 'string' ? payload.title : '';
  const content = typeof payload.content === 'string' ? payload.content : '';
  return {
    url,
    title,
    content,
    chars: countChars(content),
    transport: payload.transport,
    latencyMs: payload.latencyMs,
    demo: payload.demo,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 用一次最小请求验证密钥与传输链路。
 * 真实调用上游（即使当前处于演示模式），因为目的就是验证凭据本身。
 * count=1，成功且有结果才计费。
 */
export async function testConnection(input) {
  const startedAt = performance.now();
  const payload = await callTool({
    path: SEARCH_PATH,
    body: { query: 'DeepSeek', count: 1 },
    apiKey: input.apiKey,
    base: input.base,
    transport: input.transport,
    proxyAvailable: input.proxyAvailable,
    demo: false,
    signal: input.signal,
    timeoutMs: 30_000,
  });
  const results = Array.isArray(payload.results) ? payload.results : [];
  return {
    ok: true,
    latencyMs: payload.latencyMs || Math.round(performance.now() - startedAt),
    transport: payload.transport,
    count: results.length,
    sample: results[0]?.title || '',
    sampleUrl: results[0]?.url || '',
  };
}

export function clampCount(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 10;
  return Math.min(COUNT_MAX, Math.max(COUNT_MIN, n));
}

export function validateQuery(query) {
  const chars = countChars(query);
  if (chars === 0) return { ok: false, message: '搜索词不能为空', chars };
  if (chars > QUERY_MAX) return { ok: false, message: `搜索词最多 ${QUERY_MAX} 个字符，当前 ${chars} 个`, chars };
  if (!String(query).trim()) return { ok: false, message: '搜索词不能全为空白', chars };
  return { ok: true, chars };
}

export function validateUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return { ok: false, message: '请输入要抓取的网址' };
  if (countChars(raw) > 8192) return { ok: false, message: 'URL 长度不能超过 8192' };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, message: '不是合法的 URL，需要包含协议与主机名，例如 https://example.com/a' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, message: '只支持 http 或 https 协议' };
  }
  if (!parsed.hostname) return { ok: false, message: 'URL 必须包含 host' };
  if (parsed.username || parsed.password) return { ok: false, message: 'URL 不能携带用户名或密码' };
  return { ok: true };
}

/** 补齐并收敛单条结果字段，容错 null / 缺失。 */
export function normalizeResult(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const score = Number(r.rerank_score);
  const url = typeof r.url === 'string' ? r.url : '';
  return {
    id: `${url}#${seededInt(url || r.title || '', 1_000_000)}`,
    rerankScore: Number.isFinite(score) ? Math.min(3, Math.max(0, score)) : 0,
    title: typeof r.title === 'string' ? r.title : '',
    url,
    snippet: typeof r.snippet === 'string' ? r.snippet : '',
    summary: typeof r.summary === 'string' ? r.summary : '',
    content: typeof r.content === 'string' ? r.content : '',
    // site_name 缺失时回退到 URL 的 host，避免界面出现空来源
    siteName: typeof r.site_name === 'string' && r.site_name.trim() ? r.site_name : hostOf(url) || null,
    siteIcon: typeof r.site_icon === 'string' ? r.site_icon : null,
    date: typeof r.date === 'string' ? r.date : null,
    authority: Number.isFinite(Number(r.authority)) ? Number(r.authority) : -1,
  };
}

/* ──────────────────────────── 演示数据 ──────────────────────────── */

const DEMO_SEEDS = [
  {
    title: 'DeepSeek 发布 V4 模型：工具调用与长上下文能力升级',
    host: 'api-docs.deepseek.com',
    site: 'DeepSeek API Docs',
    path: '/zh-cn/news/news261017',
    authority: 4,
    score: 2.85,
    days: 12,
    snippet:
      'DeepSeek V4 已上线，支持更稳定的工具调用、更长的上下文窗口与更低的首字延迟，适用于 Agent 工作流与 RAG 应用。',
    summary:
      'DeepSeek 正式发布 V4 模型，重点改进工具调用可靠性、长上下文保持能力与推理成本。官方文档同时更新了 Search 与 Fetch 两个原始 JSON 接口，供 Agent 与 RAG 应用获取实时网页内容。文档指出 Search 由自研搜索引擎提供支持，按请求次数计费，每 1000 次成功请求 5 元，账号级 QPS 限制为 5。',
    contentHead: 'DeepSeek V4 现已正式上线。',
  },
  {
    title: 'Search API Reference · POST /v1/tools/search',
    host: 'api-docs.deepseek.com',
    site: 'DeepSeek API Docs',
    path: '/zh-cn/api/search/',
    authority: 4,
    score: 2.7,
    days: 12,
    snippet:
      '按 query 搜索网页并返回结构化结果列表。请求字段包括 query、count、ori_question、localization 与 need_content。',
    summary:
      '接口参考文档列出完整请求与响应 Schema。响应中每条结果包含 rerank_score（0–3，≥1.5 为优质）、title、url、snippet（100–200 字符）、summary（600–800 字符）、content、site_name、site_icon、date 与 authority（0–4，-1 表示未知）。',
    contentHead: 'Search 接口按 query 搜索网页，返回结构化结果列表。',
  },
  {
    title: '网页搜索与抓取指南：语法、错误码、计费与限速',
    host: 'api-docs.deepseek.com',
    site: 'DeepSeek API Docs',
    path: '/zh-cn/guides/search/',
    authority: 4,
    score: 2.62,
    days: 12,
    snippet:
      'query 支持 site:、-site:、-、-"..."、"..."、lang:、after:、before: 等操作符，可在一个 query 中组合多个操作符。',
    summary:
      '指南给出操作符示例，例如 DeepSeek site:github.com OR site:huggingface.co lang:zh after:2025。错误章节使用 OpenAI 兼容格式，param 恒为 null；400/401/402/403/404/408/413/429/500/504 分别对应参数非法、鉴权失败、余额不足、被策略拒绝、无可用内容、读取超时、请求体过大、限速、服务端错误与下游超时。',
    contentHead: 'Search 接口和 Fetch 接口为 Agent 与 RAG 应用提供实时网页内容。',
  },
  {
    title: 'BYOK 模式接入第三方 API 的最佳实践',
    host: 'github.com',
    site: 'GitHub',
    path: '/deepseek-ai/awesome-deepseek-integration',
    authority: 3,
    score: 2.31,
    days: 40,
    snippet:
      '把用户自带的密钥只保存在浏览器 localStorage，请求时通过 Authorization 头直连上游，服务端不落盘、不记录。',
    summary:
      '实践要点：密钥仅存 localStorage 并使用扁平键名；启动时静默读取，不弹窗打断；界面只展示状态与掩码后的末四位；清除操作需要二次确认；禁止把密钥写入仓库、构建产物或环境变量，也禁止经由第三方中转。',
    contentHead: 'Bring Your Own Key 的核心是把凭据的保管责任交还给使用者。',
  },
  {
    title: '用 Vite + React 搭建一个搜索工作台',
    host: 'vitejs.dev',
    site: 'Vite',
    path: '/guide/',
    authority: 3,
    score: 1.98,
    days: 95,
    snippet:
      'Vite 提供极快的冷启动与 HMR，配合中间件可以在开发服务器上挂载轻量转发，解决浏览器直连第三方 API 的跨域问题。',
    summary:
      '在 vite.config.js 中通过 configureServer 与 configurePreviewServer 挂载同一份 connect 中间件，可以在开发与预览两种模式下都获得同源转发能力。生产部署时把同一中间件挂到自己的 Node 服务上即可，前端代码无需改动。',
    contentHead: 'Vite 的目标是让前端开发更快。',
  },
  {
    title: 'Rerank 分数怎么看：相关性、权威性与时效性的综合排序',
    host: 'zhuanlan.zhihu.com',
    site: '知乎专栏',
    path: '/p/1900000000000000000',
    authority: 2,
    score: 1.72,
    days: 150,
    snippet:
      'rerank_score 大于等于 1.5 通常可以视为优质结果，大于 2.5 的结果在人工评估中几乎总是排在前列。',
    summary:
      '排序分数综合了查询相关性、站点权威性与内容时效性。实践中建议：先用分数下限过滤掉长尾噪声，再对前若干条结果结合 authority 与 date 做人工判断；对时效敏感的问题，应把 before:/after: 写进 query 而不是只在客户端排序。',
    contentHead: '排序分数只是起点，不是结论。',
  },
  {
    title: '如何设计一个让模型读得懂的网页摘要',
    host: 'www.anthropic.com',
    site: 'Anthropic',
    path: '/research',
    authority: 3,
    score: 1.61,
    days: 210,
    snippet:
      '短摘要用于界面展示，长摘要用于喂给模型。二者应针对不同读者优化，而不是互相截断。',
    summary:
      '面向界面的摘要需要保留最具区分度的信息，长度控制在 100–200 字符；面向模型的摘要应保留上下文、数字、日期与限定条件，长度 600–800 字符。两者都应与查询词强相关，避免把页面首段机械截断。',
    contentHead: '摘要的目标是降低读者的决策成本。',
  },
  {
    title: '给搜索结果加时间过滤：after: 与 before: 的实战',
    host: 'news.ycombinator.com',
    site: 'Hacker News',
    path: '/item?id=40000000',
    authority: 2,
    score: 1.24,
    days: 400,
    snippet:
      '很多搜索问题本质上是时间问题，把时间约束写进查询比返回后在客户端过滤更有效。',
    summary:
      '讨论认为搜索引擎的时间过滤会影响候选召回集合，客户端过滤只是对已召回结果做二次筛选，无法补回被截断的近期内容。因此在处理“最新进展”“今年发布”这类意图时，应优先使用 after:/before: 操作符。',
    contentHead: '时间约束应当尽量前移。',
  },
  {
    title: '网页抓取失败排查清单',
    host: 'developer.mozilla.org',
    site: 'MDN Web Docs',
    path: '/en-US/docs/Web/HTTP/Status',
    authority: 3,
    score: 1.12,
    days: 520,
    snippet:
      '抓取返回 404 通常不是网络问题，而是目标站点拒绝、内容类型不受支持或页面没有可提取的正文。',
    summary:
      '排查顺序：确认 URL 可公开访问且为 HTTP/HTTPS；确认未携带用户名密码；确认目标不是 PDF/图片等不受支持的内容类型；确认站点没有开启反爬或登录墙。403 表示被安全策略拒绝，429 表示触发限速，应退避后重试。',
    contentHead: 'HTTP 状态码是排查的第一步。',
  },
  {
    title: 'RAG 系统中的实时检索层该怎么设计',
    host: 'arxiv.org',
    site: 'arXiv',
    path: '/abs/2601.00001',
    authority: 3,
    score: 0.94,
    days: 640,
    snippet:
      '把搜索与抓取拆成两层：搜索负责召回候选，抓取负责按需取正文，可以显著降低单次请求的上下文成本。',
    summary:
      '论文建议将实时检索层设计为「宽召回 + 按需精读」：先用 Search 以较低成本召回一批候选，再对模型真正需要的结果调用 Fetch 获取完整 Markdown 正文。这样既控制了计费次数，也避免了把大量无关正文塞进上下文。',
    contentHead: '实时检索层的成本主要来自不必要的正文读取。',
  },
  {
    title: '搜索结果去重与站点聚合的前端实现',
    host: 'css-tricks.com',
    site: 'CSS-Tricks',
    path: '/snippets/css/complete-guide-grid/',
    authority: 2,
    score: 0.82,
    days: 760,
    snippet:
      '同一站点在同一查询下往往返回多条结果，按 host 聚合可以显著提升列表的可扫读性。',
    summary:
      '实现思路：先按规范化后的 URL 去重（去掉 hash 与 utm 类追踪参数），再按 host 分组，组内保留最高分条目作为代表，其余折叠显示。聚合视图适合需要横向比较多个来源的场景，而列表视图适合按相关性顺序连续阅读。',
    contentHead: '聚合的目标是降低扫读成本。',
  },
  {
    title: '关于搜索语法 site: 的一个常见误解',
    host: 'stackoverflow.com',
    site: 'Stack Overflow',
    path: '/questions/0000000',
    authority: 2,
    score: 0.71,
    days: 900,
    snippet:
      'site: 只能限定站点，不能限定路径；想限定路径要把路径关键词写进搜索词。',
    summary:
      '问答澄清了 site: 的作用范围：它把结果限制在指定站点，多个站点用空格分隔并通过 OR 连接，例如 site:github.com OR site:huggingface.co。它不支持下钻到具体路径，若需要限定目录应配合普通关键词。',
    contentHead: 'site: 的语义是站点，不是目录。',
  },
];

function demoBody(result, query, index) {
  const paragraphs = [
    `# ${result.title}`,
    '',
    `> 演示模式生成的内容，用于在未配置 API Key 时预览完整界面。真实使用时该正文来自 \`POST /v1/tools/fetch\`。`,
    '',
    '## 摘要',
    '',
    result.summary,
    '',
    '## 关键要点',
    '',
    `- 与查询「${query || '演示查询'}」的相关度评分：**${result.score.toFixed(2)}** / 3.00，站点权威性 ${result.authority >= 0 ? result.authority : '未知'}。`,
    `- 来源：${result.site}（\`${result.host}\`），抓取时间 ${new Date().toISOString()}。`,
    '- 搜索接口返回的 `snippet` 面向界面展示，`summary` 面向模型阅读，`content` 仅在 `need_content` 为 `true` 时填充。',
    '',
    '## 正文',
    '',
    result.contentHead,
    '',
    '这一段用于演示 Markdown 渲染：标题层级、引用块、行内代码 `need_content`、加粗、列表与表格都会被正确呈现，同时所有原始 HTML 都会被转义，外链统一加上 `noopener`。',
    '',
    '| 字段 | 类型 | 说明 |',
    '| --- | --- | --- |',
    '| rerank_score | number | 0–3，≥1.5 为优质结果 |',
    `| authority | integer | 当前条目为 ${result.authority} |`,
    '| date | string\\|null | UTC 的 RFC 3339 时间 |',
    '',
    '## 引用',
    '',
    `1. [${result.site}](${result.url})`,
    '2. [DeepSeek 网页搜索与抓取指南](https://api-docs.deepseek.com/zh-cn/guides/search/)',
    '',
    index % 2 === 0 ? '> 提示：按 Esc 关闭阅读面板，Ctrl/⌘ + K 回到搜索框。' : '',
  ];
  return paragraphs.join('\n');
}

async function demoCall(path, body, signal) {
  const delay = 380 + seededInt(String(body?.query || body?.url || 'demo'), 700);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new DeepSeekError('aborted', '请求已取消'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DeepSeekError('aborted', '请求已取消'));
        },
        { once: true },
      );
    }
  });

  if (path === FETCH_PATH) {
    const url = String(body?.url || '');
    const seed = DEMO_SEEDS.find((s) => url.includes(s.host)) || DEMO_SEEDS[0];
    const result = {
      title: seed.title,
      url,
      site: seed.site,
      host: seed.host,
      authority: seed.authority,
      score: seed.score,
      summary: seed.summary,
      contentHead: seed.contentHead,
    };
    return {
      title: seed.title,
      content: demoBody(result, url, seededInt(url, 5)),
    };
  }

  const query = String(body?.query || '');
  const count = Math.min(Number(body?.count) || 10, DEMO_SEEDS.length);
  const needContent = Boolean(body?.need_content);
  const offset = seededInt(query, DEMO_SEEDS.length);
  const rotated = [...DEMO_SEEDS.slice(offset), ...DEMO_SEEDS.slice(0, offset)].slice(0, count);

  return {
    results: rotated.map((seed, index) => {
      const result = {
        ...seed,
        url: `https://${seed.host}${seed.path}`,
        date: daysAgoISO(seed.days),
      };
      return {
        rerank_score: Number(Math.max(0, Math.min(3, seed.score - index * 0.03)).toFixed(2)),
        title: seed.title,
        url: result.url,
        snippet: seed.snippet,
        summary: seed.summary,
        content: needContent ? demoBody(result, query, index) : '',
        site_name: seed.site,
        site_icon: null,
        date: result.date,
        authority: seed.authority,
      };
    }),
  };
}
