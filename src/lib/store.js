/**
 * 应用状态：BYOK 密钥、偏好、搜索历史与用量。
 *
 * 密钥和每一项配置都是独立的 localStorage 键，启动只读、不验证、不回写。
 * 密钥只在设置页保存且连接验证通过后写入；请求失败不会改动已存密钥。
 * 历史与用量属于业务数据，仍各自一份 JSON。
 *
 * 旧键 deepseek-deepsearch-settings（整包 JSON）只在启动时兜底读取，不再写入。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_BASE, PRICE_PER_1000, clampCount, probeProxy } from './api.js';
import { deepClone, makeId } from './util.js';

export const STORAGE_KEYS = {
  key: 'deepseek-deepsearch-key',
  base: 'deepseek-deepsearch-base',
  theme: 'deepseek-deepsearch-theme',
  history: 'deepseek-deepsearch-history',
  usage: 'deepseek-deepsearch-usage',
  count: 'deepseek-deepsearch-count',
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
  'count', 'transport', 'needContent', 'deepIntent', 'oriQuestion', 'localization',
  'recordHistory', 'rememberResults', 'highlight', 'demo', 'sort', 'filter',
];
const TRANSPORTS = new Set(['auto', 'proxy', 'direct']);
const SORTS = new Set(['score', 'authority', 'fresh', 'site']);
const FILTERS = new Set(['0', '1.5', '2', 'auth3']);

export const DEFAULT_SETTINGS = {
  count: 10,
  transport: 'auto',
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
  fetchCalls: 0,
  fetchErrors: 0,
  fetchChars: 0,
  latencySum: 0,
  latencyCount: 0,
  since: null,
  lastAt: null,
  daily: {},
};

const HISTORY_LIMIT = 60;

/* ─────────────────────────── 底层读写 ─────────────────────────── */

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
  } catch {
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

  const transport = from('transport');
  const sort = from('sort');
  const filter = from('filter');
  const ori = from('oriQuestion');
  const loc = from('localization');

  return {
    count: from('count') === undefined ? DEFAULT_SETTINGS.count : clampCount(from('count')),
    transport: TRANSPORTS.has(transport) ? transport : DEFAULT_SETTINGS.transport,
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
  } catch {
    return false;
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/* ─────────────────────────── Context ─────────────────────────── */

const AppContext = createContext(null);

export function AppProvider({ children }) {
  // bootstrap：首帧就同步读入，避免“先空后填”的闪烁
  const [apiKey, setApiKeyState] = useState(() => readText(STORAGE_KEYS.key));
  const [base, setBaseState] = useState(() => readText(STORAGE_KEYS.base, DEFAULT_BASE) || DEFAULT_BASE);
  const [settings, setSettingsState] = useState(readSettings);
  const [history, setHistoryState] = useState(() => readJSON(STORAGE_KEYS.history, []));
  const [usage, setUsageState] = useState(() => ({ ...EMPTY_USAGE, ...readJSON(STORAGE_KEYS.usage, {}) }));
  const [theme, setThemeState] = useState(() => document.documentElement.dataset.theme || 'dark');
  const [proxy, setProxy] = useState({ checked: false, ok: false, upstream: DEFAULT_BASE });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
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
      if (!TRANSPORTS.has(next.transport)) next.transport = DEFAULT_SETTINGS.transport;
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

  /** 追加一条搜索历史（含结果快照，便于离线回看） */
  const pushHistory = useCallback(
    (entry) => {
      setHistoryState((prev) => {
        const record = {
          id: makeId('h'),
          at: new Date().toISOString(),
          ...entry,
          results: settings.rememberResults ? deepClone(entry.results || []).slice(0, 50) : [],
        };
        const next = [record, ...prev.filter((item) => item.query !== record.query)].slice(0, HISTORY_LIMIT);
        writeJSON(STORAGE_KEYS.history, next);
        return next;
      });
    },
    [settings.rememberResults],
  );

  const removeHistory = useCallback((id) => {
    setHistoryState((prev) => {
      const next = prev.filter((item) => item.id !== id);
      writeJSON(STORAGE_KEYS.history, next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistoryState([]);
    writeJSON(STORAGE_KEYS.history, []);
  }, []);

  /** 记录一次调用（成功或失败） */
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
        fetchChars: prev.fetchChars + (patch.kind === 'fetch' && patch.ok ? patch.chars || 0 : 0),
        latencySum: prev.latencySum + (Number.isFinite(patch.latencyMs) ? patch.latencyMs : 0),
        latencyCount: prev.latencyCount + (Number.isFinite(patch.latencyMs) ? 1 : 0),
      };
      writeJSON(STORAGE_KEYS.usage, next);
      return next;
    });
  }, []);

  const resetUsage = useCallback(() => {
    setUsageState(EMPTY_USAGE);
    writeJSON(STORAGE_KEYS.usage, EMPTY_USAGE);
  }, []);

  const wipeAll = useCallback(() => {
    setApiKeyState('');
    setBaseState(DEFAULT_BASE);
    setSettingsState(DEFAULT_SETTINGS);
    setHistoryState([]);
    setUsageState(EMPTY_USAGE);
    Object.values(STORAGE_KEYS).forEach((key) => {
      if (key !== STORAGE_KEYS.theme) writeText(key, '');
    });
    writeText(LEGACY_SETTINGS_KEY, '');
  }, []);

  const derived = useMemo(() => {
    const totalCalls = usage.searchCalls + usage.fetchCalls;
    const billable = usage.searchCalls - usage.searchErrors + (usage.fetchCalls - usage.fetchErrors);
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

      // 危险操作
      wipeAll,
    }),
    [
      // hasKey / keyHint 都由 apiKey 派生，只需把 apiKey 列为依赖
      apiKey, setApiKey, clearApiKey, base, setBase,
      settings, updateSettings, resetSettings,
      theme, toggleTheme, proxy,
      history, pushHistory, removeHistory, clearHistory,
      usage, recordUsage, resetUsage, derived, wipeAll,
    ],
  );

  return React.createElement(AppContext.Provider, { value }, children);
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp 必须在 <AppProvider> 内使用');
  return ctx;
}

export { readJSON, writeJSON, readText, writeText, HISTORY_LIMIT, PRICE_PER_1000 };

// 本模块导出的是 React Context 本身。热替换会让它重新求值并产生新的 Context 实例，
// 而已经挂载的 <AppProvider> 仍然持有旧实例，子组件 useContext 就会拿到 null
// （表现为「明明包在 Provider 里却报 useApp 必须在 AppProvider 内使用」）。
// 因此改动本文件时直接整页刷新，不做局部热替换。
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}
