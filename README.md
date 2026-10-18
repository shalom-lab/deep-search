# DeepSearch · DeepSeek 网页搜索与抓取工作台

一个 Vite + React 单页应用，把 DeepSeek 的两个实时网页工具做成顺手的工作台：

| 接口 | 用途 |
| --- | --- |
| `POST https://api.deepseek.com/v1/tools/search` | 按 query 搜索网页，返回结构化结果列表（含排序分、权威度、长短摘要） |
| `POST https://api.deepseek.com/v1/tools/fetch` | 抓取单个网页，返回标题与 Markdown 正文 |

**BYOK（Bring Your Own Key）**：你填入自己的 DeepSeek API Key，密钥只保存在本机浏览器的 `localStorage`；
历史、统计与缓存走 `IndexedDB`。请求时密钥直接放进 `Authorization: Bearer` 头。项目里没有账号系统、没有服务端存储、没有第三方中转。

---

## 在线地址

GitHub Pages（`main` / `master` 推送后由 Actions 自动构建部署）：

**https://shalom-lab.github.io/deep-search/**

仓库 Settings → Pages → Source 选 **GitHub Actions**。站点为纯静态：没有本地转发中间件，真实请求走浏览器直连；若上游未放行 CORS，请用演示模式，或改用下方 `npm run dev` / `npm start`。

## 快速开始

```bash
npm install
npm run dev          # 打开 http://127.0.0.1:5273/deep-search/
```

首次打开会看到「尚未配置 API Key」的提示：

1. 侧栏进入 **设置** → 粘贴 API Key → **保存**（会先验证连接，通过后才写入本机）；
2. 或者直接点提示里的 **用演示数据体验**，先用内置样例数据把界面走一遍（不消耗额度）。

> 只想看效果、不想现在填密钥？打开设置里的 **演示模式** 即可：完全离线、不发任何真实请求。

### 可用的命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发服务器（含 DeepSeek 同源转发） |
| `npm run build` | 构建到 `dist/` |
| `npm run preview` | 预览构建产物（同样带转发，可直接联调） |
| `npm start` | 生产服务器：托管 `dist/` + 同一份转发中间件 |
| `npm run check` | 自检：语法转译、导入解析、依赖声明、无用导入 |
| `npm run lint` | ESLint：`no-undef`（未定义标识符）、`no-unused-vars` 等 |
| `npm test` | 39 个用例：库逻辑 30 个 + 渲染冒烟 9 个 |
| `npm run verify` | `check` + `lint` + `test`，提交前跑这一个就够 |

`npm test` 的**渲染冒烟**套件用 `react-dom/server` 把整棵组件树渲染成 HTML，
不发真实请求也不需要浏览器，专门捕获静态检查抓不到的运行时错误——
例如 useMemo 依赖数组里引用了不存在的变量（会导致整页白屏）、Provider 漏挂、路由不匹配。
`lint` 则进一步覆盖事件处理函数体里的未定义标识符。

> 说明：`npm run build` 依赖 esbuild 通过管道与子进程通信，个别受限沙箱会拒绝（`spawn EPERM`）。
> 正常机器上直接可用；因此内置的 `check` / `test` 改为直接调用 esbuild 原生二进制，
> 不依赖这种管道，在任何环境都能跑。

---

## 本机持久化：密钥用 localStorage，其余用 IndexedDB

| 介质 | 存放内容 |
| --- | --- |
| **localStorage** | API Key 与其它轻量 BYOK / 扁平偏好（基址、主题、开关、排序过滤等） |
| **IndexedDB**（库名 `deepseek-deepsearch`） | 搜索历史、调用统计、搜索结果缓存、最近抓取列表 |

历史与缓存的结果快照会**强制清空 `content`**，避免正文长期堆满配额；写入失败（存储满 / IndexedDB 不可用）会弹出可见 toast。「清空本机数据」会同时清掉相关 localStorage 键与 IndexedDB 全部业务 store。

首次打开时：若 IndexedDB 为空而旧版 localStorage 里还有历史 / 统计 / 缓存等大键，会**自动迁移一次**，然后删除这些旧大键（密钥与扁平偏好键保留）。

### localStorage 键（BYOK / 偏好）

密钥需要能调用 DeepSeek 的 `POST /v1/tools/search` 与 `POST /v1/tools/fetch`。每一项单独一个键，不合并成 JSON。

