/** 搜索栏：查询输入、语法预设、条数/正文/意图开关，以及发送后自动跳转到搜索页。 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconAlert, IconLayers, IconList, IconSearch, IconSpark, IconClose } from '../components/Icon.jsx';
import { useSearchSession } from '../hooks/useAppState.jsx';
import { useApp } from '../lib/store.js';
import { useUI } from '../components/UIProvider.jsx';
import { COUNT_MAX, COUNT_MIN, QUERY_MAX, clampCount, validateQuery } from '../lib/api.js';
import { PRESETS } from '../lib/presets.js';
import { countChars, cx } from '../lib/util.js';

export default function SearchBar() {
  const app = useApp();
  const session = useSearchSession();
  const { toast } = useUI();
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const countRootRef = useRef(null);
  const [draft, setDraft] = useState(session.query || '');
  const [showCount, setShowCount] = useState(false);

  // 外部（历史恢复 / 演示）改动 query 时同步到输入框
  useEffect(() => {
    setDraft((prev) => (prev === session.query ? prev : session.query || ''));
  }, [session.query]);

  // 返回条数面板：点外部或 Esc 关闭
  useEffect(() => {
    if (!showCount) return undefined;
    const onPointer = (e) => {
      if (countRootRef.current?.contains(e.target)) return;
      setShowCount(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setShowCount(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [showCount]);

  const chars = countChars(draft);
  const validation = validateQuery(draft);
  const nearLimit = chars > QUERY_MAX * 0.85;

  // 全局快捷键
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        app.toggleTheme();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  const submit = (e) => {
    e?.preventDefault();
    if (!draft.trim()) {
      toast({ tone: 'warn', title: '请输入搜索词' });
      inputRef.current?.focus();
      return;
    }
    if (!validation.ok) {
      toast({ tone: 'warn', title: '搜索词不合法', text: validation.message });
      return;
    }
    if (!app.hasKey && !app.settings.demo) {
      toast({
        tone: 'warn',
        title: '还没配置 API Key',
        text: '这份应用采用 BYOK：填入你自己的 DeepSeek API Key 才能发起真实请求，也可以先打开演示模式。',
        actions: [
          { label: '去设置', primary: true, onClick: () => navigate('/settings') },
          { label: '开启演示模式', onClick: () => app.updateSettings({ demo: true }) },
        ],
      });
      return;
    }
    session.setQuery(draft.trim());
    navigate('/');
    session.runSearch({ query: draft.trim() });
  };

  const insertPreset = (preset) => {
    const el = inputRef.current;
    const value = draft;
    const pos = el && document.activeElement === el ? el.selectionStart ?? value.length : value.length;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const spacer = before && !before.endsWith(' ') ? ' ' : '';
    const text = preset.template.startsWith(' ') && spacer ? preset.template.slice(1) : preset.template;
    const next = `${before}${spacer}${text}${after}`;
    setDraft(next.slice(0, QUERY_MAX));
    requestAnimationFrame(() => {
      el?.focus();
      const caret = (before + spacer + text).length + (preset.caret || 0);
      el?.setSelectionRange(caret, caret);
    });
  };

  const countValue = draft ? app.count : app.count;
  const presets = useMemo(() => PRESETS, []);

  return (
    <div className="search-wrap">
      <form className="searchbar" onSubmit={submit} role="search">
        <span className="sb-ico">
          <IconSearch size={18} />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, QUERY_MAX))}
          placeholder='输入搜索词… 支持 site:、-site:、"精确短语"、lang:zh、after:2025'
          aria-label="搜索词"
          spellCheck="false"
          autoComplete="off"
          maxLength={QUERY_MAX}
        />
        {nearLimit ? (
          <span
            className="tag"
            style={{ color: chars > QUERY_MAX ? 'var(--danger)' : 'var(--warn)', flex: '0 0 auto' }}
            title={`query 上限 ${QUERY_MAX} 个 Unicode 字符`}
          >
            {chars}/{QUERY_MAX}
          </span>
        ) : null}
        <button
          type="button"
          className={cx('icon-btn', 'clear-btn', draft && 'show')}
          title="清空"
          aria-label="清空搜索词"
          onClick={() => {
            setDraft('');
            session.setQuery('');
            inputRef.current?.focus();
          }}
        >
          <IconClose size={16} />
        </button>
        <button type="submit" className="btn primary" disabled={session.loading}>
          {session.loading ? '搜索中…' : '搜索'}
          {!session.loading ? <kbd className="kbd-hint">Enter</kbd> : null}
        </button>
      </form>

      <div ref={countRootRef} className="count-root">
        <div className="search-meta">
          <div className="meta-left">
            <button
              type="button"
              className="chip"
              aria-expanded={showCount}
              aria-controls="count-panel"
              aria-pressed={showCount}
              onClick={() => setShowCount((v) => !v)}
              title="返回条数 count（1–50，默认 10）"
            >
              <IconList size={14} />
              <span>{countValue} 条</span>
            </button>

            <button
              type="button"
              className="chip"
              aria-pressed={app.settings.needContent}
              title="need_content：让接口在 content 中返回网页正文（正文更全，但请求更慢）"
              onClick={() => app.updateSettings({ needContent: !app.settings.needContent })}
            >
              <IconLayers size={14} />
              <span>返回正文</span>
            </button>

            <button
              type="button"
              className="chip"
              aria-pressed={app.settings.deepIntent}
              title="ori_question：把原始问题一并提交，帮助接口更好地理解搜索意图"
              onClick={() => app.updateSettings({ deepIntent: !app.settings.deepIntent })}
            >
              <IconSpark size={14} />
              <span>意图增强</span>
            </button>

            {app.settings.demo ? (
              <span className="chip" aria-pressed="true" title="当前使用内置演示数据，不会发起真实请求">
                <IconAlert size={14} />
                <span>演示模式</span>
              </span>
            ) : null}
          </div>

          <div className="meta-right">
            <span className="kbd-tip">Ctrl/⌘ + K 聚焦 · Ctrl/⌘ + J 主题 · ↑↓ 选择 · Enter 抓取正文</span>
          </div>
        </div>

        {showCount ? (
          <div id="count-panel" className="panel count-panel" role="region" aria-label="返回条数">
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="countRange">
                返回条数 <span className="dim">count = {countValue}</span>
              </label>
              <div className="range-row">
                <input
                  id="countRange"
                  type="range"
                  min={COUNT_MIN}
                  max={COUNT_MAX}
                  value={countValue}
                  onChange={(e) => app.updateSettings({ count: clampCount(e.target.value) })}
                />
                <output>{countValue}</output>
              </div>
              <p className="hint">只影响返回条数，不影响单次请求价格。</p>
            </div>
            <button type="button" className="btn ghost sm" onClick={() => setShowCount(false)}>
              收起
            </button>
          </div>
        ) : null}
      </div>

      <div className="preset-row">
        <span className="preset-label">语法：</span>
        {presets.map((p) => (
          <button key={p.label} type="button" className="preset" title={p.title} onClick={() => insertPreset(p)}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
