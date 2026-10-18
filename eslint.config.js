import js from '@eslint/js';
import react from 'eslint-plugin-react';

/**
 * 只启用「真会出事」的规则：
 *  - no-undef：捕获未定义标识符（例如依赖数组里手滑写了个不存在的变量，
 *    这正是本项目曾经踩过的坑：hasKey 未定义导致白屏）
 *  - no-unused-vars：让死代码及时暴露
 *  - no-const-assign / no-dupe-keys 等基础正确性规则由 js.configs.recommended 提供
 *
 * 浏览器全局单独声明，避免把 window / fetch / Blob 等误报为未定义。
 */
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  performance: 'readonly',
  crypto: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  DOMParser: 'readonly',
  Intl: 'readonly',
  Math: 'readonly',
  Date: 'readonly',
  JSON: 'readonly',
  Promise: 'readonly',
  Map: 'readonly',
  Set: 'readonly',
  WeakMap: 'readonly',
  Object: 'readonly',
  Array: 'readonly',
  Number: 'readonly',
  String: 'readonly',
  Boolean: 'readonly',
  Error: 'readonly',
  RegExp: 'readonly',
  encodeURIComponent: 'readonly',
  decodeURIComponent: 'readonly',
  matchMedia: 'readonly',
  getComputedStyle: 'readonly',
  HTMLElement: 'readonly',
  Element: 'readonly',
  Node: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  MutationObserver: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
};

const nodeGlobals = {
  process: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  console: 'readonly',
  URL: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

const baseRules = {
  ...js.configs.recommended.rules,
  'no-undef': 'error',
  'no-unused-vars': [
    'warn',
    // React 在自动 JSX 运行时下允许未使用；以 _ 开头的参数视为占位
    { argsIgnorePattern: '^_', varsIgnorePattern: '^(_|React$)', caughtErrors: 'none', ignoreRestSiblings: true },
  ],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-cond-assign': ['error', 'except-parens'],
  eqeqeq: ['warn', 'smart'],
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.check-tmp/**', '.npm-cache/**'],
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: browserGlobals,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...baseRules,
      // 让 JSX 里的组件引用被算作「已使用」，否则整屏都是 no-unused-vars 误报
      'react/jsx-uses-vars': 'error',
    },
  },
  {
    files: ['server/**/*.js', 'vite.config.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...nodeGlobals, ...browserGlobals },
    },
    rules: baseRules,
  },
];