| 存储键名 | 内容 | 取值 |
| --- | --- | --- |
| `deepseek-deepsearch-key` | **API Key** | DeepSeek API Key |
| `deepseek-deepsearch-base` | API 基址 | 默认 `https://api.deepseek.com` |
| `deepseek-deepsearch-count` | 默认条数 | `1`–`50` |
| `deepseek-deepsearch-transport` | 传输方式 | `auto` | `proxy` | `direct` |
| `deepseek-deepsearch-need-content` | 是否请求正文 | `true` | `false` |
| `deepseek-deepsearch-deep-intent` | 意图增强 | `true` | `false` |
| `deepseek-deepsearch-ori-question` | 固定原始问题 | 文本，最多 128 字 |
| `deepseek-deepsearch-localization` | 本地化 IP | 文本，可空 |
| `deepseek-deepsearch-record-history` | 记录历史 | `true` | `false` |
| `deepseek-deepsearch-remember-results` | 保存结果快照 | `true` | `false` |
| `deepseek-deepsearch-highlight` | 关键词高亮 | `true` | `false` |
| `deepseek-deepsearch-demo` | 演示模式 | `true` | `false` |
| `deepseek-deepsearch-sort` | 排序 | `score` | `authority` | `fresh` | `site` |
| `deepseek-deepsearch-filter` | 过滤 | `0` | `1.5` | `2` | `auth3` |
| `deepseek-deepsearch-theme` | 主题 | `dark` | `light` |

### IndexedDB 键（业务数据）

| 键名 | 内容 |
| --- | --- |
| `history` | 搜索历史（最多 60 条；快照不含完整 `content`） |
| `usage` | 调用统计（含「有结果才计费」计数） |
| `cache` | 当前搜索结果缓存（不含完整 `content`） |
| `fetches` | 最近抓取元信息（url / title / 字符数，不含正文） |

可在 Settings 填写密钥，也可事先写入 localStorage；启动自动读取，不重新验证。手动保存密钥时先验证连接。本应用没有仓库内 `.env` 或其它密钥落盘路径。

旧键 `deepseek-deepsearch-settings`（整包 JSON）启动时仍会读取，改过任意偏好后会拆成上表的独立键并删除旧键。旧版曾把 `history` / `usage` / `cache` / `fetches` 放在 localStorage，现已迁至 IndexedDB。

```js
// 在任何页面加载前执行（例如浏览器控制台，或在宿主页面注入）
localStorage.setItem('deepseek-deepsearch-key', 'sk-你的密钥');
```

应用启动时会**静默读取**密钥与偏好：有值就直接可用，不会弹窗打断；设置页只显示掩码后的末四位，从不回显完整密钥。

密钥流向只有一条：`localStorage` → 请求头 `Authorization: Bearer <key>` → `api.deepseek.com`。
它**不会**写入仓库、构建产物、`.env`、日志，也不会经过任何第三方中转。


## 功能

**搜索**

- 结果卡片：排序分（0–3，≥1.5 为优质）、权威度（0–4）、站点图标、发布时间、短摘要
- 一键展开**长摘要**（`summary`，面向模型阅读的那份 600–800 字摘要）
- 排序：综合 / 权威度优先 / 时效优先 / 按站点聚合（同站点折叠分组，显示组内均分与最高分）
- 过滤：全部 / ≥1.5 / ≥2.0 / 仅极权威站点（`authority ≥ 3`）
- 关键词高亮，支持 `"精确短语"`；自动忽略 `site:`、`lang:` 等操作符
- 语法快捷插入：`site:`、`-site:`、`"..."`、`lang:zh,en`、`after:`、`before:`、`-"..."`
- 键盘操作：`Ctrl/⌘ + K` 聚焦搜索框、`↑↓` 选择结果、`Enter` 抓取正文、`Esc` 关闭面板
- 导出：Markdown（含摘要与可选正文）/ JSON（还原接口原始字段）/ CSV

**抓取与阅读**

- 独立抓取页 + 每条结果的「抓取正文」按钮
- Markdown 渲染，支持渲染视图 / 原始 Markdown 切换
- 右侧阅读面板（详情抽屉），统计字符数、字节数与 token 估算

**参数控制**

- `query`：实时字符计数，1–128 个 Unicode 字符（emoji 按 1 个计），不能全为空白
- `count`：1–50 滑杆（默认 10）
- `need_content`：开关，决定 `content` 是否返回网页正文
- `ori_question`：意图增强开关；可固定一个原始问题，也可直接用搜索词
- `localization`：可选 IP 地址，用于优先返回本地化结果

