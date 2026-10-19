/**
 * 渲染冒烟测试：用 react-dom/server 把整棵组件树渲染成 HTML，不发请求、不需要浏览器。
 *
 * 目的：捕获 esbuild 语法检查抓不到的那类运行时错误——例如 useMemo 依赖数组里
 * 引用了未定义的标识符（ReferenceError）、Provider 漏挂、路由不匹配等。
 *
 * 覆盖：四个路由、三种密钥/演示状态、结果卡片渲染。
 */
import './dom-stubs.mjs';

import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App.jsx';
import ErrorBoundary from '../src/components/ErrorBoundary.jsx';
import ResultCard from '../src/components/ResultCard.jsx';
import { store } from './dom-stubs.mjs';
import { AppProvider, LEGACY_SETTINGS_KEY, STORAGE_KEYS } from '../src/lib/store.js';
import { UIProvider } from '../src/components/UIProvider.jsx';
import { AppStateProvider } from '../src/hooks/useAppState.jsx';
import { normalizeResult } from '../src/lib/api.js';

const h = React.createElement;

// recharts 的 ResponsiveContainer 在服务端渲染时会告警 useLayoutEffect 不可用，
// 这属于 SSR 的预期行为（应用本身是纯客户端），过滤掉以免淹没真实报错。
const rawError = console.error;
console.error = (...args) => {
  const first = typeof args[0] === 'string' ? args[0] : '';
  if (first.includes('useLayoutEffect does nothing on the server')) return;
  rawError.apply(console, args);
};

/* ───────── 迷你测试框架 ───────── */
let passed = 0;
const failures = [];
const cases = [];
const test = (name, fn) => cases.push({ name, fn });

