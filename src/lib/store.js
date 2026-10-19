/**
 * 应用状态：BYOK 密钥、偏好、搜索历史与用量。
 *
 * 密钥与轻量扁平偏好：独立 localStorage 键，启动只读、不验证、不回写密钥。
 * 历史、统计等偏大数据：IndexedDB（见 idb.js）；首次打开可从旧 LS 大键迁移。
 * 密钥只在设置页保存且连接验证通过后写入；请求失败不会改动已存密钥。
 *
 * 旧键 deepseek-deepsearch-settings（整包 JSON）只在启动时兜底读取，不再写入。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_BASE, PRICE_PER_1000, clampCount, probeProxy } from './api.js';
import { deepClone, makeId } from './util.js';
import {
  IDB_KEYS,
  LEGACY_LS_DATA_KEYS,
  ensureMigrated,
  idbClearAll,
  idbGet,
  idbSet,
  stripResultContent,
  storageEvents,
} from './idb.js';

export const STORAGE_KEYS = {
  key: 'deepseek-deepsearch-key',
  base: 'deepseek-deepsearch-base',
  theme: 'deepseek-deepsearch-theme',
  // 以下大键仅用于迁移识别 / 文档；运行时读写已迁至 IndexedDB
  history: 'deepseek-deepsearch-history',
  usage: 'deepseek-deepsearch-usage',
  count: 'deepseek-deepsearch-count',
  // 旧传输方式键：仅 wipeAll 时清掉，UI/偏好不再读写
  transport: 'deepseek-deepsearch-transport',
  needContent: 'deepseek-deepsearch-need-content',
  deepIntent: 'deepseek-deepsearch-deep-intent',
  oriQuestion: 'deepseek-deepsearch-ori-question',
  localization: 'deepseek-deepsearch-localization',
  recordHistory: 'deepseek-deepsearch-record-history',
  rememberResults: 'deepseek-deepsearch-remember-results',
  highlight: 'deepseek-deepsearch-highlight',
  demo: 'deepseek-deepsearch-demo',
  sort: 'deepseek-deepsearch-sort',
  filter: 'deepseek-deepsearch-filter',
};

/** 旧版把偏好合成一个 JSON。启动可读，保存时不再写回。 */
export const LEGACY_SETTINGS_KEY = 'deepseek-deepsearch-settings';

const PREF_FIELDS = [
  'count', 'needContent', 'deepIntent', 'oriQuestion', 'localization',
  'recordHistory', 'rememberResults', 'highlight', 'demo', 'sort', 'filter',
];
const SORTS = new Set(['score', 'authority', 'fresh', 'site']);
const FILTERS = new Set(['0', '1.5', '2', 'auth3']);

export const DEFAULT_SETTINGS = {
  count: 10,
  needContent: false,
  deepIntent: true,
  oriQuestion: '',
  localization: '',
  recordHistory: true,
  rememberResults: true,
  highlight: true,
  demo: false,
  sort: 'score',
  filter: '0',
};

export const EMPTY_USAGE = {
  searchCalls: 0,
  searchErrors: 0,
  searchResults: 0,
  searchBillable: 0,
  fetchCalls: 0,
  fetchErrors: 0,
  fetchBillable: 0,
  fetchChars: 0,
  latencySum: 0,
  latencyCount: 0,
  since: null,
  lastAt: null,
  daily: {},
};

const HISTORY_LIMIT = 60;

/* ─────────────────────────── 底层读写（localStorage：密钥与扁平偏好） ─────────────────────────── */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    storageEvents.emit('error', {
      reason: err?.name === 'QuotaExceededError' ? 'quota' : 'write_failed',
      title: err?.name === 'QuotaExceededError' ? '本机存储空间已满' : '本机数据写入失败',
      text: '偏好或密钥未能写入 localStorage。',
      error: err,
    });
    return false;
  }
}

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readText(key, fallback = '') {
  return readRaw(key) ?? fallback;
}

function toBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return fallback;
}

function serializePref(field, value) {
  if (field === 'needContent' || field === 'deepIntent' || field === 'recordHistory' || field === 'rememberResults' || field === 'highlight' || field === 'demo') {
    return value ? 'true' : 'false';
  }
  return String(value ?? '');
}

