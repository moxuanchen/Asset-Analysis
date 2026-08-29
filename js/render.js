/* ===== 渲染模块：Markdown → 安全 HTML + 代码高亮（离线自动降级） ===== */
'use strict';

const Renderer = (() => {
  // 初始化 marked（若已通过 CDN 加载）
  if (window.marked) {
    window.marked.use({ gfm: true, breaks: true });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * 单次渲染 Markdown 为安全 HTML（同步路径）
   * 依赖 CDN（marked/DOMPurify/hljs）不可用时降级为转义纯文本
   */
  function renderMarkdown(md) {
    if (!md || !md.trim()) return '<p class="muted">（无内容）</p>';
    if (window.marked) {
      let html;
      try {
        html = window.marked.parse(md);
      } catch (e) {
        return '<pre>' + escapeHtml(md) + '</pre>';
      }
      if (window.DOMPurify) {
        html = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
      } else {
        // fail-closed：marked 可用但缺少 DOMPurify 时，绝不渲染未净化的 HTML，降级为转义纯文本
        return '<pre>' + escapeHtml(md) + '</pre>';
      }
      if (window.hljs) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        tmp.querySelectorAll('pre code').forEach(block => {
          try { hljs.highlightElement(block); } catch (e) { /* ignore */ }
        });
        html = tmp.innerHTML;
      }
      // Markdown 表格外层包可滚动容器，避免长表撑破布局
      html = wrapTablesForScroll(html);
      return html;
    }
    return '<pre>' + escapeHtml(md) + '</pre>';
  }

  /**
   * 流式节流渲染：
   * - 累积 delta 到 buffer，schedule() 在下一帧/空闲回调中合并渲染；
   * - 收到 \n\n 或 stop / complete 时立即 flush；
   * - 复用同一个容器（replyEl），仅替换 innerHTML 减少 DOM diff。
   *
   * 用法：
   *   const sr = Renderer.createStreamRenderer(replyEl);
   *   sr.append(delta); sr.append(delta);
   *   sr.flush();   // 立即渲染
   *   sr.complete(); // 终止并渲染最终内容（可移除光标）
   *   sr.abort();   // 停止调度（保留最后一次结果）
   */
  function createStreamRenderer(targetEl, opts) {
    const options = Object.assign({ forceCursor: true, interval: 80 }, opts || {});
    const state = { buffer: '', pending: false, timer: null, done: false, useIdle: !!(window.requestIdleCallback) };
    const liveRegion = targetEl;

    function doRender() {
      state.pending = false;
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      const text = state.buffer;
      if (!text) return;
      // 渲染时若已结束不再追加流式光标
      const cursor = options.forceCursor && !state.done ? '<span class="typing-cursor" aria-hidden="true"></span>' : '';
      try {
        const html = renderMarkdown(text) + cursor;
        liveRegion.innerHTML = html;
        // 渲染后注入：代码块复制按钮 + 图片懒加载
        enhanceCodeBlocks(liveRegion);
        enhanceImages(liveRegion);
      } catch (e) {
        // 渲染失败时回退纯文本（不抛错打断流）
        liveRegion.textContent = text + (cursor ? '▍' : '');
      }
    }

    function schedule() {
      if (state.pending) return;
      state.pending = true;
      if (state.useIdle && window.requestIdleCallback) {
        window.requestIdleCallback(doRender, { timeout: 120 });
      } else {
        state.timer = setTimeout(doRender, options.interval);
      }
    }

    return {
      append(delta) {
        if (state.done || !delta) return;
        state.buffer += delta;
        // 段尾换行（\n\n）触发立即 flush，让长文不至于"卡"在 buffer
        if (state.buffer.endsWith('\n\n')) {
          if (state.timer) { clearTimeout(state.timer); state.timer = null; }
          doRender();
        } else {
          schedule();
        }
      },
      flush() {
        if (state.timer) { clearTimeout(state.timer); state.timer = null; }
        doRender();
      },
      complete() {
        state.done = true;
        if (state.timer) { clearTimeout(state.timer); state.timer = null; }
        doRender();
      },
      abort() {
        state.done = true;
        if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      },
      get length() { return state.buffer.length; },
    };
  }

  /** Markdown 表格外层包可滚动 div，避免宽表格撑破布局 */
  function wrapTablesForScroll(html) {
    if (typeof html !== 'string' || html.indexOf('<table') === -1) return html;
    return html.replace(/<table(\s[^>]*)?>/g, '<div class="md-table-wrap"><table$1>').replace(/<\/table>/g, '</table></div>');
  }

  /**
   * 给 <pre><code> 注入「复制」按钮
   * 桌面 hover/focus 显 1；触屏常驻 0.6；成功时显示 ✓ 已复制 1.6s
   */
  function enhanceCodeBlocks(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('pre').forEach(pre => {
      // 已增强过则跳过
      if (pre.querySelector(':scope > .md-copy-btn')) return;
      pre.style.position = pre.style.position || 'relative';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'md-copy-btn';
      btn.setAttribute('aria-label', '复制代码');
      btn.innerHTML = '<span class="md-copy-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></span><span class="md-copy-text">复制</span>';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const code = pre.querySelector('code');
        const text = code ? code.textContent : pre.textContent;
        copyText(text).then((ok) => {
          if (!ok) return;
          const textEl = btn.querySelector('.md-copy-text');
          const iconEl = btn.querySelector('.md-copy-icon');
          if (textEl) textEl.textContent = '已复制';
          if (iconEl) iconEl.textContent = '✓';
          btn.classList.add('is-success');
          setTimeout(() => {
            if (textEl) textEl.textContent = '复制';
            if (iconEl) iconEl.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
            btn.classList.remove('is-success');
          }, 1600);
        });
      });
      pre.appendChild(btn);
    });
  }

  /**
   * 给 <img> 注入懒加载属性：
   * - src → data-src（避免 Markdown 输出时立刻发起网络请求）
   * - 使用 IntersectionObserver 监听进入视口再恢复 src（降级原生 loading=lazy）
   * - 解码异步、图片自带 alt 由渲染器保证
   */
  let imgObserver = null;
  function getImgObserver() {
    if (imgObserver || !('IntersectionObserver' in window)) return imgObserver || null;
    imgObserver = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        const img = en.target;
        const real = img.getAttribute('data-src');
        if (real) {
          img.src = real;
          img.removeAttribute('data-src');
        }
        imgObserver.unobserve(img);
      });
    }, { rootMargin: '300px 0px', threshold: 0.01 });
    return imgObserver;
  }

  function enhanceImages(rootEl) {
    if (!rootEl) return;
    const imgs = rootEl.querySelectorAll('img');
    imgs.forEach(img => {
      // 用户主动标记了 eager 或已是 data-src 形态的跳过
      if (img.dataset.eager === '1') return;
      if (img.getAttribute('loading') === 'eager') {
        img.dataset.eager = '1';
        return;
      }
      if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
      // 如果浏览器原生 lazy 支持，直接交给浏览器（性能更优）
      if ('loading' in HTMLImageElement.prototype) {
        if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
        return;
      }
      // 不支持原生 lazy：使用 IntersectionObserver 代理
      const src = img.getAttribute('src');
      if (!src || img.hasAttribute('data-src')) return;
      img.setAttribute('data-src', src);
      img.removeAttribute('src');
      // 透明度淡入
      img.style.opacity = '0';
      img.style.transition = 'opacity .25s var(--ease)';
      img.addEventListener('load', () => { img.style.opacity = '1'; }, { once: true });
      const obs = getImgObserver();
      if (obs) obs.observe(img);
      else {
        // 终极降级：直接赋值
        img.src = src;
        img.removeAttribute('data-src');
      }
    });
  }

  /** 复制文本：优先 Clipboard API，失败 fallback execCommand */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  /** 渲染后给站外链接加 target="_blank"（在净化后执行） */
  function externalizeLinks(rootEl) {
    if (!rootEl) return;
    // 触发图片/代码块增强
    enhanceImages(rootEl);
    enhanceCodeBlocks(rootEl);
    rootEl.querySelectorAll('a').forEach(a => {
      const href = (a.getAttribute('href') || '').trim();
      if (href && !href.startsWith('#')) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  return { renderMarkdown, externalizeLinks, escapeHtml, createStreamRenderer, enhanceCodeBlocks, enhanceImages };
})();
