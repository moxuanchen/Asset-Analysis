/* ===== RAG 检索：中文 bigram 倒排索引 + 简化 BM25 ===== */
'use strict';

const RAG = (() => {
  /**
   * 分词：英文/数字按词，中文连续段按相邻字符 bigram
   */
  function tokenize(text) {
    const norm = String(text || '').toLowerCase();
    const tokens = [];
    const en = norm.match(/[a-z0-9]+/g);
    if (en) tokens.push(...en);
    const cnRuns = norm.match(/[\u4e00-\u9fa5]+/g);
    if (cnRuns) {
      for (const run of cnRuns) {
        if (run.length === 1) {
          tokens.push(run);
        } else {
          for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
        }
      }
    }
    return tokens;
  }

  /** 构建倒排索引 */
  function buildIndex(items) {
    const index = new Map();          // token -> Map<id, tf>
    const docLens = new Map();        // id -> 文档长度
    items.forEach(item => {
      const body = (item.title + ' ' + (item.tags || []).join(' ') + ' ' + (item.markdown || '')).toLowerCase();
      const head = (item.title + ' ' + (item.tags || []).join(' ')).toLowerCase();

      const tokens = tokenize(body);
      docLens.set(item.id, tokens.length);

      const freq = new Map();
      tokens.forEach(t => freq.set(t, (freq.get(t) || 0) + 1));
      // 标题与标签加权（等效 tf ×3）
      tokenize(head).forEach(t => freq.set(t, (freq.get(t) || 0) + 2));

      freq.forEach((f, t) => {
        if (!index.has(t)) index.set(t, new Map());
        index.get(t).set(item.id, f);
      });
    });
    return { index, docLens, N: items.length };
  }

  /**
   * 按查询对全部资料打分排序，返回 [{ item, score }]
   */
  function rankByQuery(query, items) {
    if (!items || !items.length) return [];
    const { index, docLens, N } = buildIndex(items);
    const qTokens = tokenize(query);
    if (!qTokens.length) return items.map(item => ({ item, score: 0 }));

    let totalLen = 0;
    docLens.forEach(v => (totalLen += v));
    const avgdl = Math.max(totalLen / N, 1);

    const scores = new Map();
    qTokens.forEach(t => {
      const postings = index.get(t);
      if (!postings) return;
      const df = postings.size;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      postings.forEach((tf, id) => {
        const dl = docLens.get(id) || 1;
        const k = 1.2 * (1 - 0.75 + 0.75 * (dl / avgdl));
        const score = idf * ((tf * 2.2) / (tf + k));
        scores.set(id, (scores.get(id) || 0) + score);
      });
    });

    const scored = items.map(item => ({ item, score: scores.get(item.id) || 0 }));
    return scored.sort((a, b) => b.score - a.score);
  }

  /** 取最相关的 topN 条 */
  function search(query, items, topN = 5) {
    return rankByQuery(query, items).slice(0, topN).map(x => x.item);
  }

  /** 全量排序（不裁剪），相关度高的在前，其余在后 */
  function rankAll(query, items) {
    return rankByQuery(query, items).map(x => x.item);
  }

  return { search, rankAll, tokenize };
})();
