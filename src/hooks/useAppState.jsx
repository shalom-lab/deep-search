/** 全局交互状态：搜索会话与详情抽屉。 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DeepSeekError, searchWeb, describeError, validateQuery } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { IDB_KEYS, idbSet, idbGet, ensureMigrated, stripResultContent, storageEvents } from '../lib/idb.js';
import { deepClone, makeId } from '../lib/util.js';
import { useUI } from '../components/UIProvider.jsx';

const SEARCH_INIT = {
  query: '',
  results: [],
  meta: null,
  loading: false,
  error: null,
  lastParams: null,
  startedAt: null,
  elapsedMs: 0,
};

const SearchContext = createContext(null);
const DrawerContext = createContext(null);

export function AppStateProvider({ children }) {
  const app = useApp();
  const { toast } = useUI();
  const [search, setSearch] = useState(() => {
    // 首帧：旧 LS 缓存兜底（SSR / 迁移前）；之后由 IDB effect 接管
    try {
      const raw = localStorage.getItem('deepseek-deepsearch-cache');
      if (!raw) return SEARCH_INIT;
      const cached = JSON.parse(raw);
      if (!cached?.query) return SEARCH_INIT;
      return {
        ...SEARCH_INIT,
        query: cached.query,
        results: Array.isArray(cached.results) ? stripResultContent(cached.results) : [],
        meta: cached.meta || null,
      };
    } catch {
      return SEARCH_INIT;
    }
  });
  const abortRef = useRef(null);
  const tickRef = useRef(null);
  const cacheHydrated = useRef(false);

  // 存储失败 → 可见 toast
  useEffect(() => {
    return storageEvents.on('error', (payload) => {
      toast({
        tone: 'err',
        title: payload?.title || '本机数据写入失败',
        text: payload?.text || '历史或缓存未能保存。',
        duration: 8000,
      });
    });
  }, [toast]);

  // 从 IndexedDB 恢复搜索缓存（迁移完成后）
  useEffect(() => {
    let alive = true;
    (async () => {
      await ensureMigrated();
      if (!alive) return;
      const cached = await idbGet(IDB_KEYS.cache, null);
      if (!alive || !cached?.query || cacheHydrated.current) return;
      cacheHydrated.current = true;
      setSearch((prev) => {
        if (prev.query || prev.loading) return prev;
        return {
          ...SEARCH_INIT,
          query: cached.query,
          results: Array.isArray(cached.results) ? stripResultContent(cached.results) : [],
          meta: cached.meta || null,
        };
      });
    })();
    return () => {
      alive = false;
    };
  }, [app.dataEpoch]);

  // 请求进行中让“已用时”走字
  useEffect(() => {
    if (search.loading) {
      const started = search.startedAt || Date.now();
      tickRef.current = setInterval(() => {
        setSearch((prev) => (prev.loading ? { ...prev, elapsedMs: Date.now() - started } : prev));
      }, 100);
    } else if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [search.loading, search.startedAt]);

  // 只缓存轻量元信息 + 结果快照（强制去掉 content）
  useEffect(() => {
    if (!search.query || search.loading) return;
    const light = stripResultContent(search.results);
    void idbSet(IDB_KEYS.cache, { query: search.query, results: light, meta: search.meta });
  }, [search.query, search.results, search.meta, search.loading]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSearch((prev) => ({ ...prev, loading: false }));
  }, []);

  /**
   * 执行搜索。
   * @param {{query?:string, count?:number, needContent?:boolean, oriQuestion?:string, localization?:string, recordHistory?:boolean, quiet?:boolean}} [opts]
   */
  const runSearch = useCallback(
    async (opts = {}) => {
      const query = String(opts.query ?? search.query ?? '').trim();
      const validation = validateQuery(query);
      if (!validation.ok) {
        toast({ tone: 'warn', title: '搜索词不合法', text: validation.message });
        setSearch((prev) => ({ ...prev, error: { code: 'invalid_request', title: '搜索词不合法', hint: validation.message, detail: '', retryable: false } }));
        return;
      }

      const needContent = opts.needContent ?? app.settings.needContent;
      const count = opts.count ?? app.count;
      const ori = opts.oriQuestion ?? (app.settings.deepIntent ? app.settings.oriQuestion || query : '');

      const params = {
        query,
        count,
        needContent,
        oriQuestion: ori,
        localization: opts.localization ?? app.settings.localization,
      };

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const startedAt = Date.now();
      setSearch((prev) => ({ ...prev, query, loading: true, error: null, lastParams: params, startedAt, elapsedMs: 0 }));

      try {
        const data = await searchWeb({
          ...params,
          apiKey: app.apiKey,
          base: app.base,
          proxyAvailable: app.proxy.ok,
          demo: app.settings.demo,
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        setSearch((prev) => ({
          ...prev,
          query,
          results: data.results,
          meta: {
            latencyMs: data.latencyMs,
            transport: data.transport,
            demo: data.demo,
            needContent: data.needContent,
            usedOri: data.usedOri,
            localization: data.localization,
            fetchedAt: data.fetchedAt,
            count: data.count,
          },
          loading: false,
          error: null,
          elapsedMs: data.latencyMs,
        }));

        app.recordUsage({ kind: 'search', ok: true, resultCount: data.results.length, latencyMs: data.latencyMs });

        if (data.results.length === 0) {
          toast({ tone: 'info', title: '没有匹配结果', text: '搜索正常结束但未召回结果，试试更换关键词或放宽限定条件。' });
        } else if (!opts.quiet) {
          toast({
            tone: 'ok',
            title: `找到 ${data.results.length} 条结果`,
            text: `用时 ${(data.latencyMs / 1000).toFixed(2)}s · 传输 ${data.transport === 'demo' ? '演示数据' : data.transport === 'proxy' ? '本地转发' : '直连'}`,
          });
        }

        if (app.settings.recordHistory && opts.recordHistory !== false) {
          app.pushHistory({
            query,
            count,
            needContent: data.needContent,
            transport: data.transport,
            latencyMs: data.latencyMs,
            demo: data.demo,
            results: data.results,
          });
        }
      } catch (err) {
        if (err?.code === 'aborted' || controller.signal.aborted) return;
        const described = err instanceof DeepSeekError ? { ...describeError(err), retryAfter: err.retryAfter } : describeError(err);
        setSearch((prev) => ({ ...prev, loading: false, error: described, elapsedMs: Date.now() - startedAt }));
        app.recordUsage({ kind: 'search', ok: false, latencyMs: Date.now() - startedAt });
        toast({
          tone: 'err',
          title: described.title,
          text: described.hint,
          actions: described.action === 'settings' ? [{ label: '去设置', primary: true }] : undefined,
        });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [app, search.query, toast],
  );

  const setQuery = useCallback((value) => {
    setSearch((prev) => ({ ...prev, query: value }));
  }, []);

  /** 从历史恢复一次搜索（不重新请求，直接展示已存快照） */
  const restoreHistory = useCallback((entry) => {
    setSearch((prev) => ({
      ...prev,
      query: entry.query,
      results: Array.isArray(entry.results) ? deepClone(entry.results) : [],
      meta: {
        latencyMs: entry.latencyMs || 0,
        transport: entry.transport || 'history',
        demo: Boolean(entry.demo),
        needContent: Boolean(entry.needContent),
        count: entry.count || (entry.results?.length ?? 0),
        fetchedAt: entry.at,
        fromHistory: true,
      },
      loading: false,
      error: null,
      elapsedMs: entry.latencyMs || 0,
    }));
  }, []);

  const clearSearch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSearch(SEARCH_INIT);
    cacheHydrated.current = true;
    void idbSet(IDB_KEYS.cache, null);
  }, []);

  /* ── 详情抽屉 ── */
  const [drawer, setDrawer] = useState({ open: false, item: null, loading: false, error: null, view: 'summary' });

  const openDrawer = useCallback((item, view = 'summary') => {
    // 每次打开都分配唯一 id：抽屉依赖 item.id 来判断「换了一条内容」，
    // 否则重复打开同一结果时不会重置已抓取的正文、也不会再次自动抓取。
    setDrawer({ open: true, item: { ...item, id: makeId('d') }, loading: false, error: null, view });
  }, []);

  const setDrawerData = useCallback((patch) => {
    setDrawer((prev) => ({ ...prev, ...patch }));
  }, []);

  const closeDrawer = useCallback(() => {
    setDrawer((prev) => ({ ...prev, open: false }));
  }, []);

  const searchValue = useMemo(
    () => ({ ...search, runSearch, setQuery, cancel, restoreHistory, clearSearch, setSearch }),
    [search, runSearch, setQuery, cancel, restoreHistory, clearSearch],
  );

  const drawerValue = useMemo(
    () => ({ ...drawer, openDrawer, closeDrawer, setDrawerData, setView: (view) => setDrawer((prev) => ({ ...prev, view })) }),
    [drawer, openDrawer, closeDrawer, setDrawerData],
  );

  return (
    <SearchContext.Provider value={searchValue}>
      <DrawerContext.Provider value={drawerValue}>{children}</DrawerContext.Provider>
    </SearchContext.Provider>
  );
}

export function useSearchSession() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearchSession 必须在 <AppStateProvider> 内使用');
  return ctx;
}

export function useDrawer() {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error('useDrawer 必须在 <AppStateProvider> 内使用');
  return ctx;
}

/** 生成一个用于展示的抽屉条目（并统一补齐字段） */
export function buildDrawerItem(kind, payload) {
  return { id: makeId('d'), kind, ...payload };
}

// 同 store.js：本模块定义 Context，热替换会产生新实例导致已挂载的 Provider
// 与子组件不匹配，故要求整页刷新。
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}
