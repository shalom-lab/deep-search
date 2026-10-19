/** 设置页：密钥 / 搜索默认 / 其它（紧凑分区）。 */
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

function Toggle({ id, checked, onChange, title, desc }) {
  return (
    <label className="toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track">
        <span className="knob" />
      </span>
      <span className="tl-text">
        <strong>{title}</strong>
        {desc ? <small>{desc}</small> : null}
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
    if (s.demo) return { cls: 'state warn', text: '演示模式（不发真实请求）' };
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

  const commitBase = () => {
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
    <div className="settings-page">
      {/* ── 密钥 ── */}
      <section className="panel settings-card">
        <div className="panel-head tight">
          <h2>密钥</h2>
          <p>
            BYOK：只存本机 <code>localStorage</code>（<code>{STORAGE_KEYS.key}</code>），
            请求时直连 <code>api.deepseek.com</code>。
          </p>
        </div>

        <div className="field compact">
          <label htmlFor="apiKeyInput">
            DeepSeek API Key
            <span className={keyState.cls} style={{ marginLeft: 8, fontWeight: 500 }}>
              {app.hasKey && !s.demo ? <IconCheck size={13} /> : null}
              {keyState.text}
            </span>
          </label>
          <div className="input-wrap">
            <IconKey size={16} />
            <input
              id="apiKeyInput"
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder={app.hasKey ? '已保存，粘贴新值可覆盖' : 'sk-…'}
              spellCheck="false"
              autoComplete="off"
              disabled={saving}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            />
          </div>
          <div className="field-foot">
            <span className="hint">保存前会用 count=1 验证一次连接</span>
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
                <IconTrash size={13} />
                清除
              </button>
            </div>
          </div>
        </div>

        <div className="field compact">
          <label htmlFor="baseInput">API 基址</label>
          <input
            id="baseInput"
            type="text"
            value={draftBase}
            onChange={(e) => setDraftBase(e.target.value)}
            onBlur={commitBase}
            placeholder={DEFAULT_BASE}
            spellCheck="false"
          />
          <p className="hint">默认 <code>{DEFAULT_BASE}</code>；一般无需改动。</p>
        </div>

        <div className="settings-note">
          <IconShield size={14} />
          <span>密钥只发给 DeepSeek；清除浏览器数据或无痕窗口即失效。</span>
        </div>
      </section>

      {/* ── 搜索默认 ── */}
      <section className="panel settings-card">
        <div className="panel-head tight">
          <h2>搜索默认</h2>
        </div>

        <div className="grid-2 compact-grid">
          <div className="field compact">
            <label htmlFor="countRange">
              返回条数 <span className="dim">count</span>
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
          </div>

          <div className="field compact">
            <label htmlFor="locInput">
              localization <span className="dim">可选</span>
            </label>
            <input
              id="locInput"
              type="text"
              value={s.localization}
              onChange={(e) => set({ localization: e.target.value })}
              placeholder="IP，如 1.2.3.4"
              spellCheck="false"
            />
          </div>
        </div>

        <div className="field compact">
          <label htmlFor="oriInput">
            固定 ori_question <span className="dim">可选 · {queryChars}/128</span>
          </label>
          <input
            id="oriInput"
            type="text"
            maxLength={128}
            value={s.oriQuestion}
            onChange={(e) => set({ oriQuestion: e.target.value.slice(0, 128) })}
            placeholder="留空则使用搜索框原文"
            spellCheck="false"
          />
        </div>

        <div className="toggle-list compact-toggles">
          <Toggle
            id="optNeedContent"
            checked={s.needContent}
            onChange={(v) => set({ needContent: v })}
            title="默认请求网页正文"
            desc="need_content=true，更全但更慢"
          />
          <Toggle
            id="optDeep"
            checked={s.deepIntent}
            onChange={(v) => set({ deepIntent: v })}
            title="默认开启意图增强"
            desc="一并提交 ori_question"
          />
        </div>
      </section>

      {/* ── 其它 ── */}
      <section className="panel settings-card">
        <div className="panel-head tight">
          <h2>其它</h2>
        </div>

        <div className="toggle-list compact-toggles">
          <Toggle
            id="optHighlight"
            checked={s.highlight}
            onChange={(v) => set({ highlight: v })}
            title="结果中高亮关键词"
          />
          <Toggle
            id="optHistory"
            checked={s.recordHistory}
            onChange={(v) => set({ recordHistory: v })}
            title="记录搜索历史"
            desc="最多 60 条，存 IndexedDB"
          />
          <Toggle
            id="optRemember"
            checked={s.rememberResults}
            onChange={(v) => set({ rememberResults: v })}
            title="历史中保存结果快照"
          />
          <Toggle
            id="optDemo"
            checked={s.demo}
            onChange={(v) => set({ demo: v })}
            title="演示模式"
            desc="内置样例，不发真实请求"
          />
        </div>

        <hr className="settings-divider" />

        <div className="usage-inline">
          <div>
            <span className="k">搜索</span>
            <strong>{formatNumber(app.usage.searchCalls)}</strong>
          </div>
          <div>
            <span className="k">抓取</span>
            <strong>{formatNumber(app.usage.fetchCalls)}</strong>
          </div>
          <div>
            <span className="k">计费估</span>
            <strong>{formatNumber(app.derived.billable)}</strong>
          </div>
          <div>
            <span className="k">花费估</span>
            <strong>¥{app.derived.estimatedCost.toFixed(3)}</strong>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          按每 1,000 次成功请求 {PRICE_PER_1000} 元估算，仅供参考。
        </p>

        <div className="field-foot" style={{ marginTop: 10 }}>
          <span className="hint">密钥 LS · 历史/统计 IDB</span>
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
                    proxy: app.proxy.ok ? 'available' : 'none',
                  },
                  null,
                  2,
                )
              }
              label="复制诊断"
              className="btn ghost sm"
              onDone={(ok) => toast({ tone: ok ? 'ok' : 'err', title: ok ? '诊断信息已复制' : '复制失败' })}
            />
          </div>
        </div>

        <hr className="settings-divider" />

        <div className="danger-zone compact">
          <div>
            <h3>清空本机数据</h3>
            <p className="muted">密钥、偏好、历史、统计与缓存（不可恢复）</p>
          </div>
          <button
            type="button"
            className="btn danger sm"
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
            <IconTrash size={14} /> 全部清空
          </button>
        </div>

        <details className="settings-details">
          <summary>接口速览</summary>
          <p className="hint" style={{ marginTop: 8 }}>
            文档：
            <a href="https://api-docs.deepseek.com/zh-cn/guides/search/" target="_blank" rel="noopener noreferrer">
              网页搜索与抓取指南 <IconExternal size={11} style={{ verticalAlign: '-1px' }} />
            </a>
          </p>
          <div className="syntax-grid tight">
            <div className="syntax-item">
              <code>POST /v1/tools/search</code>
              <span>query · count · ori_question · localization · need_content</span>
            </div>
            <div className="syntax-item">
              <code>POST /v1/tools/fetch</code>
              <span>url → title + Markdown</span>
            </div>
            <div className="syntax-item">
              <code>限速 / 计费</code>
              <span>各 5 QPS；每 1,000 次成功请求 5 元</span>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}
