/** 单条搜索结果卡片。 */
import React, { useState } from 'react';
import { Highlight, ResultMeta, ScoreBadge, SiteFavicon } from '../components/common.jsx';
import { IconDownload, IconExternal, IconEye, IconLayers, IconLink, IconSpark } from '../components/Icon.jsx';
import { useApp } from '../lib/store.js';
import { useDrawer } from '../hooks/useAppState.jsx';
import { copyText, useUI } from '../components/UIProvider.jsx';
import { cx, hostOf, scoreTier } from '../lib/util.js';

export default function ResultCard({ result, index, cursor, query, onHover }) {
  const app = useApp();
  const drawer = useDrawer();
  const { toast } = useUI();
  const [expanded, setExpanded] = useState(false);
  const tier = scoreTier(result.rerankScore);

  const open = (view = 'summary') => drawer.openDrawer({ kind: 'result', result }, view);

  // 已带正文就直接展示；否则让详情面板打开后自动抓取
  const handleFetch = () => {
    if (result.content) {
      open('content');
      return;
    }
    drawer.openDrawer({ kind: 'result', result, autoFetch: true }, 'content');
  };

  const quickCopy = async () => {
    const text = [`${result.title}`, result.url, '', result.summary || result.snippet].join('\n');
    const ok = await copyText(text);
    toast({ tone: ok ? 'ok' : 'err', title: ok ? '已复制到剪贴板' : '复制失败' });
  };

  return (
    <article
      className={cx('rcard', `tier-${tier.key}`, cursor && 'is-cursor')}
      onMouseEnter={() => onHover?.(index)}
      style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
    >
      <div className="rc-rail">
        <SiteFavicon url={result.url} name={result.siteName} icon={result.siteIcon} size={26} />
        <span className="rank-badge" title={`第 ${index + 1} 条`}>#{index + 1}</span>
      </div>

      <div className="rc-main">
        <div className="rc-head">
          <div className="rc-headmain">
            <button type="button" className="rc-title" onClick={() => open('summary')} title="查看详情">
              <Highlight text={result.title || '(无标题)'} query={query} enabled={app.settings.highlight} />
            </button>
            <ResultMeta result={result}>
              <span
                className={cx('tag', 'rc-tier', `tier-${tier.key}`)}
                title={`rerank_score ${Number(result.rerankScore).toFixed(2)} — ${tier.hint}`}
              >
                {tier.label}
              </span>
            </ResultMeta>
          </div>
          <div className="rc-scores">
            <ScoreBadge score={result.rerankScore} />
          </div>
        </div>

        {expanded ? (
          <div className="rc-summary">
            <span className="rc-summary-label">
              <IconSpark size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
              长摘要 · summary（面向模型阅读）
            </span>
            <Highlight text={result.summary || '（无长摘要）'} query={query} enabled={app.settings.highlight} />
          </div>
        ) : (
          <p className="rc-snippet">
            <Highlight text={result.snippet || result.summary?.slice(0, 180) || '（无摘要）'} query={query} enabled={app.settings.highlight} />
          </p>
        )}

        <div className="rc-foot">
          {result.content ? (
            <span className="content-flag" title="该结果已包含网页正文">
              <IconLayers size={12} /> 含正文 {Math.round(result.content.length / 1000)}k
            </span>
          ) : null}

          <div className="rc-actions">
            <button type="button" className="mini-btn" onClick={() => setExpanded((v) => !v)} title="展开/收起长摘要">
              <IconEye size={13} /> {expanded ? '收起摘要' : '长摘要'}
            </button>
            <button type="button" className="mini-btn accent" onClick={handleFetch} title="调用 Fetch 接口抓取网页正文">
              <IconDownload size={13} /> {result.content ? '读正文' : '抓取正文'}
            </button>
            <button type="button" className="mini-btn" onClick={quickCopy} title="复制标题与摘要">
              <IconLink size={13} /> 复制
            </button>
            <a className="mini-btn" href={result.url} target="_blank" rel="noopener noreferrer" title={`打开 ${hostOf(result.url)}`}>
              <IconExternal size={13} /> 原文
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

/** 按站点聚合时的分组容器。 */
export function SiteGroup({ group, children, extra }) {
  return (
    <section className="site-group">
      <div className="site-group-head">
        <SiteFavicon url={`https://${group.host}`} name={group.host} size={22} />
        <span className="gname">{group.host}</span>
        <span className="gcount">{group.items.length} 条</span>
        <span className="gavg">平均 {group.avg.toFixed(2)} · 最高 {group.top.rerankScore.toFixed(2)}</span>
      </div>
      <div className="results">{children}</div>
      {extra}
    </section>
  );
}
