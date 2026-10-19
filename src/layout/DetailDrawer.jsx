/** 详情抽屉：结果详情 / 抓取阅读。 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CopyButton, MarkdownView, ScoreBadge, SiteFavicon, AuthorityBadge } from '../components/common.jsx';
import {
  IconAlert, IconClose, IconDownload, IconExternal, IconGlobe, IconInfo, IconLayers, IconRefresh, IconSpark,
} from '../components/Icon.jsx';
import { useDrawer } from '../hooks/useAppState.jsx';
import { useApp } from '../lib/store.js';
import { DeepSeekError, describeError, fetchWeb } from '../lib/api.js';
import { useUI, downloadText } from '../components/UIProvider.jsx';
import { cx, estimateTokens, formatBytes, formatDateOnly, formatDuration, hostOf, scoreTier } from '../lib/util.js';

function toMarkdown(item) {
  if (item.kind === 'fetch') {
    return [`# ${item.title || item.url}`, '', `> 来源：${item.url}`, '', item.content || ''].join('\n');
  }
  const r = item.result || {};
  return [
    `# ${r.title || '(无标题)'}`,
    '',
    `- 链接：${r.url}`,
    `- 站点：${r.siteName || hostOf(r.url)}`,
    `- 排序分数：${Number(r.rerankScore).toFixed(2)} / 3.00`,
    `- 权威性：${r.authority}（0–4，-1 未知）`,
    `- 发布时间：${formatDateOnly(r.date) || '未知'}`,
    '',
    '## 短摘要',
    '',
    r.snippet || '（无）',
    '',
    '## 长摘要',
    '',
    r.summary || '（无）',
    r.content ? ['', '## 网页正文', '', r.content].join('\n') : '',
  ].join('\n');
}

export default function DetailDrawer() {
  const drawer = useDrawer();
  const app = useApp();
  const { toast } = useUI();
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [localContent, setLocalContent] = useState(null);
  const [fetchElapsed, setFetchElapsed] = useState(0);
  const bodyRef = useRef(null);
  const abortRef = useRef(null);

  const { open, item, view } = drawer;

  // 抓取中的计时器
  useEffect(() => {
    if (!fetching) return undefined;
    const started = Date.now();
    setFetchElapsed(0);
    const t = setInterval(() => setFetchElapsed(Date.now() - started), 100);
    return () => clearInterval(t);
  }, [fetching]);

  // 切换条目时重置本地抓取状态
  useEffect(() => {
    setLocalContent(null);
    setFetchError(null);
    setFetching(false);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [item?.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        drawer.closeDrawer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, drawer]);

  const result = item?.result || null;
  const content = localContent ?? result?.content ?? (item?.kind === 'fetch' ? item.content : '');
  const title = item?.kind === 'fetch' ? item.title || item.url : result?.title || '';
  const url = item?.kind === 'fetch' ? item.url : result?.url || '';
  const tier = result ? scoreTier(result.rerankScore) : null;
  const meta = useMemo(() => {
    if (item?.kind === 'fetch') {
      return [
        { label: `${(item.content || '').length.toLocaleString('zh-CN')} 字符`, icon: IconLayers },
        { label: formatBytes(new Blob([item.content || '']).size), icon: IconInfo },
        { label: `≈${estimateTokens(item.content || '').toLocaleString('zh-CN')} tokens`, icon: IconSpark },
      ];
    }
    return [];
  }, [item]);

  const doFetch = async () => {
    if (!url || fetching) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFetching(true);
    setFetchError(null);
    const startedAt = Date.now();
    try {
      const data = await fetchWeb({
        url,
        apiKey: app.apiKey,
        base: app.base,
        proxyAvailable: app.proxy.ok,
        demo: app.settings.demo,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setLocalContent(data.content);
      drawer.setView('content');
      app.recordUsage({ kind: 'fetch', ok: true, chars: data.chars, latencyMs: data.latencyMs });
      toast({
        tone: 'ok',
        title: '正文抓取完成',
        text: `${data.chars.toLocaleString('zh-CN')} 字符 · 用时 ${formatDuration(data.latencyMs)}`,
      });
    } catch (err) {
      if (err?.code === 'aborted' || controller.signal.aborted) return;
      const described = err instanceof DeepSeekError ? describeError(err) : describeError(err);
      setFetchError(described);
      app.recordUsage({ kind: 'fetch', ok: false, latencyMs: Date.now() - startedAt });
      toast({ tone: 'err', title: described.title, text: described.hint });
    } finally {
      setFetching(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  // 从结果卡片的「抓取正文」进入时自动发起抓取（只对当前条目触发一次）。
  // 未配置密钥且不在演示模式时不自动请求，交由面板里的按钮提示用户。
  const autoFetchedFor = useRef(null);
  useEffect(() => {
    if (!open || !item?.autoFetch) return;
    if (autoFetchedFor.current === item.id) return;
    if (fetching || localContent || content) return;
    autoFetchedFor.current = item.id;
    if (!app.hasKey && !app.settings.demo) return;
    if (!url) return;
    doFetch();
  }, [open, item, fetching, localContent, content, url, app.hasKey, app.settings.demo]);

  const markdown = item ? toMarkdown({ ...item, result: { ...(result || {}), content: localContent ?? result?.content } }) : '';

  return (
    <>
      <aside className={cx('drawer', open && 'is-open')} aria-hidden={!open} aria-label="详情面板">
        <div className="drawer-head">
          <div className="drawer-titles">
            <h3 title={title}>{title || '详情'}</h3>
            {url ? (
              <a className="drawer-url" href={url} target="_blank" rel="noopener noreferrer" title={url}>
                {url}
              </a>
            ) : null}
          </div>
          <div className="drawer-tools">
            {markdown ? (
              <CopyButton text={markdown} label="" className="icon-btn" onDone={(ok) => toast({ tone: ok ? 'ok' : 'err', title: ok ? '已复制 Markdown' : '复制失败' })} />
            ) : null}
            <button
              type="button"
              className="icon-btn"
              title="下载 Markdown"
              onClick={() => {
                const name = `${(title || 'page').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.md`;
                if (downloadText(name, markdown, 'text/markdown;charset=utf-8')) toast({ tone: 'ok', title: '已下载', text: name });
              }}
            >
              <IconDownload size={17} />
            </button>
            {url ? (
              <a className="icon-btn" href={url} target="_blank" rel="noopener noreferrer" title="新窗口打开原文">
                <IconExternal size={17} />
              </a>
            ) : null}
            <button type="button" className="icon-btn" title="关闭 (Esc)" onClick={drawer.closeDrawer}>
              <IconClose size={18} />
            </button>
          </div>
        </div>

        {(result || item?.kind === 'fetch') && (
          <div className="drawer-meta">
            <div className="drawer-seg" role="tablist">
              <button type="button" className={cx(view === 'summary' && 'on')} onClick={() => drawer.setView('summary')} role="tab">
                摘要
              </button>
              <button type="button" className={cx(view === 'content' && 'on')} onClick={() => drawer.setView('content')} role="tab">
                正文
                {content ? <span style={{ opacity: 0.6 }}> · {Math.round(content.length / 1000)}k</span> : null}
              </button>
            </div>
            {result ? <ScoreBadge score={result.rerankScore} /> : null}
            {result ? <AuthorityBadge value={result.authority} /> : null}
            {result?.date ? <span className="tag">发布 {formatDateOnly(result.date)}</span> : null}
            {meta.map((m) => (
              <span className="tag" key={m.label}>
                <m.icon size={12} /> {m.label}
              </span>
            ))}
          </div>
        )}

        <div className="drawer-body" ref={bodyRef}>
          {view === 'summary' ? (
            result ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <SiteFavicon url={result.url} name={result.siteName} icon={result.siteIcon} size={34} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>{result.siteName || hostOf(result.url)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      {hostOf(result.url)} · 权威性 {result.authority === -1 ? '未知' : result.authority}
                      {tier ? ` · ${tier.label}` : ''}
                    </div>
                  </div>
                </div>
                <div className="rc-summary" style={{ marginTop: 0 }}>
                  <span className="rc-summary-label">短摘要 · snippet</span>
                  {result.snippet || '（无）'}
                </div>
                <div style={{ marginTop: 14 }}>
                  <span className="rc-summary-label">长摘要 · summary</span>
                  <p>{result.summary || '（无）'}</p>
                </div>
                {!content ? (
                  <div className="banner" style={{ marginTop: 18 }}>
                    <IconInfo size={16} />
                    <div style={{ flex: 1 }}>
                      本条结果没有正文（请求时 <code>need_content</code> 为 false）。可以单独抓取该页面获取完整 Markdown。
                    </div>
                  </div>
                ) : (
                  <div className="tag ok" style={{ marginTop: 16 }}>
                    <IconLayers size={12} /> 已包含正文 {content.length.toLocaleString('zh-CN')} 字符
                  </div>
                )}
              </>
            ) : (
              <p className="muted">没有可展示的摘要。</p>
            )
          ) : (
            <>
              {fetchError ? (
                <div className="err-card" style={{ marginBottom: 16 }}>
                  <span className="e-ico"><IconAlert size={20} /></span>
                  <div>
                    <h3>{fetchError.title}</h3>
                    <p>{fetchError.hint}</p>
                    {fetchError.detail ? <div className="e-detail">{fetchError.detail}</div> : null}
                  </div>
                </div>
              ) : null}

              {fetching ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
                  <div className="skeleton">
                    <div className="sk-line tall w40" />
                    <div className="sk-line w100" />
                    <div className="sk-line w85" />
                    <div className="sk-line w100" />
                  </div>
                  <p className="muted" style={{ fontSize: 12.5 }}>
                    正在抓取网页正文…（{formatDuration(fetchElapsed)}）
                  </p>
                </div>
              ) : content ? (
                <>
                  <div style={{ display: 'flex', gap: 7, marginBottom: 14, flexWrap: 'wrap' }}>
                    <CopyButton text={content} label="复制正文" onDone={(ok) => toast({ tone: ok ? 'ok' : 'err', title: ok ? '已复制正文' : '复制失败' })} />
                    <button type="button" className="mini-btn" onClick={doFetch}>
                      <IconRefresh size={13} /> 重新抓取
                    </button>
                    {url ? (
                      <a className="mini-btn" href={url} target="_blank" rel="noopener noreferrer">
                        <IconGlobe size={13} /> 原文
                      </a>
                    ) : null}
                  </div>
                  <MarkdownView text={content} />
                </>
              ) : (
                <div className="empty" style={{ padding: '5vh 0' }}>
                  <div className="empty-ico"><IconGlobe size={30} /></div>
                  <h3>还没有正文</h3>
                  <p>
                    {item?.kind === 'fetch'
                      ? '该页面没有返回可提取的 Markdown 正文。'
                      : '调用 Fetch 接口抓取这个网页，返回 Markdown 格式的完整正文。'}
                  </p>
                  {url ? (
                    <button type="button" className="btn primary" onClick={doFetch}>
                      <IconDownload size={16} /> 抓取网页正文
                    </button>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
      {open ? <div className="drawer-scrim" onClick={drawer.closeDrawer} /> : null}
    </>
  );
}
