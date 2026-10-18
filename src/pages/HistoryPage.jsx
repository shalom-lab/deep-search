/** 历史页：调用统计（含图表）+ 搜索历史快照。 */
import React, { Suspense, lazy, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, RelativeTime, SiteFavicon } from '../components/common.jsx';
import { IconDownload, IconExternal, IconHistory, IconLayers, IconRefresh, IconTrash } from '../components/Icon.jsx';
import { useApp } from '../lib/store.js';
import { useSearchSession, useDrawer } from '../hooks/useAppState.jsx';
import { downloadText, useUI } from '../components/UIProvider.jsx';
import { PRICE_PER_1000 } from '../lib/api.js';
import { formatDuration, formatNumber, hostOf } from '../lib/util.js';
import { exportFilename } from '../lib/results.js';

function Stat({ k, v, unit, tone, title }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ''}`} title={title}>
      <div className="k">{k}</div>
      <div className="v">
        {v}
        {unit ? <span className="u">{unit}</span> : null}
      </div>
    </div>
  );
}

const HistoryCharts = lazy(() => import('./HistoryCharts.jsx'));

export default function HistoryPage() {
  const app = useApp();
  const session = useSearchSession();
  const drawer = useDrawer();
  const navigate = useNavigate();
  const { toast, confirm } = useUI();
  const [expanded, setExpanded] = useState(() => new Set());

  const { derived, usage } = app;

  const daily = useMemo(() => {
    const out = [];
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const bucket = usage.daily?.[key] || {};
      out.push({
        day: `${d.getMonth() + 1}/${d.getDate()}`,
        key,
        搜索: bucket.search || 0,
        抓取: bucket.fetch || 0,
        结果: bucket.results || 0,
        失败: bucket.errors || 0,
      });
    }
    return out;
  }, [usage.daily]);

  const hasData = derived.totalCalls > 0;
  const activeDays = daily.filter((d) => d.搜索 + d.抓取 > 0).length;

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportHistory = () => {
    const rows = app.history.flatMap((h) =>
      (h.results?.length ? h.results : [null]).map((r, i) => ({
        query: h.query,
        searchedAt: h.at,
        rank: r ? i + 1 : '',
        rerank_score: r?.rerankScore ?? '',
        authority: r?.authority ?? '',
        title: r?.title ?? '',
        url: r?.url ?? '',
        site_name: r?.siteName ?? '',
        date: r?.date ?? '',
        snippet: r?.snippet ?? '',
      })),
    );
    const cols = Object.keys(rows[0] || { query: '' });
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
    const name = exportFilename('deepsearch-history', 'all', 'csv');
    downloadText(name, `\uFEFF${csv}`, 'text/csv;charset=utf-8');
    toast({ tone: 'ok', title: '已导出历史', text: name });
  };

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>调用统计</h2>
          <p className="muted">
            统计只保存在本机。Search 与 Fetch 均为每 1,000 次<strong>成功且产生结果</strong>的请求 {PRICE_PER_1000} 元，
            失败、无结果或超时不计费。
          </p>
        </div>

        <div className="usage-grid">
          <Stat k="总请求" v={formatNumber(derived.totalCalls)} unit="次" title="搜索 + 抓取的调用总次数" />
          <Stat k="计费请求（估算）" v={formatNumber(derived.billable)} unit="次" tone="accent" title="成功且产生结果的请求数" />
          <Stat
            k="估算花费"
            v={`¥${derived.estimatedCost.toFixed(3)}`}
            tone={derived.estimatedCost > 0 ? 'warn' : undefined}
            title={`按每 1000 次 ${PRICE_PER_1000} 元估算，仅本地推算，请以账单为准`}
          />
          <Stat k="平均延迟" v={derived.avgLatency ? formatDuration(derived.avgLatency) : '—'} />
          <Stat k="失败请求" v={formatNumber(derived.errorCount)} unit="次" tone={derived.errorCount ? 'warn' : undefined} />
          <Stat k="活跃天数" v={formatNumber(activeDays)} unit="天" title="最近 30 天内有调用的天数" />
          <Stat k="搜索返回结果" v={formatNumber(usage.searchResults)} unit="条" />
          <Stat k="抓取正文字符" v={formatNumber(usage.fetchChars)} unit="字符" />
        </div>

        {hasData ? (
          <Suspense fallback={<p className="muted" style={{ fontSize: 13 }}>图表加载中…</p>}>
            <HistoryCharts daily={daily} />
          </Suspense>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>
            还没有调用记录。搜索或抓取几次后，这里会出现趋势图。
          </p>
        )}

        <div className="usage-head">
          <span className="hint">
            统计起始于 {usage.since ? new Date(usage.since).toLocaleString('zh-CN', { hour12: false }) : '—'}
          </span>
          <button
            type="button"
            className="link-btn"
            onClick={async () => {
              if (await confirm({ title: '重置统计？', text: '将清空本机的调用次数与趋势数据，历史搜索记录不受影响。', okLabel: '重置' })) {
                app.resetUsage();
                toast({ tone: 'ok', title: '统计已重置' });
              }
            }}
          >
            重置统计
          </button>
        </div>
      </div>

      <div className="result-head">
        <div className="rh-left">
          <h2>搜索历史</h2>
          <span className="muted">
            共 {app.history.length} 条 · 最多保留 60 条{app.settings.rememberResults ? '（含结果快照）' : '（未保存结果快照）'}
          </span>
        </div>
        <div className="rh-right">
          <button type="button" className="btn ghost" disabled={!app.history.length} onClick={exportHistory}>
            <IconDownload size={15} /> 导出 CSV
          </button>
          <button
            type="button"
            className="btn ghost danger"
            disabled={!app.history.length}
            onClick={async () => {
              if (await confirm({ title: '清空全部历史？', text: `将删除 ${app.history.length} 条搜索历史，此操作不可恢复。`, okLabel: '清空' })) {
                app.clearHistory();
                session.clearSearch();
                toast({ tone: 'ok', title: '历史已清空' });
              }
            }}
          >
            <IconTrash size={15} /> 清空
          </button>
        </div>
      </div>

      {app.history.length === 0 ? (
        <EmptyState icon={IconHistory} title="还没有搜索历史">
          <p>每次搜索都会自动记录在这里（可在设置中关闭）。点击任意一条即可恢复当次的结果快照。</p>
        </EmptyState>
      ) : (
        <div className="history-list">
          {app.history.map((h) => {
            const isOpen = expanded.has(h.id);
            const top = h.results?.[0];
            return (
              <div className="hcard" key={h.id}>
                <div className="hcard-top">
                  <button
                    type="button"
                    className="hcard-q"
                    onClick={() => {
                      session.restoreHistory(h);
                      navigate('/');
                      toast({ tone: 'info', title: '已恢复历史结果', text: h.results?.length ? `${h.results.length} 条结果来自快照` : '该记录未保存结果，可点击“重新搜索”' });
                    }}
                  >
                    {h.query}
                  </button>
                  <div className="btn-group">
                    <button
                      type="button"
                      className="mini-btn accent"
                      onClick={() => {
                        session.setQuery(h.query);
                        navigate('/');
                        session.runSearch({ query: h.query, count: h.count, needContent: h.needContent });
                      }}
                      title="用当前设置重新执行这次搜索"
                    >
                      <IconRefresh size={13} /> 重新搜索
                    </button>
                    {h.results?.length ? (
                      <button type="button" className="mini-btn" onClick={() => toggle(h.id)}>
                        <IconLayers size={13} /> {isOpen ? '收起' : `${h.results.length} 条结果`}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="mini-btn danger"
                      onClick={() => app.removeHistory(h.id)}
                      title="删除这条记录"
                    >
                      <IconTrash size={13} />
                    </button>
                  </div>
                </div>

                <div className="hcard-meta">
                  <span className="tag">
                    <RelativeTime value={h.at} />
                  </span>
                  <span className="tag">{h.count} 条请求</span>
                  {h.latencyMs ? <span className="tag">{formatDuration(h.latencyMs)}</span> : null}
                  {h.needContent ? <span className="tag ok">need_content</span> : null}
                  {h.demo ? <span className="tag accent">演示</span> : null}
                  {top ? (
                    <span className="tag">
                      <SiteFavicon url={top.url} name={top.siteName} size={14} /> 最高分 {Number(top.rerankScore).toFixed(2)}
                    </span>
                  ) : null}
                </div>

                {isOpen && h.results?.length ? (
                  <div className="hcard-results">
                    {h.results.map((r, i) => (
                      <div className="hr-item" key={`${h.id}-${i}`}>
                        <span className="sc">{Number(r.rerankScore).toFixed(2)}</span>
                        <button
                          type="button"
                          className="tt"
                          style={{ background: 'none', color: 'inherit', textAlign: 'left', flex: 1 }}
                          onClick={() => drawer.openDrawer({ kind: 'result', result: r }, r.content ? 'content' : 'summary')}
                          title="在详情面板中查看"
                        >
                          {r.title || r.url}
                        </button>
                        <span className="dim" style={{ fontSize: 11, flex: '0 0 auto' }}>{hostOf(r.url)}</span>
                        <a className="dim" href={r.url} target="_blank" rel="noopener noreferrer" title="打开原文" style={{ flex: '0 0 auto' }}>
                          <IconExternal size={12} />
                        </a>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
