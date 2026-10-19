/**
 * 单元测试（零框架依赖，零网络请求）：
 *   npm run test
 *
 * 覆盖：query/url 校验、演示数据、HTTP 状态码 → 中文错误映射、传输回退、
 * 以及 Markdown 渲染与高亮的安全性（不产生可执行 HTML）。
 *
 * 依赖浏览器全局（localStorage / crypto / performance）的部分在这里打桩。
 */
import assert from 'node:assert/strict';

/* ───────── 浏览器环境打桩（必须在 import 业务模块之前） ───────── */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window = globalThis;
globalThis.document = { documentElement: { dataset: {} }, createElement: () => ({ style: {} }) };


/* ───────── IndexedDB 内存打桩（历史/缓存走 IDB） ───────── */
(function stubIndexedDB() {
  const dbs = new Map();
  class MemReq {
    constructor() {
      this.result = undefined;
      this.error = null;
      this.onsuccess = null;
      this.onerror = null;
    }
    _ok(value) {
      this.result = value;
      Promise.resolve().then(() => this.onsuccess?.({ target: this }));
    }
    _fail(err) {
      this.error = err;
      Promise.resolve().then(() => this.onerror?.({ target: this }));
    }
  }
  class MemStore {
    constructor(map) {
      this._map = map;
    }
    get(key) {
      const req = new MemReq();
      req._ok(this._map.has(key) ? this._map.get(key) : undefined);
      return req;
    }
    put(value, key) {
      const req = new MemReq();
      this._map.set(key, value);
      req._ok(key);
      return req;
    }
    delete(key) {
      const req = new MemReq();
      this._map.delete(key);
      req._ok(undefined);
      return req;
    }
    clear() {
      const req = new MemReq();
      this._map.clear();
      req._ok(undefined);
      return req;
    }
  }
  class MemTx {
    constructor(map, mode) {
      this._map = map;
      this.mode = mode;
      this._complete = null;
      this.onerror = null;
      this.onabort = null;
      this._done = false;
      Promise.resolve().then(() => {
        this._done = true;
        this._complete?.();
      });
    }
    get oncomplete() {
      return this._complete;
    }
    set oncomplete(fn) {
      this._complete = fn;
      if (this._done && fn) fn();
    }
    objectStore() {
      return new MemStore(this._map);
    }
  }
  class MemDb {
    constructor(name, storeMap) {
      this.name = name;
      this.objectStoreNames = {
        _names: new Set(storeMap.keys()),
        contains(n) { return this._names.has(n); },
      };
      this._stores = storeMap;
    }
    transaction(storeName) {
      if (!this._stores.has(storeName)) this._stores.set(storeName, new Map());
      return new MemTx(this._stores.get(storeName));
    }
    createObjectStore(name) {
      if (!this._stores.has(name)) this._stores.set(name, new Map());
      this.objectStoreNames._names.add(name);
      return new MemStore(this._stores.get(name));
    }
  }
  globalThis.indexedDB = {
    open(name, version) {
      const req = new MemReq();
      req.onupgradeneeded = null;
      req.onblocked = null;
      Promise.resolve().then(() => {
        let entry = dbs.get(name);
        const isNew = !entry;
        if (!entry) {
          entry = { version: version || 1, stores: new Map() };
          dbs.set(name, entry);
        }
        const db = new MemDb(name, entry.stores);
        req.result = db;
        if (isNew || (version && version > entry.version)) {
          entry.version = version || entry.version;
          req.onupgradeneeded?.({ target: req });
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
})();


const api = await import('../src/lib/api.js');
const util = await import('../src/lib/util.js');
const md = await import('../src/lib/markdown.js');
const results = await import('../src/lib/results.js');

/* ───────── 迷你测试框架 ───────── */
let passed = 0;
const failures = [];
const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}
async function run() {
  for (const c of cases) {
    try {
      await c.fn();
      passed += 1;
      console.log(`  ✓ ${c.name}`);
    } catch (err) {
      failures.push({ name: c.name, err });
      console.log(`  ✗ ${c.name}`);
      console.log(`      ${err.message.split('\n')[0]}`);
    }
  }
  console.log(`\n通过 ${passed} / ${cases.length}`);
  if (failures.length) {
    console.log('\n失败详情：');
    for (const f of failures) console.log(`\n[${f.name}]\n${f.err.stack || f.err.message}`);
    process.exitCode = 1;
  } else {
    console.log('全部通过 ✅');
  }
}

/* ───────── 校验逻辑 ───────── */
test('validateQuery 拒绝空、空白与超长', () => {
  assert.equal(api.validateQuery('').ok, false);
  assert.equal(api.validateQuery('   ').ok, false);
  assert.equal(api.validateQuery('ok').ok, true);
  assert.equal(api.validateQuery('a'.repeat(128)).ok, true);
  assert.equal(api.validateQuery('a'.repeat(129)).ok, false);
});

test('validateQuery 按 Unicode 码点计数（emoji 算 1 个）', () => {
  const emoji = '🌐'.repeat(128);
  assert.equal(util.countChars(emoji), 128);
  assert.equal(api.validateQuery(emoji).ok, true);
  assert.equal(api.validateQuery('🌐'.repeat(129)).ok, false);
});

test('validateUrl 只接受带 host 的 http/https，且拒绝用户名密码', () => {
  assert.equal(api.validateUrl('https://example.com/a').ok, true);
  assert.equal(api.validateUrl('http://example.com').ok, true);
  assert.equal(api.validateUrl('example.com').ok, false);
  assert.equal(api.validateUrl('ftp://example.com').ok, false);
  assert.equal(api.validateUrl('https://user:pw@example.com').ok, false);
  assert.equal(api.validateUrl(`https://example.com/${'a'.repeat(9000)}`).ok, false);
});

test('clampCount 收敛到 1..50，默认 10', () => {
  assert.equal(api.clampCount(0), 1);
  assert.equal(api.clampCount(999), 50);
  assert.equal(api.clampCount('abc'), 10);
  assert.equal(api.clampCount(7.6), 8);
});

/* ───────── 错误码映射（来源：官方指南的错误表） ───────── */
test('HTTP 状态码映射到官方错误语义', () => {
  const expect = {
    400: 'invalid_request',
    401: 'unauthorized',
    402: 'insufficient_balance',
    403: 'forbidden',
    404: 'not_found',
    408: 'timeout',
    413: 'too_large',
    429: 'rate_limited',
    500: 'server_error',
    504: 'gateway_timeout',
  };
  for (const [status, code] of Object.entries(expect)) {
    assert.equal(api.statusToCode(Number(status)), code, `HTTP ${status}`);
  }
});

test('describeError 给出中文标题与提示，并标记是否可重试', () => {
  const err = new api.DeepSeekError('rate_limited', "'count' must be between 1 and 50", { status: 429, retryAfter: 3 });
  const d = api.describeError(err);
  assert.equal(d.title, 'HTTP 429 · 触发限速');
  assert.match(d.hint, /5 QPS/);
  assert.equal(d.retryable, true);
  assert.equal(d.status, 429);
  assert.equal(err.retryAfter, 3);
});

test('401 会引导用户去设置，且不可重试', () => {
  const d = api.describeError(new api.DeepSeekError('unauthorized', 'bad key', { status: 401 }));
  assert.equal(d.action, 'settings');
  assert.equal(d.retryable, false);
});

/* ───────── 请求编排：请求体、鉴权头、传输回退 ───────── */
function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return calls;
}
const jsonResponse = (status, payload) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });

test('searchWeb 构造正确的请求体与 Authorization 头', async () => {
  const calls = stubFetch(() =>
    jsonResponse(200, {
      results: [
        {
          rerank_score: 2.4,
          title: 'T',
          url: 'https://example.com/a',
          snippet: 's',
          summary: 'S',
          content: '',
          site_name: 'Example',
          site_icon: null,
          date: '2026-06-01T00:00:00+00:00',
          authority: 3,
        },
      ],
    }),
  );

  const out = await api.searchWeb({
    query: 'DeepSeek V4',
    count: 5,
    needContent: true,
    oriQuestion: '它什么时候发布的？',
    localization: '1.2.3.4',
    apiKey: 'sk-test-key',
    base: 'https://api.deepseek.com',
    transport: 'proxy',
    proxyAvailable: true,
  });

  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, {
    query: 'DeepSeek V4',
    count: 5,
    need_content: true,
    ori_question: '它什么时候发布的？',
    localization: '1.2.3.4',
  });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test-key');
  assert.equal(calls[0].url, '/__deepseek/api/tools/search');
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].rerankScore, 2.4);
  assert.equal(out.results[0].siteName, 'Example');
  assert.equal(out.transport, 'proxy');
});

