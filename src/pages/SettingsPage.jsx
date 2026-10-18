/** 设置页：BYOK 密钥、接口参数、偏好开关、用量统计、危险操作。 */
import React, { useMemo, useRef, useState } from 'react';
import { CopyButton } from '../components/common.jsx';
import {
  IconCheck, IconExternal, IconKey, IconShield, IconTrash,
} from '../components/Icon.jsx';
import { useApp, STORAGE_KEYS } from '../lib/store.js';
import { useSearchSession } from '../hooks/useAppState.jsx';
import { useUI, downloadText } from '../components/UIProvider.jsx';
import { DEFAULT_BASE, PRICE_PER_1000, describeError, testConnection } from '../lib/api.js';
import { countChars, formatDuration, formatNumber } from '../lib/util.js';

const TRANSPORTS = [
  { value: 'auto', label: '自动（推荐）', hint: '优先本地转发，失败时回退直连' },
  { value: 'proxy', label: '仅本地转发', hint: '同源 /__deepseek/api，不受跨域限制' },
  { value: 'direct', label: '仅直连上游', hint: '浏览器 → api.deepseek.com，需要放行 CORS' },
];

function Toggle({ id, checked, onChange, title, desc }) {
  return (
    <label className="toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track">
        <span className="knob" />
      </span>
      <span className="tl-text">
        <strong>{title}</strong>
        <small>{desc}</small>
      </span>
    </label>
  );
}

