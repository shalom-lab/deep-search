/**
 * 测试运行器：
 *   1. 用 esbuild 原生二进制把每个测试文件打包到 .check-tmp/
 *      （避开沙箱对「带管道的子进程」的限制）
 *   2. 依次用 node 执行打包结果，汇总退出码
 *
 * 用法：
 *   npm test -- --no-build    # 跳过打包，直接跑上次产物
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TMP = join(ROOT, '.check-tmp');
const NO_BUILD = process.argv.includes('--no-build');

const SUITES = [
  { name: '库逻辑', entry: 'test-lib.mjs', format: 'esm' },
  // 渲染套件用 CJS 打包：react-dom/server 需要 require('stream')，recharts 需要
  // require('react')，以 ESM 打包会被 esbuild 变成不受支持的动态 require。
  { name: '渲染冒烟', entry: 'test-render.mjs', format: 'cjs' },
];

function findEsbuild() {
  const tripleMap = {
    win32: { x64: 'win32-x64', arm64: 'win32-arm64' },
    darwin: { x64: 'darwin-x64', arm64: 'darwin-arm64' },
    linux: { x64: 'linux-x64', arm64: 'linux-arm64' },
  };
  const triple = tripleMap[process.platform]?.[process.arch];
  const names = process.platform === 'win32' ? ['esbuild.exe', 'esbuild'] : ['bin/esbuild', 'esbuild'];
  const candidates = [];
  if (triple) for (const n of names) candidates.push(join(ROOT, 'node_modules', '@esbuild', triple, n));
  for (const n of names) candidates.push(join(ROOT, 'node_modules', 'esbuild', n));
  return candidates.find((p) => existsSync(p)) || null;
}

mkdirSync(TMP, { recursive: true });

for (const suite of SUITES) {
  const entry = join(HERE, suite.entry);
  const base = suite.entry.replace(/\.mjs$/, '');
  // 注意：package.json 是 "type": "module"，所以 CJS 产物必须用 .cjs 扩展名
  const bundle = join(TMP, `${base}.bundle.${suite.format === 'cjs' ? 'cjs' : 'mjs'}`);

  if (!NO_BUILD) {
    const esbuild = findEsbuild();
    if (!esbuild) {
      console.error('找不到 esbuild 原生二进制，请先运行 npm install');
      process.exit(2);
    }
    const args = [
      relative(ROOT, entry).replace(/\\/g, '/'),
      '--bundle',
      '--platform=node',
      `--format=${suite.format}`,
      '--target=node20',
      '--loader:.js=jsx',
      `--outfile=${relative(ROOT, bundle).replace(/\\/g, '/')}`,
      // CJS 产物里 import.meta 恒为空（HMR 守卫因此自动失效），这条警告无意义
      '--log-override:empty-import-meta=silent',
      '--log-level=warning',
    ];
    const res = spawnSync(esbuild, args, { stdio: 'inherit', cwd: ROOT });
    if (res.status !== 0) {
      console.error(`\n[${suite.name}] 测试文件打包失败`);
      process.exit(res.status || 1);
    }
  }

  console.log(`\n═══ ${suite.name} ═══`);
  const run = spawnSync(process.execPath, [bundle], { stdio: 'inherit', cwd: ROOT });
  if (run.status !== 0) {
    console.error(`\n[${suite.name}] 未通过`);
    process.exit(run.status || 1);
  }
}

console.log('\n全部测试套件通过 ✅');
