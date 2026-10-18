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

// Node 22 已有 navigator，这里只在缺失时补一个（剪贴板接口）
if (!globalThis.navigator) {
  globalThis.navigator = { clipboard: { writeText: async () => {} } };
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

export { store };