export default function SettingsPage() {
  const app = useApp();
  const session = useSearchSession();
  const { toast, confirm } = useUI();
  const [draftKey, setDraftKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftBase, setDraftBase] = useState(app.base);
  const saveAbort = useRef(null);

  const s = app.settings;
  const set = (patch) => app.updateSettings(patch);

  const keyState = useMemo(() => {
    if (s.demo) return { cls: 'state warn', text: '演示模式已开启（不会发起真实请求）' };
    if (!app.hasKey) return { cls: 'state', text: '未设置' };
    return { cls: 'state ok', text: `已保存 · ${app.keyHint}` };
  }, [app.hasKey, app.keyHint, s.demo]);

  const saveKey = async () => {
    const value = draftKey.trim();
    if (!value) {
      toast({ tone: 'warn', title: '请输入 API Key' });
      return;
    }
    if (value.length < 20 || /\s/.test(value)) {
      toast({ tone: 'err', title: '密钥格式不正确', text: '请粘贴完整的 DeepSeek API Key。未写入。' });
      return;
    }
    const base = String(draftBase ?? '').trim().replace(/\/+$/, '') || DEFAULT_BASE;
    try {
      const parsedBase = new URL(base);
      if (parsedBase.protocol !== 'https:' && parsedBase.protocol !== 'http:') throw new Error('bad');
    } catch {
      toast({ tone: 'err', title: '基址格式不正确', text: '请填写 http 或 https 地址。密钥未写入。' });
      return;
    }

    saveAbort.current?.abort();
    const controller = new AbortController();
    saveAbort.current = controller;
    setSaving(true);
    try {
      const result = await testConnection({
        apiKey: value,
        base,
        transport: s.transport,
        proxyAvailable: app.proxy.ok,
        signal: controller.signal,
      });
      app.setBase(base || DEFAULT_BASE);
      setDraftBase(base || DEFAULT_BASE);
      app.setApiKey(value);
      setDraftKey('');
      toast({
        tone: 'ok',
        title: '密钥已保存',
        text: `连接验证通过 · ${result.transport === 'proxy' ? '本地转发' : '直连'} · ${formatDuration(result.latencyMs)}`,
      });
    } catch (err) {
      const described = describeError(err);
      toast({ tone: 'err', title: described.title || '验证失败，未保存', text: described.hint || '请检查密钥、额度或网络后重试。已有配置保持不变。' });
    } finally {
      setSaving(false);
    }
  };

  const exportSettings = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      note: '为保证安全，API Key 不会被导出。',
      base: app.base,
      settings: app.settings,
      usage: app.usage,
    };
    const name = `deepsearch-settings-${new Date().toISOString().slice(0, 10)}.json`;
    downloadText(name, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    toast({ tone: 'ok', title: '已导出设置', text: name });
  };

  const queryChars = countChars(s.oriQuestion);

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>API Key（BYOK）</h2>
          <p>
            密钥只写入本机浏览器 <code>localStorage</code>，请求时直接放进 <code>Authorization: Bearer</code> 头发给
            DeepSeek。本项目的开发转发中间件不落盘、不记录任何密钥。
          </p>
        </div>

        <div className="field">
          <label htmlFor="apiKeyInput">
            DeepSeek API Key <span className="req">*</span>
          </label>
          <div className="input-wrap">
            <IconKey size={17} />
            <input
              id="apiKeyInput"
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder={app.hasKey ? '已保存，输入新值可覆盖' : 'sk-...'}
              spellCheck="false"
              autoComplete="off"
              disabled={saving}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            />
          </div>
          <div className="field-foot">
            <span className={keyState.cls}>
              {app.hasKey && !s.demo ? <IconCheck size={14} /> : null}
              {keyState.text}
            </span>
            <div className="btn-group">
              <button type="button" className="btn primary sm" onClick={saveKey} disabled={saving || !draftKey.trim()}>
                {saving ? '验证中…' : '保存'}
              </button>
              <button
                type="button"
                className="btn ghost sm danger"
                disabled={saving || !app.hasKey}
                onClick={async () => {
                  if (await confirm({ title: '清除已保存的 API Key？', text: '清除后需要重新填写才能发起真实请求。', okLabel: '清除' })) {
                    app.clearApiKey();
                    toast({ tone: 'ok', title: '密钥已清除' });
                  }
                }}
              >
                清除
              </button>
            </div>
          </div>
          <p className="hint">
            存储键名：<code>{STORAGE_KEYS.key}</code>。可在此填写，也可事先写入 localStorage；启动自动读取，不重新验证。
            点保存会先用当前密钥请求一次 <code>POST /v1/tools/search</code>（count=1），通过后才写入。
          </p>
          <p className="hint">
            本机用量：计费请求 {formatNumber(app.derived.billable)} 次 · 估算花费 ¥{app.derived.estimatedCost.toFixed(3)}
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>接口与传输</h2>
          <p className="muted">搜索与抓取共用同一个基址；请求路径固定为 <code>/v1/tools/search</code> 与 <code>/v1/tools/fetch</code>。</p>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="baseInput">API 基址</label>
            <input
              id="baseInput"
              type="text"
              value={draftBase}
              onChange={(e) => setDraftBase(e.target.value)}
              onBlur={() => {
                const next = String(draftBase ?? '').trim().replace(/\/+$/, '') || DEFAULT_BASE;
                try {
                  const parsed = new URL(next);
                  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('bad');
                  app.setBase(next);
                  setDraftBase(next);
                } catch {
                  toast({ tone: 'err', title: '基址格式不正确', text: '请填写 http 或 https 地址。未写入。' });
                  setDraftBase(app.base);
                }
              }}
              placeholder={DEFAULT_BASE}
              spellCheck="false"
            />
            <p className="hint">
              默认 <code>{DEFAULT_BASE}</code>。只检查地址格式，不单独验证连接。保存密钥时会用这里的基址一起验证。
            </p>
          </div>

          <div className="field">
            <label htmlFor="transportSelect">传输方式</label>
            <select id="transportSelect" value={s.transport} onChange={(e) => set({ transport: e.target.value })}>
              {TRANSPORTS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} — {t.hint}
                </option>
              ))}
            </select>
            <p className="hint">
              本地转发状态：
              {app.proxy.checked ? (
                app.proxy.ok ? (
                  <span style={{ color: 'var(--ok)' }}> 已启用（上游 {app.proxy.upstream}）</span>
                ) : (
                  <span style={{ color: 'var(--warn)' }}> 未检测到（当前可能不是通过 npm run dev 打开）</span>
                )
              ) : (
                ' 检测中…'
              )}
              <button type="button" className="link-btn" style={{ marginLeft: 6 }} onClick={() => app.recheckProxy()}>
                重新检测
              </button>
            </p>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="countRange">
              默认返回条数 <span className="dim">count</span>
            </label>
            <div className="range-row">
              <input
                id="countRange"
                type="range"
                min="1"
                max="50"
                value={app.count}
                onChange={(e) => set({ count: Number(e.target.value) })}
              />
              <output>{app.count}</output>
            </div>
            <p className="hint">1–50，默认 10；只影响条数，不影响单次价格。</p>
          </div>

          <div className="field">
            <label htmlFor="locInput">
              localization <span className="dim">可选</span>
            </label>
            <input
              id="locInput"
              type="text"
              value={s.localization}
              onChange={(e) => set({ localization: e.target.value })}
              placeholder="1.2.3.4 或 2400:cb00::1"
              spellCheck="false"
            />
            <p className="hint">用于优先返回该 IP 归属地的本地化结果；留空则不传该字段。</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="oriInput">
            固定 ori_question <span className="dim">可选，{queryChars}/128</span>
          </label>
          <input
            id="oriInput"
            type="text"
            maxLength={128}
            value={s.oriQuestion}
            onChange={(e) => set({ oriQuestion: e.target.value.slice(0, 128) })}
            placeholder="触发搜索的用户原始问题（留空则使用搜索框原文）"
            spellCheck="false"
          />
          <p className="hint">
            开启「意图增强」时，会把该值（为空则用当前搜索词）作为 <code>ori_question</code> 提交，帮助接口理解意图。
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>偏好设置</h2>
        </div>
        <div className="toggle-list">
          <Toggle
            id="optNeedContent"
            checked={s.needContent}
            onChange={(v) => set({ needContent: v })}
            title="默认请求网页正文（need_content = true）"
            desc="content 会直接返回网页正文，信息更全但请求更慢；关闭时 content 恒为空字符串。"
          />
          <Toggle
            id="optDeep"
            checked={s.deepIntent}
            onChange={(v) => set({ deepIntent: v })}
            title="默认开启意图增强（ori_question）"
            desc="把原始问题一并提交，1–128 个字符，有助于更好地理解搜索意图。"
          />
          <Toggle
            id="optHighlight"
            checked={s.highlight}
            onChange={(v) => set({ highlight: v })}
            title="在结果中高亮关键词"
            desc="按 query 中的词（含「精确短语」）高亮标题与摘要。"
          />
          <Toggle
            id="optHistory"
            checked={s.recordHistory}
            onChange={(v) => set({ recordHistory: v })}
            title="记录搜索历史"
            desc="保存查询与时间（最多 60 条）到本机 IndexedDB。"
          />
          <Toggle
            id="optRemember"
            checked={s.rememberResults}
            onChange={(v) => set({ rememberResults: v })}
            title="在历史中保存结果快照"
            desc="关闭后只记录查询本身，历史条目无法离线回看结果。"
          />
          <Toggle
            id="optDemo"
            checked={s.demo}
            onChange={(v) => set({ demo: v })}
            title="演示模式（内置样例数据）"
            desc="不发起真实请求、不消耗额度，用于预览界面与联调；需要真实结果时请关闭。"
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>用量与数据</h2>
          <p className="muted">
            费用按每 1,000 次成功且产生结果的请求 {PRICE_PER_1000} 元估算，仅供参考，请以官方账单为准。
          </p>
        </div>
        <div className="usage-grid">
          <div className="stat">
            <div className="k">搜索请求</div>
            <div className="v">
              {formatNumber(app.usage.searchCalls)}
              <span className="u">次</span>
            </div>
          </div>
          <div className="stat">
            <div className="k">抓取请求</div>
            <div className="v">
              {formatNumber(app.usage.fetchCalls)}
              <span className="u">次</span>
            </div>
          </div>
          <div className="stat accent">
            <div className="k">计费请求（估算）</div>
            <div className="v">{formatNumber(app.derived.billable)}</div>
          </div>
          <div className="stat warn">
            <div className="k">估算花费</div>
            <div className="v">¥{app.derived.estimatedCost.toFixed(3)}</div>
          </div>
        </div>

        <div className="field-foot">
          <span className="hint">密钥在 localStorage；历史 / 统计 / 缓存在 IndexedDB。没有账号、没有服务端存储。</span>
          <div className="btn-group">
            <button type="button" className="btn ghost sm" onClick={exportSettings}>
              导出设置
            </button>
            <CopyButton
              text={() =>
                JSON.stringify(
                  {
                    base: app.base,
                    keyStored: app.hasKey,
                    settings: app.settings,
                    usage: app.usage,
                    transport: app.proxy.ok ? 'proxy 可用' : 'proxy 不可用',
                  },
                  null,
                  2,
                )
              }
              label="复制诊断信息"
              className="btn ghost sm"
              onDone={(ok) => toast({ tone: ok ? 'ok' : 'err', title: ok ? '诊断信息已复制' : '复制失败' })}
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>安全说明</h2>
        </div>
        <div className="toggle-list">
          <div className="banner" style={{ margin: 0 }}>
            <IconShield size={17} />
            <div>
              <strong>密钥永远不会离开这台机器（除了发给 DeepSeek）。</strong>
              <div className="hint" style={{ marginTop: 4 }}>
                开发转发只做同源转发与 Authorization 透传，不写入日志、不写入磁盘、不做任何中转存储。
                清除浏览器数据或在无痕窗口打开，密钥即失效。
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="danger-zone">
          <div>
            <h3>清空本机数据</h3>
            <p className="muted">移除密钥、基址、偏好、搜索历史、统计、缓存与最近抓取（不可恢复）</p>
          </div>
          <button
            type="button"
            className="btn danger"
            onClick={async () => {
              if (
                await confirm({
                  title: '清空全部本机数据？',
                  text: '密钥、设置、搜索历史、用量统计、搜索缓存与最近抓取都会被删除，且无法恢复。',
                  okLabel: '全部清空',
                })
              ) {
                app.wipeAll();
                session.clearSearch();
                setDraftBase(DEFAULT_BASE);
                toast({ tone: 'ok', title: '已清空本机数据' });
              }
            }}
          >
            <IconTrash size={15} /> 全部清空
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>接口速览</h2>
          <p className="muted">
            完整说明见官方文档：
            <a href="https://api-docs.deepseek.com/zh-cn/guides/search/" target="_blank" rel="noopener noreferrer">
              {' '}网页搜索与抓取指南 <IconExternal size={12} style={{ verticalAlign: '-1px' }} />
            </a>
          </p>
        </div>

        <div className="syntax-grid">
          <div className="syntax-item">
            <code>POST /v1/tools/search</code>
            <span>query(必填, ≤128 字符) · count(1–50, 默认 10) · ori_question · localization · need_content</span>
          </div>
          <div className="syntax-item">
            <code>POST /v1/tools/fetch</code>
            <span>url(必填, ≤8192, 含 host 的 http/https, 不能带用户名密码) → title + Markdown 正文</span>
          </div>
          <div className="syntax-item">
            <code>错误码</code>
            <span>400 参数 · 401 鉴权 · 402 余额 · 403 策略拒绝 · 404 无可用内容 · 408 超时 · 413 过大 · 429 限速 · 5xx 服务端</span>
          </div>
          <div className="syntax-item">
            <code>限速</code>
            <span>Search 与 Fetch 各自独立，账号级 5 QPS；Fetch 对单域名另有 QPS 限制。</span>
          </div>
          <div className="syntax-item">
            <code>计费</code>
            <span>按请求次数计费：每 1,000 次成功请求 5 元。失败、无结果、超时不计费。</span>
          </div>
          <div className="syntax-item">
            <code>返回字段</code>
            <span>rerank_score(0–3) · title · url · snippet · summary · content · site_name · site_icon · date · authority(0–4)</span>
          </div>
        </div>
      </div>
    </>
  );
}
