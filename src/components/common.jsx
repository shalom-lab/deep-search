/** 通用展示组件：toast 容器、确认弹窗、评分徽章、favicon、空态、骨架屏、错误卡片、Markdown 视图。 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useUI, copyText } from './UIProvider.jsx';
import {
  IconAlert, IconCheck, IconClose, IconCopy, IconExternal, IconInfo, IconKey, IconRefresh, IconSearch, IconSpark, IconWifi,
} from './Icon.jsx';
import { renderMarkdown, highlightText } from '../lib/markdown.js';
import { authorityInfo, cx, formatDateOnly, formatRelative, hostOf, scoreTier, siteAvatar } from '../lib/util.js';

/* ─────────────── Toaster ─────────────── */
const TONE_ICON = { ok: IconCheck, err: IconAlert, warn: IconAlert, info: IconInfo };

export function Toaster() {
  const { toasts, dismissToast, runAction } = useUI();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const Ico = TONE_ICON[t.tone] || IconInfo;
        return (
          <div key={t.id} className={cx('toast', t.tone, t.leaving && 'out')} role="status">
            <span className="t-ico"><Ico size={17} /></span>
            <div className="t-body">
              <div className="t-title">{t.title}</div>
              {t.text ? <div className="t-text">{t.text}</div> : null}
              {t.actions?.length ? (
                <div className="t-actions">
                  {t.actions.map((a, i) => (
                    <button
                      key={i}
                      type="button"
                      className={cx('mini-btn', a.primary !== false && 'accent')}
                      onClick={() => runAction(a, t.id)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button type="button" className="icon-btn" aria-label="关闭提示" onClick={() => dismissToast(t.id)}>
              <IconClose size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────── 确认弹窗 ─────────────── */
export function ConfirmModal() {
  const { confirmState, settleConfirm } = useUI();
  const okRef = useRef(null);
  useEffect(() => {
    if (confirmState) okRef.current?.focus();
  }, [confirmState]);
  if (!confirmState) return null;
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && settleConfirm(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={confirmState.title}>
        <h3>{confirmState.title}</h3>
        <p>{confirmState.text}</p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={() => settleConfirm(false)}>
            {confirmState.cancelLabel}
          </button>
          <button
            ref={okRef}
            type="button"
            className={cx('btn', confirmState.danger ? 'danger' : 'primary')}
            onClick={() => settleConfirm(true)}
          >
            {confirmState.okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────── 评分徽章 ─────────────── */
export function ScoreBadge({ score, showBar = true }) {
  const tier = scoreTier(score);
  const pct = Math.max(3, Math.min(100, (Number(score) / 3) * 100));
  return (
    <span
      className={cx('score-badge', `tier-${tier.key}`)}
      title={`rerank_score ${Number(score).toFixed(2)} / 3.00 — ${tier.label}（${tier.hint}）`}
    >
      {showBar ? <span className="bar"><i style={{ '--pct': `${pct}%` }} /></span> : null}
      {Number(score).toFixed(2)}
    </span>
  );
}

/* ─────────────── 权威度徽章 ─────────────── */
export function AuthorityBadge({ value, compact: isCompact = false }) {
  const info = authorityInfo(value);
  const num = Number(value);
  return (
    <span className={cx('auth-badge', info.key)} title={`authority ${num}（0–4，-1 表示未知）— ${info.label}权威`}>
      {isCompact ? null : '权威 '}
      {num >= 0 ? num : '?'}
    </span>
  );
}

/* ─────────────── 站点图标 ─────────────── */
export function SiteFavicon({ url, name, icon, size = 30 }) {
  const [failed, setFailed] = useState(false);
  const avatar = useMemo(() => siteAvatar(url, name), [url, name]);
  const src = icon || (hostOf(url) ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostOf(url))}` : '');
  useEffect(() => setFailed(false), [src]);

  return (
    <span
      className="rc-fav"
      style={{ width: size, height: size, flexBasis: size }}
      title={name || hostOf(url)}
    >
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span style={{ color: `hsl(${avatar.hue} 72% 62%)` }}>{avatar.letter}</span>
      )}
    </span>
  );
}

/* ─────────────── 空状态 ─────────────── */
export function EmptyState({ icon, title, children, cards }) {
  const Ico = icon || IconSearch;
  return (
    <div className="empty">
      <div className="empty-ico"><Ico size={34} /></div>
      <h3>{title}</h3>
      {children ? <div>{children}</div> : null}
      {cards?.length ? (
        <div className="empty-cards">
          {cards.map((c) => (
            <button key={c.title} type="button" className="empty-card" onClick={c.onClick}>
              <strong>{c.title}</strong>
              <span>{c.desc}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────── 骨架屏 ─────────────── */
export function ResultSkeleton({ count = 5 }) {
  return (
    <div className="results">
      {Array.from({ length: count }).map((_, i) => (
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
  );
}

/* ─────────────── 错误卡片 ─────────────── */
export function ErrorCard({ error, onRetry, onOpenSettings, onDismiss, retryLabel = '重试' }) {
  const [showDetail, setShowDetail] = useState(false);
  if (!error) return null;
  const isKey = error.code === 'unauthorized';
  const isCors = error.code === 'cors' || error.code === 'network';
  const Ico = isKey ? IconKey : isCors ? IconWifi : IconAlert;

  return (
    <div className="err-card" role="alert">
      <span className="e-ico"><Ico size={22} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3>{error.title || '请求失败'}</h3>
        <p>{error.hint}</p>
        {error.detail ? (
          <>
            <button type="button" className="link-btn" onClick={() => setShowDetail((v) => !v)} style={{ marginTop: 8, color: 'var(--text-3)' }}>
              {showDetail ? '收起原始信息' : '查看原始信息'}
            </button>
            {showDetail ? <div className="e-detail">{error.detail}</div> : null}
          </>
        ) : null}
        <div className="e-actions">
          {error.retryable && onRetry ? (
            <button type="button" className="mini-btn accent" onClick={onRetry}>
              <IconRefresh size={14} /> {retryLabel}
              {error.retryAfter ? `（${error.retryAfter}s 后）` : ''}
            </button>
          ) : null}
          {isKey && onOpenSettings ? (
            <button type="button" className="mini-btn accent" onClick={onOpenSettings}>
              <IconKey size={14} /> 去填写 API Key
            </button>
          ) : null}
          {isCors ? (
            <button type="button" className="mini-btn" onClick={() => window.open('https://api-docs.deepseek.com/zh-cn/guides/search/', '_blank', 'noopener')}>
              <IconExternal size={14} /> 查看接口文档
            </button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="mini-btn" onClick={onDismiss}>
              <IconClose size={14} /> 关闭
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ─────────────── 高亮文本 ─────────────── */
export function Highlight({ text, query, enabled = true }) {
  const html = useMemo(() => {
    const value = String(text ?? '');
    if (!value) return '';
    return enabled && query ? highlightText(value, query) : value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }, [text, query, enabled]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ─────────────── Markdown 视图 ─────────────── */
export function MarkdownView({ text }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  if (!html) return <p className="muted">（内容为空）</p>;
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ─────────────── 复制按钮 ─────────────── */
export function CopyButton({ text, label = '复制', className = 'mini-btn', onDone }) {
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => timer.current && clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={cx(className, done && 'ok')}
      onClick={async () => {
        const ok = await copyText(typeof text === 'function' ? text() : text);
        if (ok) {
          setDone(true);
          timer.current = setTimeout(() => setDone(false), 1600);
          onDone?.(true);
        } else {
          onDone?.(false);
        }
      }}
    >
      {done ? <IconCheck size={14} /> : <IconCopy size={14} />}
      {done ? '已复制' : label}
    </button>
  );
}

/* ─────────────── 结果元信息行 ─────────────── */
export function ResultMeta({ result, showUrl = true }) {
  const date = formatDateOnly(result.date);
  return (
    <div className="rc-meta">
      <span className="rc-host">{result.siteName || hostOf(result.url)}</span>
      {showUrl ? (
        <>
          <span className="sep">·</span>
          <span className="rc-url" title={result.url}>{result.url}</span>
        </>
      ) : null}
      {date ? (
        <>
          <span className="sep">·</span>
          <span title={result.date}>{date}</span>
        </>
      ) : null}
      <AuthorityBadge value={result.authority} />
    </div>
  );
}

/* ─────────────── 横幅 ─────────────── */
export function Banner({ tone = 'info', icon, children, actions }) {
  const Ico = icon || IconSpark;
  return (
    <div className={cx('banner', tone === 'warn' && 'warn')}>
      <Ico size={17} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {actions ? <div className="b-actions">{actions}</div> : null}
    </div>
  );
}

/** 相对时间（每分钟自动刷新一次） */
export function RelativeTime({ value, prefix = '' }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const text = formatRelative(value);
  return <span title={value || ''}>{prefix}{text}</span>;
}
