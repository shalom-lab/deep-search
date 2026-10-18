/**
 * IndexedDB 持久化：历史、统计、搜索/抓取缓存等偏大数据。
 * API Key 与其它轻量 BYOK/扁平偏好仍走 localStorage（见 store.js）。
 *
 * 单一 object store `kv`，按字符串键存值；写入失败通过 storageEvents 广播，
 * 由 UI 层弹出 toast（存储满 / IDB 不可用）。
 */
import { createEmitter } from './util.js';

export const IDB_NAME = 'deepseek-deepsearch';
export const IDB_VERSION = 1;
export const IDB_STORE = 'kv';

/** 业务数据键（均在 IndexedDB，不再长期占用 localStorage 配额） */
export const IDB_KEYS = {
  history: 'history',
  usage: 'usage',
  cache: 'cache',
  fetches: 'fetches',
};

/** 启动时若 IDB 空、旧 localStorage 还有这些大键，则迁移后删除 */
export const LEGACY_LS_DATA_KEYS = [
  'deepseek-deepsearch-history',
  'deepseek-deepsearch-usage',
  'deepseek-deepsearch-cache',
  'deepseek-deepsearch-fetches',
];

export const storageEvents = createEmitter();

let dbPromise = null;
let migratePromise = null;

function canUseIdb() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb() {
  if (!canUseIdb()) {
    return Promise.reject(Object.assign(new Error('IndexedDB 不可用'), { code: 'unavailable' }));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(IDB_NAME, IDB_VERSION);
    } catch (err) {
      dbPromise = null;
      reject(Object.assign(err instanceof Error ? err : new Error(String(err)), { code: 'unavailable' }));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(Object.assign(req.error || new Error('IndexedDB 打开失败'), { code: 'unavailable' }));
    };
    req.onblocked = () => {
      /* 其它标签页升版本时可能阻塞；保持等待 */
    };
  });
  return dbPromise;
}

function classifyError(err) {
  const name = err?.name || '';
  const msg = String(err?.message || err || '');
  if (
    name === 'QuotaExceededError'
    || /quota/i.test(msg)
    || err?.code === 22
  ) {
    return 'quota';
  }
  if (err?.code === 'unavailable' || name === 'InvalidStateError' || /IndexedDB|indexedDB/i.test(msg)) {
    return 'unavailable';
  }
  return 'write_failed';
}

export function notifyStorageError(err, context = '') {
  const reason = classifyError(err);
  const titles = {
    quota: '本机存储空间已满',
    unavailable: '本机 IndexedDB 不可用',
    write_failed: '本机数据写入失败',
  };
  const texts = {
    quota: '历史、缓存或统计未能保存。请清理浏览器站点数据后重试。',
    unavailable: '历史与缓存无法持久化（隐私模式或策略禁用）。密钥仍可用 localStorage。',
    write_failed: context ? `${context}未能保存。` : '部分数据未能保存到本机。',
  };
  storageEvents.emit('error', {
    reason,
    title: titles[reason] || titles.write_failed,
    text: texts[reason] || texts.write_failed,
    error: err,
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 请求失败'));
  });
}

/** @returns {Promise<any>} */
export async function idbGet(key, fallback = null) {
  try {
    const db = await openDb();
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const value = await reqToPromise(store.get(key));
    return value === undefined ? fallback : value;
  } catch (err) {
    notifyStorageError(err, `读取 ${key}`);
    return fallback;
  }
}

/** @returns {Promise<boolean>} 是否写入成功 */
export async function idbSet(key, value) {
  try {
    const db = await openDb();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    if (value === undefined || value === null) {
      await reqToPromise(store.delete(key));
    } else {
      await reqToPromise(store.put(value, key));
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB 事务失败'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 事务中止'));
    });
    return true;
  } catch (err) {
    notifyStorageError(err, `写入 ${key}`);
    return false;
  }
}

export async function idbDel(key) {
  return idbSet(key, null);
}

/** 清空本库全部业务键（wipe 用） */
export async function idbClearAll() {
  try {
    const db = await openDb();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    await reqToPromise(store.clear());
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB clear 失败'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB clear 中止'));
    });
    return true;
  } catch (err) {
    notifyStorageError(err, '清空 IndexedDB');
    return false;
  }
}

function readLegacyLsJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function removeLegacyLsKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * 若 IDB 尚无业务数据、而旧 localStorage 仍有历史/缓存等大键，则一次性迁入并删除旧键。
 * 密钥与扁平偏好键保留不动。幂等：已有 IDB 数据则只清遗留 LS 大键。
 */
export function ensureMigrated() {
  if (migratePromise) return migratePromise;
  migratePromise = (async () => {
    if (!canUseIdb()) {
      notifyStorageError(Object.assign(new Error('IndexedDB 不可用'), { code: 'unavailable' }));
      return { migrated: false, reason: 'unavailable' };
    }

    const existing = await Promise.all([
      idbGet(IDB_KEYS.history, null),
      idbGet(IDB_KEYS.usage, null),
      idbGet(IDB_KEYS.cache, null),
      idbGet(IDB_KEYS.fetches, null),
    ]);
    const hasIdbData = existing.some((v) => v != null);

    const legacy = {
      history: readLegacyLsJson('deepseek-deepsearch-history'),
      usage: readLegacyLsJson('deepseek-deepsearch-usage'),
      cache: readLegacyLsJson('deepseek-deepsearch-cache'),
      fetches: readLegacyLsJson('deepseek-deepsearch-fetches'),
    };
    const hasLegacy = Object.values(legacy).some((v) => v !== undefined);

    if (!hasIdbData && hasLegacy) {
      const stripContent = (list) => {
        if (!Array.isArray(list)) return list;
        return list.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const next = { ...item };
          if (Array.isArray(next.results)) {
            next.results = next.results.map((r) => (r && typeof r === 'object' ? { ...r, content: '' } : r));
          }
          return next;
        });
      };

      if (legacy.history !== undefined) {
        await idbSet(IDB_KEYS.history, stripContent(legacy.history));
      }
      if (legacy.usage !== undefined) {
        await idbSet(IDB_KEYS.usage, legacy.usage);
      }
      if (legacy.cache !== undefined) {
        const cache = legacy.cache;
        if (cache && typeof cache === 'object' && Array.isArray(cache.results)) {
          await idbSet(IDB_KEYS.cache, {
            ...cache,
            results: cache.results.map((r) => (r && typeof r === 'object' ? { ...r, content: '' } : r)),
          });
        } else {
          await idbSet(IDB_KEYS.cache, cache);
        }
      }
      if (legacy.fetches !== undefined) {
        await idbSet(IDB_KEYS.fetches, legacy.fetches);
      }
    }

    // 无论是否迁入，只要旧大键还在就删掉，避免继续撑爆 localStorage
    if (hasLegacy) {
      LEGACY_LS_DATA_KEYS.forEach(removeLegacyLsKey);
    }

    return { migrated: !hasIdbData && hasLegacy, reason: 'ok' };
  })().catch((err) => {
    migratePromise = null;
    notifyStorageError(err, '迁移旧数据');
    return { migrated: false, reason: 'error' };
  });
  return migratePromise;
}

/** 历史快照强制去掉 content，避免长期堆满 */
export function stripResultContent(results) {
  if (!Array.isArray(results)) return [];
  return results.map((r) => (r && typeof r === 'object' ? { ...r, content: '' } : r));
}
