/* ===== 入口：路由、视图渲染与交互绑定 ===== */
'use strict';

(() => {
  /* ---------- 状态 ---------- */
  let items = [];
  let currentId = null;
  let searchQuery = '';
  let expSearchQuery = '';
  let pending = null;            // 添加/编辑弹窗待保存数据
  let batchPending = [];         // 批量预览条目
  let chatHistory = [];          // 当前会话消息 [{role, content}]
  let chatAbort = null;          // AbortController
  let isGenerating = false;      // 是否正在生成（控制停止按钮）
  let sessions = [];             // 全部会话记录
  let currentSessionId = null;   // 当前会话 id
  let experiences = [];          // 经验库 [{id, sourceId, sourceTitle, sourceUrl, content, createdAt}]
  let summarizing = false;       // 是否正在批量总结
  let mentionState = { open: false, query: '', results: [], active: 0, atIndex: -1 };
  let addStepMode = 'single';        // 添加弹窗流程：single（1→2）/ batch（1→3）
  let searchTimer = null;            // 资料库搜索防抖 timer
  let expSearchTimer = null;         // 经验库搜索防抖 timer
  let lastModalFocus = null;         // 打开弹窗前聚焦的元素（关闭后还原）

  const WELCOME_HTML = `
    <div class="chat-welcome empty-state">
      <div class="empty-illu" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="10" y="14" width="44" height="36" rx="6" fill="var(--primary-soft)" stroke="var(--primary)"/>
          <path d="M18 26h28M18 34h22M18 42h16" stroke="var(--primary)"/>
        </svg>
      </div>
      <h2 class="empty-title">你好，我是你的金融资料助手</h2>
      <p class="empty-sub">两种提问方式：直接提问 <b>独立问答</b>，或输入 <b>@</b> 引用资料 / 整个经验库做基于内容的问答。</p>
      <p class="empty-sub muted" id="chat-welcome-hint">请先在 <a href="#/settings?tab=model">设置 → 模型</a> 中填入 DeepSeek API Key，并确保资料库中已有内容。</p>
      <div class="empty-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-suggest="什么是 ROE？与 ROA 区别是什么？">试试「ROE 与 ROA 区别」</button>
        <button type="button" class="btn btn-secondary btn-sm" data-suggest="@ 总结近 5 年货币政策走向">试试「@ 总结资料」</button>
        <button type="button" class="btn btn-secondary btn-sm" data-suggest="用通俗语言解释 LPR 形成机制">试试「LPR 通俗解释」</button>
      </div>
    </div>`;

  /* ---------- 工具 ---------- */
  /* 内联 SVG 插画 / 图标：替代 emoji，保持与聊天欢迎页一致的视觉语言（描边 = 主色） */
  const ICON = {
    book: '<svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14h17a3 3 0 0 1 3 3v33a3 3 0 0 0-3-3H20a3 3 0 0 0-3 3V17a3 3 0 0 1 3-3z"/><path d="M37 14h7a3 3 0 0 1 3 3v33a3 3 0 0 0-3-3h-7" opacity=".55"/><path d="M24 22h16M24 29h16M24 36h10" opacity=".55"/></svg>',
    search: '<svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="28" cy="28" r="14"/><path d="M38.5 38.5L52 52"/></svg>',
    bulb: '<svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M32 14a15 15 0 0 1 9.5 26.7c-2.2 1.8-3.5 4-3.5 6.8H26c0-2.8-1.3-5-3.5-6.8A15 15 0 0 1 32 14z"/><path d="M25 50h14M27.5 55h9" opacity=".6"/></svg>',
    pencil: '<svg class="stat-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.5 4.5l3 3L9 18l-3.5.5.5-3.5z"/><path d="M14.5 6.5l3 3"/></svg>',
    clock: '<svg class="stat-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    copy: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    download: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>'
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => Renderer.escapeHtml(s);
  const hostOf = (url) => { try { return new URL(url).hostname; } catch (e) { return url || ''; } };
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
  const fmtTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const parseTags = (str) => [...new Set(String(str || '').split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean))];
  const newId = () => crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  const fmtShort = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  /** 会话列表相对时间显示：刚刚 / X 分钟前 / X 小时前 / 昨天 / X 天前 / 原格式 */
  const fmtRelative = (ts) => {
    if (!ts) return '';
    const now = Date.now();
    const diff = Math.max(0, now - ts);
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const day = new Date(now), yest = new Date(now - 86400000);
    const isYesterday = (d) => d.getFullYear() === yest.getFullYear() && d.getMonth() === yest.getMonth() && d.getDate() === yest.getDate();
    const d = new Date(ts);
    if (isYesterday(d)) return '昨天';
    const days = Math.floor(h / 24);
    if (days < 7) return days + ' 天前';
    return fmtShort(ts);
  };

  /** 获取容器内可见且可聚焦的元素（用于弹窗焦点陷阱） */
  function getFocusable(root) {
    if (!root) return [];
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    return [...root.querySelectorAll(selector)].filter(el =>
      !el.disabled && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)
    );
  }

  /** 移动端会话抽屉展开/收起（≤900px 生效；桌面端样式默认隐藏按钮，调用无副作用） */
  function setSessionDrawer(open) {
    const sidebar = document.querySelector('.session-sidebar');
    const mask = $('session-drawer-mask');
    const btn = $('btn-sessions');
    if (sidebar) sidebar.classList.toggle('is-open', open);
    if (mask) mask.classList.toggle('hidden', !open);
    if (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? '收起对话列表' : '打开对话列表');
    }
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    UI.initTheme();
    items = await FlibStore.loadItems();
    experiences = await FlibStore.loadExperiences();
    sessions = await FlibStore.loadSessions();
    // 按创建时间升序排列，保证会话列表位置稳定（最早在前，最新在后）
    sessions.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (!sessions.length) {
      currentSessionId = newId();
      sessions = [{ id: currentSessionId, title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [] }];
      await FlibStore.saveSessions(sessions);
      FlibStore.setCurrentSessionId(currentSessionId);
      chatHistory = [];
    } else {
      // 恢复上次查看的会话，找不到则用第一个
      const savedId = FlibStore.getCurrentSessionId();
      let target = savedId ? sessions.find(s => s.id === savedId) : null;
      if (!target) target = sessions[0];
      currentSessionId = target.id;
      FlibStore.setCurrentSessionId(currentSessionId);
      chatHistory = (target.messages || []).map(m => ({
        role: m.role,
        content: m.content,
        ...(m.sources && m.sources.length ? { sources: m.sources } : {})
      }));
    }
    bindEvents();
    route();
    renderLibrary();
    renderExperienceList();
    updateExpBanner();
    renderSessionList();
    renderChatMessages();
    if (window.AssetPanel && typeof window.AssetPanel.init === 'function') {
      window.AssetPanel.init();
    } else if (typeof AssetPanel !== 'undefined' && typeof AssetPanel.init === 'function') {
      AssetPanel.init();
    }
    fillSettings();
    updateDataCount();
    updateOnboarding();
    setupReducedMotion();
    // 首屏 lib-detail 的 empty-state 按钮（初始 HTML 存在）
    const libDetailAdd = $('lib-detail-add');
    if (libDetailAdd) libDetailAdd.addEventListener('click', () => openAddModal());
  }

  /** 监听 prefers-reduced-motion 媒体查询，写 html[data-rm] 兜底 */
  function setupReducedMotion() {
    const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (!mq) return;
    const apply = () => document.documentElement.setAttribute('data-rm', mq.matches ? 'true' : 'false');
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply); // Safari 旧版
  }

  /** 检测 API Key 与首启状态，更新 onboarding 提示与角标 */
  function updateOnboarding() {
    let s;
    try { s = FlibStore.getSettings(); } catch (e) { s = null; }
    const noKey = !s || !s.apiKey;
    const badge = $('onboard-badge');
    if (badge) badge.classList.toggle('hidden', !noKey);
  }

  /* ---------- 路由 ---------- */
  function route() {
    const raw = (location.hash || '#/library').replace('#/', '');
    const [view, queryStr] = raw.split('?');
    const safeView = view || 'library';
    const params = new URLSearchParams(queryStr || '');
    document.querySelectorAll('.view').forEach(v => {
      v.classList.add('hidden');
      v.classList.remove('view-entering', 'view-enter');
    });
    const target = $('view-' + safeView);
    if (target) {
      // 两帧动画：先设起始态（透明+下移）再在 rAF 后触发过渡到终态
      target.classList.add('view-entering');
      target.classList.remove('hidden');
      // 双 rAF：确保浏览器先应用起始态，再触发过渡
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          target.classList.remove('view-entering');
          target.classList.add('view-enter');
          // 动画结束后清理类名
          const onEnd = () => {
            target.classList.remove('view-enter');
            target.removeEventListener('animationend', onEnd);
          };
          target.addEventListener('animationend', onEnd);
        });
      });
    }
    // 导航 active 态：以 [aria-current="page"] 作为唯一真相源（语义优先）
    const navItems = document.querySelectorAll('.nav-item');
    let firstMatch = null;
    navItems.forEach(n => {
      const isActive = n.dataset.route === safeView;
      if (isActive) {
        n.classList.add('active');
        n.setAttribute('aria-current', 'page');
        if (!firstMatch) firstMatch = n;
      } else {
        n.classList.remove('active');
        n.removeAttribute('aria-current');
      }
    });
    // 设置页 Tab：解析 ?tab=data
    if (safeView === 'settings') {
      const tab = (params.get('tab') || 'model').toLowerCase();
      switchSettingsTab(tab === 'data' ? 'data' : 'model', { skipUrl: true });
    }
    // 资产面板：切换进入时确保重新渲染并展示最新统计
    if (safeView === 'assets') {
      if (window.AssetPanel && typeof window.AssetPanel.renderAssets === 'function') {
        window.AssetPanel.renderAssets();
      }
    }
    // 切换视图时清除列表键盘高亮，避免残留焦点态
    ['lib-list', 'exp-list'].forEach(id => {
      const box = $(id);
      if (box) box.querySelectorAll('.kbd-active').forEach(el => el.classList.remove('kbd-active'));
    });
    // 路由切换后，将焦点交给当前 active 导航（仅在用户用键盘/外部链接进入时）
    // ——避免每次 hashchange 抢焦点造成阅读中断，故不自动聚焦。
  }

  /** 设置页 Tab 切换（支持程序 / URL 双向） */
  function switchSettingsTab(tab, opts) {
    const safeTab = tab === 'data' ? 'data' : 'model';
    document.querySelectorAll('[data-settings-tab]').forEach(btn => {
      const isActive = btn.dataset.settingsTab === safeTab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    const modelPanel = $('settings-panel-model');
    const dataPanel = $('settings-panel-data');
    if (modelPanel) modelPanel.classList.toggle('hidden', safeTab !== 'model');
    if (dataPanel) dataPanel.classList.toggle('hidden', safeTab !== 'data');
    // 同步 URL（用户点击 tab 时更新）
    if (!opts || !opts.skipUrl) {
      const cur = (location.hash || '').replace('#/', '').split('?')[0] || 'settings';
      if (cur === 'settings') {
        const newHash = '#/settings?tab=' + safeTab;
        if (location.hash !== newHash) {
          // replaceState 避免污染 history
          history.replaceState(null, '', newHash);
        }
      }
    }
  }
  window.addEventListener('hashchange', route);

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    // 主题切换
    $('btn-theme').addEventListener('click', () => UI.toggleTheme());
    // 搜索（防抖 250ms，避免每击键全量搜索）
    $('search-input').addEventListener('input', e => {
      searchQuery = e.target.value;
      updateSearchClearBtn();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderLibrary, 250);
    });
    // 搜索清除按钮
    $('search-clear').addEventListener('click', clearLibrarySearch);
    // 经验库搜索（防抖）
    $('exp-search').addEventListener('input', e => {
      expSearchQuery = e.target.value;
      const expClear = $('exp-search-clear');
      if (expClear) expClear.classList.toggle('visible', !!e.target.value);
      clearTimeout(expSearchTimer);
      expSearchTimer = setTimeout(renderExperienceList, 250);
    });
    $('exp-search-clear')?.addEventListener('click', () => {
      expSearchQuery = '';
      const exp = $('exp-search'); if (exp) exp.value = '';
      const expClear = $('exp-search-clear'); if (expClear) expClear.classList.remove('visible');
      renderExperienceList();
      if (exp) exp.focus();
    });
    // 全局键盘快捷键：`/` 或 Ctrl/Cmd+K 聚焦资料库搜索；Esc 清空并失焦
    document.addEventListener('keydown', e => {
      // 在输入框/textarea/可编辑元素中不拦截 Esc / /
      const ae = document.activeElement;
      const isEditable = ae && (
        ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable ||
        ae.getAttribute('role') === 'textbox' || ae.getAttribute('role') === 'combobox'
      );
      // Esc：在搜索框非空时清空搜索
      if (e.key === 'Escape') {
        if (isEditable && (ae.id === 'search-input' || ae.id === 'exp-search')) {
          if (ae.value) {
            ae.value = '';
            ae.dispatchEvent(new Event('input', { bubbles: true }));
            ae.blur();
            e.preventDefault();
          }
          return;
        }
        // 弹窗已在 document.keydown 关闭（Escape→closeModal），此处不重复
      }
      // Ctrl/Cmd+K：聚焦资料库搜索
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (location.hash !== '#/library') location.hash = '#/library';
        setTimeout(() => { const inp = $('search-input'); if (inp) inp.focus(); }, 30);
        return;
      }
      // `/`：在非编辑态聚焦资料库搜索（GitHub 风格）
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditable) {
        e.preventDefault();
        if (location.hash !== '#/library') location.hash = '#/library';
        setTimeout(() => { const inp = $('search-input'); if (inp) inp.focus(); }, 30);
      }
    });
    // 列表点击（事件委托）
    $('lib-list').addEventListener('click', e => {
      const itemEl = e.target.closest('.lib-item');
      if (itemEl) renderDetail(itemEl.dataset.id);
    });
    // 添加资料
    $('btn-add').addEventListener('click', () => openAddModal());
    // 添加弹窗 Tab 切换
    document.querySelectorAll('.add-tab').forEach(tab => tab.addEventListener('click', () => switchAddTab(tab.dataset.tab)));
    // 文件选择与拖拽
    $('btn-pick-file').addEventListener('click', () => $('add-file').click());
    $('add-file').addEventListener('change', e => handleFiles([...e.target.files]));
    const drop = $('file-drop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]);
    });
    // 批量保存
    $('btn-save-batch').addEventListener('click', saveBatch);
    // 经验库搜索（防抖）
    $('exp-search').addEventListener('input', e => {
      expSearchQuery = e.target.value;
      clearTimeout(expSearchTimer);
      expSearchTimer = setTimeout(renderExperienceList, 250);
    });
    $('btn-summarize-all').addEventListener('click', summarizeAll);
    $('exp-list').addEventListener('click', e => {
      // 经验来源跳转：点击卡片标题直接定位到资料库对应条目
      const jump = e.target.closest('[data-jump-source]');
      if (jump) {
        const sid = jump.dataset.jumpSource;
        location.hash = '#/library';
        setTimeout(() => renderDetail(sid), 30);
        return;
      }
      const btn = e.target.closest('[data-act]');
      const card = e.target.closest('.exp-card');
      if (!btn || !card) return;
      if (btn.dataset.act === 'del') deleteExperience(card.dataset.id);
      if (btn.dataset.act === 'regenerate') {
        btn.disabled = true;
        UI.toast('正在重新生成经验…', 'info');
        summarizeItem(card.dataset.sourceId, true).finally(() => { btn.disabled = false; });
      }
    });
    // 弹窗关闭
    document.querySelectorAll('#modal-add [data-close]').forEach(el => el.addEventListener('click', closeModal));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    // 弹窗焦点陷阱：Tab 在弹窗内循环
    const modalAdd = $('modal-add');
    if (modalAdd) {
      modalAdd.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab' || modalAdd.classList.contains('hidden')) return;
        const focusables = getFocusable(modalAdd);
        if (!focusables.length) { e.preventDefault(); return; }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
    }
    // 移动端会话抽屉：唤起按钮 / 遮罩关闭
    const btnSessions = $('btn-sessions');
    if (btnSessions) {
      btnSessions.addEventListener('click', () => {
        const sidebar = document.querySelector('.session-sidebar');
        setSessionDrawer(!(sidebar && sidebar.classList.contains('is-open')));
      });
    }
    const sessionMask = $('session-drawer-mask');
    if (sessionMask) sessionMask.addEventListener('click', () => setSessionDrawer(false));
    // Stepper：返回上一步（恢复输入数据由 setAddStep 自身处理）
    const btnBackPreview = $('btn-back-preview');
    if (btnBackPreview) btnBackPreview.addEventListener('click', () => setAddStep('input'));
    const btnBackBatch = $('btn-back-batch');
    if (btnBackBatch) btnBackBatch.addEventListener('click', () => {
      // 批量返回时清空 batchPending，避免下次直接落到旧状态
      batchPending = [];
      setAddStep('input');
    });
    // 抓取 / 解析：主按钮行为随当前激活的来源 Tab 分发
    $('btn-fetch').addEventListener('click', () => {
      const fileTab = document.querySelector('.add-tab[data-tab="file"]');
      if (fileTab && fileTab.classList.contains('active')) { $('add-file').click(); return; }
      doFetch();
    });
    $('btn-refetch').addEventListener('click', doFetch);
    // 手动粘贴内容兜底
    $('btn-paste-add').addEventListener('click', doPasteAdd);
    // 保存
    $('btn-save-item').addEventListener('click', saveItem);
    // 聊天
    $('btn-send').addEventListener('click', () => {
      if (isGenerating) { if (chatAbort) chatAbort.abort(); }
      else sendMessage();
    });
    // 消息操作（重新回答）
    $('chat-messages').addEventListener('click', e => {
      const act = e.target.closest('[data-act="regenerate"]');
      if (act) {
        const wrap = e.target.closest('.msg');
        if (wrap) regenerateReply(wrap);
        return;
      }
      // 示例问题卡片：填入输入框并自动发送（无 API Key 时引导去设置）
      const suggest = e.target.closest('[data-suggest]');
      if (suggest) {
        let s = null;
        try { s = FlibStore.getSettings(); } catch (err) { s = null; }
        if (!s || !s.apiKey) {
          UI.toast('请先在设置中填入 API Key', 'error');
          location.hash = '#/settings?tab=model';
          return;
        }
        const input = $('chat-input');
        if (input) {
          input.value = suggest.dataset.suggest;
          autoGrow();
          input.focus();
          sendMessage();
        }
      }
    });
    $('btn-new-chat').addEventListener('click', newChat);
    $('session-list').addEventListener('click', e => {
      const del = e.target.closest('.session-del');
      const item = e.target.closest('.session-item');
      if (del && item) { deleteSession(item.dataset.id); return; }
      if (item) switchSession(item.dataset.id);
    });
    $('chat-input').addEventListener('keydown', onChatKeydown);
    $('chat-input').addEventListener('input', () => { autoGrow(); updateMentionPanel(); });
    // 设置
    $('btn-save-settings').addEventListener('click', saveSettings);
    $('btn-test').addEventListener('click', testConnection);
    $('btn-toggle-key').addEventListener('click', toggleKey);
    // 设置页输入变更时同步"未保存更改"指示器
    ['set-apikey', 'set-baseurl', 'set-proxy', 'set-model'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', updateSettingsDirty);
    });
    $('btn-export').addEventListener('click', exportData);
    $('btn-import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', importData);
    $('btn-clear').addEventListener('click', clearAll);
    // 设置页 Tab
    document.querySelectorAll('[data-settings-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchSettingsTab(btn.dataset.settingsTab));
    });
    // 主/危险按钮 click flash 反馈
    document.addEventListener('pointerdown', e => {
      const btn = e.target.closest('.btn-primary, .btn-danger');
      if (!btn || btn.disabled) return;
      btn.classList.remove('btn-flash');
      // 强制 reflow 重启动画
      void btn.offsetWidth;
      btn.classList.add('btn-flash');
      clearTimeout(btn.__flashTimer);
      btn.__flashTimer = setTimeout(() => btn.classList.remove('btn-flash'), 460);
    });

    /* 资料库 / 经验库列表键盘导航：↑/↓（j/k）移动高亮，Home/End 跳转，Enter 打开/跳转 */
    document.addEventListener('keydown', (e) => {
      const ae = document.activeElement;
      const isEditable = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable
        || ae.getAttribute('role') === 'textbox' || ae.getAttribute('role') === 'combobox');
      // 编辑态、弹窗开启、或焦点已在交互控件上时交回原生处理
      if (isEditable) return;
      if (ae && (ae.tagName === 'BUTTON' || ae.tagName === 'A' || ae.tagName === 'SELECT' || ae.getAttribute('role') === 'button')) return;
      const modal = $('modal-add');
      if (modal && !modal.classList.contains('hidden')) return;

      const libView = $('view-library'), expView = $('view-experience');
      const onLib = libView && !libView.classList.contains('hidden');
      const onExp = expView && !expView.classList.contains('hidden');
      if (!onLib && !onExp) return;

      const isPrev = e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K';
      const isNext = e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J';
      const isHome = e.key === 'Home';
      const isEnd = e.key === 'End';
      const isEnter = e.key === 'Enter';
      if (!(isPrev || isNext || isHome || isEnd || isEnter)) return;

      const sel = onLib ? '.lib-item' : '.exp-card';
      const container = onLib ? 'lib-list' : 'exp-list';
      const cards = Array.from($(container).querySelectorAll(sel));
      if (!cards.length) return;

      let idx = cards.findIndex(el => el.classList.contains('kbd-active'));
      if (isHome) idx = 0;
      else if (isEnd) idx = cards.length - 1;
      else if (isNext) idx = idx < 0 ? 0 : Math.min(cards.length - 1, idx + 1);
      else if (isPrev) idx = idx < 0 ? 0 : Math.max(0, idx - 1);

      if (isEnter && idx >= 0) {
        const el = cards[idx];
        if (onLib) {
          renderDetail(el.dataset.id);
        } else {
          const jump = el.querySelector('[data-jump-source]');
          if (jump) { const sid = jump.dataset.jumpSource; location.hash = '#/library'; setTimeout(() => renderDetail(sid), 30); }
        }
        e.preventDefault();
        return;
      }
      cards.forEach(el => el.classList.remove('kbd-active'));
      const cur = cards[idx];
      cur.classList.add('kbd-active');
      cur.scrollIntoView({ block: 'nearest' });
      e.preventDefault();
    });
  }

  /* ---------- 资料库列表 ---------- */
  function renderLibrary() {
    const q = searchQuery.trim().toLowerCase();
    let list = items.filter(i => {
      if (!q) return true;
      // 标签过滤：searchQuery 以 # 开头 → 命中标签
      if (q.startsWith('#')) {
        const tag = q.slice(1);
        return (i.tags || []).some(t => String(t).toLowerCase().includes(tag));
      }
      return (i.title || '').toLowerCase().includes(q)
        || (i.tags || []).join(' ').toLowerCase().includes(q)
        || (i.summary || '').toLowerCase().includes(q)
        || (i.markdown || '').toLowerCase().includes(q);
    });
    list = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const el = $('lib-list');
    const total = items.length;
    const filtered = list.length;
    if (!list.length) {
      if (items.length) {
        el.innerHTML = `
          <div class="empty-state empty-state-inline">
            <div class="empty-illu" aria-hidden="true">${ICON.search}</div>
            <p class="empty-title">未找到匹配的资料</p>
            <p class="empty-sub">没有资料匹配 <b>${esc(searchQuery.trim())}</b>。<button type="button" class="btn-link-clear" id="lib-empty-clear">清空搜索</button>查看全部 ${total} 条。</p>
          </div>`;
        const btn = $('lib-empty-clear');
        if (btn) btn.addEventListener('click', clearLibrarySearch);
      } else {
        el.innerHTML = '<div class="empty-state empty-state-inline"><div class="empty-illu" aria-hidden="true">' + ICON.book + '</div><p class="empty-title">资料库还没有内容</p><p class="empty-sub">粘贴网页链接或拖入文件，自动提取正文入库</p><button type="button" class="btn btn-primary btn-sm" id="lib-empty-add">＋ 添加第一份资料</button></div>';
      }
    } else {
      el.innerHTML = list.map(i => `
        <div class="lib-item ${i.id === currentId ? 'active' : ''}" data-id="${i.id}">
          <div class="lib-item-title">${esc(i.title)}</div>
          <div class="lib-item-meta"><span class="src">${esc(i.url ? hostOf(i.url) : (i.fileType ? i.fileType.toUpperCase() : '本地文件'))}</span><span>${fmtTime(i.createdAt)}</span></div>
          ${i.tags && i.tags.length ? `<div class="lib-item-tags">${i.tags.map(t => `<span class="tag" data-tag="${esc(t)}" role="button" tabindex="0" aria-label="按标签 ${esc(t)} 过滤" title="按此标签过滤">${esc(t)}</span>`).join('')}</div>` : ''}
          ${i.summary ? `<div class="lib-item-summary">${esc(i.summary)}</div>` : ''}
        </div>`).join('');
    }
    // 计数：搜索态显示"匹配 X / 共 Y 条"；否则显示总数
    const countEl = $('lib-count');
    if (countEl) {
      const qTrim = searchQuery.trim();
      if (qTrim) {
        countEl.innerHTML = `<span class="count-main">匹配 <strong>${filtered}</strong> / 共 ${total} 条</span><button type="button" class="btn-link-clear" id="lib-count-clear">清空</button>`;
        const btn = $('lib-count-clear');
        if (btn) btn.addEventListener('click', clearLibrarySearch);
      } else {
        countEl.innerHTML = `<span class="count-main">共 <strong>${total}</strong> 条资料</span>`;
      }
    }
    // 标签点击过滤（事件委托）
    el.querySelectorAll('.tag[data-tag]').forEach(tagEl => {
      tagEl.addEventListener('click', (ev) => {
        ev.stopPropagation();  // 避免触发外层 lib-item 点击
        applyTagFilter(tagEl.dataset.tag);
      });
      tagEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); applyTagFilter(tagEl.dataset.tag); }
      });
    });
    // 空状态"添加第一份资料"按钮
    const libEmptyAdd = $('lib-empty-add');
    if (libEmptyAdd) libEmptyAdd.addEventListener('click', () => openAddModal());
  }

  /** 清空资料库搜索 */
  function clearLibrarySearch() {
    const input = $('search-input');
    searchQuery = '';
    if (input) input.value = '';
    renderLibrary();
    updateSearchClearBtn();
    if (input) input.focus();
  }

  /** 按标签过滤（写回搜索框并渲染） */
  function applyTagFilter(tag) {
    searchQuery = '#' + tag;
    const input = $('search-input');
    if (input) input.value = searchQuery;
    renderLibrary();
    updateSearchClearBtn();
    UI.toast(`已按标签「${tag}」过滤`, 'info', 1800);
  }

  /** 同步搜索清除按钮显隐 */
  function updateSearchClearBtn() {
    const input = $('search-input');
    const clear = $('search-clear');
    if (input && clear) clear.classList.toggle('visible', !!input.value);
  }

  /* ---------- 资料详情 ---------- */
  function renderDetail(id) {
    const item = items.find(x => x.id === id);
    if (!item) { showDetailEmpty(); return; }
    currentId = id;
    // 字数与预计阅读时长（中文 400 字/分钟；Markdown 标记字符剔除）
    const plain = (item.markdown || '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_~`\-\[\]\(\)!\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
    const wordCount = plain.length;
    const readingMin = Math.max(1, Math.round(wordCount / 400));
    const statsHtml = `<div class="detail-stats">
      <span>${ICON.pencil} ${wordCount.toLocaleString()} 字</span>
      <span class="stat-dot"></span>
      <span>${ICON.clock} 约 ${readingMin} 分钟阅读</span>
    </div>`;
    $('lib-detail').innerHTML = `
      <div class="reading-progress" aria-hidden="true"><span id="reading-progress-bar"></span></div>
      <div class="detail-head">
        <button type="button" class="btn btn-ghost btn-sm lib-back-btn" id="lib-back-btn" aria-label="返回资料列表">← 返回列表</button>
        <h1 class="detail-title">${esc(item.title)}</h1>
        <div class="detail-meta">
          ${item.tags && item.tags.length ? item.tags.map(t => `<span class="tag" data-tag="${esc(t)}" role="button" tabindex="0" aria-label="按标签 ${esc(t)} 过滤" title="按此标签过滤">${esc(t)}</span>`).join('') : ''}
          ${item.url
            ? `<a href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.url)}</a>`
            : `<span>本地文件${item.fileType ? ' · ' + item.fileType.toUpperCase() : ''}</span>`}
          <span>收录于 ${fmtTime(item.createdAt)}</span>
        </div>
        ${statsHtml}
        <div class="detail-actions">
          <button class="btn btn-ghost btn-sm" data-act="copy" title="复制全文（Markdown）">${ICON.copy} 复制</button>
          <button class="btn btn-ghost btn-sm" data-act="download" title="下载为 .md 文件">${ICON.download} 下载</button>
          <button class="btn btn-ghost btn-sm" data-act="edit">编辑</button>
          ${item.url ? '<button class="btn btn-ghost btn-sm" data-act="refetch">重新抓取</button>' : ''}
          <button class="btn btn-danger btn-sm" data-act="del">删除</button>
        </div>
      </div>
      <div class="detail-content md">${Renderer.renderMarkdown(item.markdown)}</div>
      <button type="button" class="detail-scroll-top" id="detail-scroll-top" aria-label="回到顶部" title="回到顶部">↑</button>`;
    Renderer.externalizeLinks($('lib-detail'));
    // 详情内标签点击过滤（沿用侧栏相同的过滤语义）
    $('lib-detail').querySelectorAll('.tag[data-tag]').forEach(tagEl => {
      tagEl.addEventListener('click', (ev) => { ev.stopPropagation(); applyTagFilter(tagEl.dataset.tag); });
      tagEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); applyTagFilter(tagEl.dataset.tag); }
      });
    });
    $('lib-detail').querySelector('[data-act="edit"]').addEventListener('click', () => openAddModal(item));
    $('lib-detail').querySelector('[data-act="refetch"]')?.addEventListener('click', () => reFetchItem(item));
    $('lib-detail').querySelector('[data-act="del"]').addEventListener('click', () => deleteItem(item.id));
    $('lib-detail').querySelector('[data-act="copy"]').addEventListener('click', () => copyItemContent(item));
    $('lib-detail').querySelector('[data-act="download"]').addEventListener('click', () => downloadItemMd(item));
    // 返回列表：展开侧栏（仅移动端可见该按钮）
    const backBtn = $('lib-detail').querySelector('.lib-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => {
      const viewLib = document.querySelector('.view-library');
      if (viewLib) viewLib.classList.remove('lib-collapsed');
    });
    // 阅读进度条 + 回顶按钮显隐
    setupReadingProgress();
    // 移动端（≤900px）选中资料后自动收起列表，详情区自动占满
    if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
      const viewLib = document.querySelector('.view-library');
      if (viewLib) viewLib.classList.add('lib-collapsed');
    }
    renderLibrary();
  }

  /** 复制资料全文（Markdown） */
  function copyItemContent(item) {
    const text = `# ${item.title}\n\n${item.markdown || ''}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => UI.toast('已复制全文到剪贴板', 'success', 2000),
        () => UI.toast('复制失败', 'error')
      );
    } else {
      // 降级：临时 textarea
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        UI.toast(ok ? '已复制全文到剪贴板' : '复制失败', ok ? 'success' : 'error', 2000);
      } catch (e) {
        UI.toast('复制失败', 'error');
      }
    }
  }

  /** 导出资料为 .md 文件 */
  function downloadItemMd(item) {
    const blob = new Blob([`# ${item.title}\n\n${item.markdown || ''}`], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (item.title || '未命名') + '.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
    UI.toast('已下载 .md 文件', 'success', 1800);
  }

  /** 详情页阅读进度 + 回顶按钮联动 */
  function setupReadingProgress() {
    const detail = $('lib-detail');
    if (!detail) return;
    const bar = detail.querySelector('#reading-progress-bar');
    const topBtn = detail.querySelector('#detail-scroll-top');
    let rafPending = false;
    const update = () => {
      rafPending = false;
      const scrollable = detail.scrollHeight - detail.clientHeight;
      const pct = scrollable > 0 ? Math.min(100, Math.max(0, (detail.scrollTop / scrollable) * 100)) : 0;
      if (bar) bar.style.width = pct + '%';
      if (topBtn) topBtn.classList.toggle('is-visible', detail.scrollTop > 200 && scrollable > 100);
    };
    detail.addEventListener('scroll', () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(update);
    }, { passive: true });
    if (topBtn) topBtn.addEventListener('click', () => {
      const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      detail.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
    });
    update();
  }

  function showDetailEmpty() {
    const viewLib = document.querySelector('.view-library');
    if (viewLib) viewLib.classList.remove('lib-collapsed');
    $('lib-detail').innerHTML = `
      <div class="empty-state">
        <div class="empty-illu" aria-hidden="true">${ICON.book}</div>
        <p class="empty-title">还没有选择资料</p>
        <p class="empty-sub">从左侧选择一篇资料查看详情，或添加你的第一份资料</p>
        <div class="empty-actions">
          <button type="button" class="btn btn-primary btn-sm" id="lib-detail-add">＋ 添加资料</button>
        </div>
      </div>`;
    const btn = $('lib-detail-add');
    if (btn) btn.addEventListener('click', () => openAddModal());
  }

  /* ---------- 添加 / 编辑弹窗 ---------- */
  function switchAddTab(name) {
    document.querySelectorAll('.add-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    $('add-tab-url').classList.toggle('hidden', name !== 'url');
    $('add-tab-file').classList.toggle('hidden', name !== 'file');
    // 主按钮随 Tab 语义切换：网页链接 → 抓取；本地文件 → 唤起文件选择（选中后自动解析）
    const btn = $('btn-fetch');
    if (btn) btn.textContent = name === 'file' ? '选择文件并解析' : '抓取网页内容';
  }

  /**
   * Stepper 步骤指示器：
   *  - 接收 step 名（input / preview / batch）
   *  - 当前 step 加 .active，之前 step 加 .done（显示已完成态）
   *  - 同时配合 #add-step-* 显隐
   */
  function setAddStep(step) {
    const order = ['input', 'preview', 'batch'];
    const curIdx = order.indexOf(step);
    const isBatch = addStepMode === 'batch';
    document.querySelectorAll('.add-step').forEach(el => {
      const stepName = el.dataset.step;
      // 按场景隐藏无关步骤：单条流程隐藏「批量确认」，多条流程隐藏「预览确认」
      const visible = isBatch ? stepName !== 'preview' : stepName !== 'batch';
      el.classList.toggle('hidden', !visible);
      if (!visible) return;
      const idx = order.indexOf(stepName);
      el.classList.toggle('active', idx === curIdx);
      el.classList.toggle('done', idx !== -1 && idx < curIdx);
    });
    // 显隐三大步
    $('add-step-input').classList.toggle('hidden', step !== 'input');
    $('add-step-preview').classList.toggle('hidden', step !== 'preview');
    $('add-step-batch').classList.toggle('hidden', step !== 'batch');
    // 把焦点交给该步首个 input（无障碍：进入新区域时焦点转移）
    const focusMap = {
      input: 'add-url',
      preview: 'preview-title',
      batch: 'batch-list',
    };
    const focusId = focusMap[step];
    if (focusId) {
      const t = setTimeout(() => {
        const el = $(focusId);
        if (el) el.focus({ preventScroll: false });
      }, 30);
      // 兜底清理（防止多次切换时遗留 timer）
      if (window.__addStepFocusTimer) clearTimeout(window.__addStepFocusTimer);
      window.__addStepFocusTimer = t;
    }
  }

  function openAddModal(item) {
    const modal = $('modal-add');
    lastModalFocus = document.activeElement;
    addStepMode = 'single'; // 编辑/单条流程走 1→2
    modal.classList.remove('hidden');
    $('modal-title').textContent = item ? '编辑资料' : '添加资料';
    $('fetch-status').textContent = '';
    $('fetch-status').className = 'settings-status';
    // Onboarding：缺少 API Key 时显示横幅引导
    const hint = $('onboard-hint');
    if (hint) {
      let s = null;
      try { s = FlibStore.getSettings(); } catch (e) { s = null; }
      hint.classList.toggle('hidden', !!(s && s.apiKey));
    }
    if (item) {
      pending = { id: item.id, url: item.url, title: item.title, tags: item.tags || [], markdown: item.markdown, summary: item.summary, fileType: item.fileType || '' };
      $('preview-title').value = item.title;
      $('preview-tags').value = (item.tags || []).join(', ');
      $('preview-content').innerHTML = Renderer.renderMarkdown(item.markdown);
      Renderer.externalizeLinks($('preview-content'));
      // 文件类资料没有 URL，隐藏「重新抓取」
      $('btn-refetch').classList.toggle('hidden', !item.url);
      // 编辑模式直接进 preview 步，input 步标 done
      setAddStep('preview');
    } else {
      pending = null;
      $('add-url').value = '';
      $('add-title').value = '';
      $('add-tags').value = '';
      $('add-paste').value = '';
      $('btn-refetch').classList.remove('hidden');
      switchAddTab('url');
      setAddStep('input');
    }
    // 焦点移入弹窗内第一个可聚焦元素（无障碍）
    const firstFocusable = getFocusable(modal)[0];
    if (firstFocusable) firstFocusable.focus();
  }

  function closeModal() {
    const modal = $('modal-add');
    if (modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    setAddStep('input'); // 重置步骤指示器
    // 焦点还原到打开弹窗前的元素
    if (lastModalFocus && lastModalFocus.isConnected) lastModalFocus.focus();
    lastModalFocus = null;
  }

  async function doFetch() {
    const urls = $('add-url').value.split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (!urls.length) { setFetchStatus('请先输入网页链接', 'err'); return; }
    if (urls.length > 1) { await doFetchBatch(urls); return; }
    const url = urls[0];
    setFetchStatus('正在抓取并提取内容…', '');
    $('btn-fetch').disabled = true;
    try {
      const result = await Fetcher.fetch(url);
      pending = {
        id: pending && pending.id ? pending.id : null,
        url: url,
        title: ($('add-title').value.trim() || result.title),
        tags: parseTags($('add-tags').value),
        markdown: result.markdown,
        summary: result.summary,
        fileType: ''
      };
      $('preview-title').value = pending.title;
      $('preview-tags').value = pending.tags.join(', ');
      $('preview-content').innerHTML = Renderer.renderMarkdown(pending.markdown);
      Renderer.externalizeLinks($('preview-content'));
      $('btn-refetch').classList.remove('hidden');
      addStepMode = 'single';
      setAddStep('preview');
      setFetchStatus('抓取成功', 'ok');
    } catch (e) {
      setFetchStatus(e.message || '抓取失败', 'err');
    } finally {
      $('btn-fetch').disabled = false;
    }
  }

  /** 兜底：抓取失败时，用用户手动粘贴的网页正文直接入库 */
  function doPasteAdd() {
    const text = $('add-paste').value.trim();
    if (!text) { setFetchStatus('请先粘贴网页内容', 'err'); return; }
    pending = {
      id: pending && pending.id ? pending.id : null,
      url: $('add-url').value.trim(),
      title: ($('add-title').value.trim() || '手动添加的资料'),
      tags: parseTags($('add-tags').value),
      markdown: text,
      summary: text.slice(0, 180),
      fileType: ''
    };
    $('preview-title').value = pending.title;
    $('preview-tags').value = pending.tags.join(', ');
    $('preview-content').innerHTML = Renderer.renderMarkdown(pending.markdown);
    Renderer.externalizeLinks($('preview-content'));
    $('btn-refetch').classList.add('hidden'); // 手动内容无 URL，禁用重新抓取
    addStepMode = 'single';
    setAddStep('preview');
    setFetchStatus('已使用粘贴内容', 'ok');
  }

  /** 批量抓取多个链接，进入批量预览 */
  async function doFetchBatch(urls) {
    addStepMode = 'batch';
    setAddStep('batch');
    const statusEl = $('batch-status');
    const listEl = $('batch-list');
    const defaultTags = parseTags($('add-tags').value);
    batchPending = [];
    listEl.innerHTML = '';
    let ok = 0, fail = 0;
    for (let i = 0; i < urls.length; i++) {
      statusEl.textContent = `正在抓取 ${i + 1}/${urls.length}…`;
      statusEl.className = 'settings-status';
      try {
        const r = await Fetcher.fetch(urls[i]);
        batchPending.push({ url: urls[i], title: r.title, tags: [...defaultTags], markdown: r.markdown, summary: r.summary, fileType: '', status: 'ok', msg: '' });
        ok++;
      } catch (e) {
        batchPending.push({ url: urls[i], title: urls[i], tags: [], markdown: '', summary: '', fileType: '', status: 'fail', msg: e.message });
        fail++;
      }
      renderBatchList();
    }
    statusEl.textContent = `抓取完成：成功 ${ok} 条，失败 ${fail} 条`;
    statusEl.className = 'settings-status' + (fail ? ' err' : ' ok');
    // 批量进行中可能已关闭弹窗：完成时仍用 Toast 汇总结果
    UI.toast(`批量抓取完成：成功 ${ok} 条，失败 ${fail} 条`, fail ? 'error' : 'success');
  }

  /** 批量解析本地文件 */
  async function doParseFiles(files) {
    addStepMode = 'batch';
    setAddStep('batch');
    const statusEl = $('batch-status');
    const listEl = $('batch-list');
    const defaultTags = parseTags($('add-tags').value);
    batchPending = [];
    listEl.innerHTML = '';
    let ok = 0, fail = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      statusEl.textContent = `正在解析 ${i + 1}/${files.length}：${f.name}`;
      statusEl.className = 'settings-status';
      try {
        const r = await FileParser.parse(f);
        batchPending.push({ url: '', title: r.title, tags: [...defaultTags], markdown: r.markdown, summary: r.summary, fileType: (f.name.split('.').pop() || '').toLowerCase(), status: 'ok', msg: '' });
        ok++;
      } catch (e) {
        batchPending.push({ url: '', title: f.name, tags: [], markdown: '', summary: '', fileType: (f.name.split('.').pop() || '').toLowerCase(), status: 'fail', msg: e.message });
        fail++;
      }
      renderBatchList();
    }
    statusEl.textContent = `解析完成：成功 ${ok} 条，失败 ${fail} 条`;
    statusEl.className = 'settings-status' + (fail ? ' err' : ' ok');
    // 批量进行中可能已关闭弹窗：完成时仍用 Toast 汇总结果
    UI.toast(`批量解析完成：成功 ${ok} 条，失败 ${fail} 条`, fail ? 'error' : 'success');
  }

  /** 渲染批量预览列表：成功项在前，失败项 details 折叠在后 */
  function renderBatchList() {
    const listEl = $('batch-list');
    const okItems = batchPending.map((p, i) => Object.assign({}, p, { _idx: i })).filter(p => p.status === 'ok');
    const failItems = batchPending.map((p, i) => Object.assign({}, p, { _idx: i })).filter(p => p.status === 'fail');
    const okHtml = okItems.map(p => `
      <div class="batch-item">
        <div class="batch-item-head">
          <input class="form-input" data-title="${p._idx}" value="${esc(p.title)}" placeholder="标题">
          <button type="button" class="btn btn-ghost btn-sm" data-rm="${p._idx}" aria-label="移除「${esc(p.title)}」">移除</button>
        </div>
        <input class="form-input batch-tag" data-tags="${p._idx}" value="${esc((p.tags || []).join(', '))}" placeholder="标签（逗号分隔）">
      </div>`).join('');
    const failHtml = failItems.length
      ? `<details class="batch-fail-group">
          <summary>失败 ${failItems.length} 条，点击展开 <span class="batch-fail-hint">（可单独移除）</span></summary>
          <div class="batch-fail-list">
            ${failItems.map(p => `
              <div class="batch-item fail">
                <div class="batch-item-head">
                  <span class="batch-err" title="${esc(p.msg)}">${esc(p.title)} —— ${esc(p.msg)}</span>
                  <button type="button" class="btn btn-ghost btn-sm" data-rm="${p._idx}" aria-label="移除「${esc(p.title)}」">移除</button>
                </div>
              </div>`).join('')}
          </div>
        </details>`
      : '';
    listEl.innerHTML = okHtml + failHtml;
    listEl.querySelectorAll('[data-rm]').forEach(btn => btn.addEventListener('click', () => {
      batchPending.splice(+btn.dataset.rm, 1);
      renderBatchList();
    }));
    listEl.querySelectorAll('[data-title]').forEach(inp => inp.addEventListener('input', () => { batchPending[+inp.dataset.title].title = inp.value; }));
    listEl.querySelectorAll('[data-tags]').forEach(inp => inp.addEventListener('input', () => { batchPending[+inp.dataset.tags].tags = parseTags(inp.value); }));
  }

  /** 批量保存（仅成功条目） */
  async function saveBatch() {
    const toSave = batchPending.filter(p => p.status === 'ok');
    if (!toSave.length) {
      const st = $('batch-status');
      st.textContent = '没有可保存的条目';
      st.className = 'settings-status err';
      return;
    }
    const btn = $('btn-save-batch');
    btn.disabled = true;
    let lastId = null;
    for (const p of toSave) {
      const item = {
        id: crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        url: p.url,
        title: p.title.trim() || '未命名资料',
        tags: p.tags || [],
        markdown: p.markdown,
        summary: p.summary,
        fileType: p.fileType,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      items = await FlibStore.addItem(item);
      lastId = item.id;
      triggerAutoSummarize(item);
    }
    btn.disabled = false;
    closeModal();
    renderLibrary();
    updateExpBanner();
    if (lastId) renderDetail(lastId);
    updateDataCount();
    UI.toast('已保存 ' + toSave.length + ' 条资料', 'success');
  }

  /** 解析本地文件：单文件走预览确认，多文件走批量 */
  async function handleFiles(files) {
    if (!files || !files.length) return;
    $('add-file').value = '';
    if (files.length > 1) { await doParseFiles(files); return; }
    const file = files[0];
    setFetchStatus('正在解析文件（较大文件可能较慢）…', '');
    try {
      const result = await FileParser.parse(file);
      pending = {
        id: null,
        url: '',
        title: $('add-title').value.trim() || result.title,
        tags: parseTags($('add-tags').value),
        markdown: result.markdown,
        summary: result.summary,
        fileType: (file.name.split('.').pop() || '').toLowerCase()
      };
      $('preview-title').value = pending.title;
      $('preview-tags').value = pending.tags.join(', ');
      $('preview-content').innerHTML = Renderer.renderMarkdown(pending.markdown);
      Renderer.externalizeLinks($('preview-content'));
      $('btn-refetch').classList.add('hidden');
      addStepMode = 'single';
      setAddStep('preview');
      setFetchStatus('解析成功', 'ok');
    } catch (e) {
      setFetchStatus(e.message || '解析失败', 'err');
    }
  }

  function setFetchStatus(msg, type) {
    const el = $('fetch-status');
    el.textContent = msg;
    el.className = 'settings-status' + (type === 'ok' ? ' ok' : type === 'err' ? ' err' : '');
  }

  async function saveItem() {
    if (!pending) return;
    pending.title = $('preview-title').value.trim() || '未命名资料';
    pending.tags = parseTags($('preview-tags').value);

    if (pending.id) {
      items = await FlibStore.updateItem(pending.id, { title: pending.title, tags: pending.tags, markdown: pending.markdown, summary: pending.summary, url: pending.url, fileType: pending.fileType });
    } else {
      const item = {
        id: crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2),
        url: pending.url,
        title: pending.title,
        tags: pending.tags,
        markdown: pending.markdown,
        summary: pending.summary,
        fileType: pending.fileType,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      items = await FlibStore.addItem(item);
      currentId = item.id;
      triggerAutoSummarize(item);
      updateExpBanner();
    }
    closeModal();
    renderLibrary();
    renderDetail(currentId);
    updateDataCount();
    UI.toast('已保存到资料库', 'success');
  }

  async function reFetchItem(item) {
    if (!item.url) return; // 本地文件资料无需重新抓取
    $('btn-refetch').disabled = true;
    const old = $('lib-detail').innerHTML;
    try {
      const result = await Fetcher.fetch(item.url);
      items = await FlibStore.updateItem(item.id, { markdown: result.markdown, summary: result.summary, title: result.title || item.title });
      renderDetail(item.id);
    } catch (e) {
      $('lib-detail').innerHTML = old;
      UI.toast('重新抓取失败：' + e.message, 'error');
    } finally {
      $('btn-refetch').disabled = false;
    }
  }

  async function deleteItem(id) {
    if (!await UI.confirm('确定删除这篇资料吗？此操作不可恢复。', { title: '删除资料', danger: true })) return;
    items = await FlibStore.removeItem(id);
    if (currentId === id) { currentId = null; showDetailEmpty(); }
    renderLibrary();
    updateDataCount();
    UI.toast('资料已删除', 'success');
  }

  /* ---------- 经验库 ---------- */
  /** 「整个经验库」整体引用条目 */
  function expAllEntry() {
    return { id: 'exp|__all__', sourceType: 'exp-all', title: '整个经验库', url: '', content: '' };
  }

  function hasExperience(sourceId) {
    return experiences.some(e => e.sourceId === sourceId);
  }

  /** 保存后静默触发自动总结（无 Key 或失败不阻塞，缺口由经验库横幅提示） */
  function triggerAutoSummarize(item) {
    if (!item || !item.markdown || hasExperience(item.id)) return;
    summarizeItem(item.id).catch(() => { /* 静默 */ });
  }

  /** 为单篇资料生成经验（每篇单独调用模型；已有则跳过，除非 force 强制重生成） */
  async function summarizeItem(sourceId, force = false) {
    if (summarizing) return;
    if (!force && hasExperience(sourceId)) return;
    const item = items.find(i => i.id === sourceId);
    if (!item || !item.markdown) return;
    summarizing = true;
    try {
      const content = await Experience.summarize(item);
      // 强制重生成时先移除该资料已有的旧经验，避免重复累积
      if (force) experiences = experiences.filter(e => e.sourceId !== sourceId);
      experiences.push({ id: newId(), sourceId: item.id, sourceTitle: item.title, sourceUrl: item.url, content, createdAt: Date.now() });
      await FlibStore.saveExperiences(experiences);
    } finally {
      summarizing = false;
    }
    renderExperienceList();
    updateExpBanner();
  }

  /** 为所有缺少经验的资料逐个生成经验 */
  async function summarizeAll() {
    if (summarizing) return;
    const missing = items.filter(i => i.markdown && !hasExperience(i.id));
    if (!missing.length) { updateExpBanner(); return; }
    const btn = $('btn-summarize-all');
    const textEl = $('exp-banner-text');
    UI.setLoading(btn, true);
    let ok = 0, fail = 0;
    for (let i = 0; i < missing.length; i++) {
      const item = missing[i];
      textEl.textContent = `正在总结 ${i + 1}/${missing.length}：《${item.title}》`;
      try {
        const content = await Experience.summarize(item);
        experiences.push({ id: newId(), sourceId: item.id, sourceTitle: item.title, sourceUrl: item.url, content, createdAt: Date.now() });
        await FlibStore.saveExperiences(experiences);
        ok++;
      } catch (e) {
        fail++;
      }
      renderExperienceList();
    }
    UI.setLoading(btn, false);
    textEl.textContent = fail
      ? `总结完成：成功 ${ok} 条，失败 ${fail} 条（可点击单条「重新生成」重试）`
      : `总结完成：成功 ${ok} 条`;
    await FlibStore.saveExperiences(experiences);
    renderExperienceList();
    updateExpBanner();
  }

  /** 删除一条经验（资料不受影响） */
  async function deleteExperience(id) {
    const exp = experiences.find(e => e.id === id);
    if (!exp) return;
    if (!await UI.confirm('确定删除这条经验吗？', { title: '删除经验', danger: true })) return;
    experiences = experiences.filter(e => e.id !== id);
    await FlibStore.saveExperiences(experiences);
    renderExperienceList();
    updateExpBanner();
    UI.toast('经验已删除', 'success');
  }

  /** 渲染经验库列表（含 FLIP 动画：先记录旧位置，重排后对移动的卡片补间） */
  function renderExperienceList() {
    const q = expSearchQuery.trim().toLowerCase();
    let list = experiences.filter(e => {
      if (!q) return true;
      return (e.sourceTitle || '').toLowerCase().includes(q) || (e.content || '').toLowerCase().includes(q);
    });
    list = [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const el = $('exp-list');
    // FLIP 步骤 1（First）：记录现有卡片的位置
    const firstRects = new Map();
    el.querySelectorAll('.exp-card').forEach(card => {
      firstRects.set(card.dataset.id, card.getBoundingClientRect());
    });

    if (!list.length) {
      if (experiences.length) {
        el.innerHTML = '<div class="empty-state empty-state-inline"><div class="empty-illu" aria-hidden="true">' + ICON.search + '</div><p class="empty-title">未找到匹配的经验</p><p class="empty-sub">试试更短的关键词，或清空搜索框查看全部</p></div>';
      } else if (items.length) {
        const pending = items.filter(it => !experiences.find(e => e.sourceId === it.id)).length;
        el.innerHTML = '<div class="empty-state empty-state-inline"><div class="empty-illu" aria-hidden="true">' + ICON.bulb + '</div><p class="empty-title">经验库还没有内容</p><p class="empty-sub">资料库已有 ' + items.length + ' 篇，其中 ' + pending + ' 篇待总结。</p><button type="button" class="btn btn-primary btn-sm" id="exp-empty-summarize">开始批量总结</button></div>';
      } else {
        el.innerHTML = '<div class="empty-state empty-state-inline"><div class="empty-illu" aria-hidden="true">' + ICON.bulb + '</div><p class="empty-title">经验库还没有内容</p><p class="empty-sub">先在「资料库」添加资料，模型会自动生成浓缩经验；也可对已有资料点击「开始总结」批量生成。</p><button type="button" class="btn btn-secondary btn-sm" id="exp-empty-go-lib">去资料库添加 →</button></div>';
      }
    } else {
      el.innerHTML = list.map(e => {
        // 经验卡片来源是否仍存在于资料库（被删除资料的经验会残留）
        const srcExists = items.some(it => it.id === e.sourceId);
        const sourceHtml = srcExists
          ? `<button type="button" class="exp-source-link" data-jump-source="${esc(e.sourceId)}" title="跳转到资料库该篇">《${esc(e.sourceTitle)}》</button>`
          : `<span class="exp-source" title="原始资料已删除">《${esc(e.sourceTitle)}》<span style="color:var(--text-3);font-weight:400">（已删除）</span></span>`;
        return `
        <div class="exp-card" data-id="${e.id}" data-source-id="${e.sourceId}" role="listitem">
          <div class="exp-card-head">
            <span class="exp-tag">经验</span>
            ${sourceHtml}
            <span class="exp-time" title="${fmtTime(e.createdAt)}">${fmtRelative(e.createdAt)}</span>
            <div class="exp-card-actions">
              <button class="btn btn-ghost btn-sm" data-act="regenerate">重新生成</button>
              <button class="btn btn-danger btn-sm" data-act="del">删除</button>
            </div>
          </div>
          <div class="exp-content md">${Renderer.renderMarkdown(e.content)}</div>
        </div>`;
      }).join('');
    }
    // FLIP 步骤 2（Last → Invert → Play）：对保留的卡片，从旧位置"反相"位移到当前位置
    el.querySelectorAll('.exp-card').forEach(card => {
      const first = firstRects.get(card.dataset.id);
      if (!first) return;  // 新增卡片不做补间
      const last = card.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (!dx && !dy) return;
      // 反相：瞬时移回原位（无 transition）
      card.style.transition = 'none';
      card.style.transform = `translate(${dx}px, ${dy}px)`;
      // 下一帧再放开 transition 触发到原位（FLIP Play）
      requestAnimationFrame(() => {
        card.style.transition = 'transform .42s var(--ease)';
        card.style.transform = '';
        const cleanup = () => {
          card.style.transition = '';
          card.removeEventListener('transitionend', cleanup);
        };
        card.addEventListener('transitionend', cleanup);
      });
    });
    $('exp-count').textContent = `共 ${experiences.length} 条经验`;
    // 空状态按钮
    const btnExpSum = $('exp-empty-summarize');
    if (btnExpSum) btnExpSum.addEventListener('click', () => summarizeAll());
    const btnExpGoLib = $('exp-empty-go-lib');
    if (btnExpGoLib) btnExpGoLib.addEventListener('click', () => { location.hash = '#/library'; });
  }

  /** 检测资料与经验的缺口并显示横幅 */
  function updateExpBanner() {
    const banner = $('exp-banner');
    const textEl = $('exp-banner-text');
    const missing = items.filter(i => i.markdown && !hasExperience(i.id));
    if (!missing.length) {
      banner.classList.add('hidden');
      return;
    }
    banner.classList.remove('hidden');
    textEl.textContent = `有 ${missing.length} 篇资料尚未总结经验（新资料保存后会自动总结；未配置 API Key 时可手动触发）`;
  }

  /* ---------- AI 问答 ---------- */
  function appendChatMsg(role, html, sourcesHtml) {
    const box = $('chat-messages');
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + role;
    const avatar = role === 'user' ? '我' : 'AI';
    const actions = role === 'assistant'
      ? `<button class="msg-regen" data-act="regenerate" title="重新回答" aria-label="重新回答">
           <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
         </button>`
      : '';
    wrap.innerHTML = `
      <div class="msg-avatar">${avatar}</div>
      <div class="msg-body">
        <div class="md">${html}</div>
        ${sourcesHtml || ''}
        ${actions}
      </div>`;
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
    return wrap.querySelector('.msg-body .md');
  }

  function autoGrow() {
    const el = $('chat-input');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }

  function setChatStatus(msg, type) {
    const el = $('chat-status');
    if (type === 'error' && msg) {
      // 错误态用 alert 卡片：图标 + 文本 + 重试按钮（点击重新生成上一条）
      el.innerHTML = `<span class="alert-inline" role="alert"><span class="alert-icon" aria-hidden="true">⚠️</span><span class="alert-text"></span><button type="button" class="btn btn-ghost btn-sm alert-retry" id="chat-status-retry">↻ 重试</button></span>`;
      el.querySelector('.alert-text').textContent = msg;
      const retry = el.querySelector('#chat-status-retry');
      if (retry) retry.addEventListener('click', regenerateLast);
    } else {
      el.textContent = msg || '';
    }
    el.className = type === 'error' ? 'chat-status-error' : type === 'stream' ? 'chat-status-streaming' : '';
    // 流式状态用 aria-busy 反映在 chat-messages 上（不重复 live，避免每 16ms 抢断读屏）
    const messages = $('chat-messages');
    if (messages) {
      if (type === 'stream') {
        messages.setAttribute('aria-busy', 'true');
      } else {
        messages.removeAttribute('aria-busy');
      }
    }
  }

  /** 重试最近一条 assistant 回复（删除它并重新生成） */
  function regenerateLast() {
    const list = $('chat-messages');
    if (!list) return;
    const msgs = [...list.querySelectorAll('.msg.assistant')];
    const last = msgs[msgs.length - 1];
    if (last) regenerateReply(last);
  }

  async function sendMessage() {
    if (isGenerating) return;
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text) return;

    // 隐藏欢迎语
    const welcome = document.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    input.value = '';
    autoGrow();
    closeMentionPanel();

    appendChatMsg('user', esc(text).replace(/\n/g, '<br>'));
    chatHistory.push({ role: 'user', content: text });
    await saveCurrentSession();

    await generateReply(buildSources(text));
  }

  /** 解析消息中的 @提及为引用来源（经验库整体展开） */
  function buildSources(text) {
    const entries = [expAllEntry(), ...items];
    const mentions = parseMentions(text, entries);
    return mentions.map(s => s.sourceType === 'exp-all'
      ? { ...s, content: experiences.map(e => `《${e.sourceTitle}》：\n${e.content}`).join('\n\n---\n\n') }
      : s);
  }

  /** 基于当前 chatHistory 生成一条 AI 回复（新增或重新回答共用） */
  async function generateReply(sources) {
    const sourceTitles = sources.map(s => s.title);
    const replyEl = appendChatMsg('assistant', '<span class="muted">思考中…</span>');

    // 引用来源（仅 @ 模式展示）
    if (sources.length) {
      replyEl.parentElement.insertAdjacentHTML('beforeend', `
        <div class="msg-sources">
          <details>
            <summary>引用 ${sources.length} 条指定内容</summary>
            <ul>${sources.map(s => {
              if (s.sourceType === 'exp-all') return `<li><svg viewBox="0 0 64 64" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:2px"><path d="M20 14h17a3 3 0 0 1 3 3v33a3 3 0 0 0-3-3H20a3 3 0 0 0-3 3V17a3 3 0 0 1 3-3z"/></svg>整个经验库（${experiences.length} 条经验）</li>`;
              const label = esc(s.title);
              return s.url
                ? `<li><a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${label}</a></li>`
                : `<li>${label}</li>`;
            }).join('')}</ul>
          </details>
        </div>`);
    }

    chatAbort = new AbortController();
    isGenerating = true;
    setSendBtn(true);
    setChatStatus('正在生成…（可点击「⏹ 停止」终止）', 'stream');

    let full = '';
    // 流式节流渲染：onDelta 只 append 进 buffer，由 renderer 内部合并到下一帧
    const streamRenderer = Renderer.createStreamRenderer(replyEl);
    const onDelta = (delta) => {
      full += delta;
      streamRenderer.append(delta);
      const list = $('chat-messages');
      if (list) list.scrollTop = list.scrollHeight;
    };

    try {
      const messages = buildMessages(chatHistory, sources);
      const reply = await Chat.chatRaw(messages, { onDelta, signal: chatAbort.signal });
      if (!full && reply.content) {
        full = reply.content;
        streamRenderer.append(reply.content);
      }
      // 完成：flush 末尾内容 + 移除光标
      streamRenderer.complete();
      chatHistory.push({ role: 'assistant', content: full || reply.content, sources: sourceTitles });
      setChatStatus('', '');
      await saveCurrentSession();
    } catch (e) {
      streamRenderer.abort();
      if (e.code === 'ABORT') {
        // 用户主动停止：保留已生成的部分内容
        if (full) {
          replyEl.innerHTML = Renderer.renderMarkdown(full);
          Renderer.externalizeLinks(replyEl);
          chatHistory.push({ role: 'assistant', content: full, sources: sourceTitles });
        } else {
          replyEl.innerHTML = '<span class="muted">⏹ 已停止生成</span>';
          chatHistory.push({ role: 'assistant', content: '⏹ 已停止生成', sources: sourceTitles });
        }
        setChatStatus('已停止生成', '');
      } else {
        replyEl.innerHTML = `<span class="chat-status-error">${esc(e.message)}</span>`;
        chatHistory.push({ role: 'assistant', content: e.message, sources: sourceTitles });
        setChatStatus(e.message, 'error');
      }
      await saveCurrentSession();
    } finally {
      isGenerating = false;
      setSendBtn(false);
      chatAbort = null;
    }
    // 控制上下文长度：发送时只保留最近 20 条（完整记录仍保存在会话中）
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
  }

  /** 切换发送/停止按钮 */
  function setSendBtn(generating) {
    const btn = $('btn-send');
    btn.textContent = generating ? '⏹ 停止' : '发送';
    btn.disabled = false;
    btn.classList.toggle('btn-stop', generating);
    // 同步 aria-label，避免读屏只听到按钮文字变化
    btn.setAttribute('aria-label', generating ? '停止生成' : '发送消息');
  }

  /** 重新回答：删除该条回答及其后的消息，重新生成 */
  async function regenerateReply(wrapEl) {
    if (isGenerating) return;
    const box = $('chat-messages');
    const idx = [...box.children].indexOf(wrapEl);
    if (idx === -1) return;
    const session = sessions.find(s => s.id === currentSessionId);
    if (!session) return;
    const target = (session.messages || [])[idx];
    if (!target || target.role !== 'assistant') return;
    if (!await UI.confirm('重新回答将删除本条回答及其后的消息并重新生成，确定吗？', { title: '重新回答' })) return;

    // 截断会话到该条回答之前
    const newMessages = (session.messages || []).slice(0, idx);
    chatHistory = newMessages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.sources && m.sources.length ? { sources: m.sources } : {})
    }));
    session.messages = newMessages;
    await FlibStore.saveSessions(sessions);

    renderChatMessages();
    const lastUser = [...chatHistory].reverse().find(m => m.role === 'user');
    if (!lastUser) return;
    await generateReply(buildSources(lastUser.content));
  }

  /* ---------- 会话管理 ---------- */
  async function persistSession(id, history) {
    if (!id) return;
    const idx = sessions.findIndex(s => s.id === id);
    if (idx === -1) return;
    const session = sessions[idx];
    session.messages = history.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.sources && m.sources.length ? { sources: m.sources } : {})
    }));
    const firstUser = history.find(m => m.role === 'user');
    if (firstUser) session.title = firstUser.content.replace(/\s+/g, ' ').slice(0, 16) || '新对话';
    session.updatedAt = Date.now();
    await FlibStore.saveSessions(sessions);
    renderSessionList();
  }

  async function saveCurrentSession() {
    await persistSession(currentSessionId, chatHistory);
  }

  /**
   * 会话列表 keyed diff：保留现有节点，仅更新标题/时间/active 类，避免每次重新创建 DOM 抖动。
   * 新增节点 append，删除节点 unmount。
   */
  function renderSessionList() {
    const el = $('session-list');
    sessions.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (!sessions.length) {
      el.innerHTML = '<div class="session-empty">暂无对话<br>点击「＋ 新对话」开始</div>';
      return;
    }
    // 现有节点按 data-id 索引
    const existing = new Map();
    el.querySelectorAll('.session-item').forEach(node => existing.set(node.dataset.id, node));
    const seen = new Set();
    const frag = document.createDocumentFragment();
    sessions.forEach(s => {
      seen.add(s.id);
      let node = existing.get(s.id);
      if (!node) {
         // 新建
         node = document.createElement('div');
         node.className = 'session-item';
         node.dataset.id = s.id;
         node.setAttribute('role', 'listitem');
         node.innerHTML = `<span class="session-item-title"></span><span class="session-item-time"></span><button class="session-del" title="删除对话" aria-label="删除对话「${esc(s.title)}」">✕</button>`;
         frag.appendChild(node);
       } else {
         existing.delete(s.id);  // 剩余的就是待删除
       }
      // 增量更新（DOM 文本节点级 diff）
      const titleEl = node.querySelector('.session-item-title');
      const timeEl = node.querySelector('.session-item-time');
      if (titleEl && titleEl.textContent !== s.title) titleEl.textContent = s.title;
      // 会话时间：相对时间显示（更人性化的列表可读性）
      const t = fmtRelative(s.updatedAt);
      if (timeEl && timeEl.textContent !== t) timeEl.textContent = t;
      const isActive = s.id === currentSessionId;
      if (node.classList.contains('active') !== isActive) {
        node.classList.toggle('active', isActive);
      }
    });
    // 删除多余节点
    existing.forEach(node => node.remove());
    // 追加新增（若顺序错乱，重新 append 全部以保证 DOM 顺序）
    Array.from(frag.childNodes).forEach(node => el.appendChild(node));
    // 强制按 sessions 顺序重排（keyed diff 局部更新，append 后顺序仍然正确）
    let cursor = el.firstChild;
    for (const s of sessions) {
      // 跳过非 session-item 节点（空状态）
      if (cursor && cursor.classList && !cursor.classList.contains('session-item')) cursor = cursor.nextSibling;
      const target = el.querySelector(`.session-item[data-id="${s.id}"]`);
      if (cursor !== target && target) {
        el.insertBefore(target, cursor);
      } else if (target) {
        cursor = target.nextSibling;
      }
    }
  }

  function renderChatMessages() {
    const box = $('chat-messages');
    box.innerHTML = '';
    const session = sessions.find(s => s.id === currentSessionId);
    if (!session || !session.messages.length) {
      box.innerHTML = WELCOME_HTML;
      // 有 Key 时隐藏"请先设置 Key"提示
      let s = null;
      try { s = FlibStore.getSettings(); } catch (e) { s = null; }
      if (s && s.apiKey) {
        const hint = box.querySelector('#chat-welcome-hint');
        if (hint) hint.classList.add('hidden');
      }
      return;
    }
    session.messages.forEach(m => {
      if (m.role === 'user') {
        appendChatMsg('user', esc(m.content).replace(/\n/g, '<br>'));
      } else {
        const el = appendChatMsg('assistant', Renderer.renderMarkdown(m.content));
        if (m.sources && m.sources.length) {
          el.parentElement.insertAdjacentHTML('beforeend', `
            <div class="msg-sources">引用内容：${m.sources.map(t => esc(t)).join('、')}</div>`);
        }
      }
    });
    box.scrollTop = box.scrollHeight;
  }

  async function newChat() {
    const cur = sessions.find(s => s.id === currentSessionId);
    // 如果当前已经是空对话，什么也不做
    if (cur && (!cur.messages || !cur.messages.length)) return;
    // 先保存当前会话
    if (cur && cur.messages && cur.messages.length) {
      await saveCurrentSession();
    }
    // 查找是否已存在空的「新对话」，有则直接切换过去（确保最多一个空会话）
    const existingEmpty = sessions.find(s => s.id !== currentSessionId && (!s.messages || !s.messages.length) && s.title === '新对话');
    if (existingEmpty) {
      currentSessionId = existingEmpty.id;
      FlibStore.setCurrentSessionId(currentSessionId);
      chatHistory = [];
      closeMentionPanel();
      setChatStatus('', '');
      renderChatMessages();
      renderSessionList();
      setSessionDrawer(false);
      await FlibStore.saveSessions(sessions);
      return;
    }
    // 创建新的空对话，追加到列表末尾
    currentSessionId = newId();
    sessions.push({ id: currentSessionId, title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
    FlibStore.setCurrentSessionId(currentSessionId);
    chatHistory = [];
    closeMentionPanel();
    setChatStatus('', '');
    renderChatMessages();
    renderSessionList();
    setSessionDrawer(false);
    await FlibStore.saveSessions(sessions);
  }

  async function switchSession(id) {
    if (id === currentSessionId) return;
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    // 先捕获旧会话数据，立即切换并渲染，避免旧消息残留与闪烁
    const prevId = currentSessionId;
    const prevHistory = chatHistory;
    currentSessionId = id;
    FlibStore.setCurrentSessionId(currentSessionId);
    chatHistory = session.messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.sources && m.sources.length ? { sources: m.sources } : {})
    }));
    closeMentionPanel();
    setChatStatus('', '');
    renderChatMessages();
    renderSessionList();
    setSessionDrawer(false); // 移动端选中会话后收起抽屉
    // 异步保存旧会话（用捕获的历史），不阻塞切换
    if (prevId) await persistSession(prevId, prevHistory);
  }

  async function deleteSession(id) {
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    if (!await UI.confirm(`确定删除对话「${esc(session.title)}」吗？`, { title: '删除对话', danger: true })) return;
    sessions = sessions.filter(s => s.id !== id);
    if (currentSessionId === id) {
      if (sessions.length) {
        currentSessionId = sessions[0].id;
      } else {
        currentSessionId = newId();
        sessions = [{ id: currentSessionId, title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [] }];
      }
      FlibStore.setCurrentSessionId(currentSessionId);
      const cur = sessions.find(s => s.id === currentSessionId);
      chatHistory = cur.messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.sources && m.sources.length ? { sources: m.sources } : {})
      }));
      renderChatMessages();
    }
    await FlibStore.saveSessions(sessions);
    renderSessionList();
    setSessionDrawer(false);
  }

  // 知识库内容拼入 prompt 的字符预算（约 4 万 token 输入，为对话历史与输出留足余量）
  const KNOWLEDGE_BUDGET = 80000;

  function buildMessages(history, sources) {
    let sys = '你是一名专业的金融资料分析助手。';
    if (sources.length) {
      sys += '请基于下方【知识库资料】回答用户问题。要求：1) 优先引用资料中的事实、数据与结论，并注明出处（资料序号）；2) 资料无法回答时明确说明资料不足，不要编造；3) 使用简体中文，条理清晰、重点突出。';
      sys += '\n\n【知识库资料】\n' + buildKnowledgeText(sources);
      sys += '\n\n【资料结束】';
    } else {
      sys += '本次对话不附带任何参考资料，请基于自身知识回答，条理清晰、重点突出。';
    }
    return [{ role: 'system', content: sys }, ...history];
  }

  /** 全量拼入所有内容；超预算时每篇等额截断，保证每篇都有内容 */
  function buildKnowledgeText(sources) {
    const blocks = sources.map((s, i) => {
      const content = s.sourceType === 'exp-all' ? (s.content || '') : (s.markdown || '');
      const kind = s.sourceType === 'exp-all' ? '经验库' : '资料';
      return `[${kind}${i + 1}]《${s.title}》\n${content}`;
    });
    const total = blocks.reduce((n, b) => n + b.length, 0);
    if (total <= KNOWLEDGE_BUDGET) return blocks.join('\n\n---\n\n');
    const per = Math.max(300, Math.floor(KNOWLEDGE_BUDGET / sources.length));
    return blocks.map(b => b.length <= per ? b : b.slice(0, per) + '\n…（内容过长，已截断）').join('\n\n---\n\n');
  }

  /* ---------- AI 问答 @ 提及（多选模式） ---------- */
  function onChatKeydown(e) {
    if (mentionState.open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionState.active = (mentionState.active + 1) % mentionState.results.length;
        renderMentionPanel();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionState.active = (mentionState.active - 1 + mentionState.results.length) % mentionState.results.length;
        renderMentionPanel();
        return;
      }
      if (e.key === ' ' && !e.shiftKey) {
        e.preventDefault();
        const hit = mentionState.results[mentionState.active];
        if (hit) toggleMention(hit.item.id);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const checked = mentionState.results.filter(r => r.checked);
        if (checked.length) {
          insertMentions();  // 有勾选：批量插入
        } else {
          const hit = mentionState.results[mentionState.active];
          if (hit) { hit.checked = true; insertMentions(); }  // 无勾选：插入当前高亮项
        }
        return;
      }
      if (e.key === 'Escape') { closeMentionPanel(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function updateMentionPanel() {
    // 输入时清除之前的错误提示
    const st = $('chat-status');
    if (st.classList.contains('chat-status-error')) { st.textContent = ''; st.className = ''; }
    const input = $('chat-input');
    const text = input.value;
    const cursor = input.selectionStart != null ? input.selectionStart : text.length;
    const before = text.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    if (atIdx === -1 || /[\s,，。.;；!?！？\n]/.test(before.slice(atIdx + 1))) {
      closeMentionPanel();
      return;
    }
    const query = before.slice(atIdx + 1);
    const q = query.toLowerCase();
    // 经验部分仅保留「整个经验库」整体引用（固定置顶），其后为资料条目
    const results = [];
    if (experiences.length) results.push({ item: expAllEntry(), checked: false });
    items
      .filter(i => (i.title || '').toLowerCase().includes(q))
      .forEach(item => results.push({ item, checked: false }));
    const final = results.slice(0, 13);
    if (!final.length) { closeMentionPanel(); return; }
    mentionState = { open: true, query, results: final, active: 0, atIndex: atIdx };
    renderMentionPanel();
  }

  function renderMentionPanel() {
    const panel = $('mention-panel');
    const input = $('chat-input');
    panel.classList.remove('hidden');
    // 同步 combobox 状态
    if (input) input.setAttribute('aria-expanded', 'true');
    const checkedCount = mentionState.results.filter(r => r.checked).length;
    const totalCount = mentionState.results.length;
    panel.innerHTML = `
      <div class="mention-toolbar">
        <span class="mention-toolbar-label">@引用 · ↑↓ 切换 · Space 勾选 · Enter 插入 · Esc 关闭</span>
        <span class="mention-toolbar-count" aria-live="polite">${totalCount} 条匹配 · 已选 ${checkedCount}</span>
      </div>
      <div class="mention-list" role="presentation">
        ${mentionState.results.map((r, i) => {
          const prefix = r.item.sourceType === 'exp-all' ? '<svg viewBox="0 0 64 64" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px;margin-right:2px"><path d="M20 14h17a3 3 0 0 1 3 3v33a3 3 0 0 0-3-3H20a3 3 0 0 0-3 3V17a3 3 0 0 1 3-3z"/></svg> ' : '';
          const meta = r.item.sourceType === 'exp-all'
            ? `${experiences.length} 条经验`
            : (r.item.url ? hostOf(r.item.url) : '本地文件');
          const isActive = i === mentionState.active;
          const optId = `mention-opt-${i}`;
          if (isActive && input) input.setAttribute('aria-activedescendant', optId);
          return `
            <div class="mention-item ${isActive ? 'active' : ''}" data-id="${r.item.id}" id="${optId}" role="option" aria-selected="${r.checked ? 'true' : 'false'}" tabindex="-1">
              <span class="mention-check" aria-hidden="true">${r.checked ? '☑' : '☐'}</span>
              <span class="mention-item-title">${prefix}${esc(r.item.title)}</span>
              <span class="mention-meta">${esc(meta)}</span>
            </div>`;
        }).join('')}
      </div>
      <div class="mention-footer">
        <button type="button" class="btn btn-ghost btn-sm" id="mention-cancel">取消</button>
        <button type="button" class="btn btn-primary btn-sm" id="mention-confirm">确定插入</button>
      </div>`;
    panel.querySelectorAll('.mention-item').forEach(el => el.addEventListener('click', () => toggleMention(el.dataset.id)));
    const confirm = $('mention-confirm');
    if (confirm) confirm.addEventListener('click', insertMentions);
    const cancel = $('mention-cancel');
    if (cancel) cancel.addEventListener('click', closeMentionPanel);
  }

  /** 切换某条资料的勾选状态 */
  function toggleMention(id) {
    if (!mentionState.open) return;
    const hit = mentionState.results.find(r => r.item.id === id);
    if (!hit) return;
    hit.checked = !hit.checked;
    renderMentionPanel();
  }

  /** 将勾选的资料批量插入输入框（@标题1 @标题2 …） */
  function insertMentions() {
    if (!mentionState.open) return;
    const selected = mentionState.results.filter(r => r.checked).map(r => r.item);
    if (!selected.length) { closeMentionPanel(); return; }
    const input = $('chat-input');
    const text = input.value;
    const start = mentionState.atIndex;
    const end = input.selectionStart != null ? input.selectionStart : text.length;
    input.value = text.slice(0, start) + selected.map(i => i.sourceType === 'exp-all' ? '@[整个经验库]' : '@' + i.title).join(' ') + ' ' + text.slice(end);
    closeMentionPanel();
    input.focus();
    autoGrow();
  }

  function closeMentionPanel() {
    if (mentionState.open) $('mention-panel').classList.add('hidden');
    mentionState = { open: false, query: '', results: [], active: 0, atIndex: -1 };
    // 同步重置 combobox 状态
    const input = $('chat-input');
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
  }

  /** 解析消息中的 @提及，返回命中的条目（经验/整个经验库/资料） */
  function parseMentions(text, itemList) {
    const regex = /@([^@\s,，。.;；!?！？\n]+)/g;
    const ids = new Set();
    let m;
    while ((m = regex.exec(text)) !== null) {
      const name = m[1].replace(/\s/g, '');
      if (!name) continue;
      if (name === '[整个经验库]') { ids.add('exp|__all__'); continue; }
      for (const i of itemList) {
        const t = (i.title || '').replace(/\s/g, '');
        if (t && (t.includes(name) || name.includes(t))) { ids.add(i.id); break; }
      }
    }
    return [...ids].map(id => itemList.find(i => i.id === id)).filter(Boolean);
  }

  /* ---------- 设置 ---------- */
  function currentSettingsSnapshot() {
    return {
      apiKey: ($('set-apikey').value || '').trim(),
      baseUrl: ($('set-baseurl').value || '').trim() || 'https://api.deepseek.com',
      proxyUrl: ($('set-proxy').value || '').trim(),
      model: ($('set-model').value || '').trim() || 'deepseek-chat'
    };
  }
  function settingsEqual(a, b) {
    return a.apiKey === b.apiKey && a.baseUrl === b.baseUrl && a.proxyUrl === b.proxyUrl && a.model === b.model;
  }
  /** 设置页"未保存更改"指示器：有差异时在保存按钮旁显示黄色脉冲小点 */
  function updateSettingsDirty() {
    const indicator = $('settings-dirty');
    if (!indicator) return;
    const cur = currentSettingsSnapshot();
    const saved = (() => { try { return FlibStore.getSettings() || {}; } catch (e) { return {}; } })();
    // 与默认值归一化后比较
    const savedNorm = {
      apiKey: saved.apiKey || '',
      baseUrl: saved.baseUrl || 'https://api.deepseek.com',
      proxyUrl: saved.proxyUrl || '',
      model: saved.model || 'deepseek-chat'
    };
    const dirty = !settingsEqual(cur, savedNorm);
    indicator.classList.toggle('hidden', !dirty);
  }

  function fillSettings() {
    const s = FlibStore.getSettings();
    $('set-apikey').value = s.apiKey || '';
    $('set-baseurl').value = s.baseUrl || 'https://api.deepseek.com';
    $('set-proxy').value = s.proxyUrl || '';
    $('set-model').value = s.model || 'deepseek-chat';
    updateSettingsDirty();
  }

  function saveSettings() {
    const s = currentSettingsSnapshot();
    FlibStore.saveSettings({
      apiKey: s.apiKey,
      baseUrl: s.baseUrl,
      proxyUrl: s.proxyUrl,
      model: s.model
    });
    setStatus('settings-status', '设置已保存', 'ok');
    UI.toast('设置已保存', 'success');
    updateOnboarding();
    updateSettingsDirty();
  }

  function toggleKey() {
    const el = $('set-apikey');
    const btn = $('btn-toggle-key');
    const show = el.type === 'password';
    el.type = show ? 'text' : 'password';
    btn.textContent = show ? '隐藏' : '显示';
  }

  async function testConnection() {
    saveSettings();
    const btn = $('btn-test');
    UI.setLoading(btn, true, '测试中…');
    setStatus('settings-status', '正在测试连接…', '');
    try {
      const reply = await Chat.test();
      setStatus('settings-status', '连接成功：' + reply, 'ok');
      UI.toast('连接成功', 'success');
    } catch (e) {
      setStatus('settings-status', e.message, 'err');
      UI.toast(e.message, 'error');
    } finally {
      UI.setLoading(btn, false);
    }
  }

  function setStatus(id, msg, type) {
    const el = $(id);
    el.textContent = msg;
    el.className = 'settings-status' + (type === 'ok' ? ' ok' : type === 'err' ? ' err' : '');
  }

  /**
   * 聊天区「回到最新」FAB：
   * - 用户向上滚动超过 240px 时显示；
   * - 点击后平滑滚到底部；
   * - 已在底部时自动隐藏（避免遮挡输入框）。
   */
  function setupChatScrollFab() {
    const fab = $('chat-scroll-fab');
    const box = $('chat-messages');
    if (!fab || !box) return;
    let pending = false;
    const update = () => {
      pending = false;
      const dist = box.scrollHeight - box.clientHeight - box.scrollTop;
      // 距离底部 < 80px 视为已到底
      fab.classList.toggle('visible', dist > 80 && box.scrollHeight > box.clientHeight + 100);
    };
    box.addEventListener('scroll', () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(update);
    }, { passive: true });
    fab.addEventListener('click', () => {
      const prefersReduced = matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      box.scrollTo({ top: box.scrollHeight, behavior: prefersReduced ? 'auto' : 'smooth' });
    });
  }

  /* ---------- 数据管理 ---------- */
  async function exportData() {
    const json = await FlibStore.exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '金融资料库-备份-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus('data-status', '已导出 ' + items.length + ' 条资料', 'ok');
    UI.toast('已导出 ' + items.length + ' 条资料', 'success');
  }

  async function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      items = await FlibStore.importData(text);
      renderLibrary();
      updateDataCount();
      if (window.AssetPanel && typeof window.AssetPanel.init === 'function') {
        window.AssetPanel.init();
      }
      setStatus('data-status', '导入成功，现有 ' + items.length + ' 条资料', 'ok');
      UI.toast('导入成功', 'success');
    } catch (err) {
      setStatus('data-status', '导入失败：文件格式不正确', 'err');
    } finally {
      e.target.value = '';
    }
  }

  async function clearAll() {
    if (!items.length) return;
    if (!await UI.confirm('确定清空全部 <b>' + items.length + '</b> 条资料吗？此操作不可恢复，建议先导出备份。', { title: '清空资料库', danger: true, okText: '清空' })) return;
    items = await FlibStore.clearItems();
    currentId = null;
    showDetailEmpty();
    renderLibrary();
    updateDataCount();
    updateExpBanner();
    setStatus('data-status', '资料库已清空（经验库保留）', 'ok');
    UI.toast('资料库已清空', 'success');
  }

  function updateDataCount() {
    $('data-count').textContent = `当前资料库共 ${items.length} 条资料`;
  }

  /* ---------- 启动 ---------- */
  // 聊天区滚动监听：用户向上滚动时显示「回到最新」FAB
  setupChatScrollFab();
  document.addEventListener('DOMContentLoaded', init);
})();
