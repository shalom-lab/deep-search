/** 结果集合的排序 / 过滤 / 聚合 / 导出（纯函数）。 */
import { formatDateOnly, hostOf, normalizeUrl } from './util.js';

export function filterResults(results, filter) {
  const list = Array.isArray(results) ? results : [];
  if (!filter || filter === '0') return list;
  if (filter === 'auth3') return list.filter((r) => Number(r.authority) >= 3);
  const min = Number(filter);
  if (!Number.isFinite(min)) return list;
  return list.filter((r) => Number(r.rerankScore) >= min);
}

export function sortResults(results, sort) {
  const list = [...(Array.isArray(results) ? results : [])];
  const time = (r) => {
    const t = r.date ? new Date(r.date).getTime() : 0;
    return Number.isNaN(t) ? 0 : t;
  };
  switch (sort) {
    case 'authority':
      return list.sort((a, b) => b.authority - a.authority || b.rerankScore - a.rerankScore);
    case 'fresh':
      return list.sort((a, b) => time(b) - time(a) || b.rerankScore - a.rerankScore);
    case 'site':
      return list.sort((a, b) => hostOf(a.url).localeCompare(hostOf(b.url), 'zh-CN') || b.rerankScore - a.rerankScore);
    case 'score':
    default:
      return list.sort((a, b) => b.rerankScore - a.rerankScore);
  }
}

export function dedupeResults(results) {
  const seen = new Set();
  return (Array.isArray(results) ? results : []).filter((r) => {
    const key = normalizeUrl(r.url) || r.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 按站点聚合：组内按分数排序，组间按最高分排序。 */
export function groupBySite(results) {
  const map = new Map();
  (Array.isArray(results) ? results : []).forEach((r) => {
    const key = hostOf(r.url) || '未知站点';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return [...map.entries()]
    .map(([host, items]) => {
      const sorted = [...items].sort((a, b) => b.rerankScore - a.rerankScore);
      const avg = sorted.reduce((sum, r) => sum + r.rerankScore, 0) / sorted.length;
      return { host, items: sorted, avg, top: sorted[0] };
    })
    .sort((a, b) => b.avg - a.avg);
}

export function summarize(results) {
  const list = Array.isArray(results) ? results : [];
  const scored = list.map((r) => Number(r.rerankScore) || 0);
  const good = list.filter((r) => (Number(r.rerankScore) || 0) >= 1.5).length;
  const authoritative = list.filter((r) => Number(r.authority) >= 3).length;
  const sites = new Set(list.map((r) => hostOf(r.url)).filter(Boolean));
  const avg = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 0;
  const withContent = list.filter((r) => r.content).length;
  return { total: list.length, good, authoritative, sites: sites.size, avg, withContent };
}

/* ─────────────── 导出 ─────────────── */

function mdEscape(text) {
  return String(text ?? '').replace(/\n{3,}/g, '\n\n');
}

export function toMarkdown(results, meta = {}) {
  const list = Array.isArray(results) ? results : [];
  const sum = summarize(list);
  const lines = [
    `# 搜索结果：${meta.query || ''}`,
    '',
    `- 返回条数：${sum.total}`,
    `- 优质结果（rerank_score ≥ 1.5）：${sum.good}`,
    `- 极权威来源（authority ≥ 3）：${sum.authoritative}`,
    `- 覆盖站点：${sum.sites}`,
    `- 平均排序分数：${sum.avg.toFixed(2)} / 3.00`,
    meta.needContent !== undefined ? `- need_content：${meta.needContent}` : null,
    meta.usedOri !== undefined ? `- ori_question：${meta.usedOri ? '已提供' : '未提供'}` : null,
    meta.latencyMs ? `- 用时：${(meta.latencyMs / 1000).toFixed(2)}s` : null,
    `- 导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '---',
    '',
  ].filter(Boolean);

  list.forEach((r, i) => {
    lines.push(`## ${i + 1}. ${r.title || '(无标题)'}`);
    lines.push('');
    lines.push(`- 链接：${r.url}`);
    lines.push(`- 站点：${r.siteName || hostOf(r.url)}`);
    lines.push(`- 排序分数：${Number(r.rerankScore).toFixed(2)} / 3.00`);
    lines.push(`- 权威性：${r.authority}（0–4，-1 未知）`);
    lines.push(`- 发布时间：${formatDateOnly(r.date) || '未知'}`);
    lines.push('');
    if (r.snippet) {
      lines.push(`**短摘要**：${mdEscape(r.snippet)}`);
      lines.push('');
    }
    if (r.summary) {
      lines.push(`**长摘要**：${mdEscape(r.summary)}`);
      lines.push('');
    }
    if (r.content) {
      lines.push('<details><summary>网页正文</summary>');
      lines.push('');
      lines.push(mdEscape(r.content));
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  });

  return lines.join('\n');
}

export function toJSONExport(results, meta = {}) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      query: meta.query || '',
      request: {
        count: meta.count,
        need_content: meta.needContent,
        ori_question: meta.usedOri ? meta.oriQuestion || '' : null,
        localization: meta.localization || '',
      },
      stats: summarize(results),
      results: (Array.isArray(results) ? results : []).map((r) => ({
        rerank_score: r.rerankScore,
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        summary: r.summary,
        content: r.content || '',
        site_name: r.siteName,
        site_icon: r.siteIcon,
        date: r.date,
        authority: r.authority,
      })),
    },
    null,
    2,
  );
}

export function toCSV(results) {
  const cols = ['rank', 'rerank_score', 'authority', 'title', 'url', 'site_name', 'date', 'snippet'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = (Array.isArray(results) ? results : []).map((r, i) =>
    [i + 1, r.rerankScore, r.authority, r.title, r.url, r.siteName || hostOf(r.url), r.date || '', r.snippet].map(esc).join(','),
  );
  return [cols.join(','), ...rows].join('\r\n');
}

export function exportFilename(prefix, query, ext) {
  const safe = String(query || 'search')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .slice(0, 48) || 'search';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${prefix}-${safe}-${stamp}.${ext}`;
}
