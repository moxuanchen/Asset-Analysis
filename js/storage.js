/* ===== 存储层：localStorage 为主，容量超限自动回退 IndexedDB ===== */
'use strict';

const FlibStore = (() => {
  const ITEMS_KEY = 'flib.items';
  const SETTINGS_KEY = 'flib.settings';
  const SESSIONS_KEY = 'flib.sessions';
  const EXPS_KEY = 'flib.experiences';
  const ASSETS_KEY = 'flib.assets';
  const CURRENT_SESSION_KEY = 'flib.currentSession';
  // IDB 回退标记：数据写入 IndexedDB 后置位；load 时若标记存在则优先读 IDB，
  // 避免 localStorage 仍持有旧值（saveItems 容量超限回退后新数据被静默丢弃）。
  const FB_ITEMS_KEY = 'flib.fb.items';
  const FB_SESSIONS_KEY = 'flib.fb.sessions';
  const FB_EXPS_KEY = 'flib.fb.experiences';
  const FB_ASSETS_KEY = 'flib.fb.assets';

  /* ---- IndexedDB 回退（KV 存储） ---- */
  const idb = {
    _db: null,
    _open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('flib-db', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) {
            db.createObjectStore('kv');
          }
        };
        req.onsuccess = () => { this._db = req.result; resolve(req.result); };
        req.onerror = () => reject(req.error);
      });
    },
    async get(key) {
      const db = await this._open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async set(key, value) {
      const db = await this._open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async delete(key) {
      const db = await this._open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  };

  /* ---- 回退标记辅助 ---- */
  function hasFallbackMarker(markerKey) {
    try { return localStorage.getItem(markerKey) === '1'; } catch (e) { return false; }
  }

  function clearFallbackMarker(markerKey) {
    try { localStorage.removeItem(markerKey); } catch (e) { /* ignore */ }
  }

  /** 把从 IDB 读到的数据回迁 localStorage；回迁成功才清除标记（数据仍超限时保留标记，下次继续读 IDB） */
  function migrateFromIdb(lsKey, markerKey, raw) {
    let migrated = false;
    try { localStorage.setItem(lsKey, raw); migrated = true; } catch (e) { /* ignore */ }
    if (migrated) clearFallbackMarker(markerKey);
  }

  /* ---- 资料 CRUD ---- */
  function getItems() {
    try {
      const raw = localStorage.getItem(ITEMS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return null; // null 表示需要尝试 IndexedDB
  }

  function saveItems(items) {
    const payload = JSON.stringify(items);
    try {
      localStorage.setItem(ITEMS_KEY, payload);
      return Promise.resolve();
    } catch (e) {
      // 容量超限或 file:// 下 localStorage 不可用 → 回退 IndexedDB，并置标记
      try { localStorage.setItem(FB_ITEMS_KEY, '1'); } catch (e2) { /* ignore */ }
      return idb.set(ITEMS_KEY, payload);
    }
  }

  async function loadItems() {
    // 有回退标记时，IDB 才是权威数据源：先读 IDB，避免读到 localStorage 旧值
    if (hasFallbackMarker(FB_ITEMS_KEY)) {
      try {
        const raw = await idb.get(ITEMS_KEY);
        if (raw) {
          const items = JSON.parse(raw);
          migrateFromIdb(ITEMS_KEY, FB_ITEMS_KEY, raw);
          return items;
        }
      } catch (e) { /* ignore */ }
      // IDB 无数据或不可用：清除失效标记，走常规逻辑
      clearFallbackMarker(FB_ITEMS_KEY);
    }
    let items = getItems();
    if (items !== null) return items;
    // localStorage 无数据时尝试 IndexedDB（可能之前被迁移过去）
    try {
      const raw = await idb.get(ITEMS_KEY);
      if (raw) {
        items = JSON.parse(raw);
        migrateFromIdb(ITEMS_KEY, FB_ITEMS_KEY, raw);
        return items;
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  async function addItem(item) {
    const items = await loadItems();
    items.push(item);
    await saveItems(items);
    return items;
  }

  async function updateItem(id, patch) {
    const items = await loadItems();
    const idx = items.findIndex(x => x.id === id);
    if (idx === -1) return items;
    items[idx] = { ...items[idx], ...patch, updatedAt: Date.now() };
    await saveItems(items);
    return items;
  }

  async function removeItem(id) {
    let items = await loadItems();
    items = items.filter(x => x.id !== id);
    await saveItems(items);
    return items;
  }

  async function clearItems() {
    try { localStorage.removeItem(ITEMS_KEY); } catch (e) { /* ignore */ }
    clearFallbackMarker(FB_ITEMS_KEY);
    // 只删除资料对应的 IDB key：避免清空整个 kv 存储，导致已回退到 IDB 的
    // sessions/experiences 被误删、且标记未清造成回滚丢失
    try { await idb.delete(ITEMS_KEY); } catch (e) { /* ignore */ }
    return [];
  }

  /* ---- 设置 ---- */
  function getSettings() {
    const def = {
      apiKey: '',
      baseUrl: 'https://api.deepseek.com',
      proxyUrl: '',
      model: 'deepseek-chat'
    };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return { ...def, ...JSON.parse(raw) };
    } catch (e) { /* ignore */ }
    return def;
  }

  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  /* ---- 会话记录 ---- */
  function saveSessions(sessions) {
    const payload = JSON.stringify(sessions);
    try {
      localStorage.setItem(SESSIONS_KEY, payload);
      return Promise.resolve();
    } catch (e) {
      try { localStorage.setItem(FB_SESSIONS_KEY, '1'); } catch (e2) { /* ignore */ }
      return idb.set(SESSIONS_KEY, payload);
    }
  }

  async function loadSessions() {
    if (hasFallbackMarker(FB_SESSIONS_KEY)) {
      try {
        const raw = await idb.get(SESSIONS_KEY);
        if (raw) {
          const sessions = JSON.parse(raw);
          migrateFromIdb(SESSIONS_KEY, FB_SESSIONS_KEY, raw);
          return sessions;
        }
      } catch (e) { /* ignore */ }
      clearFallbackMarker(FB_SESSIONS_KEY);
    }
    let sessions = null;
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      if (raw) sessions = JSON.parse(raw);
    } catch (e) { /* ignore */ }
    if (sessions === null) {
      try {
        const raw = await idb.get(SESSIONS_KEY);
        if (raw) {
          sessions = JSON.parse(raw);
          migrateFromIdb(SESSIONS_KEY, FB_SESSIONS_KEY, raw);
        }
      } catch (e) { /* ignore */ }
    }
    return sessions || [];
  }

  /* ---- 当前会话 ID（刷新后恢复） ---- */
  function getCurrentSessionId() {
    try { return localStorage.getItem(CURRENT_SESSION_KEY) || null; } catch (e) { return null; }
  }

  function setCurrentSessionId(id) {
    try {
      if (id) localStorage.setItem(CURRENT_SESSION_KEY, id);
      else localStorage.removeItem(CURRENT_SESSION_KEY);
    } catch (e) { /* ignore */ }
  }

  /* ---- 经验库 ---- */
  function saveExperiences(list) {
    const payload = JSON.stringify(list);
    try {
      localStorage.setItem(EXPS_KEY, payload);
      return Promise.resolve();
    } catch (e) {
      try { localStorage.setItem(FB_EXPS_KEY, '1'); } catch (e2) { /* ignore */ }
      return idb.set(EXPS_KEY, payload);
    }
  }

  async function loadExperiences() {
    if (hasFallbackMarker(FB_EXPS_KEY)) {
      try {
        const raw = await idb.get(EXPS_KEY);
        if (raw) {
          const list = JSON.parse(raw);
          migrateFromIdb(EXPS_KEY, FB_EXPS_KEY, raw);
          return list;
        }
      } catch (e) { /* ignore */ }
      clearFallbackMarker(FB_EXPS_KEY);
    }
    let list = null;
    try {
      const raw = localStorage.getItem(EXPS_KEY);
      if (raw) list = JSON.parse(raw);
    } catch (e) { /* ignore */ }
    if (list === null) {
      try {
        const raw = await idb.get(EXPS_KEY);
        if (raw) {
          list = JSON.parse(raw);
          migrateFromIdb(EXPS_KEY, FB_EXPS_KEY, raw);
        }
      } catch (e) { /* ignore */ }
    }
    return list || [];
  }

  /* ---- 资产面板 ---- */
  function saveAssets(list) {
    const payload = JSON.stringify(Array.isArray(list) ? list : []);
    try {
      localStorage.setItem(ASSETS_KEY, payload);
      return Promise.resolve();
    } catch (e) {
      try { localStorage.setItem(FB_ASSETS_KEY, '1'); } catch (e2) { /* ignore */ }
      return idb.set(ASSETS_KEY, payload);
    }
  }

  async function loadAssets() {
    if (hasFallbackMarker(FB_ASSETS_KEY)) {
      try {
        const raw = await idb.get(ASSETS_KEY);
        if (raw) {
          const list = JSON.parse(raw);
          migrateFromIdb(ASSETS_KEY, FB_ASSETS_KEY, raw);
          return Array.isArray(list) ? list : [];
        }
      } catch (e) { /* ignore */ }
      clearFallbackMarker(FB_ASSETS_KEY);
    }
    let list = null;
    try {
      const raw = localStorage.getItem(ASSETS_KEY);
      if (raw) list = JSON.parse(raw);
    } catch (e) { /* ignore */ }
    if (list === null) {
      try {
        const raw = await idb.get(ASSETS_KEY);
        if (raw) {
          list = JSON.parse(raw);
          migrateFromIdb(ASSETS_KEY, FB_ASSETS_KEY, raw);
        }
      } catch (e) { /* ignore */ }
    }
    return Array.isArray(list) ? list : [];
  }

  /* ---- 导出 / 导入 ---- */
  async function exportData() {
    const items = await loadItems();
    const assets = await loadAssets();
    return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items, assets }, null, 2);
  }

  async function importData(jsonStr) {
    const data = JSON.parse(jsonStr);
    const list = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
    const items = await loadItems();
    const merged = [...items];
    for (const item of list) {
      if (!item || typeof item.id !== 'string') continue;
      if (!merged.some(x => x.id === item.id)) merged.push(item);
    }
    await saveItems(merged);
    // 资产导入（仅当导出包含 assets 字段时）：按 id 去重合并
    if (data && Array.isArray(data.assets)) {
      const assets = await loadAssets();
      const am = [...assets];
      for (const a of data.assets) {
        if (!a || typeof a.id !== 'string') continue;
        if (!am.some(x => x.id === a.id)) am.push(a);
      }
      await saveAssets(am);
    }
    return merged;
  }

  return { getItems, saveItems, loadItems, addItem, updateItem, removeItem, clearItems, getSettings, saveSettings, saveSessions, loadSessions, getCurrentSessionId, setCurrentSessionId, saveExperiences, loadExperiences, saveAssets, loadAssets, exportData, importData };
})();
