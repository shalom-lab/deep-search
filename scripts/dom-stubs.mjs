/**
 * 浏览器全局打桩：让 React 组件树可以在 Node 里被服务端渲染。
 * 必须在任何业务模块之前 import（ES 模块按 import 声明顺序求值）。
 */
const store = new Map();

globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  get length() {
    return store.size;
  },
  key: (i) => [...store.keys()][i] ?? null,
};

globalThis.window = globalThis;
if (!globalThis.location || typeof globalThis.location !== 'object') {
  globalThis.location = {
    href: 'http://127.0.0.1:5273/deep-search/',
    origin: 'http://127.0.0.1:5273',
    protocol: 'http:',
    host: '127.0.0.1:5273',
    hostname: '127.0.0.1',
    port: '5273',
    pathname: '/deep-search/',
    search: '',
    hash: '',
    assign() {},
    replace() {},
    reload() {},
  };
}
if (globalThis.window && !globalThis.window.location) {
  globalThis.window.location = globalThis.location;
}


const mql = () => ({
  matches: false,
  media: '',
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
});

globalThis.matchMedia = mql;
if (globalThis.window !== globalThis) globalThis.window.matchMedia = mql;

// Node 可能已有残缺 navigator；补齐 React / recharts 需要的字段
const navPatch = {
  clipboard: { writeText: async () => {} },
  userAgent: 'Mozilla/5.0 (DeepSearchTest) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  language: 'zh-CN',
  languages: ['zh-CN', 'en'],
};
if (!globalThis.navigator) {
  globalThis.navigator = { ...navPatch };
} else {
  for (const [k, v] of Object.entries(navPatch)) {
    if (globalThis.navigator[k] == null) {
      try {
        Object.defineProperty(globalThis.navigator, k, { value: v, configurable: true });
      } catch {
        /* 只读属性则忽略 */
      }
    }
  }
}

globalThis.document = {
  title: '',
  documentElement: { dataset: {}, style: {} },
  head: { appendChild() {} },
  body: { appendChild() {}, removeChild() {} },
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
};

globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((cb) => setTimeout(() => cb(0), 0));
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || ((id) => clearTimeout(id));


/* ───────── IndexedDB 内存打桩（历史/缓存走 IDB） ───────── */
(function stubIndexedDB() {
  const dbs = new Map();
  class MemReq {
    constructor() {
      this.result = undefined;
      this.error = null;
      this.onsuccess = null;
      this.onerror = null;
    }
    _ok(value) {
      this.result = value;
      Promise.resolve().then(() => this.onsuccess?.({ target: this }));
    }
    _fail(err) {
      this.error = err;
      Promise.resolve().then(() => this.onerror?.({ target: this }));
    }
  }
  class MemStore {
    constructor(map) {
      this._map = map;
    }
    get(key) {
      const req = new MemReq();
      req._ok(this._map.has(key) ? this._map.get(key) : undefined);
      return req;
    }
    put(value, key) {
      const req = new MemReq();
      this._map.set(key, value);
      req._ok(key);
      return req;
    }
    delete(key) {
      const req = new MemReq();
      this._map.delete(key);
      req._ok(undefined);
      return req;
    }
    clear() {
      const req = new MemReq();
      this._map.clear();
      req._ok(undefined);
      return req;
    }
  }
  class MemTx {
    constructor(map, mode) {
      this._map = map;
      this.mode = mode;
      this._complete = null;
      this.onerror = null;
      this.onabort = null;
      this._done = false;
      Promise.resolve().then(() => {
        this._done = true;
        this._complete?.();
      });
    }
    get oncomplete() {
      return this._complete;
    }
    set oncomplete(fn) {
      this._complete = fn;
      if (this._done && fn) fn();
    }
    objectStore() {
      return new MemStore(this._map);
    }
  }
  class MemDb {
    constructor(name, storeMap) {
      this.name = name;
      this.objectStoreNames = {
        _names: new Set(storeMap.keys()),
        contains(n) { return this._names.has(n); },
      };
      this._stores = storeMap;
    }
    transaction(storeName) {
      if (!this._stores.has(storeName)) this._stores.set(storeName, new Map());
      return new MemTx(this._stores.get(storeName));
    }
    createObjectStore(name) {
      if (!this._stores.has(name)) this._stores.set(name, new Map());
      this.objectStoreNames._names.add(name);
      return new MemStore(this._stores.get(name));
    }
  }
  globalThis.indexedDB = {
    open(name, version) {
      const req = new MemReq();
      req.onupgradeneeded = null;
      req.onblocked = null;
      Promise.resolve().then(() => {
        let entry = dbs.get(name);
        const isNew = !entry;
        if (!entry) {
          entry = { version: version || 1, stores: new Map() };
          dbs.set(name, entry);
        }
        const db = new MemDb(name, entry.stores);
        req.result = db;
        if (isNew || (version && version > entry.version)) {
          entry.version = version || entry.version;
          req.onupgradeneeded?.({ target: req });
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
})();

export { store };
