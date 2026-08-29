/* ===== UI 工具模块：Toast 通知 / 自定义确认对话框 / 按钮加载态 / 主题切换 ===== */
'use strict';

const UI = (() => {
  /* ---------- Toast 通知 ---------- */
  // 不同类型对应的迷你图标字符（中文环境下，符号优于 emoji 以确保字体一致）
  const TOAST_ICON = {
    success: '✓',
    error: '✕',
    warning: '!',
    info: 'i'
  };
  function toast(msg, type = 'info', duration = 2800) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    const icon = TOAST_ICON[type] || TOAST_ICON.info;
    el.innerHTML = `<span class="toast-icon" aria-hidden="true">${icon}</span><span class="toast-msg"></span><button class="toast-x" aria-label="关闭">✕</button>`;
    el.querySelector('.toast-msg').textContent = msg;
    container.appendChild(el);

    const remove = () => {
      if (!el.isConnected) return;
      el.classList.add('out');
      setTimeout(() => el.remove(), 230);
    };
    el.querySelector('.toast-x').addEventListener('click', remove);
    const timer = setTimeout(remove, duration);
    // 悬停时暂停自动关闭
    el.addEventListener('mouseenter', () => clearTimeout(timer));
  }

  /* ---------- 自定义确认对话框（返回 Promise<boolean>） ---------- */
  function confirm(message, opts = {}) {
    return new Promise(resolve => {
      const title = opts.title || '请确认';
      const okText = opts.okText || '确定';
      const cancelText = opts.cancelText || '取消';
      const danger = !!opts.danger;
      const iconType = opts.icon || (danger ? 'danger' : 'info');
      // 图标映射（28px 圆底色块图标）
      const iconMap = {
        danger: { emoji: '⚠️', bg: 'var(--danger-soft)', color: 'var(--danger)' },
        warning: { emoji: '⚠️', bg: 'var(--warning-soft)', color: 'var(--warning)' },
        info: { emoji: 'ℹ️', bg: 'var(--primary-soft)', color: 'var(--primary)' },
        success: { emoji: '✓', bg: 'var(--success-soft)', color: 'var(--success)' },
        question: { emoji: '?', bg: 'var(--primary-soft)', color: 'var(--primary)' },
      };
      const iconCfg = iconMap[iconType] || iconMap.info;

      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = `
        <div class="modal-mask" data-close></div>
        <div class="modal-body confirm-dialog" role="dialog" aria-modal="true" aria-label="${title}">
          <div class="modal-head"><h3>${title}</h3><button class="modal-close" data-close aria-label="关闭">✕</button></div>
          <div class="modal-content">
            <div class="confirm-row">
              <span class="confirm-icon" aria-hidden="true" style="background:${iconCfg.bg};color:${iconCfg.color}">${iconCfg.emoji}</span>
              <div class="confirm-msg">${danger ? '<p class="confirm-warn">此操作不可恢复。</p>' : ''}${message}</div>
            </div>
            <div class="confirm-actions">
              <button class="btn btn-ghost" data-cancel>${cancelText}</button>
              <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${okText}</button>
            </div>
          </div>
        </div>`;

      const done = (val) => {
        modal.remove();
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') done(false);
        if (e.key === 'Enter') done(true);
      };

      modal.querySelector('[data-close]').addEventListener('click', () => done(false));
      modal.querySelector('[data-cancel]').addEventListener('click', () => done(false));
      modal.querySelector('[data-ok]').addEventListener('click', () => done(true));
      document.addEventListener('keydown', onKey);

      document.body.appendChild(modal);
      // 危险操作默认焦点在「取消」按钮防误触
      const focusBtn = danger ? modal.querySelector('[data-cancel]') : modal.querySelector('[data-ok]');
      if (focusBtn) focusBtn.focus();
    });
  }

  /* ---------- 按钮加载态（保留原文本，加载时显示小圈） ---------- */
  function setLoading(btn, loading, label) {
    if (!btn) return;
    if (loading) {
      if (btn.dataset.origText === undefined) btn.dataset.origText = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner" aria-hidden="true"></span>${label || btn.dataset.origText}`;
    } else {
      btn.disabled = false;
      if (btn.dataset.origText !== undefined) {
        btn.textContent = btn.dataset.origText;
        delete btn.dataset.origText;
      }
    }
  }

  /* ---------- 主题切换 ---------- */
  const THEME_KEY = 'flib-theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#232220' : '#C96442');
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
    return theme;
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    return next;
  }

  return { toast, confirm, setLoading, initTheme, toggleTheme };
})();