**其它**

- 搜索历史（可恢复结果快照、重新搜索、导出 CSV）
- 调用统计：次数、计费请求数、估算花费、平均延迟、最近 30 天趋势图
- 深色 / 浅色主题（`Ctrl/⌘ + J`，首帧前生效、无闪烁）
- Toast 提示 + 二次确认弹窗 + 完整中文化的错误卡片
- 演示模式：内置样例数据，离线预览整个界面
- 响应式：桌面为「侧栏 + 内容 + 抽屉」，窄屏抽屉全宽、侧栏改浮层

---

## 关于跨域：为什么需要一个转发

浏览器直连 `api.deepseek.com` 通常会**被跨域策略拦截**（`fetch` 抛 `TypeError: Failed to fetch`），
而这是浏览器行为，前端代码无法绕过——密钥在浏览器里，就必须由浏览器发请求。

因此 `vite.config.js` 挂了一个**无状态转发中间件**（`server/deepseekProxy.js`）：

- 路径白名单：只转发 `POST /v1/tools/search` 与 `POST /v1/tools/fetch`，不会变成开放代理
- **只透传** `Authorization` 头，不记录、不落盘、不缓存
- 同时挂到 **dev server 与 preview server**，所以 `npm run build && npm run preview` 一样能用
- 生产环境用 `npm start`（`server/serve.js`），托管 `dist/` 的同时挂上同一份中间件

客户端有三种传输方式（设置页可切换）：

| 模式 | 行为 |
| --- | --- |
| **自动**（默认） | 优先走同源转发，失败时自动回退直连 |
| **仅本地转发** | 只走 `/__deepseek/api/*`，不受跨域限制 |
| **仅直连上游** | 浏览器 → `api.deepseek.com`，需要上游/网关放行 CORS |

启动时会静默探测 `/__deepseek/health` 判断转发是否可用，状态显示在状态栏与设置页。

> GitHub Pages 即为纯静态部署（见上方「在线地址」）：无本地转发，默认传输方式会回退到直连。
> 需要绕开 CORS 时，本机用 `npm run dev` 或 `npm start`（带同源转发）。

---

## 搜索语法

`query` 中的操作符会原样传给搜索服务，可以在一个 query 里组合多个：

| 操作符 | 示例 | 说明 |
| --- | --- | --- |
| `site:` | `DeepSeek site:github.com` | 限定站点；多个用空格分隔并通过 `OR` 连接 |
| `-site:` | `DeepSeek -site:example.com` | 排除站点 |
| `-` | `DeepSeek -广告` | 排除包含该关键词的网页 |
| `-"..."` | `DeepSeek -"release notes"` | 排除包含该短语的网页 |
| `"..."` | `DeepSeek "精确短语"` | 精确匹配短语 |
| `lang:` | `DeepSeek lang:zh,en` | 限定语言，逗号分隔 |
| `after:` | `DeepSeek after:2025-01-01` | 限定发布日期之后 |
| `before:` | `DeepSeek before:2026-06-01` | 限定发布日期之前 |

组合示例：

```
DeepSeek 模型 site:github.com OR site:huggingface.co lang:zh after:2025
```

---

## 接口要点（应用已按此实现）

**Search 请求体**

| 字段 | 必填 | 默认 | 约束 |
| --- | --- | --- | --- |
| `query` | 是 | — | 1–128 个 Unicode 字符，不能全为空白 |
| `count` | 否 | `10` | 1–50 |
| `ori_question` | 否 | — | 1–128 字符；传 `null` 视为未提供 |
| `localization` | 否 | `""` | 用于优先返回本地化结果的 IP |
| `need_content` | 否 | `false` | 为 `false` 时 `content` 恒为空字符串 |

**Search 响应字段**：`rerank_score`(0–3)、`title`、`url`、`snippet`(100–200 字符)、
`summary`(600–800 字符)、`content`、`site_name`、`site_icon`、`date`(UTC RFC 3339)、`authority`(0–4，`-1` 未知)。

**Fetch 请求体**：`url`，长度 ≤ 8192，必须为含 host 的 HTTP/HTTPS URL，且不能携带用户名或密码。

**错误处理**（错误体为 OpenAI 兼容格式，`param` 恒为 `null`）

