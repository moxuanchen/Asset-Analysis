/* ===== 资产面板：个人资产配置的录入与总览 =====
   独立全局模块，由 app.js 的 init() 及路由切换调用。
   数据存 FlibStore（localStorage / IndexedDB 回退），随「设置 → 数据」整体导入导出。
   纯本地、零外部依赖：占比环形图用手绘 SVG，不引第三方图表库（贴合项目离线降级策略）。
*/
'use strict';

const AssetPanel = (() => {
  /* 类别定义：id / 中文标签 / 视觉图标 / 与主题协调的配色（暖陶土基调 + 冷暖平衡） */
  const CATEGORIES = [
    { id: 'cash',       label: '现金及存款', icon: '💵', color: '#C96442' },
    { id: 'stock',      label: '股票',       icon: '📈', color: '#D98C5F' },
    { id: 'fund',       label: '基金与 ETF', icon: '📊', color: '#E0B450' },
    { id: 'bond',       label: '债券',       icon: '📜', color: '#6E9E8F' },
    { id: 'realestate', label: '房产',       icon: '🏠', color: '#5B7DB1' },
    { id: 'gold',       label: '黄金与商品', icon: '🪙', color: '#B8862F' },
    { id: 'crypto',     label: '加密货币',   icon: '⚡', color: '#8E6FB0' },
    { id: 'other',      label: '其他',       icon: '💼', color: '#9A8C7A' }
  ];
  const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

  const ICON = {
    asset: '<svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="10" y="20" width="44" height="30" rx="6" fill="var(--primary-soft)" stroke="var(--primary)"/><path d="M10 30h44" stroke="var(--primary)"/><circle cx="40" cy="35" r="5" stroke="var(--primary)"/><path d="M22 14v8M32 12v10M42 14v8" opacity=".6"/></svg>',
    edit: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.5 4.5l3 3L9 18l-3.5.5.5-3.5z"/><path d="M14.5 6.5l3 3"/></svg>',
    del: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>'
  };

  let assets = [];
  let editId = null;        // 编辑中的资产 id；null 表示新增
  let modalBound = false;
  let lastModalFocus = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmtMoney = (n) => '¥' + (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMoneyShort = (n) => '¥' + (Number(n) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const pad = (n) => String(n).padStart(2, '0');
  const newId = () => 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const fmtTimeShort = (ts) => {
    if (!ts) return '暂无记录';
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const latestTs = () => assets.reduce((m, a) => Math.max(m, a.updatedAt || a.createdAt || 0), 0);

  /* ---------- 初始化：加载数据并首次渲染 ---------- */
  async function init() {
    try { assets = await FlibStore.loadAssets(); } catch (e) { assets = []; }
    bindModalOnce();
    renderAssets();
  }

  /* ---------- 占比统计 ---------- */
  function byCategory() {
    const map = {};
    for (const c of CATEGORIES) map[c.id] = 0;
    for (const a of assets) {
      const cat = CAT[a.category] ? a.category : 'other';
      map[cat] += Number(a.amount) || 0;
    }
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    return { map, total };
  }

  /* ---------- 渲染总览 ---------- */
  function renderAssets() {
    const root = $('view-assets');
    if (!root) return;
    if (!assets.length) {
      root.innerHTML = emptyHtml();
      const b = $('asset-add-empty');
      if (b) b.addEventListener('click', () => openModal(null));
      return;
    }
    const { map, total } = byCategory();
    const segs = CATEGORIES.map(c => ({ ...c, amount: map[c.id] })).filter(c => c.amount > 0);
    
    // 寻找最大配置类别
    const topCat = segs.slice().sort((a, b) => b.amount - a.amount)[0];
    const topCatPct = total > 0 && topCat ? ((topCat.amount / total) * 100).toFixed(1) : '0.0';

    root.innerHTML =
      `<div class="asset-head">
        <div>
          <h2 class="asset-title">资产面板</h2>
          <p class="asset-desc">可视化总览与分类配置，全面掌握个人财务状况</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="asset-add">＋ 添加资产</button>
      </div>
      <div class="asset-overview">
        <div class="asset-card asset-summary">
          <div class="asset-summary-top">
            <span class="asset-summary-label">总资产（CNY）</span>
            <span class="asset-summary-total">${fmtMoney(total)}</span>
            <span class="asset-summary-meta">更新于 ${fmtTimeShort(latestTs())}</span>
          </div>
          <div class="asset-summary-stats">
            <div class="asset-stat-item">
              <span class="asset-stat-label">配置项 / 类别</span>
              <span class="asset-stat-val">${assets.length} 项 / ${segs.length} 类</span>
            </div>
            <div class="asset-stat-item">
              <span class="asset-stat-label">最大占比类别</span>
              <span class="asset-stat-val">${topCat ? `${topCat.icon} ${esc(topCat.label)} (${topCatPct}%)` : '—'}</span>
            </div>
          </div>
        </div>
        <div class="asset-card asset-ring-card">
          ${ringHtml(segs, total)}
        </div>
      </div>
      <div class="asset-card asset-list-card">
        ${listHtml(map, total)}
      </div>`;

    const add = $('asset-add');
    if (add) add.addEventListener('click', () => openModal(null));
    root.querySelectorAll('.asset-edit').forEach(btn =>
      btn.addEventListener('click', () => openModal(btn.closest('.asset-item').dataset.id)));
    root.querySelectorAll('.asset-del').forEach(btn =>
      btn.addEventListener('click', () => removeAsset(btn.closest('.asset-item').dataset.id)));
  }

  function emptyHtml() {
    return `<div class="asset-empty">
      <div class="empty-state">
        <div class="empty-illu" aria-hidden="true">${ICON.asset}</div>
        <p class="empty-title">还没有资产配置</p>
        <p class="empty-sub">记录现金、股票、基金、房产等，自动生成占比总览与分类明细</p>
        <div class="empty-actions">
          <button type="button" class="btn btn-primary btn-sm" id="asset-add-empty">＋ 添加第一笔资产</button>
        </div>
      </div>
    </div>`;
  }

  /* ---------- 环形图（手绘 SVG donut） ---------- */
  function ringHtml(segs, total) {
    const cx = 90, cy = 90, r = 64, sw = 20;
    const C = 2 * Math.PI * r;
    let acc = 0;
    const arcs = segs.map(s => {
      const len = total > 0 ? (s.amount / total) * C : 0;
      const off = -acc;
      acc += len;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    }).join('');
    const ringSvg = total > 0
      ? `<svg class="asset-ring" viewBox="0 0 180 180" width="170" height="170" role="img" aria-label="资产分类占比环形图">${arcs}</svg>`
      : `<svg class="asset-ring" viewBox="0 0 180 180" width="170" height="170" role="img" aria-label="暂无资产"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${sw}"/></svg>`;
    const center = total > 0
      ? `<div class="asset-ring-center"><span class="asset-ring-center-label">总净值</span><span class="asset-ring-center-value" title="${fmtMoney(total)}">${fmtMoneyShort(total)}</span></div>`
      : '';
    const legend = segs.map(s => {
      const pct = total > 0 ? ((s.amount / total) * 100).toFixed(1) : '0.0';
      return `<div class="asset-legend-item" title="${esc(s.label)}：${fmtMoney(s.amount)} (${pct}%)">
        <span class="asset-legend-dot" style="background:${s.color}"></span>
        <span class="asset-legend-label">${s.icon} ${esc(s.label)}</span>
        <span class="asset-legend-val">${fmtMoneyShort(s.amount)} · ${pct}%</span>
      </div>`;
    }).join('');
    return `<div class="asset-ring-wrap">${ringSvg}${center}</div><div class="asset-ring-legend">${legend}</div>`;
  }

  /* ---------- 明细列表（按类别分组，含占比条） ---------- */
  function listHtml(map, total) {
    const present = CATEGORIES.filter(c => map[c.id] > 0);
    if (!present.length) return '<p class="muted">暂无资产配置</p>';
    return present.map(cat => {
      const items = assets
        .filter(a => (CAT[a.category] ? a.category : 'other') === cat.id)
        .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
      const catTotal = map[cat.id];
      const pct = total > 0 ? (catTotal / total) * 100 : 0;
      return `<div class="asset-group">
        <div class="asset-group-head">
          <span class="asset-group-icon" aria-hidden="true">${cat.icon}</span>
          <span class="asset-group-label">${esc(cat.label)}</span>
          <span class="asset-group-pct">${pct.toFixed(1)}%</span>
          <span class="asset-group-amount">${fmtMoney(catTotal)}</span>
        </div>
        <div class="asset-bar"><div class="asset-bar-fill" style="width:${pct.toFixed(1)}%;background:${cat.color}"></div></div>
        <ul class="asset-items">
          ${items.map(a => `<li class="asset-item" data-id="${a.id}">
            <div class="asset-item-info">
              <span class="asset-item-name" title="${esc(a.name)}">${esc(a.name)}</span>
              ${a.note ? `<span class="asset-item-note" title="${esc(a.note)}">${esc(a.note)}</span>` : ''}
            </div>
            <span class="asset-item-amount">${fmtMoney(a.amount)}</span>
            <span class="asset-item-actions">
              <button type="button" class="icon-btn asset-edit" title="编辑「${esc(a.name)}」" aria-label="编辑">${ICON.edit}</button>
              <button type="button" class="icon-btn asset-del" title="删除「${esc(a.name)}」" aria-label="删除">${ICON.del}</button>
            </span>
          </li>`).join('')}
        </ul>
      </div>`;
    }).join('');
  }

  /* ---------- 录入弹窗 ---------- */
  function openModal(id) {
    lastModalFocus = document.activeElement;
    editId = id || null;
    const a = id ? assets.find(x => x.id === id) : null;
    $('asset-f-name').value = a ? a.name : '';
    $('asset-f-cat').value = a ? (CAT[a.category] ? a.category : 'other') : 'cash';
    $('asset-f-amount').value = a ? a.amount : '';
    $('asset-f-note').value = a ? (a.note || '') : '';
    $('asset-modal-title').textContent = a ? '编辑资产' : '添加资产';
    
    const modal = $('modal-asset');
    if (modal) {
      modal.classList.remove('hidden');
      setTimeout(() => $('asset-f-name').focus(), 40);
    }
  }

  function closeModal() {
    const m = $('modal-asset');
    if (m) m.classList.add('hidden');
    if (lastModalFocus && typeof lastModalFocus.focus === 'function') {
      lastModalFocus.focus();
    }
  }

  function bindModalOnce() {
    if (modalBound) return;
    modalBound = true;
    const modal = $('modal-asset');
    if (!modal) return;
    
    modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeModal));
    $('asset-save').addEventListener('click', saveAsset);
    
    // 表单回车自动保存
    ['asset-f-name', 'asset-f-cat', 'asset-f-amount', 'asset-f-note'].forEach(id => {
      const el = $(id);
      if (el) {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            saveAsset();
          }
        });
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeModal();
    });

    // 弹窗 Tab 焦点循环
    modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || modal.classList.contains('hidden')) return;
      const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
      const focusables = [...modal.querySelectorAll(selector)].filter(el => !el.disabled && (el.offsetWidth || el.offsetHeight));
      if (!focusables.length) { e.preventDefault(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  async function saveAsset() {
    const name = $('asset-f-name').value.trim();
    const category = $('asset-f-cat').value;
    const amountVal = $('asset-f-amount').value.trim();
    const amount = parseFloat(amountVal);
    const note = $('asset-f-note').value.trim();
    
    if (!name) {
      UI.toast('请填写资产名称', 'warning');
      $('asset-f-name').focus();
      return;
    }
    if (!amountVal || isNaN(amount) || amount < 0) {
      UI.toast('请输入有效金额（不小于 0）', 'warning');
      $('asset-f-amount').focus();
      return;
    }

    if (editId) {
      const idx = assets.findIndex(x => x.id === editId);
      if (idx > -1) {
        assets[idx] = { ...assets[idx], name, category, amount, note, updatedAt: Date.now() };
      }
    } else {
      assets.push({ id: newId(), name, category, amount, note, createdAt: Date.now(), updatedAt: Date.now() });
    }
    
    await FlibStore.saveAssets(assets);
    closeModal();
    renderAssets();
    UI.toast(editId ? '资产修改已保存' : '已添加新资产', 'success');
  }

  async function removeAsset(id) {
    const item = assets.find(x => x.id === id);
    const label = item ? item.name : '该资产';
    if (!await UI.confirm(`确定删除资产「<b>${esc(label)}</b>」吗？此操作不可撤销。`, { title: '删除资产', danger: true, okText: '删除' })) {
      return;
    }
    assets = assets.filter(x => x.id !== id);
    await FlibStore.saveAssets(assets);
    renderAssets();
    UI.toast('已删除资产', 'success');
  }

  return { init, renderAssets };
})();

/* 确保全局挂载，兼顾严格模式与模块环境 */
if (typeof window !== 'undefined') {
  window.AssetPanel = AssetPanel;
}