test('未提供可选字段时不会带进请求体', async () => {
  const calls = stubFetch(() => jsonResponse(200, { results: [] }));
  await api.searchWeb({ query: 'x', count: 10, apiKey: 'sk-k', transport: 'proxy', proxyAvailable: true });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ['count', 'query']);
});

test('normalizeResult 容忍缺失字段与越界分数', () => {
  const r = api.normalizeResult({ url: 'https://a.com/x', rerank_score: 99, authority: undefined });
  assert.equal(r.rerankScore, 3);
  assert.equal(r.authority, -1);
  assert.equal(r.title, '');
  assert.equal(r.date, null);
  // site_name 缺失时回退到 host，避免界面出现空来源
  assert.equal(r.siteName, 'a.com');
});

test('normalizeResult 保留上游 site_name，无 URL 时为 null', () => {
  const withName = api.normalizeResult({ url: 'https://a.com/x', site_name: '示例站点', site_icon: 'https://a.com/f.ico' });
  assert.equal(withName.siteName, '示例站点');
  assert.equal(withName.siteIcon, 'https://a.com/f.ico');

  const noUrl = api.normalizeResult({ title: '无链接', site_name: '  ' });
  assert.equal(noUrl.siteName, null);
  assert.equal(noUrl.url, '');
});

test('fatch: 400 抛出 invalid_request 且带上游消息', async () => {
  stubFetch(() => jsonResponse(400, { error: { message: "'count' must be between 1 and 50", type: 'invalid_request_error', param: null, code: 'invalid_request_error' } }));
  await assert.rejects(
    () => api.searchWeb({ query: 'x', count: 1, apiKey: 'sk-k', transport: 'proxy', proxyAvailable: true }),
    (err) => {
      assert.equal(err.code, 'invalid_request');
      assert.match(err.message, /between 1 and 50/);
      assert.equal(err.status, 400);
      return true;
    },
  );
});

