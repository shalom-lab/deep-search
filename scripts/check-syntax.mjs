/**
 * 项目自检（零额外依赖）：语法 + 导入解析 + 依赖一致性
 *   npm run check
 *
 * 为什么不用 esbuild 的 JS API：JS API 会再派生一个带管道的子进程，部分受限沙箱
 * 会拒绝（spawn EPERM）。这里直接以 inherit 方式调用 esbuild 原生二进制，
 * 并用 --metafile 把结构化结果写到文件，避免依赖管道读取输出。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const TMP = join(ROOT, '.check-tmp');
const EXT = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const SOURCE_DIRS = ['src', 'server'];
const EXTRAS = ['vite.config.js'];

/* ───────────── 1. 定位 esbuild 原生二进制 ───────────── */
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

const esbuild = findEsbuild();
if (!esbuild) {
  console.error('找不到 esbuild 原生二进制，请先运行 npm install');
  process.exit(2);
}
console.log(`esbuild: ${relative(ROOT, esbuild)}`);

/* ───────────── 2. 收集文件 ───────────── */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.has(name.slice(name.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

const files = [
  ...SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d))),
  ...EXTRAS.map((f) => join(ROOT, f)),
].filter((f) => existsSync(f) && statSync(f).isFile());

/* ───────────── 3. 语法检查：分两次 esbuild build + metafile ───────────── */
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const BROWSER_ENTRIES = files.filter((f) => relative(ROOT, f).replace(/\\/g, '/').startsWith('src/'));
const NODE_ENTRIES = files.filter((f) => !BROWSER_ENTRIES.includes(f));

const COMMON = ['--bundle', '--format=esm', '--jsx=automatic', '--loader:.js=jsx', '--log-level=error', '--log-limit=0'];

const BUILDS = [
  {
    name: '浏览器端 (src/**)',
    entries: BROWSER_ENTRIES,
    args: [
      ...COMMON,
      '--platform=browser',
      '--target=es2022',
      '--external:react',
      '--external:react-dom',
      '--external:react-dom/client',
      '--external:react-router-dom',
      '--external:recharts',
      '--external:marked',
    ],
  },
  {
    name: 'Node 端 (server/**, vite.config.js)',
    entries: NODE_ENTRIES,
    args: [
      ...COMMON,
      '--platform=node',
      '--target=node20',
      '--external:vite',
      '--external:esbuild',
      '--external:rollup',
      '--external:@babel/*',
    ],
  },
];

const builds = [];
for (const build of BUILDS) {
  const outdir = join(TMP, build.name.startsWith('浏览器') ? 'browser' : 'node');
  const metaPath = join(TMP, `${build.name.startsWith('浏览器') ? 'browser' : 'node'}-meta.json`);
  const args = [
    ...build.entries.map((f) => relative(ROOT, f).replace(/\\/g, '/')),
    ...build.args,
    `--outdir=${outdir}`,
    `--metafile=${metaPath}`,
  ];
  const res = spawnSync(esbuild, args, { stdio: 'inherit', cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  let meta = null;
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      meta = null;
    }
  }
  builds.push({ ...build, res, meta, ok: res.status === 0 && Boolean(meta?.outputs && Object.keys(meta.outputs).length) });
}

/* ───────────── 4. 导入解析 + 依赖一致性 ───────────── */
const IMPORT_RE = /(?:^|\n)\s*(?:import\s+(?:[\s\S]*?)\s+from\s*|import\s*|export\s+(?:[\s\S]*?)\s+from\s*)['"]([^'"]+)['"]/g;
const importFailures = [];
const usedPackages = new Set();

for (const file of files) {
  const rel = relative(ROOT, file);
  const code = readFileSync(file, 'utf8');
  const specifiers = new Set();
  let m;
  while ((m = IMPORT_RE.exec(code)) !== null) specifiers.add(m[1]);
  const dynRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynRe.exec(code)) !== null) specifiers.add(m[1]);

  for (const spec of specifiers) {
    if (spec.startsWith('node:')) continue;
    if (spec.startsWith('.')) {
      const base = resolve(dirname(file), spec);
      const tries = [base, `${base}.js`, `${base}.jsx`, join(base, 'index.js'), join(base, 'index.jsx')];
      if (!tries.some((t) => existsSync(t))) importFailures.push({ rel, spec, reason: '相对路径无法解析' });
      continue;
    }
    const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    usedPackages.add(pkgName);
    if (!existsSync(join(ROOT, 'node_modules', pkgName))) {
      importFailures.push({ rel, spec, reason: `依赖 ${pkgName} 未安装` });
    }
  }
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const declared = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
const missingDecl = [...usedPackages].filter((u) => !declared.has(u));
const unusedDecl = [...declared].filter((d) => !usedPackages.has(d));

