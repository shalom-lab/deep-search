/** 应用外壳：侧栏 + 顶栏搜索 + 路由视图 + 状态栏 + 详情抽屉。 */
import React, { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Sidebar from './layout/Sidebar.jsx';
import SearchBar from './layout/SearchBar.jsx';
import DetailDrawer from './layout/DetailDrawer.jsx';
import SearchPage from './pages/SearchPage.jsx';
import FetchPage from './pages/FetchPage.jsx';
import HistoryPage from './pages/HistoryPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import { ConfirmModal } from './components/common.jsx';
import { IconMenu, IconRefresh, IconSearch } from './components/Icon.jsx';
import { useApp } from './lib/store.js';
import { useSearchSession } from './hooks/useAppState.jsx';
import { cx, formatClock, formatDuration } from './lib/util.js';

const TITLES = {
  '/': '搜索',
  '/fetch': '抓取',
  '/history': '历史',
  '/settings': '设置',
};

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export default function App() {
  const app = useApp();
  const session = useSearchSession();
  const location = useLocation();
  const isMobile = useMediaQuery('(max-width: 1024px)');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    document.title = `${TITLES[location.pathname] || 'DeepSearch'} · DeepSearch`;
  }, [location.pathname]);

  // 切换路由时在高分辨率下保持侧栏展开，移动端收起
  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  const closeSidebar = () => isMobile && setSidebarOpen(false);

  const statusKey = app.settings.demo
    ? { cls: 'demo', text: '演示模式' }
    : !app.hasKey
      ? { cls: 'err', text: '未设置密钥' }
      : { cls: 'on', text: `密钥已就绪 · ${app.keyHint}` };

  return (
    <div className="app">
      <Sidebar open={sidebarOpen} onNavigate={closeSidebar} />

      <main className="main">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="icon-btn only-mobile"
              aria-label="打开侧栏"
              onClick={() => setSidebarOpen((v) => !v)}
            >
              <IconMenu size={18} />
            </button>
            <SearchBar />
          </div>
        </header>

        <div className="scroll-area">
          <Routes>
            <Route path="/" element={<SearchPage />} />
            <Route path="/fetch" element={<FetchPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>

        <footer className="statusbar">
          <div className="sb-left">
            <span className="sb-item" title={app.settings.demo ? '当前使用内置演示数据' : app.hasKey ? `密钥：${app.keyHint}` : '未配置 API Key'}>
              <span className={cx('dot', statusKey.cls)} />
              {statusKey.text}
            </span>
            <span className="sb-item" title="搜索接口调用次数 / 抓取接口调用次数">
              搜索 {app.usage.searchCalls} · 抓取 {app.usage.fetchCalls}
            </span>
            <span className="sb-item" title="最近一次调用时间">
              最近调用 {app.usage.lastAt ? formatClock(app.usage.lastAt) : '—'}
            </span>
          </div>
          <div className="sb-right">
            <span className="sb-item" title="估算花费（每 1000 次成功请求 5 元）">
              估算 ¥{app.derived.estimatedCost.toFixed(3)}
            </span>
            {session.loading ? (
              <span className="sb-item accent">
                <IconRefresh size={12} /> 搜索中 {formatDuration(session.elapsedMs)}
              </span>
            ) : session.meta?.latencyMs ? (
              <span className="sb-item accent" title="最近一次搜索耗时">
                <IconSearch size={12} /> {formatDuration(session.meta.latencyMs)}
                {session.meta.transport === 'proxy' ? ' · 本地转发' : session.meta.transport === 'direct' ? ' · 直连' : session.meta.transport === 'demo' ? ' · 演示' : ''}
              </span>
            ) : null}
          </div>
        </footer>
      </main>

      <DetailDrawer />
      <ConfirmModal />
    </div>
  );
}
