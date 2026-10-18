import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { AppProvider } from './lib/store.js';
import { UIProvider } from './components/UIProvider.jsx';
import { AppStateProvider } from './hooks/useAppState.jsx';
import { Toaster } from './components/common.jsx';
import './styles/global.css';

// HashRouter：无需服务端路由配置，静态托管 / file:// 直接打开都能工作。
// ErrorBoundary 放在最外层，连 Provider 初始化失败也能被兜住（否则就是白屏）。
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <UIProvider>
          <AppStateProvider>
            <HashRouter>
              <App />
            </HashRouter>
            <Toaster />
          </AppStateProvider>
        </UIProvider>
      </AppProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