| 状态码 | 含义 | 应用行为 |
| --- | --- | --- |
| 400 | 请求不合法 | 提示检查 query 长度与 count 范围 |
| 401 | Key 缺失或无效 | 引导去「设置」重新填写 |
| 402 | 余额不足 | 提示充值，不重试 |
| 403 | 被安全策略拒绝（Fetch） | 提示换来源 |
| 404 | 未获取到可用内容 | 说明 URL/内容类型/正文提取失败的可能 |
| 408 / 504 | 超时 | 自动退避重试 1 次（可取消），仍失败再提示 |
| 413 | 请求体过大 | 不可重试 |
| 429 | 超过 QPS | 按 `Retry-After` 退避后自动重试 1 次（可取消） |
| 5xx | 服务端错误 | 自动退避重试 1 次（可取消），仍失败再提示 |

**限速**：Search 与 Fetch 各自独立限速 **5 QPS**（按账号计算，与用哪个 Key 无关）；Fetch 对单个目标域名另有 QPS 限制。

**计费**：按请求次数计费，每 1,000 次**成功请求 5 元**（Search 的 `results` 必须非空，Fetch 必须返回正文）。
失败、无结果或超时**不计费**；`count` 只影响返回条数，不影响单次价格。
应用内的「估算花费」是按上述规则在本机推算的，仅供参考，请以官方账单为准。

---

## 项目结构

```
deepsearch/
├── .github/workflows/pages.yml # GitHub Pages：verify → build → deploy-pages
├── index.html                  # Vite 入口（主题在首帧前定好，避免闪烁）
├── vite.config.js              # base=/deep-search/ + 代理中间件 + 404.html SPA 回退
├── eslint.config.js            # ESLint：no-undef / no-unused-vars（含浏览器全局声明）
├── server/
│   ├── deepseekProxy.js        # 无状态转发：白名单 + Authorization 透传（仅本地）
│   └── serve.js                # 可选：本地/自建 Node 托管 dist/ + 同一份中间件
├── scripts/
│   ├── check-syntax.mjs        # 自检：语法 / 导入解析 / 依赖一致性 / 无用导入
│   ├── dom-stubs.mjs           # 让组件树能在 Node 里服务端渲染的最小浏览器打桩
│   ├── test-lib.mjs            # 库逻辑用例
│   ├── test-render.mjs         # 渲染冒烟用例
│   └── run-tests.mjs           # 测试运行器（esbuild 二进制打包后执行）
└── src/
    ├── main.jsx                # 入口：Provider 嵌套 + HashRouter
    ├── App.jsx                 # 外壳：侧栏 / 顶栏 / 路由 / 状态栏 / 抽屉
    ├── lib/
    │   ├── api.js              # 两个接口的客户端、校验、错误映射、演示数据
    │   ├── store.js            # BYOK 密钥、偏好、历史、统计（localStorage）
    │   ├── markdown.js         # Markdown 渲染 + 清洗 + 高亮
    │   ├── results.js          # 排序 / 过滤 / 聚合 / 导出（纯函数）
    │   ├── presets.js          # 语法预设与示例查询
    │   └── util.js             # 通用工具
    ├── hooks/useAppState.jsx   # 搜索会话与详情抽屉
    ├── components/             # Icon / UIProvider / ResultCard / common
    ├── layout/                 # Sidebar / SearchBar / DetailDrawer
    ├── pages/                  # SearchPage / FetchPage / HistoryPage / SettingsPage
    └── styles/global.css       # 设计系统（主题变量 → 布局 → 组件 → 响应式）
```

---

## 安全说明

- 抓取回来的 Markdown 属于**不可信远程内容**：渲染前先整体转义原始 HTML，再交给 marked，
  渲染后逐节点清洗（移除 `script`/`iframe`/事件属性/危险协议），外链统一加 `noopener noreferrer nofollow`。
- 密钥只在浏览器内存与 `localStorage` 中出现，历史与统计同样只存本机。
- 设置页提供「清空本机数据」与「导出设置」（导出内容**不含**密钥）。
- 生产转发中间件只放行两个接口路径，不做通用代理。

---

## 参考

- [网页搜索与抓取指南](https://api-docs.deepseek.com/zh-cn/guides/search/)
- [Search API Reference](https://api-docs.deepseek.com/zh-cn/api/search/)
- [Fetch API Reference](https://api-docs.deepseek.com/zh-cn/api/fetch/)