test('fetchWeb 校验 URL 后返回 title 与 content', async () => {
  const calls = stubFetch(() => jsonResponse(200, { title: 'Example', content: '# Hi\n\nbody' }));
  const out = await api.fetchWeb({
    url: 'https://example.com/article',
    apiKey: 'sk-k',
    transport: 'proxy',
    proxyAvailable: true,
  });
  assert.equal(out.title, 'Example');
  assert.equal(out.content, '# Hi\n\nbody');
  assert.equal(out.chars, util.countChars('# Hi\n\nbody'));
  assert.equal(calls[0].url, '/__deepseek/api/tools/fetch');
  assert.deepEqual(JSON.parse(calls[0].init.body), { url: 'https://example.com/article' });
});

test('直连模式使用完整基址', async () => {
  const calls = stubFetch(() => jsonResponse(200, { results: [] }));
  await api.searchWeb({ query: 'x', apiKey: 'sk-k', base: 'https://api.deepseek.com/', transport: 'direct' });
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/tools/search');
});

test('代理失败时自动回退到直连', async () => {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(url);
    if (url.startsWith('/__deepseek')) throw new TypeError('Failed to fetch');
    return jsonResponse(200, { results: [] });
  };
  const out = await api.searchWeb({
    query: 'x',
    apiKey: 'sk-k',
    base: 'https://api.deepseek.com',
    transport: 'auto',
    proxyAvailable: true,
  });
  assert.equal(seen.length, 2);
  assert.equal(out.transport, 'direct');
});