/** 扁平键优先；缺省时才看旧 JSON。启动过程不写回。 */
function readSettings() {
  const legacy = readJSON(LEGACY_SETTINGS_KEY, {});
  const from = (field) => {
    const flat = readRaw(STORAGE_KEYS[field]);
    if (flat !== null) return flat;
    if (legacy && Object.prototype.hasOwnProperty.call(legacy, field)) return legacy[field];
    return undefined;
  };

  const sort = from('sort');
  const filter = from('filter');
  const ori = from('oriQuestion');
  const loc = from('localization');

  return {
    count: from('count') === undefined ? DEFAULT_SETTINGS.count : clampCount(from('count')),
    needContent: toBool(from('needContent'), DEFAULT_SETTINGS.needContent),
    deepIntent: toBool(from('deepIntent'), DEFAULT_SETTINGS.deepIntent),
    oriQuestion: ori == null ? '' : String(ori).slice(0, 128),
    localization: loc == null ? '' : String(loc),
    recordHistory: toBool(from('recordHistory'), DEFAULT_SETTINGS.recordHistory),
    rememberResults: toBool(from('rememberResults'), DEFAULT_SETTINGS.rememberResults),
    highlight: toBool(from('highlight'), DEFAULT_SETTINGS.highlight),
    demo: toBool(from('demo'), DEFAULT_SETTINGS.demo),
    sort: SORTS.has(sort) ? sort : DEFAULT_SETTINGS.sort,
    filter: FILTERS.has(String(filter)) ? String(filter) : DEFAULT_SETTINGS.filter,
  };
}

