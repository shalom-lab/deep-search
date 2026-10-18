/**
 * 轻量 Markdown 渲染（marked） + 安全加固。
 *
 * 渲染的是抓取接口返回的远程内容，因此：
 *  1. 先按原始文本转义，再交给 marked，杜绝内联 HTML 注入；
 *  2. 渲染后逐节点清洗，只允许安全标签/属性，外链统一 noopener；
 *  3. 危险协议（javascript: / data: 等）一律剥离。
 */
import { Marked } from 'marked';

const SAFE_URL_RE = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i;

const BLOCKED_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'link', 'meta', 'base', 'svg', 'math', 'template', 'noscript',
]);

const ALLOWED_ATTRS = new Set(['href', 'title', 'alt', 'src', 'colspan', 'rowspan', 'start', 'id', 'class']);

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return String(value ?? '').replace(/["'<>`]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function isSafeUrl(url) {
  const value = String(url ?? '').trim();
  if (!value) return false;
  // 去掉可能用于绕过的控制字符与空白（例如 "java\tscript:" / "java\nscript:"）。
  // 这里必须匹配控制字符，否则白名单可被绕过，故对 no-control-regex 做局部豁免。
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u0020\u007f]/g, '');
  return SAFE_URL_RE.test(cleaned);
}

/** 内联代码片段着色：`code` 与 #tag */
function inlineDecorations(escaped) {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(^|[\s(（[【])(#[\w\u4e00-\u9fff-]{2,24})/g, '$1<span class="md-tag">$2</span>');
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  pedantic: false,
});

marked.use({
  renderer: {
    html(token) {
      // HTML 块一律转义显示，不注入
      const raw = typeof token === 'string' ? token : token?.text ?? '';
      return `<p class="md-raw-html">${escapeHtml(raw)}</p>`;
    },
    code({ text, lang }) {
      const language = String(lang || '').split(/\s+/)[0].slice(0, 24);
      return `<pre class="md-pre" data-lang="${escapeAttr(language)}"><code>${escapeHtml(text)}</code></pre>`;
    },
    codespan({ text }) {
      return `<code class="md-code">${escapeHtml(text)}</code>`;
    },
    link({ href, title, tokens }) {
      const text = marked.parser(tokens ?? []);
      if (!isSafeUrl(href)) return `<span class="md-link-dead">${text}</span>`;
      return `<a href="${escapeAttr(href)}" title="${escapeAttr(title || '')}" target="_blank" rel="noopener noreferrer nofollow">${text}</a>`;
    },
    image({ href, title, text }) {
      if (!isSafeUrl(href)) return `<span class="md-link-dead">${escapeHtml(text || '')}</span>`;
      return `<img src="${escapeAttr(href)}" alt="${escapeAttr(text || '')}" title="${escapeAttr(title || '')}" loading="lazy" referrerpolicy="no-referrer" />`;
    },
    table(token) {
      const header = `<tr>${(token.header || [])
        .map((cell) => `<th align="${escapeAttr(cell.align || 'left')}">${marked.parser(cell.tokens ?? [])}</th>`)
        .join('')}</tr>`;
      const body = (token.rows || [])
        .map(
          (row) =>
            `<tr>${row
              .map((cell) => `<td align="${escapeAttr(cell.align || 'left')}">${marked.parser(cell.tokens ?? [])}</td>`)
              .join('')}</tr>`,
        )
        .join('');
      return `<div class="md-table-wrap"><table class="md-table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
    },
  },
});

/** 渲染前把原文整体转义，防止原始 HTML 直通。 */
function sanitizeSource(markdown) {
  return escapeHtml(String(markdown ?? '').replace(/\r\n?/g, '\n'));
}

function cleanNode(node) {
  const children = [...node.children];
  children.forEach(cleanNode);
  const tag = node.tagName.toLowerCase();
  if (BLOCKED_TAGS.has(tag)) {
    node.remove();
    return;
  }
  [...node.attributes].forEach((attr) => {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on') || !ALLOWED_ATTRS.has(name)) {
      node.removeAttribute(attr.name);
      return;
    }
    if ((name === 'href' || name === 'src') && !isSafeUrl(attr.value)) node.removeAttribute(attr.name);
  });
  if (tag === 'a') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
}

export function renderMarkdown(markdown) {
  const source = sanitizeSource(markdown);
  if (!source.trim()) return '';
  let html = marked.parse(source, { async: false });
  if (typeof html !== 'string') html = String(html);
  // 二次清洗：真正解析一次 DOM，移除任何漏网的危险节点/属性
  try {
    const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
    const root = doc.getElementById('root');
    [...root.children].forEach(cleanNode);
    html = root.innerHTML;
  } catch {
    /* 无 DOMParser 时不再降级处理，源已转义 */
  }
  return html;
}

/** 给纯文本加内联装饰（用于短摘要展示） */
export function renderInline(text) {
  return inlineDecorations(escapeHtml(text));
}

/** 未启用 marked 时的纯文本兜底（保留段落结构） */
export function renderPlain(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((block) => `<p>${inlineDecorations(escapeHtml(block.trim())).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

/**
 * 按 query 生成高亮 HTML。
 * 支持 "精确短语"、site:xxx、-排除词；逐段转义后再包裹 <mark>。
 */
export function highlightText(rawText, query) {
  const text = String(rawText ?? '');
  if (!text) return '';
  const terms = extractTerms(query);
  if (!terms.length) return escapeHtml(text);

  const escaped = escapeHtml(text);
  const parts = [];
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  let last = 0;
  let match;
  while ((match = pattern.exec(escaped)) !== null) {
    if (match.index > last) parts.push(escaped.slice(last, match.index));
    parts.push(`<mark class="hl">${match[0]}</mark>`);
    last = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex += 1;
    if (parts.length > 400) break;
  }
  parts.push(escaped.slice(last));
  return parts.join('');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 从 query 中拆出值得高亮的词（浏览器/Node 通用，不依赖 DOM） */
export function extractTerms(query) {
  const raw = String(query ?? '');
  const terms = new Set();
  const quoted = raw.match(/"([^"]{2,40})"/g) || [];
  quoted.forEach((q) => {
    const inner = q.slice(1, -1).trim();
    if (inner) terms.add(inner);
  });

  raw
    .replace(/"[^"]*"/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .forEach((token) => {
      const lower = token.toLowerCase();
      if (lower.startsWith('-') || lower.startsWith('+')) return;
      if (/^(site|lang|after|before|intitle|filetype|inurl|related):/i.test(lower)) return;
      if (/^(or|and|not)$/i.test(lower)) return;
      if (/^\d{4}(\.\.\d{4})?$/.test(lower)) return;
      const cleaned = token.replace(/[，。、！？；：""''（）【】《》]/g, '').trim();
      if ([...cleaned].length >= 2) terms.add(cleaned);
    });

  return [...terms]
    .filter((t) => [...t].length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 12);
}
