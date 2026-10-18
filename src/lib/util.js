/** 通用小工具：无第三方依赖，浏览器与 Node 均可安全使用。 */

export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

/** 简易稳定哈希，用于给站点配色、生成确定性假数据。 */
export function hashString(input) {
  const str = String(input ?? '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 由字符串确定性生成 0..n-1 的整数。 */
export function seededInt(input, n) {
  return hashString(input) % Math.max(1, n);
}

/** 2026-06-01T00:00:00+00:00 -> 2026-06-01（无效返回 null） */
export function formatDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** 相对时间：3 分钟前 / 2 天前 */
export function formatRelative(value, now = Date.now()) {
  if (!value) return '';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  const abs = Math.abs(diff);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  const rtf = (n, unit) => (typeof Intl !== 'undefined' && Intl.RelativeTimeFormat
    ? new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }).format(diff < 0 ? n : -n, unit)
    : `${n}${unit}`);
  if (abs < 45_000) return '刚刚';
  if (abs < hour) return rtf(Math.round(abs / min), 'minute');
  if (abs < day) return rtf(Math.round(abs / hour), 'hour');
  if (abs < 30 * day) return rtf(Math.round(abs / day), 'day');
  if (abs < 365 * day) return rtf(Math.round(abs / (30 * day)), 'month');
  return rtf(Math.round(abs / (365 * day)), 'year');
}

export function formatClock(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { hour12: false });
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return `${Math.floor(ms / 60_000)}分${Math.round((ms % 60_000) / 1000)}秒`;
}

export function formatNumber(n) {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('zh-CN');
}

/** 紧凑数字：1234 -> 1.2k */
export function formatCompact(n) {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) < 1000) return String(Math.round(n));
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 字符数（按 Unicode 码点计，代理对算 1 个） */
export function countChars(text) {
  return [...String(text ?? '')].length;
}

/** 估算 token（中英混合粗估：CJK 1 字 ≈ 1 token，其他 ≈ 4 字符 1 token） */
export function estimateTokens(text) {
  const s = String(text ?? '');
  if (!s) return 0;
  const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const rest = s.length - cjk;
  return Math.ceil(cjk + rest / 4);
}

/** 取站点名：优先 site_name，其次 host */
export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url || '').replace(/^https?:\/\//, '').split('/')[0] || '';
  }
}

export function siteLabel(result) {
  return result?.site_name || hostOf(result?.url) || '未知来源';
}

export function faviconOf(url) {
  const host = hostOf(url);
  if (!host) return '';
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`;
}

/** 站点首字母 + 配色，作为图标加载失败时的兜底 */
const AVATAR_HUES = [212, 268, 320, 12, 36, 152, 182, 96];
export function siteAvatar(url, name) {
  const label = String(name || hostOf(url) || '?').trim();
  return {
    letter: [...label][0]?.toUpperCase() || '?',
    hue: AVATAR_HUES[seededInt(hostOf(url) || label, AVATAR_HUES.length)],
  };
}

export function scoreTier(score) {
  const s = Number(score) || 0;
  if (s >= 2.5) return { key: 'top', label: '极佳', hint: '强相关 · 高权威' };
  if (s >= 1.5) return { key: 'good', label: '优质', hint: '相关度良好' };
  if (s >= 0.8) return { key: 'fair', label: '一般', hint: '部分相关' };
  return { key: 'low', label: '较弱', hint: '相关度偏低' };
}

export const AUTHORITY_LABELS = {
  '-1': { label: '未知', key: 'unknown' },
  0: { label: '低', key: 'low' },
  1: { label: '较低', key: 'lowish' },
  2: { label: '中等', key: 'mid' },
  3: { label: '极高', key: 'high' },
  4: { label: '最高', key: 'top' },
};

export function authorityInfo(value) {
  return AUTHORITY_LABELS[String(value)] || AUTHORITY_LABELS['-1'];
}

export function daysAgoISO(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export function pluralZh(n, unit) {
  return `${n} ${unit}`;
}

/** 极简事件总线，用于跨组件广播（如快捷键、toast）。 */
export function createEmitter() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => map.get(type)?.delete(fn);
    },
    emit(type, payload) {
      map.get(type)?.forEach((fn) => {
        try {
          fn(payload);
        } catch (err) {
          console.error('[emitter]', type, err);
        }
      });
    },
  };
}

/** 稳定的 JSON 深拷贝（用于历史快照，避免后续被改写） */
export function deepClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

/** 生成短 id（无 crypto 时回退） */
export function makeId(prefix = 'id') {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** 防抖 */
export function debounce(fn, wait = 250) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => timer && clearTimeout(timer);
  return wrapped;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** 去掉 URL 中的 hash / 追踪参数，便于去重 */
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    [...u.searchParams.keys()].forEach((k) => {
      if (/^(utm_|ref|spm|from|share_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
    });
    return u.toString();
  } catch {
    return String(url || '');
  }
}
