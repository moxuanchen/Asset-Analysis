/* ===== 本地文件解析：PDF / DOCX / Markdown / TXT → Markdown =====
 * 依赖库按需懒加载（CDN），离线时相关格式不可用
 */
'use strict';

const FileParser = (() => {
  const CDN = {
    pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
    turndown: 'https://cdn.jsdelivr.net/npm/turndown@7.1.2/dist/turndown.js'
  };

  const loaded = {};

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('解析库加载失败，请检查网络后重试'));
      document.head.appendChild(s);
    });
  }

  async function ensure(key) {
    if (loaded[key]) return;
    await loadScript(CDN[key]);
    loaded[key] = true;
  }

  async function ensurePdf() {
    if (window.pdfjsLib) return;
    await ensure('pdf');
    try {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    } catch (e) { /* worker 配置失败时降级主线程解析 */ }
  }

  /**
   * 解析文件，返回 { markdown, title, summary }
   */
  async function parse(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
      const text = await file.text();
      if (!text.trim()) throw new Error('文件内容为空');
      return {
        markdown: text,
        title: file.name.replace(/\.(md|markdown|txt)$/i, ''),
        summary: extractSummary(text)
      };
    }
    if (ext === 'pdf') {
      // 超大 PDF 主线程解析会卡死页面，超限提示改用其他方式
      if (file.size > 50 * 1024 * 1024) {
        throw new Error('PDF 文件超过 50MB，请改用其他方式处理');
      }
      const buf = await file.arrayBuffer();
      const text = await parsePdf(buf);
      if (!text.trim()) throw new Error('未能从该 PDF 提取到文字（可能是扫描版，暂不支持 OCR）');
      return {
        markdown: text,
        title: file.name.replace(/\.pdf$/i, ''),
        summary: extractSummary(text)
      };
    }
    if (ext === 'docx') {
      const buf = await file.arrayBuffer();
      const md = await parseDocx(buf);
      return {
        markdown: md,
        title: file.name.replace(/\.docx$/i, ''),
        summary: extractSummary(md)
      };
    }
    throw new Error('不支持的文件格式，请选择 PDF / DOCX / Markdown / TXT');
  }

  /** PDF 文本提取（主线程解析，避免 file:// 下 worker 受限） */
  async function parsePdf(arrayBuffer) {
    await ensurePdf();
    const task = window.pdfjsLib.getDocument({ data: arrayBuffer, disableWorker: true });
    const pdf = await task.promise;
    let out = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      let line = '';
      let lastY = null;
      for (const item of tc.items) {
        const y = item.transform ? item.transform[5] : 0;
        if (lastY !== null && Math.abs(y - lastY) > 3) {
          out += line + '\n';
          line = '';
        }
        line += item.str;
        lastY = y;
      }
      out += line + '\n\n';
    }
    await task.destroy();
    return out.trim();
  }

  /** DOCX → HTML → Markdown */
  async function parseDocx(arrayBuffer) {
    await ensure('mammoth');
    if (!window.TurndownService) await ensure('turndown');
    const result = await window.mammoth.convertToHtml({ arrayBuffer });
    const html = result.value || '';
    if (!html.trim()) throw new Error('未能从该 DOCX 提取到内容');
    const md = new window.TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
      .turndown(html);
    return md.trim();
  }

  /** 从 Markdown 提取纯文本摘要 */
  function extractSummary(md, len = 180) {
    const plain = String(md || '')
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

  return { parse };
})();