async function run() {
  for (const c of cases) {
    try {
      await c.fn();
      passed += 1;
      console.log(`  ✓ ${c.name}`);
    } catch (err) {
      failures.push({ name: c.name, err });
      console.log(`  ✗ ${c.name}`);
      console.log(`      ${String(err.message).split('\n')[0]}`);
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

function resetStorage(entries = {}) {
  store.clear();
  for (const [k, v] of Object.entries(entries)) store.set(k, v);
}

function renderApp(route = '/') {
  return renderToString(
    h(
      AppProvider,
      null,
      h(
        UIProvider,
        null,
        h(
          AppStateProvider,
          null,
          h(MemoryRouter, { initialEntries: [route] }, h(App, null)),
        ),
      ),
    ),
  );
}

/* ───────── 用例 ───────── */

test('无密钥：初始渲染成功，并提示配置 API Key', () => {
  resetStorage();
  const html = renderApp('/');
  if (!html.includes('DeepSearch')) throw new Error('未渲染出品牌名');
  if (!html.includes('尚未配置 API Key')) throw new Error('缺少未配置密钥的提示横幅');
  if (!html.includes('开始一次网页搜索')) throw new Error('缺少搜索空状态');
});

test('启动即从 localStorage 读取密钥（BYOK bootstrap）', () => {
  resetStorage({ [STORAGE_KEYS.key]: 'sk-abcdefghijklmnopqrstuvwxyz012345' });
  const html = renderApp('/');
  if (html.includes('尚未配置 API Key')) throw new Error('已存密钥却仍显示未配置');
  if (!html.includes('密钥已就绪')) throw new Error('状态栏未显示密钥已就绪');
  // 只展示掩码，不能回显完整密钥
  if (html.includes('sk-abcdefghijklmnopqrstuvwxyz012345')) throw new Error('渲染结果泄露了完整密钥');
  if (!html.includes('sk-••••')) throw new Error('未展示掩码后的密钥提示');
});

test('演示模式：状态栏与开关正确渲染', () => {
  resetStorage({ [LEGACY_SETTINGS_KEY]: JSON.stringify({ demo: true }) });
  const html = renderApp('/');
  if (!html.includes('演示模式')) throw new Error('未渲染演示模式标记');
  // 用横幅里的特征句判断，避免误命中侧栏 title 等属性
  if (html.includes('本应用采用 BYOK')) throw new Error('演示模式下仍显示要求配置密钥的横幅');
});

test('四个路由都能完整渲染', () => {
  resetStorage({ [STORAGE_KEYS.key]: 'sk-test-000000000000000000' });
  const routes = [
    ['/', '开始一次网页搜索'],
    ['/fetch', '抓取一个网页'],
    ['/history', '调用统计'],
    ['/settings', '密钥'],
  ];
  for (const [route, marker] of routes) {
    const html = renderApp(route);
    if (!html.includes(marker)) throw new Error(`${route} 未渲染出「${marker}」`);
  }
});

test('未知路由不会导致渲染失败', () => {
  resetStorage();
  // 注意：<Navigate> 的跳转发生在 effect 里，renderToString 不执行 effect，
  // 因此这里只断言「不抛错」，回退行为由浏览器端负责。
  const html = renderApp('/no-such-page');
  if (!html.includes('DeepSearch')) throw new Error('未知路由渲染异常');
});

test('设置页展示存储键名与安全说明', () => {
  resetStorage();
  const html = renderApp('/settings');
  if (!html.includes(STORAGE_KEYS.key)) throw new Error('设置页未说明存储键名');
  if (!html.includes('localStorage')) throw new Error('设置页未说明存储位置');
});

test('结果卡片渲染标题、分数、权威度与操作按钮', () => {
  resetStorage();
  const result = normalizeResult({
    title: 'DeepSeek 发布 V4 模型',
    url: 'https://api-docs.deepseek.com/zh-cn/news/news261017',
    snippet: '重点改进工具调用与长上下文能力。',
    summary: '这是一段较长的摘要，用于给模型阅读。'.repeat(6),
    content: '',
    site_name: 'DeepSeek API Docs',
    date: '2026-06-01T00:00:00+00:00',
    rerank_score: 2.4,
    authority: 3,
  });

  const html = renderToString(
    h(
      AppProvider,
      null,
      h(
        UIProvider,
        null,
        h(
          AppStateProvider,
          null,
          h(
            MemoryRouter,
            null,
            h(ResultCard, { result, index: 0, cursor: false, query: 'DeepSeek' }),
          ),
        ),
      ),
    ),
  );

  // 标题会被关键词高亮切成多段，因此断言未被切开的片段
  if (!html.includes('V4 模型')) throw new Error('未渲染标题');
  if (!html.includes('DeepSeek')) throw new Error('未渲染标题关键词');
  if (!html.includes('2.40')) throw new Error('未渲染排序分');
  if (!html.includes('2026-06-01')) throw new Error('未渲染发布日期');
  if (!html.includes('DeepSeek API Docs')) throw new Error('未渲染站点名');
  if (!html.includes('抓取正文')) throw new Error('未渲染抓取按钮');
  if (!html.includes('优质')) throw new Error('未渲染评分档位');
});

test('历史页在有历史数据时能渲染条目', () => {
  resetStorage({
    [STORAGE_KEYS.key]: 'sk-test-000000000000000000',
    [STORAGE_KEYS.history]: JSON.stringify([
      {
        id: 'h1',
        at: new Date().toISOString(),
        query: 'DeepSeek V4',
        count: 5,
        latencyMs: 820,
        needContent: false,
        results: [
          {
            id: 'r1',
            rerankScore: 2.4,
            title: 'DeepSeek V4 发布',
            url: 'https://example.com/a',
            snippet: 's',
            summary: 'S',
            content: '',
            siteName: 'Example',
            siteIcon: null,
            date: '2026-06-01T00:00:00+00:00',
            authority: 3,
          },
        ],
      },
    ]),
  });
  const html = renderApp('/history');
  if (!html.includes('DeepSeek V4')) throw new Error('未渲染历史查询词');
  if (!html.includes('重新搜索')) throw new Error('未渲染重新搜索按钮');
});

test('有缓存结果时，搜索页渲染完整结果列表', () => {
  const cached = {
    query: 'DeepSeek V4',
    results: [
      normalizeResult({
        title: 'DeepSeek V4 正式发布',
        url: 'https://api-docs.deepseek.com/zh-cn/news/news261017',
        snippet: '支持工具调用与长上下文。',
        summary: '长摘要若干。',
        site_name: 'DeepSeek API Docs',
        date: '2026-06-01T00:00:00+00:00',
        rerank_score: 2.8,
        authority: 4,
      }),
      normalizeResult({
        title: '一个较弱的结果',
        url: 'https://example.com/weak',
        snippet: '相关度较低。',
        rerank_score: 0.6,
        authority: 1,
      }),
    ],
    meta: { latencyMs: 640, transport: 'proxy', count: 2, needContent: false },
  };
  resetStorage({ [STORAGE_KEYS.key]: 'sk-test-000000000000000000', 'deepseek-deepsearch-cache': JSON.stringify(cached) });
  const html = renderApp('/');

  // 标题中的 “DeepSeek V4” 会被高亮切成多段 <mark>，因此断言未被切开的片段
  if (!html.includes('正式发布')) throw new Error('未渲染缓存中的结果');
  if (!html.includes('<mark')) throw new Error('未渲染关键词高亮');
  if (!html.includes('2.80')) throw new Error('未渲染排序分');
  if (!html.includes('抓取正文')) throw new Error('未渲染结果操作');
  if (!html.includes('综合排序')) throw new Error('未渲染排序下拉');
  if (!html.includes('导出')) throw new Error('未渲染导出入口');
  if (html.includes('开始一次网页搜索')) throw new Error('有结果时不应再显示空状态');
});

test('ErrorBoundary：正常时透传子元素，出错时给出兜底状态', () => {
  resetStorage();
  const html = renderToString(h(ErrorBoundary, null, h('div', { id: 'kid' }, '子内容')));
  if (!html.includes('子内容')) throw new Error('未透传 children');

  // react-dom/server 不支持错误边界捕获，这里直接验证兜底状态的计算
  const state = ErrorBoundary.getDerivedStateFromError(new Error('boom'));
  if (!(state.error instanceof Error) || state.error.message !== 'boom') {
    throw new Error('getDerivedStateFromError 未返回 error 状态');
  }
});

// 不能用顶层 await：这个套件以 CJS 打包（这样 react-dom/server 与 recharts 的
// require('stream') / require('react') 才能被 Node 原生解析）。
run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
