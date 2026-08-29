/* ===== 抓取模块：优先用 r.jina.ai Reader 转 Markdown；失败（含微信等反爬站点）兜底用 CORS 代理抓取原始 HTML 并提取正文。
  微信公众号链接特殊处理：r.jina.ai 在国内网络普遍连接超时，先走 CORS 代理直抓 #js_content，失败再回退 jina ===== */
'use strict';

const Fetcher = (() => {
  /**
   * 抓取网页并解析为 { markdown, title, summary }
   * 内部函数名取 fetchPage，避免遮蔽全局 fetch（原实现中 fetch() 自引用导致无限递归）
   * @param {string} url
   */
  async function fetchPage(url) {
    const target = (url || '').trim();
    const clean = target.replace(/^https?:\/\//i, '');
    if (!/^[\w-]+(\.[\w-]+)+/.test(clean)) {
      throw new Error('链接格式不正确，请检查后重试');
    }
    // 微信公众号文章：r.jina.ai 在国内网络普遍连接超时（30s 白等），
    // 优先走 CORS 代理直抓 #js_content，全部代理失败再回退 jina
    const isWeixin = /mp\.weixin\.qq\.com/i.test(target);
    if (isWeixin) {
      const viaProxy = await tryProxyHtml(target);
      if (viaProxy) return viaProxy;
      const viaJina = await tryJina(target);
      if (viaJina) return viaJina;
    } else {
      // 1) 主抓取服务（r.jina.ai Reader）
      const viaJina = await tryJina(target);
      if (viaJina) return viaJina;
      // 2) 兜底：CORS 代理抓取原始 HTML 并提取正文
      const viaProxy = await tryProxyHtml(target);
      if (viaProxy) return viaProxy;
    }
    throw new Error('自动抓取失败：主服务与兜底代理均无法获取该页面内容。可复制网页正文，使用「手动粘贴内容」添加。');
  }

  /** 主抓取：r.jina.ai Reader。任何失败返回 null，交由兜底处理 */
  async function tryJina(target) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch('https://r.jina.ai/' + encodeURIComponent(target), {
        headers: { 'X-Return-Format': 'markdown' },
        signal: controller.signal
      });
      if (!res.ok) return null;
      const text = await res.text();
      if (!text || text.length < 40) return null;
      const parsed = parse(text);
      if (!parsed.markdown || parsed.markdown.length < 40) return null;
      // 微信等站点常返回「环境异常 / 请在微信客户端打开 / 验证」等拦截页，视作失败走兜底
      if (/请在微信客户端打开|环境异常|访问过于频繁|请输入验证码|该内容已被投诉|此内容因违规无法查看/i.test(parsed.markdown)) return null;
      return parsed;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** 兜底：通过 CORS 代理抓取原始 HTML，再从正文容器提取并转 Markdown */
  async function tryProxyHtml(target) {
    const proxies = [
      // cors.eu.org：Cloudflare Worker 代理，国内可达，微信文章实测可完整抓取（2026-08 验证）
      u => 'https://cors.eu.org/' + u,
      u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
      u => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u)
    ];
    for (let i = 0; i < proxies.length; i++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(proxies[i](target), { signal: controller.signal });
        if (!res.ok) continue;
        const html = await res.text();
        if (!html || html.length < 200) continue;
        const art = extractArticle(html, target);
        // 代理也可能拿到微信拦截页，需再次识别并放弃，尝试下一个代理
        if (!art.markdown || art.markdown.length < 50) continue;
        if (/请在微信客户端打开|环境异常|访问过于频繁|请输入验证码|该内容已被投诉|此内容因违规无法查看/i.test(art.markdown)) continue;
        return { markdown: art.markdown, title: art.title, summary: extractSummary(art.markdown) };
      } catch (e) {
        // 尝试下一个代理
      } finally {
        clearTimeout(timeoutId);
      }
    }
    return null;
  }

  /** 从整页 HTML 中提取标题与正文容器，并转 Markdown */
  function extractArticle(html, url) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // 标题
    let title = '';
    const og = doc.querySelector('meta[property="og:title"]');
    if (og) title = (og.getAttribute('content') || '').trim();
    if (!title) { const t = doc.querySelector('title'); if (t) title = t.textContent.trim(); }
    // 正文容器：微信优先 #js_content，其次通用 article / 内容类容器
    let container = null;
    if (/mp\.weixin\.qq\.com/.test(url)) container = doc.getElementById('js_content');
    if (!container) container = doc.querySelector('article');
    if (!container) container = doc.querySelector('.rich_media_content, .article, .post-content, .content, .article-content');
    if (!container) container = doc.body;
    const md = htmlToMarkdown(container ? container.innerHTML : html);
    return { title: title || '未命名资料', markdown: md };
  }

  /** 解析 r.jina.ai 输出：元数据头 + Markdown 正文 */
  function parse(text) {
    let markdown = text;
    let title = '';

    // r.jina.ai 头部格式：Title: / URL Source: / Markdown Content:
    const titleMatch = text.match(/^Title:\s*(.*)$/m);
    if (titleMatch) title = titleMatch[1].trim();

    const contentMark = text.indexOf('Markdown Content:');
    if (contentMark !== -1) {
      const lineEnd = text.indexOf('\n', contentMark);
      markdown = lineEnd !== -1 ? text.slice(lineEnd + 1) : '';
    }

    // 兜底：取第一个 H1 作为标题
    if (!title) {
      const h1 = markdown.match(/^#\s+(.+)$/m);
      if (h1) title = h1[1].trim();
    }
    if (!title) title = '未命名资料';

    return { markdown: markdown.trim() || text.trim(), title, summary: extractSummary(markdown) };
  }

  /** 从 Markdown 提取纯文本摘要 */
  function extractSummary(md, len = 180) {
    const plain = md
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(#{1,6})\s+/gm, ' ')
      .replace(/[>*_~|\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!plain) return '（无文本摘要）';
    return plain.length > len ? plain.slice(0, len) + '…' : plain;
  }

  /** 将文章 HTML 转为 Markdown（聚焦常见文章结构，去除脚本/样式） */
  function htmlToMarkdown(html) {
    if (!html) return '';
    const clean = String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
    const doc = new DOMParser().parseFromString(clean, 'text/html');
    return renderNode(doc.body).replace(/\n{3,}/g, '\n\n').trim();
  }

  function renderNode(node) {
    let md = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { // TEXT_NODE
        md += child.textContent;
      } else if (child.nodeType === 1) { // ELEMENT_NODE
        const tag = child.tagName.toLowerCase();
        const inner = renderNode(child);
        const innerTrim = inner.trim();
        switch (tag) {
          case 'br': md += '\n'; break;
          case 'p':
          case 'div':
          case 'section':
            if (innerTrim) md += innerTrim + '\n\n';
            break;
          case 'h1': md += '# ' + innerTrim + '\n\n'; break;
          case 'h2': md += '## ' + innerTrim + '\n\n'; break;
          case 'h3': md += '### ' + innerTrim + '\n\n'; break;
          case 'h4': md += '#### ' + innerTrim + '\n\n'; break;
          case 'h5': md += '##### ' + innerTrim + '\n\n'; break;
          case 'h6': md += '###### ' + innerTrim + '\n\n'; break;
          case 'strong':
          case 'b': md += '**' + innerTrim + '**'; break;
          case 'em':
          case 'i': md += '*' + innerTrim + '*'; break;
          case 'a': {
            const href = child.getAttribute('href') || '';
            md += href ? `[${innerTrim}](${href})` : innerTrim;
            break;
          }
          case 'img': {
            // 微信等站点用懒加载：src 是 140px 占位图，真实图在 data-src，优先取
            const src = child.getAttribute('data-src') || child.getAttribute('src') || '';
            const alt = child.getAttribute('alt') || '';
            if (src) md += `![${alt}](${src})\n\n`;
            break;
          }
          case 'ul':
          case 'ol': {
            let items = '';
            for (const li of child.children) {
              if (li.tagName.toLowerCase() === 'li') items += (tag === 'ol' ? '1. ' : '- ') + renderNode(li).trim() + '\n';
            }
            md += items + '\n';
            break;
          }
          case 'blockquote': md += '> ' + innerTrim.replace(/\n+/g, '\n> ') + '\n\n'; break;
          case 'hr': md += '---\n\n'; break;
          case 'pre': md += '```\n' + (child.textContent || '').replace(/\n$/, '') + '\n```\n\n'; break;
          case 'code': md += '`' + innerTrim + '`'; break;
          case 'table': md += htmlTableToMarkdown(child) + '\n\n'; break;
          default: md += inner;
        }
      }
    }
    return md;
  }

  function htmlTableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';
    const lines = [];
    rows.forEach((tr, ri) => {
      const cells = Array.from(tr.querySelectorAll('th,td')).map(td => renderNode(td).trim().replace(/\n/g, ' '));
      if (!cells.length) return;
      lines.push('| ' + cells.join(' | ') + ' |');
      if (ri === 0) lines.push('| ' + cells.map(() => '---').join(' | ') + ' |');
    });
    return lines.join('\n');
  }

  return { fetch: fetchPage };
})();