test('传输链路只按配置生效（proxy 不越界回退）', async () => {
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(url);
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(() =>
    api.searchWeb({ query: 'x', apiKey: 'sk-k', transport: 'proxy', proxyAvailable: false }),
  );
  assert.equal(seen.length, 1);
});

test('网络错误提示跨域，并说明如何恢复', async () => {
  stubFetch(() => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(
    () => api.searchWeb({ query: 'x', apiKey: 'sk-k', transport: 'direct' }),
    (err) => {
      assert.equal(err.code, 'cors');
      assert.match(api.describeError(err).hint, /npm run dev|CORS|跨域|Pages|演示模式/);
      return true;
    },
  );
});

test('corsHintForHost 按 hostname 分流 Pages 与本地', () => {
  assert.match(api.corsHintForHost('shalom-lab.github.io'), /CORS|演示模式|npm run dev|Worker|反代/);
  assert.equal(api.isGitHubPagesHost('shalom-lab.github.io'), true);
  assert.equal(api.isGitHubPagesHost('localhost'), false);
  assert.match(api.corsHintForHost('localhost'), /npm run dev|同源转发/);
  assert.match(api.corsHintForHost('127.0.0.1'), /npm run dev|同源转发/);
});

const retryResponse = (status, payload, retryAfter = '0') =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
  });

test('429 带 Retry-After 时自动退避并重试 1 次后成功', async () => {
  let n = 0;
  const calls = stubFetch(() => {
    n += 1;
    if (n === 1) return retryResponse(429, { error: { message: 'rate limited' } }, '0');
    return jsonResponse(200, { results: [] });
  });
  const out = await api.searchWeb({ query: 'x', apiKey: 'sk-k', transport: 'proxy', proxyAvailable: true });
  assert.equal(calls.length, 2);
  assert.equal(out.results.length, 0);
  assert.equal(out.transport, 'proxy');
});

test('429 重试仍失败则抛出 rate_limited（共 2 次请求）', async () => {
  const calls = stubFetch(() => retryResponse(429, { error: { message: 'still limited' } }, '0'));
  await assert.rejects(
    () => api.searchWeb({ query: 'x', apiKey: 'sk-k', transport: 'proxy', proxyAvailable: true }),
    (err) => {
      assert.equal(err.code, 'rate_limited');
      assert.equal(err.status, 429);
      assert.equal(err.retryAfter, 0);
      return true;
    },
  );
  assert.equal(calls.length, 2);
});

test('5xx 自动重试 1 次；400 不自动重试', async () => {
  let n = 0;
  const calls5 = stubFetch(() => {
    n += 1;
    if (n === 1) return retryResponse(503, { error: { message: 'unavailable' } }, '0');
    return jsonResponse(200, { results: [{ title: 'ok', url: 'https://a.com', snippet: 's', summary: 'S', content: '', site_name: 'A', date: null, authority: 1, rerank_score: 1 }] });
  });
  const out = await api.searchWeb({ query: 'x', apiKey: 'sk-k', transport: 'proxy', proxyAvailable: true });
  assert.equal(calls5.length, 2);
  assert.equal(out.results.length, 1);

  const calls400 = stubFetch(() => jsonResponse(400, { error: { message: 'bad' } }));
  await assert.rejects(
    () => api.searchWeb({ query: 'x', apiKey: 'sk-k', transport: 'proxy', proxyAvailable: true }),
    (err) => err.code === 'invalid_request',
  );
  assert.equal(calls400.length, 1);
});

