/* ===== 聊天模块：DeepSeek chat completions（SSE 流式 + 降级） ===== */
'use strict';

class ChatError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const Chat = (() => {
  function mapHttpError(status) {
    switch (status) {
      case 401: return 'API Key 无效，请检查设置中的 Key';
      case 402: return '账户余额不足，请前往 DeepSeek 平台充值';
      case 429: return '请求过于频繁（限流），请稍后再试';
      case 400: return '请求参数错误（可能资料内容超出模型上下文长度）';
      case 403: return '访问被拒绝，请检查 Key 权限或代理配置';
      default: return '服务端错误（HTTP ' + status + '）';
    }
  }

  /**
   * 发送对话请求（流式），返回完整结果
   * @param {Array} messages [{role, content}]
   * @param {Object} opts { onDelta(text), signal }
   * @returns {Promise<{content:string, finishReason:string}>}
   */
  async function chatRaw(messages, opts = {}) {
    const s = FlibStore.getSettings();
    if (!s.apiKey) throw new ChatError('请先在「设置」中填写 DeepSeek API Key', 'NO_KEY');

    // 30 秒超时中止；同时联动外部 signal（用户点击「停止」）
    const TIMEOUT_MS = 30000;
    const controller = new AbortController();
    const userSignal = opts.signal || null;
    let timeoutId = 0;
    let timedOut = false;

    const onUserAbort = () => controller.abort();
    if (userSignal) {
      if (userSignal.aborted) controller.abort();
      else userSignal.addEventListener('abort', onUserAbort);
    }
    timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);

    // AbortError → 区分超时与用户停止
    const toChatError = (e) => {
      if (e instanceof ChatError) return e;
      if (e && e.name === 'AbortError') {
        return timedOut
          ? new ChatError('请求超时（30 秒无响应），请稍后重试', 'TIMEOUT')
          : new ChatError('已停止生成', 'ABORT');
      }
      return e;
    };

    try {
      const base = (s.proxyUrl || s.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
      const url = base + '/chat/completions';
      const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey };

      const body = { model: s.model || 'deepseek-chat', messages, temperature: 0.7, stream: true };
      const post = (stream) => fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, stream }),
        signal: controller.signal
      });

      let res;
      try {
        res = await post(true);
      } catch (e) {
        throw toChatError(e);
      }

      if (!res.ok) throw new ChatError(mapHttpError(res.status), 'HTTP_' + res.status);

      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      // 代理/网关不支持流式时，降级为非流式
      if (!ctype.includes('text/event-stream')) {
        const data = await res.json().catch(() => null);
        const msg = data?.choices?.[0]?.message || {};
        const content = msg.content || '';
        if (opts.onDelta && content) opts.onDelta(content);
        return { content, finishReason: data?.choices?.[0]?.finish_reason || '' };
      }

      // SSE 流式解析
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let finishReason = '';
      let buffer = '';
      let finished = false;

      const handleLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') { finished = true; return; }
        try {
          const json = JSON.parse(payload);
          const choice = json.choices && json.choices[0];
          if (!choice) return;
          if (choice.finish_reason) finishReason = choice.finish_reason;
          const delta = choice.delta || {};
          if (delta.content) {
            full += delta.content;
            if (opts.onDelta) opts.onDelta(delta.content);
          }
        } catch (e) { /* 忽略异常分片 */ }
      };

      while (!finished) {
        let value;
        try {
          const chunk = await reader.read();
          if (chunk.done) break;
          value = chunk.value;
        } catch (e) {
          throw toChatError(e);
        }
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          handleLine(line);
          if (finished) break;
        }
      }
      if (buffer.trim()) handleLine(buffer);

      return { content: full, finishReason };
    } catch (e) {
      throw toChatError(e);
    } finally {
      clearTimeout(timeoutId);
      if (userSignal) userSignal.removeEventListener('abort', onUserAbort);
    }
  }

  /**
   * 发送对话请求（兼容旧接口），仅返回文本
   * @returns {Promise<string>}
   */
  async function chat(messages, opts = {}) {
    const r = await chatRaw(messages, opts);
    return r.content;
  }

  /**
   * 测试连接：发送一条最小请求
   */
  async function test() {
    const reply = await chat([{ role: 'user', content: '回复"连接成功"四个字即可' }], {});
    return reply;
  }

  return { chat, chatRaw, test };
})();
