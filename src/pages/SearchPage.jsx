/** 搜索页：结果列表、过滤排序、导出、键盘导航。 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ResultCard, { SiteGroup } from '../components/ResultCard.jsx';
import { Banner, EmptyState, ErrorCard, Highlight } from '../components/common.jsx';
import {
  IconDownload, IconKey, IconLayers, IconRefresh, IconSearch, IconWifi as IconNet, IconClose, IconSpark,
} from '../components/Icon.jsx';
import { useApp } from '../lib/store.js';
import { useSearchSession, useDrawer } from '../hooks/useAppState.jsx';
import { downloadText, useUI } from '../components/UIProvider.jsx';
import { FILTERS, SORTS, EXAMPLE_QUERIES } from '../lib/presets.js';
import {
  dedupeResults, exportFilename, filterResults, groupBySite, sortResults, summarize, toCSV, toJSONExport, toMarkdown,
} from '../lib/results.js';
import { formatDuration } from '../lib/util.js';

function ExportMenu({ results, meta, compact }) {
  const { toast } = useUI();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const disabled = !results.length;
  const doExport = (format) => {
    setOpen(false);
    const q = meta?.query || '';
    if (format === 'md') {
      const name = exportFilename('deepsearch', q, 'md');
      downloadText(name, toMarkdown(results, meta), 'text/markdown;charset=utf-8');
      toast({ tone: 'ok', title: '已导出 Markdown', text: name });
    } else if (format === 'json') {
      const name = exportFilename('deepsearch', q, 'json');
      downloadText(name, toJSONExport(results, meta), 'application/json;charset=utf-8');
      toast({ tone: 'ok', title: '已导出 JSON', text: name });
    } else {
      const name = exportFilename('deepsearch', q, 'csv');
      downloadText(name, `\uFEFF${toCSV(results)}`, 'text/csv;charset=utf-8');
      toast({ tone: 'ok', title: '已导出 CSV', text: name });
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn ghost" disabled={disabled} onClick={() => setOpen((v) => !v)} title={disabled ? '暂无可导出的结果' : '导出结果'}>
        <IconDownload size={15} />
        {compact ? null : <span>导出</span>}
      </button>
      {open ? (
        <div className="panel" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 224, margin: 0, padding: 8, zIndex: 40 }}>
          {[
            { key: 'md', label: 'Markdown（含摘要）', hint: '.md' },
            { key: 'json', label: 'JSON（原始结构）', hint: '.json' },
            { key: 'csv', label: 'CSV（表格）', hint: '.csv' },
          ].map((it) => (
            <button
              key={it.key}
              type="button"
              className="recent-item"
              onClick={() => doExport(it.key)}
              style={{ width: '100%' }}
            >
              <span className="rq">{it.label}</span>
              <span className="rt">{it.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function SearchPage() {
  const app = useApp();
  const session = useSearchSession();
  const drawer = useDrawer();
  const navigate = useNavigate();
  const [cursor, setCursor] = useState(-1);
  const listRef = useRef(null);

  const sort = app.settings.sort;
  const filter = app.settings.filter;

  const view = useMemo(() => {
    const unique = dedupeResults(session.results);
    const filtered = filterResults(unique, filter);
    const sorted = sortResults(filtered, sort);
    return { unique, filtered, sorted, stats: summarize(session.results), groups: sort === 'site' ? groupBySite(sorted) : null };
  }, [session.results, filter, sort]);

  // 键盘导航
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
      if (typing || drawer.open) return;
      if (!view.sorted.length) return;
      if (e.key === 'ArrowDown' || (e.key === 'j' && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        setCursor((c) => Math.min(view.sorted.length - 1, c + 1));
      } else if (e.key === 'ArrowUp' || (e.key === 'k' && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (e.key === 'Enter' && cursor >= 0 && cursor < view.sorted.length) {
        e.preventDefault();
        const r = view.sorted[cursor];
        drawer.openDrawer({ kind: 'result', result: r }, r.content ? 'content' : 'summary');
      } else if (e.key === 'Escape') {
        setCursor(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.sorted, cursor, drawer]);

  const meta = useMemo(
    () => ({
      query: session.query,
      count: session.meta?.count,
      needContent: session.meta?.needContent,
      usedOri: session.meta?.usedOri,
      localization: session.meta?.localization,
      latencyMs: session.meta?.latencyMs,
      oriQuestion: app.settings.oriQuestion,
    }),
    [session.query, session.meta, app.settings.oriQuestion],
  );

  const hasResults = session.results.length > 0;
  const showBanner = !app.settings.demo && (!app.hasKey || !app.proxy.ok);

  return (
    <>
      {showBanner ? (
        !app.hasKey ? (
          <Banner
            icon={IconKey}
            actions={
              <>
                <button type="button" className="mini-btn accent" onClick={() => navigate('/settings')}>
                  填写 API Key
                </button>
                <button type="button" className="mini-btn" onClick={() => app.updateSettings({ demo: true })}>
                  用演示数据体验
                </button>
              </>
            }
          >
            <strong>尚未配置 API Key。</strong> 本应用采用 BYOK（Bring Your Own Key）：密钥只保存在本机浏览器 localStorage，直接随请求发给 DeepSeek，不经过任何第三方。
          </Banner>
        ) : (
          <Banner
            tone="warn"
            icon={IconNet}
            actions={
              <>
                <button type="button" className="mini-btn accent" onClick={() => app.recheckProxy()}>
                  <IconRefresh size={13} /> 重新检测
                </button>
                <button type="button" className="mini-btn" onClick={() => navigate('/settings')}>
                  传输设置
                </button>
              </>
            }
          >
            <strong>未检测到本地转发。</strong> 浏览器直连 <code>api.deepseek.com</code> 可能被跨域策略拦截；通过 <code>npm run dev</code> 打开本页会自动启用同源转发。
          </Banner>
        )
      ) : null}

      {session.error ? (
        <ErrorCard
          error={session.error}
          onRetry={() => session.runSearch({ query: session.query })}
          onOpenSettings={() => navigate('/settings')}
          onDismiss={() => session.setSearch((prev) => ({ ...prev, error: null }))}
        />
      ) : null}

      {session.loading ? (
        <>
          <div className="result-head">
            <div className="rh-left">
              <h2>正在搜索…</h2>
              <span className="muted">
                “{session.query}” · 已用时 {formatDuration(session.elapsedMs)}
              </span>
            </div>
          </div>
          <div className="results">
            {Array.from({ length: Math.min(app.count, 6) }).map((_, i) => (
              <div className="skeleton" key={i} style={{ animationDelay: `${i * 60}ms` }}>
                <div className="sk-row">
                  <div className="sk-line" style={{ width: 30, height: 30, borderRadius: 8, flex: '0 0 30px' }} />
                  <div style={{ flex: 1 }}>
                    <div className="sk-line tall w60" />
                    <div className="sk-line w40" />
                  </div>
                  <div className="sk-line" style={{ width: 58, height: 22, borderRadius: 999 }} />
                </div>
                <div className="sk-line w100" style={{ marginTop: 12 }} />
                <div className="sk-line w85" />
              </div>
            ))}
          </div>
        </>
      ) : !hasResults ? (
        <EmptyState
          icon={IconSearch}
          title="开始一次网页搜索"
          cards={EXAMPLE_QUERIES.map((q) => ({
            title: q.title,
            desc: q.desc,
            onClick: () => {
              session.setQuery(q.desc);
              session.runSearch({ query: q.desc });
            },
          }))}
        >
          <p>
            输入关键词即可调用 <code>POST /v1/tools/search</code>。支持 <code>site:</code>、<code>-site:</code>、
            <code>&quot;精确短语&quot;</code>、<code>lang:zh,en</code>、<code>after:2025</code> 等语法，
            也可以用 <code>need_content</code> 让接口直接返回正文。
          </p>
        </EmptyState>
      ) : (
        <>
          <div className="result-head">
            <div className="rh-left">
              <h2>
                “<Highlight text={session.query} query="" />”
              </h2>
              <span className="muted">
                {view.stats.total} 条结果 · 优质 {view.stats.good} · 极权威 {view.stats.authoritative} · 覆盖 {view.stats.sites} 个站点 ·
                平均 {view.stats.avg.toFixed(2)} 分
                {session.meta?.latencyMs ? ` · ${formatDuration(session.meta.latencyMs)}` : ''}
                {session.meta?.fromHistory ? ' · 来自历史快照' : ''}
                {session.meta?.transport === 'demo' ? ' · 演示数据' : ''}
              </span>
            </div>
            <div className="rh-right">
              <label className="select-wrap" title="排序方式">
                <IconSpark size={14} />
                <select value={sort} onChange={(e) => app.updateSettings({ sort: e.target.value })}>
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label className="select-wrap" title="结果过滤">
                <IconLayers size={14} />
                <select value={filter} onChange={(e) => app.updateSettings({ filter: e.target.value })}>
                  {FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn ghost"
                title="重新执行本次搜索"
                onClick={() => session.runSearch({ query: session.query })}
              >
                <IconRefresh size={15} />
              </button>
              <ExportMenu results={view.sorted} meta={meta} />
              <button
                type="button"
                className="btn ghost"
                title="清空当前结果"
                onClick={() => {
                  session.clearSearch();
                  setCursor(-1);
                }}
              >
                <IconClose size={15} />
              </button>
            </div>
          </div>

          {view.filtered.length === 0 ? (
            <EmptyState icon={IconLayers} title="当前筛选条件下没有结果">
              <p>
                {FILTERS.find((f) => f.value === filter)?.label} 过滤掉了全部 {view.unique.length} 条结果，试试放宽条件。
              </p>
              <div className="btn-group" style={{ marginTop: 12 }}>
                <button type="button" className="btn ghost" onClick={() => app.updateSettings({ filter: '0' })}>
                  显示全部结果
                </button>
              </div>
            </EmptyState>
          ) : sort === 'site' ? (
            <div ref={listRef}>
              {view.groups.map((g) => (
                <SiteGroup key={g.host} group={g}>
                  {g.items.map((r) => (
                    <ResultCard
                      key={r.id}
                      result={r}
                      index={view.sorted.indexOf(r)}
                      cursor={view.sorted.indexOf(r) === cursor}
                      query={session.query}
                      onHover={setCursor}
                    />
                  ))}
                </SiteGroup>
              ))}
            </div>
          ) : (
            <div className="results" ref={listRef}>
              {view.sorted.map((r, i) => (
                <ResultCard
                  key={r.id}
                  result={r}
                  index={i}
                  cursor={i === cursor}
                  query={session.query}
                  onHover={setCursor}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
