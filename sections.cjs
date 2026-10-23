'use strict';
// Parse only balanced top-level Lake blocks; unsupported structure fails closed.
function blocks(lake) {
  const tokens = /<!--[\s\S]*?-->|<!doctype\s+lake\s*>|<\/?[a-zA-Z][\w:-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>/gi;
  const stack = [], result = [];
  let end = 0, start, tag;
  for (const token of lake.matchAll(tokens)) {
    const gap = lake.slice(end, token.index);
    if (gap.includes('<') || (!stack.length && gap.trim())) throw new Error('无法安全解析 Lake 章节结构');
    const value = token[0]; end = token.index + value.length;
    if (/^<!/i.test(value)) continue;
    const name = /^<\/?([\w:-]+)/.exec(value)[1].toLowerCase();
    if (value.startsWith('</')) {
      if (stack.pop() !== name) throw new Error('Lake 标签不平衡，停止章节替换');
      if (!stack.length) result.push({tag, start, end});
    } else {
      if (!stack.length) {start = token.index; tag = name;}
      if (/\/>$/.test(value) || /^(meta|br|hr|img|input|link|wbr)$/.test(name)) {
        if (!stack.length) result.push({tag, start, end});
      } else stack.push(name);
    }
  }
  if (stack.length || lake.slice(end).trim()) throw new Error('Lake 结构不完整，停止章节替换');
  return result;
}
function headingText(html) {
  return html.replace(/<!--[\s\S]*?-->|<\/?[a-zA-Z][\w:-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    const names = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
    if (entity[0] !== '#') return names[entity.toLowerCase()];
    const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
    if (!Number.isInteger(number) || number < 0 || number > 0x10ffff) throw new Error('标题字符编码无效');
    return String.fromCodePoint(number);
  }).trim();
}
function locateSection(lake, heading, occurrence) {
  if (typeof heading !== 'string' || !heading.trim()) throw new Error('章节重写需要 section_heading（原章节标题）');
  const headings = blocks(lake).filter(b => /^h[1-6]$/.test(b.tag)).map(b => ({...b, level:Number(b.tag[1]), heading:headingText(lake.slice(b.start,b.end))}));
  const candidates = headings.filter(b => b.heading === heading.trim());
  if (!candidates.length) throw new Error('未找到章节标题；仅支持正文顶层的 h1 至 h6 标题');
  if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > candidates.length)) throw new Error('section_occurrence 超出同名标题范围');
  if (candidates.length > 1 && occurrence === undefined) throw new Error('存在同名章节，请用 section_occurrence 指定第几个（从1开始）');
  const target = candidates[(occurrence || 1)-1];
  const following = headings.find(b => b.start > target.start && b.level <= target.level);
  return {heading:target.heading,level:target.level,occurrence:occurrence || 1,start:target.end,end:following ? following.start : lake.length};
}
function contentFragment(converted) {
  if (!/^<!doctype lake>/i.test(converted)) throw new Error('Markdown 转换未返回有效Lake');
  const fragment = blocks(converted).filter(b => b.tag !== 'meta').map(b => converted.slice(b.start,b.end)).join('');
  if (!fragment.trim()) throw new Error('转换后正文为空，停止章节替换');
  return fragment;
}
module.exports = {locateSection,contentFragment};
