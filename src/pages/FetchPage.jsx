/** 网页抓取页：输入 URL → POST /v1/tools/fetch → Markdown 阅读器。 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, EmptyState, ErrorCard, MarkdownView, CopyButton } from '../components/common.jsx';
import {
  IconAlert, IconDownload, IconExternal, IconGlobe, IconKey, IconLayers, IconLink, IconRefresh, IconSpark,
} from '../components/Icon.jsx';
import { useApp } from '../lib/store.js';
import { useDrawer } from '../hooks/useAppState.jsx';
import { downloadText, useUI } from '../components/UIProvider.jsx';
import { DeepSeekError, describeError, fetchWeb, validateUrl } from '../lib/api.js';
import { writeJSON, readJSON } from '../lib/store.js';
import { cx, estimateTokens, formatBytes, formatDuration, hostOf } from '../lib/util.js';

const RECENT_KEY = 'deepseek-deepsearch-fetches';

function loadRecent() {
  const list = readJSON(RECENT_KEY, []);
  return Array.isArray(list) ? list.slice(0, 20) : [];
}

export default function FetchPage() {
  const app = useApp();
  const drawer = useDrawer();
  const navigate = useNavigate();
  const { toast } = useUI();
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const [url, setUrl] = useState('');
  const [state, setState] = useState({ loading: false, error: null, data: null, elapsedMs: 0, startedAt: 0 });
  const [view, setView] = useState('rendered');
  const [recent, setRecent] = useState(loadRecent);

  useEffect(() => {
    if (state.loading) {
      const t = setInterval(() => setState((s) => (s.loading ? { ...s, elapsedMs: Date.now() - s.startedAt } : s)), 100);
      return () => clearInterval(t);
    }
    return undefined;
  }, [state.loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const validation = url ? validateUrl(url) : { ok: true };

  const doFetch = async (target = url) => {
    const value = String(target || '').trim();
    const check = validateUrl(value);
    if (!check.ok) {
      toast({ tone: 'warn', title: '网址不合法', text: check.message });
      return;
    }
    if (!app.hasKey && !app.settings.demo) {
      toast({
        tone: 'warn',
        title: '还没配置 API Key',
        text: '抓取接口同样需要 BYOK 密钥。',
        actions: [
          { label: '去设置', primary: true, onClick: () => navigate('/settings') },
          { label: '开启演示模式', onClick: () => app.updateSettings({ demo: true }) },
        ],
      });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Date.now();
    setState({ loading: true, error: null, data: null, elapsedMs: 0, startedAt });

    try {
      const data = await fetchWeb({
        url: value,
        apiKey: app.apiKey,
        base: app.base,
        transport: app.settings.transport,
        proxyAvailable: app.proxy.ok,
        demo: app.settings.demo,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setState({ loading: false, error: null, data, elapsedMs: data.latencyMs, startedAt });
      app.recordUsage({ kind: 'fetch', ok: true, chars: data.chars, latencyMs: data.latencyMs });
      setView('rendered');

      const entry = { url: value, title: data.title, at: new Date().toISOString(), chars: data.chars };
      const next = [entry, ...recent.filter((r) => r.url !== value)].slice(0, 20);
      setRecent(next);
      writeJSON(RECENT_KEY, next);

      toast({
        tone: 'ok',
        title: '抓取完成',
        text: `${data.chars.toLocaleString('zh-CN')} 字符 · 用时 ${formatDuration(data.latencyMs)}`,
      });
    } catch (err) {
      if (err?.code === 'aborted' || controller.signal.aborted) return;
      const described = err instanceof DeepSeekError ? describeError(err) : describeError(err);
      setState({ loading: false, error: described, data: null, elapsedMs: Date.now() - startedAt, startedAt });
      app.recordUsage({ kind: 'fetch', ok: false, latencyMs: Date.now() - startedAt });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const data = state.data;
  const filename = useMemo(
    () => `${(data?.title || hostOf(url) || 'page').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.md`,
    [data, url],
  );

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>网页抓取</h2>
          <p>
            输入任意 HTTP/HTTPS 网址，调用 <code>POST /v1/tools/fetch</code> 返回页面标题与 Markdown 正文。
            URL 长度不超过 8192，必须包含 host，且不能携带用户名或密码。
          </p>
        </div>
        <form
          className="fetchbar"
          onSubmit={(e) => {
            e.preventDefault();
            doFetch();
          }}
        >
          <div className="input-wrap">
            <IconLink size={17} />
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              spellCheck="false"
              aria-label="要抓取的网址"
            />
          </div>
          <button type="submit" className="btn primary" disabled={state.loading}>
            {state.loading ? '抓取中…' : '抓取'}
          </button>
          {state.data ? (
            <button type="button" className="btn ghost" onClick={() => doFetch()} title="重新抓取">
              <IconRefresh size={15} />
            </button>
          ) : null}
        </form>
        {url && !validation.ok ? (
          <p className="hint" style={{ marginTop: 8, color: 'var(--warn)' }}>
            <IconAlert size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {validation.message}
          </p>
        ) : null}

        {recent.length ? (
          <div style={{ marginTop: 14, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="preset-label">最近抓取：</span>
            {recent.slice(0, 6).map((r) => (
              <button
                key={r.url}
                type="button"
                className="preset"
                title={`${r.title || r.url}\n${r.at}`}
                onClick={() => {
                  setUrl(r.url);
                  doFetch(r.url);
                }}
              >
                {hostOf(r.url)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!app.hasKey && !app.settings.demo ? (
        <Banner
          icon={IconKey}
          actions={
            <>
              <button type="button" className="mini-btn accent" onClick={() => navigate('/settings')}>
                填写 API Key
              </button>
              <button type="button" className="mini-btn" onClick={() => app.updateSettings({ demo: true })}>
                演示模式
              </button>
            </>
          }
        >
          <strong>尚未配置 API Key。</strong> 抓取与搜索共用同一个 BYOK 密钥。
        </Banner>
      ) : null}

      <div className="fetch-result">
        {state.loading ? (
          <div className="panel">
            <div className="sk-line tall w40" />
            <div className="sk-line w100" style={{ marginTop: 14 }} />
            <div className="sk-line w85" />
            <div className="sk-line w100" />
            <div className="sk-line w60" />
            <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
              正在抓取 {hostOf(url)} …（已用时 {formatDuration(state.elapsedMs)}）
            </p>
          </div>
        ) : state.error ? (
          <ErrorCard
            error={state.error}
            onRetry={() => doFetch()}
            onOpenSettings={() => navigate('/settings')}
            onDismiss={() => setState((s) => ({ ...s, error: null }))}
            retryLabel="重新抓取"
          />
        ) : data ? (
          <div className="panel">
            <div className="reader-head">
              <div style={{ minWidth: 0 }}>
                <h2>{data.title || '(无标题)'}</h2>
                <a className="rurl" href={data.url} target="_blank" rel="noopener noreferrer">
                  {data.url}
                </a>
              </div>
              <div className="btn-group">
                <button type="button" className="btn ghost" onClick={() => doFetch()} title="重新抓取">
                  <IconRefresh size={15} /> 重抓
                </button>
                <CopyButton
                  text={data.content}
                  label="复制正文"
                  className="btn ghost"
                  onDone={(ok) => toast({ tone: ok ? 'ok' : 'err', title: ok ? '已复制正文' : '复制失败' })}
                />
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    if (downloadText(filename, data.content, 'text/markdown;charset=utf-8')) {
                      toast({ tone: 'ok', title: '已下载', text: filename });
                    }
                  }}
                >
                  <IconDownload size={15} /> 下载
                </button>
                <a className="btn ghost" href={data.url} target="_blank" rel="noopener noreferrer">
                  <IconExternal size={15} /> 原文
                </a>
                <button
                  type="button"
                  className="btn ghost"
                  title="在右侧面板中阅读"
                  onClick={() =>
                    drawer.openDrawer(
                      { kind: 'fetch', url: data.url, title: data.title, content: data.content },
                      'content',
                    )
                  }
                >
                  <IconGlobe size={15} />
                </button>
              </div>
            </div>

            <div className="reader-stats">
              <span className="tag accent">
                <IconLayers size={12} /> {data.chars.toLocaleString('zh-CN')} 字符
              </span>
              <span className="tag">
                <IconSpark size={12} /> ≈{estimateTokens(data.content).toLocaleString('zh-CN')} tokens
              </span>
              <span className="tag">{formatBytes(new Blob([data.content]).size)}</span>
              <span className="tag">用时 {formatDuration(data.latencyMs)}</span>
              <span className="tag">
                传输 {data.transport === 'demo' ? '演示数据' : data.transport === 'proxy' ? '本地转发' : '直连'}
              </span>
              <div className="drawer-seg" style={{ marginLeft: 'auto' }}>
                <button type="button" className={cx(view === 'rendered' && 'on')} onClick={() => setView('rendered')}>
                  渲染
                </button>
                <button type="button" className={cx(view === 'raw' && 'on')} onClick={() => setView('raw')}>
                  原始 Markdown
                </button>
              </div>
            </div>

            {view === 'rendered' ? (
              data.content ? (
                <MarkdownView text={data.content} />
              ) : (
                <p className="muted">接口返回了空正文。</p>
              )
            ) : (
              <pre className="plain-body" style={{ margin: 0, maxHeight: 620, overflow: 'auto' }}>
                {data.content || '（空）'}
              </pre>
            )}
          </div>
        ) : (
          <EmptyState
            icon={IconGlobe}
            title="抓取一个网页"
            cards={[
              { title: 'DeepSeek 文档', desc: 'https://api-docs.deepseek.com/zh-cn/guides/search/', onClick: () => { setUrl('https://api-docs.deepseek.com/zh-cn/guides/search/'); doFetch('https://api-docs.deepseek.com/zh-cn/guides/search/'); } },
              { title: 'MDN HTTP 状态码', desc: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status', onClick: () => { const u = 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status'; setUrl(u); doFetch(u); } },
              { title: 'example.com', desc: 'https://example.com', onClick: () => { setUrl('https://example.com'); doFetch('https://example.com'); } },
            ]}
          >
            <p>
              抓取结果受目标站点可用性与访问策略影响：403 表示被安全策略拒绝，404 表示未取得可用正文，
              429 表示触发限速（Fetch 对单域名同样有 QPS 限制）。
            </p>
          </EmptyState>
        )}
      </div>
    </>
  );
}
