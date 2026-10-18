/** 轻量全局 UI 状态：toast 与确认弹窗。 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { clamp } from '../lib/util.js';

const UIContext = createContext(null);

let toastSeq = 0;

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const timers = useRef(new Map());

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, 200);
    timers.current.set(id, timer);
  }, []);

  /**
   * @param {object} opts
   * @param {'ok'|'err'|'warn'|'info'} [opts.tone]
   * @param {string} opts.title
   * @param {string} [opts.text]
   * @param {number} [opts.duration] 毫秒，0 表示不自动关闭
   * @param {{label:string,onClick:Function,primary?:boolean}[]} [opts.actions]
   */
  const toast = useCallback(
    (opts) => {
      const id = `t${++toastSeq}`;
      const entry = {
        id,
        tone: opts.tone || 'info',
        title: opts.title || '',
        text: opts.text || '',
        actions: opts.actions || [],
        duration: opts.duration ?? (opts.tone === 'err' ? 7000 : 3600),
      };
      setToasts((prev) => [...prev.slice(-3), entry]);
      if (entry.duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => {
            dismissToast(id);
            timers.current.delete(id);
          }, entry.duration),
        );
      }
      return id;
    },
    [dismissToast],
  );

  const runAction = useCallback(
    (action, id) => {
      dismissToast(id);
      try {
        action?.onClick?.();
      } catch (err) {
        console.error('[toast action]', err);
      }
    },
    [dismissToast],
  );

  /** 二次确认；返回 Promise<boolean> */
  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        setConfirmState({
          title: opts?.title || '确认操作',
          text: opts?.text || '',
          okLabel: opts?.okLabel || '确定',
          cancelLabel: opts?.cancelLabel || '取消',
          danger: opts?.danger !== false,
          resolve,
        });
      }),
    [],
  );

  const settleConfirm = useCallback(
    (result) => {
      setConfirmState((prev) => {
        prev?.resolve?.(result);
        return null;
      });
    },
    [],
  );

  useEffect(() => {
    if (!confirmState) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') settleConfirm(false);
      if (e.key === 'Enter') settleConfirm(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmState, settleConfirm]);

  const value = useMemo(
    () => ({ toast, confirm, toasts, dismissToast, runAction, confirmState, settleConfirm }),
    [toast, confirm, toasts, dismissToast, runAction, confirmState, settleConfirm],
  );
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI 必须在 <UIProvider> 内使用');
  return ctx;
}

/** 复制到剪贴板，带降级方案 */
export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* 继续降级 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 触发文件下载 */
export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}

export { clamp };

// 同 store.js：本模块定义 Context，热替换会产生新实例导致 already-mounted 的
// Provider 与子组件不匹配，故要求整页刷新。
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}
