/** 侧栏：品牌、主导航、最近搜索、密钥状态。 */
import React from 'react';
import { NavLink } from 'react-router-dom';
import { IconGlobe, IconHistory, IconMoon, IconSearch, IconSettings, IconSun } from '../components/Icon.jsx';
import { useApp } from '../lib/store.js';
import { useSearchSession } from '../hooks/useAppState.jsx';
import { cx, formatRelative } from '../lib/util.js';

function keyDotClass({ hasKey, demo }) {
  if (demo) return 'demo';
  if (!hasKey) return 'err';
  return 'on';
}

export default function Sidebar({ open, onNavigate }) {
  const app = useApp();
  const session = useSearchSession();

  const items = [
    { to: '/', label: '搜索', icon: IconSearch, end: true },
    { to: '/fetch', label: '抓取', icon: IconGlobe },
    { to: '/history', label: '历史', icon: IconHistory, badge: app.history.length },
    { to: '/settings', label: '设置', icon: IconSettings },
  ];

  const recent = app.history.slice(0, 12);

  return (
    <aside className={cx('sidebar', open && 'is-open')} aria-label="侧边栏">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <IconSearch size={21} strokeWidth={2.4} />
        </div>
        <div className="brand-text">
          <strong>DeepSearch</strong>
          <small>BYOK · 搜索 + 抓取</small>
        </div>
      </div>

      <nav className="nav" aria-label="主导航">
        {items.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) => cx('nav-item', isActive && 'is-active')}
            onClick={onNavigate}
          >
            <it.icon size={17} />
            <span>{it.label}</span>
            {it.badge ? <em className="pill">{it.badge > 99 ? '99+' : it.badge}</em> : null}
          </NavLink>
        ))}
      </nav>

      <div className="side-section">
        <div className="side-head">
          <h3>最近搜索</h3>
          {app.history.length ? (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                app.clearHistory();
                session.clearSearch();
              }}
            >
              清空
            </button>
          ) : null}
        </div>
        <ul className="recent">
          {recent.length === 0 ? (
            <li className="recent-empty">
              还没有搜索记录
              <br />
              搜索一次后会自动出现在这里
            </li>
          ) : (
            recent.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="recent-item"
                  title={`${h.query}\n${h.at}`}
                  onClick={() => {
                    session.restoreHistory(h);
                    onNavigate?.();
                  }}
                >
                  <span className="rq">{h.query}</span>
                  {h.results?.length ? <span className="rn">{h.results.length}</span> : null}
                  <span className="rt">{formatRelative(h.at)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="side-foot">
        <div
          className="key-state"
          title={
            app.settings.demo
              ? '演示模式：使用内置样例数据，不会发起真实请求'
              : app.hasKey
                ? `已保存密钥（${app.keyHint}）`
                : '尚未配置 API Key，请到「设置」中填写'
          }
        >
          <span className={cx('dot', keyDotClass({ hasKey: app.hasKey, demo: app.settings.demo }))} />
          <span>
            {app.settings.demo ? '演示模式' : app.hasKey ? `密钥 ${app.keyHint}` : '密钥未设置'}
          </span>
        </div>
        <div className="side-actions">
          <button
            type="button"
            className="icon-btn"
            title={app.theme === 'dark' ? '当前深色主题，点击切换到浅色 (Ctrl+J)' : '当前浅色主题，点击切换到深色 (Ctrl+J)'}
            aria-label={app.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            onClick={app.toggleTheme}
          >
            {app.theme === 'dark' ? <IconMoon size={17} /> : <IconSun size={17} />}
          </button>
        </div>
      </div>
    </aside>
  );
}