test('退避等待期间 AbortSignal 可取消自动重试', async () => {
  const controller = new AbortController();
  stubFetch(() => retryResponse(429, { error: { message: 'rate limited' } }, '30'));
  const pending = api.searchWeb({
    query: 'x',
    apiKey: 'sk-k',
    transport: 'proxy',
    proxyAvailable: true,
    signal: controller.signal,
  });
  await new Promise((r) => setTimeout(r, 30));
  controller.abort();
  await assert.rejects(pending, (err) => err.code === 'aborted');
});

test('stripResultContent / normalizeUsage：快照清 content、有结果才计费', async () => {
  const idb = await import('../src/lib/idb.js');
  const store = await import('../src/lib/store.js');
  const stripped = idb.stripResultContent([{ title: 'a', content: 'HUGE' }, null]);
  assert.equal(stripped[0].content, '');
  assert.equal(stripped[0].title, 'a');
  const usage = store.normalizeUsage({ searchCalls: 5, searchErrors: 1, fetchCalls: 3, fetchErrors: 0 });
  assert.equal(usage.searchBillable, 4);
  assert.equal(usage.fetchBillable, 3);
  const fresh = store.normalizeUsage({ searchCalls: 2, searchErrors: 0, searchBillable: 1, fetchCalls: 1, fetchErrors: 0, fetchBillable: 0 });
  assert.equal(fresh.searchBillable, 1);
  assert.equal(fresh.fetchBillable, 0);
});

test('缺少 API Key 时直接报 unauthorized，不发请求', async () => {
  const calls = stubFetch(() => jsonResponse(200, { results: [] }));
  await assert.rejects(
    () => api.searchWeb({ query: 'x', apiKey: '   ', transport: 'direct' }),
    (err) => err.code === 'unauthorized' && true,
  );
  assert.equal(calls.length, 0);
});

test('演示模式不发起任何网络请求，且返回结构化结果', async () => {
  const calls = stubFetch(() => jsonResponse(200, { results: [] }));
  const out = await api.searchWeb({ query: 'DeepSeek V4', count: 6, needContent: true, demo: true });
  assert.equal(calls.length, 0);
  assert.equal(out.results.length, 6);
  assert.equal(out.demo, true);
  assert.equal(out.transport, 'demo');
  for (const r of out.results) {
    assert.ok(r.title.length > 0);
    assert.ok(r.url.startsWith('http'));
    assert.ok(r.rerankScore >= 0 && r.rerankScore <= 3);
    assert.ok(r.authority >= -1 && r.authority <= 4);
    assert.ok(r.content.length > 0, 'need_content=true 时应带正文');
    assert.equal(r.date.includes('T'), true);
  }
});

test('演示模式 fetch 返回 Markdown 正文', async () => {
  stubFetch(() => jsonResponse(200, {}));
  const out = await api.fetchWeb({ url: 'https://api-docs.deepseek.com/zh-cn/guides/search/', demo: true });
  assert.ok(out.content.includes('#'));
  assert.ok(out.content.length > 200);
});

/* ───────── 结果处理 ───────── */
test('过滤与排序符合预期', () => {
  const list = [
    api.normalizeResult({ url: 'https://a.com/1', rerank_score: 0.4, authority: 1, date: '2026-01-01T00:00:00Z' }),
    api.normalizeResult({ url: 'https://b.com/1', rerank_score: 2.6, authority: 4, date: '2024-01-01T00:00:00Z' }),
    api.normalizeResult({ url: 'https://c.com/1', rerank_score: 1.7, authority: 3, date: '2025-06-01T00:00:00Z' }),
  ];
  assert.equal(results.filterResults(list, '1.5').length, 2);
  assert.equal(results.filterResults(list, 'auth3').length, 2);
  assert.equal(results.filterResults(list, '2').length, 1);
  assert.equal(results.sortResults(list, 'score')[0].rerankScore, 2.6);
  assert.equal(results.sortResults(list, 'fresh')[0].url, 'https://a.com/1');
  assert.equal(results.sortResults(list, 'authority')[0].authority, 4);
});