function writeText(key, value) {
  try {
    if (!value) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch (err) {
    storageEvents.emit('error', {
      reason: err?.name === 'QuotaExceededError' ? 'quota' : 'write_failed',
      title: err?.name === 'QuotaExceededError' ? '本机存储空间已满' : '本机数据写入失败',
      text: '偏好或密钥未能写入 localStorage。',
      error: err,
    });
    return false;
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** 归一化用量；旧数据缺少「有结果才计费」字段时用成功次数兜底一次 */
export function normalizeUsage(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const next = { ...EMPTY_USAGE, ...src, daily: src.daily && typeof src.daily === 'object' ? src.daily : {} };
  if (src.searchBillable == null && (src.searchCalls || src.searchErrors)) {
    next.searchBillable = Math.max(0, (src.searchCalls || 0) - (src.searchErrors || 0));
  }
  if (src.fetchBillable == null && (src.fetchCalls || src.fetchErrors)) {
    next.fetchBillable = Math.max(0, (src.fetchCalls || 0) - (src.fetchErrors || 0));
  }
  next.searchBillable = Number(next.searchBillable) || 0;
  next.fetchBillable = Number(next.fetchBillable) || 0;
  return next;
}

function persistHistory(list) {
  return idbSet(IDB_KEYS.history, list);
}

function persistUsage(data) {
  return idbSet(IDB_KEYS.usage, data);
}

/* ─────────────────────────── Context ─────────────────────────── */

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // 密钥 / 偏好 / 主题：首帧同步读 LS，避免闪烁
  const [apiKey, setApiKeyState] = useState(() => readText(STORAGE_KEYS.key));
  const [base, setBaseState] = useState(() => readText(STORAGE_KEYS.base, DEFAULT_BASE) || DEFAULT_BASE);
  const [settings, setSettingsState] = useState(readSettings);
  // 首帧同步读旧 LS 大键作兜底（SSR / 迁移前无闪烁）；正式读写走 IndexedDB
  const [history, setHistoryState] = useState(() => {
    const legacy = readJSON(STORAGE_KEYS.history, null);
    return Array.isArray(legacy) ? legacy : [];
  });
  const [usage, setUsageState] = useState(() => normalizeUsage(readJSON(STORAGE_KEYS.usage, {})));
  const [theme, setThemeState] = useState(() => document.documentElement.dataset.theme || 'dark');
  const [proxy, setProxy] = useState({ checked: false, ok: false, upstream: DEFAULT_BASE });
  /** 数据世代：wipe / 迁移完成后递增，供缓存页等重读 IDB */
  const [dataEpoch, setDataEpoch] = useState(0);
  const [storageReady, setStorageReady] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // IndexedDB：迁移旧 LS 大键 → 读入历史与用量
  useEffect(() => {
    let alive = true;
    (async () => {
      await ensureMigrated();
      if (!alive) return;
      const [h, u] = await Promise.all([
        idbGet(IDB_KEYS.history, []),
        idbGet(IDB_KEYS.usage, {}),
      ]);
      if (!alive) return;
      setHistoryState(Array.isArray(h) ? h : []);
      setUsageState(normalizeUsage(u));
      setStorageReady(true);
      setDataEpoch((n) => n + 1);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 探测本地转发是否可用（静默，不阻塞渲染）
  useEffect(() => {
    let alive = true;
    probeProxy().then((result) => {
      if (alive) setProxy({ checked: true, ok: Boolean(result.ok), upstream: result.upstream || DEFAULT_BASE });
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setApiKey = useCallback((value) => {
    const next = String(value ?? '').trim();
    setApiKeyState(next);
    writeText(STORAGE_KEYS.key, next);
    return next;
  }, []);

  const clearApiKey = useCallback(() => {
    setApiKeyState('');
    writeText(STORAGE_KEYS.key, '');
  }, []);

  const setBase = useCallback((value) => {
    const next = String(value ?? '').trim().replace(/\/+$/, '') || DEFAULT_BASE;
    setBaseState(next);
    writeText(STORAGE_KEYS.base, next);
  }, []);

  const updateSettings = useCallback((patch) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
      next.count = clampCount(next.count);
      if (!SORTS.has(next.sort)) next.sort = DEFAULT_SETTINGS.sort;
      if (!FILTERS.has(String(next.filter))) next.filter = DEFAULT_SETTINGS.filter;
      next.oriQuestion = String(next.oriQuestion ?? '').slice(0, 128);
      const changed = PREF_FIELDS.some((field) => next[field] !== prev[field]);
      if (changed && readRaw(LEGACY_SETTINGS_KEY)) {
        PREF_FIELDS.forEach((field) => writeText(STORAGE_KEYS[field], serializePref(field, next[field])));
        writeText(LEGACY_SETTINGS_KEY, '');
      } else {
        for (const field of PREF_FIELDS) {
          if (next[field] !== prev[field]) writeText(STORAGE_KEYS[field], serializePref(field, next[field]));
        }
      }
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettingsState(DEFAULT_SETTINGS);
    PREF_FIELDS.forEach((field) => writeText(STORAGE_KEYS[field], ''));
    writeText(LEGACY_SETTINGS_KEY, '');
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      writeText(STORAGE_KEYS.theme, next);
      return next;
    });
  }, []);

  /** 追加一条搜索历史（快照强制清 content，避免长期堆满） */
  const pushHistory = useCallback(
    (entry) => {
      setHistoryState((prev) => {
        const rawResults = settings.rememberResults ? deepClone(entry.results || []).slice(0, 50) : [];
        const record = {
          id: makeId('h'),
          at: new Date().toISOString(),
          ...entry,
          results: stripResultContent(rawResults),
        };
        const next = [record, ...prev.filter((item) => item.query !== record.query)].slice(0, HISTORY_LIMIT);
        void persistHistory(next);
        return next;
      });
    },
    [settings.rememberResults],
  );

  const removeHistory = useCallback((id) => {
    setHistoryState((prev) => {
      const next = prev.filter((item) => item.id !== id);
      void persistHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistoryState([]);
    void persistHistory([]);
  }, []);

  /** 记录一次调用（成功或失败）；计费仅统计「有结果」的成功请求 */
  const recordUsage = useCallback((patch) => {
    setUsageState((prev) => {
      const day = todayKey();
      const daily = { ...(prev.daily || {}) };
      const bucket = { search: 0, fetch: 0, errors: 0, ...(daily[day] || {}) };
      if (patch.kind === 'search') {
        bucket.search += 1;
        if (patch.ok) bucket.results = (bucket.results || 0) + (patch.resultCount || 0);
      }
      if (patch.kind === 'fetch') bucket.fetch += 1;
      if (!patch.ok) bucket.errors += 1;
      daily[day] = bucket;

      // 只保留最近 30 天
      const keys = Object.keys(daily).sort();
      while (keys.length > 30) delete daily[keys.shift()];

      const searchHadResults = patch.kind === 'search' && patch.ok && (patch.resultCount || 0) > 0;
      const fetchHadContent = patch.kind === 'fetch' && patch.ok && (patch.chars || 0) > 0;

      const next = {
        ...prev,
        daily,
        since: prev.since || new Date().toISOString(),
        lastAt: new Date().toISOString(),
        searchCalls: prev.searchCalls + (patch.kind === 'search' ? 1 : 0),
        fetchCalls: prev.fetchCalls + (patch.kind === 'fetch' ? 1 : 0),
        searchErrors: prev.searchErrors + (patch.kind === 'search' && !patch.ok ? 1 : 0),
        fetchErrors: prev.fetchErrors + (patch.kind === 'fetch' && !patch.ok ? 1 : 0),
        searchResults: prev.searchResults + (patch.kind === 'search' && patch.ok ? patch.resultCount || 0 : 0),
        searchBillable: (prev.searchBillable || 0) + (searchHadResults ? 1 : 0),
        fetchBillable: (prev.fetchBillable || 0) + (fetchHadContent ? 1 : 0),
        fetchChars: prev.fetchChars + (patch.kind === 'fetch' && patch.ok ? patch.chars || 0 : 0),
        latencySum: prev.latencySum + (Number.isFinite(patch.latencyMs) ? patch.latencyMs : 0),
        latencyCount: prev.latencyCount + (Number.isFinite(patch.latencyMs) ? 1 : 0),
      };
      void persistUsage(next);
      return next;
    });
  }, []);

  const resetUsage = useCallback(() => {
    setUsageState(EMPTY_USAGE);
    void persistUsage(EMPTY_USAGE);
  }, []);

  const wipeAll = useCallback(() => {
    setApiKeyState('');
    setBaseState(DEFAULT_BASE);
    setSettingsState(DEFAULT_SETTINGS);
    setHistoryState([]);
    setUsageState(EMPTY_USAGE);

    // localStorage：密钥、偏好、主题以外的遗留大键
    Object.values(STORAGE_KEYS).forEach((key) => {
      if (key !== STORAGE_KEYS.theme) writeText(key, '');
    });
    writeText(LEGACY_SETTINGS_KEY, '');
    LEGACY_LS_DATA_KEYS.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    });

    // IndexedDB：历史 / 统计 / 缓存 / 最近抓取
    void idbClearAll().then(() => {
      if (mounted.current) setDataEpoch((n) => n + 1);
    });
  }, []);

  const derived = useMemo(() => {
    const totalCalls = usage.searchCalls + usage.fetchCalls;
    // 官方：成功且产生结果才计费（Search results 非空 / Fetch 有正文）
    const billable = (usage.searchBillable || 0) + (usage.fetchBillable || 0);
    const avgLatency = usage.latencyCount ? usage.latencySum / usage.latencyCount : 0;
    const errorCount = usage.searchErrors + usage.fetchErrors;
    return {
      totalCalls,
      billable,
      /** 估算花费：成功且产生结果的请求才计费 */
      estimatedCost: (billable / 1000) * PRICE_PER_1000,
      avgLatency,
      errorCount,
      errorRate: totalCalls ? errorCount / totalCalls : 0,
    };
  }, [usage]);

  const value = useMemo(
    () => ({
      // 密钥与基址
      apiKey,
      hasKey: Boolean(apiKey),
      keyHint: apiKey ? `${apiKey.slice(0, 3)}••••${apiKey.slice(-4)}` : '',
      setApiKey,
      clearApiKey,
      base,
      setBase,

      // 偏好
      settings,
      updateSettings,
      resetSettings,
      count: clampCount(settings.count),

      // 主题
      theme,
      setTheme: (value) => {
        const next = value === 'light' ? 'light' : 'dark';
        setThemeState(next);
        writeText(STORAGE_KEYS.theme, next);
      },
      toggleTheme,

      // 传输
      proxy,
      recheckProxy: () => probeProxy().then((r) => setProxy({ checked: true, ok: Boolean(r.ok), upstream: r.upstream || DEFAULT_BASE })),

      // 历史
      history,
      pushHistory,
      removeHistory,
      clearHistory,

      // 用量
      usage,
      recordUsage,
      resetUsage,
      derived,

      // 存储就绪 / 世代（wipe 后供其它页重读）
      storageReady,
      dataEpoch,

      // 危险操作
      wipeAll,
    }),
    [
      apiKey, setApiKey, clearApiKey, base, setBase,
      settings, updateSettings, resetSettings,
      theme, toggleTheme, proxy,
      history, pushHistory, removeHistory, clearHistory,
      usage, recordUsage, resetUsage, derived, wipeAll,
      storageReady, dataEpoch,
    ],
  );

  return React.createElement(AppContext.Provider, { value }, children);
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp 必须在 <AppProvider> 内使用');
  return ctx;
}

export { readJSON, writeJSON, readText, writeText, HISTORY_LIMIT, PRICE_PER_1000, IDB_KEYS };

// 本模块导出的是 React Context 本身。热替换会让它重新求值并产生新的 Context 实例，
// 而已经挂载的 <AppProvider> 仍然持有旧实例，子组件 useContext 就会拿到 null
// （表现为「明明包在 Provider 里却报 useApp 必须在 AppProvider 内使用」）。
// 因此改动本文件时直接整页刷新，不做局部热替换。
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}
