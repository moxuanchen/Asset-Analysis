/* ===== 经验总结模块：调用模型为一篇资料生成浓缩经验 ===== */
'use strict';

const Experience = (() => {
  const MAX_INPUT = 6000; // 送入模型的资料内容上限（字符）

  /**
   * 为一篇资料生成极其浓缩的经验总结（每篇单独调用）
   * 生成时先取系统时间，并判定经验是否具有时效性：
   *   - 时效性经验：标注所指参考时段，并强调时效性不足、引用前需核实；
   *   - 通用/非时效性经验：正常总结，不加时效提示。
   * @param {Object} item 资料条目 {title, markdown}
   * @returns {Promise<string>} 经验内容（Markdown）
   */
  async function summarize(item) {
    // 检索总结时的系统时间，供模型判定时效性与标注"距今"程度
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const nowISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const nowCN = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

    const sys = '你是资深金融分析师。请阅读资料内容，输出【极其浓缩的经验总结】，要求：\n' +
      '1) 提炼 3-6 条可复用的要点，每条一句话（不超过 40 字），直接以 Markdown 无序列表列出；\n' +
      '2) 先判断内容属性：\n' +
      '   - 若要点依赖特定时点/时段的数据、价格、利率、政策、行情或事件（即"时效性经验"），你必须：\n' +
      '     a. 从资料中提炼该经验所指的参考时段（如 2024年、2025Q1、2024-06 等；若资料无明确时间则写"资料未注明时间"）；\n' +
      '     b. 在要点列表【最前面】加一行固定格式的 Markdown 引用块：\n' +
      '        > ⏱️ 时效性提示（参考时段：<参考时段>）：本经验反映该时段情况，当前系统时间为 ' + nowCN + '，距今可能已有时日，时效性不足，引用前请核实最新数据。\n' +
      '   - 若为通用方法、原理、常识等"不具有时效性的经验"，则直接输出要点列表，不要加上述提示行。\n' +
      '3) 要点应突出关键结论、重要数据、可复用判断逻辑或风险提示；不要客套话，不要重复资料标题，不要多余解释。';

    const user = `【当前系统时间】${nowISO}（${nowCN}）\n\n【资料】《${item.title}》\n\n${(item.markdown || '').slice(0, MAX_INPUT)}`;
    const reply = await Chat.chat(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      {}
    );
    const text = (reply || '').trim();
    if (!text) throw new Error('模型未返回有效内容');
    return text;
  }

  return { summarize };
})();