/* ───────────── 5. 未使用的具名导入 ───────────── */
const deadImports = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  const code = readFileSync(file, 'utf8');

  // 注意：body 必须在循环外算好。若在 while 循环里复用同一个全局正则做 replace，
  // lastIndex 会被重置，exec 将永远从头开始（死循环）。
  const body = code.replace(/(?:^|\n)\s*import\s+[\s\S]*?from\s*['"][^'"]+['"]/g, '');

  // 逐条 import 语句：import A, { B as C, D } from 'x'  /  import * as N from 'x'
  const importRe = /import\s+([\s\S]*?)\s+from\s*['"][^'"]+['"]/g;
  let m;
  while ((m = importRe.exec(code)) !== null) {
    const clause = m[1];
    const braces = clause.match(/\{([\s\S]*)\}/);
    const named = [];
    if (braces) {
      for (const part of braces[1].split(',')) {
        const t = part.trim();
        if (!t) continue;
        const asMatch = t.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
        if (asMatch) named.push({ imported: asMatch[1], local: asMatch[2] });
        else if (/^[\w$]+$/.test(t)) named.push({ imported: t, local: t });
      }
    }
    // 默认导入与命名空间导入
    const prefix = clause.split('{')[0].replace(/,/g, ' ').trim();
    for (const token of prefix.split(/\s+/).filter(Boolean)) {
      if (token === 'type' || token === 'as' || token === '*') continue;
      if (/^[\w$]+$/.test(token)) named.push({ imported: token, local: token });
    }

    // 检查每个本地名是否仍出现在正文中
    for (const { imported, local } of named) {
      // 自动 JSX 运行时下 React 默认导入无需使用，属良性，不计入
      if (imported === 'React' && local === 'React' && rel.endsWith('.jsx')) continue;
      const usage = new RegExp(`(?<![\\w$.])${local.replace(/[$]/g, '\\$')}(?![\\w$])`);
      if (!usage.test(body)) deadImports.push({ rel, imported, local });
    }
  }
}

/* ───────────── 6. 报告 ───────────── */
console.log(`\n扫描文件：${files.length} 个`);

let syntaxFailed = 0;
for (const build of builds) {
  if (build.ok) {
    console.log(`✓ ${build.name}：${build.entries.length} 个入口转译并打包成功（${Object.keys(build.meta.outputs).length} 个产物）`);
  } else {
    syntaxFailed += 1;
    console.log(`✗ ${build.name}：转译失败（见上方 esbuild 报错）`);
  }
}

if (importFailures.length) {
  console.log(`\n✗ 导入解析失败 ${importFailures.length} 处`);
  for (const f of importFailures) console.log(`  ${f.rel}  →  ${f.spec}  (${f.reason})`);
} else {
  console.log('✓ 导入解析通过（相对路径与第三方依赖均可找到）');
}

if (missingDecl.length) console.log(`\n! 使用了未声明的依赖：${missingDecl.join(', ')}`);
else console.log('✓ 依赖声明覆盖全部实际使用');

if (unusedDecl.length) console.log(`! package.json 中声明但未使用：${unusedDecl.join(', ')}`);

if (deadImports.length) {
  console.log(`\n! 未使用的导入 ${deadImports.length} 处（不影响运行，建议清理）`);
  for (const d of deadImports) console.log(`  ${d.rel}  →  ${d.imported}${d.local !== d.imported ? ` (as ${d.local})` : ''}`);
} else {
  console.log('✓ 没有未使用的导入');
}

rmSync(TMP, { recursive: true, force: true });

const failed = syntaxFailed + importFailures.length + missingDecl.length;
console.log(failed ? `\n自检失败：${failed} 个问题` : '\n自检通过 ✅');
process.exit(failed ? 1 : 0);