test('去重会忽略 hash 与 utm 参数', () => {
  const list = [
    api.normalizeResult({ url: 'https://a.com/x', rerank_score: 1 }),
    api.normalizeResult({ url: 'https://a.com/x#top', rerank_score: 2 }),
    api.normalizeResult({ url: 'https://a.com/x?utm_source=weibo', rerank_score: 3 }),
    api.normalizeResult({ url: 'https://a.com/y', rerank_score: 1 }),
  ];
  assert.equal(results.dedupeResults(list).length, 2);
  assert.equal(results.summarize(list).total, 4);
});

test('导出 Markdown / JSON / CSV 结构完整', () => {
  const list = [api.normalizeResult({ url: 'https://a.com/x', title: '标题', rerank_score: 2.2, authority: 3, snippet: 's', summary: 'S', date: '2026-01-01T00:00:00Z' })];
  const meta = { query: '测试', count: 1, needContent: false, usedOri: true, latencyMs: 800 };
  const m = results.toMarkdown(list, meta);
  assert.match(m, /# 搜索结果：测试/);
  assert.match(m, /## 1\. 标题/);
  assert.match(m, /2\.20 \/ 3\.00/);
  const j = JSON.parse(results.toJSONExport(list, meta));
  assert.equal(j.results[0].site_name, 'a.com');
  assert.equal(j.results[0].rerank_score, 2.2);
  const csv = results.toCSV(list);
  assert.equal(csv.split('\r\n').length, 2);
  assert.match(csv, /"标题"/);
});

/* ───────── 高亮与 Markdown 安全 ───────── */
test('高亮只包裹查询词，并转义 HTML', () => {
  const out = md.highlightText('<script>x</script> DeepSeek 发布', 'DeepSeek');
  assert.ok(out.includes('<mark class="hl">DeepSeek</mark>'));
  assert.equal(out.includes('<script>'), false);
  assert.ok(out.includes('&lt;script&gt;'));
});

test('高亮支持 "精确短语"，并忽略 site:/lang: 等操作符', () => {
  const terms = md.extractTerms('DeepSeek "工具调用" site:github.com lang:zh -排除');
  assert.ok(terms.includes('工具调用'));
  assert.ok(terms.includes('DeepSeek'));
  assert.equal(terms.some((t) => t.includes('site:') || t.includes('lang:')), false);
  assert.equal(terms.includes('-排除'), false);
});

test('renderMarkdown 转义内联 HTML 与脚本', () => {
  const html = md.renderMarkdown('# 标题\n\n<script>alert(1)</script>\n\n普通段落');
  assert.equal(/<script/i.test(html), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(/<h1/i.test(html));
});

test('renderMarkdown 剥离 javascript: 链接', () => {
  const html = md.renderMarkdown('[点我](javascript:alert(1))');
  assert.equal(/href\s*=\s*"javascript:/i.test(html), false);
  assert.ok(html.includes('md-link-dead'));
});

test('renderMarkdown 渲染表格与代码块', () => {
  const html = md.renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```');
  assert.ok(html.includes('md-table'));
  assert.ok(html.includes('md-pre'));
  assert.ok(html.includes('const x = 1;'));
});

/* ───────── 工具函数 ───────── */
test('工具函数：日期、站点、评分档位', () => {
  assert.equal(util.formatDateOnly('2026-06-01T00:00:00+00:00'), '2026-06-01');
  assert.equal(util.formatDateOnly(null), null);
  assert.equal(util.hostOf('https://www.example.com/a/b'), 'example.com');
  assert.equal(util.hostOf('not a url'), 'not a url');
  assert.equal(util.scoreTier(2.6).key, 'top');
  assert.equal(util.scoreTier(1.6).key, 'good');
  assert.equal(util.scoreTier(0.2).key, 'low');
  assert.equal(util.authorityInfo(3).label, '极高');
  assert.equal(util.authorityInfo(-1).label, '未知');
  assert.equal(util.authorityInfo(99).label, '未知');
});

test('estetic: estimateTokens 对中文估算高于等长英文', () => {
  assert.ok(util.estimateTokens('中文中文中文中文') > util.estimateTokens('abcd'));
});

await run();
