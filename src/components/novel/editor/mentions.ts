/**
 * 正文里的素材提及切分。
 *
 * 单独抽出来是因为**连续章节流**要复用同一套逻辑：环绕着当前章渲染的
 * 邻章是只读正文，但高亮、悬停卡与可编辑章必须完全一致，否则同一句
 * 人名在两处的样式会慢慢长歪。
 */

/** 切分结果：entryId 非空表示这一段是某条素材的提及。 */
export interface TextPart {
  text: string;
  entryId: string | null;
}

/**
 * 把正文按素材提及切成片段。
 *
 * 必须按**最长优先**匹配：`张三丰` 里同时含 `张三` 与 `丰`（后者是别的条目名）
 * 时，若先匹配短名就会把长名切成碎片。同时用 `Set` 一次判定所有边界，
 * 避免对每个候选名都扫一遍整段——长章里这个开销是平方级的。
 */
export function splitByMentions(
  text: string,
  names: Map<string, string>
): TextPart[] {
  if (!names.size || !text) return [{ text, entryId: null }];

  /* 长度降序，保证长名先占住区间。 */
  const candidates = [...names.keys()].sort((a, b) => b.length - a.length);
  const hits: { start: number; end: number; id: string }[] = [];

  for (const name of candidates) {
    if (!name) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(name, from);
      if (at < 0) break;
      const end = at + name.length;
      /* 已被更长的匹配覆盖则跳过，不重复高亮。 */
      if (!hits.some((h) => at < h.end && end > h.start)) {
        hits.push({ start: at, end, id: names.get(name)! });
      }
      from = end;
    }
  }
  if (!hits.length) return [{ text, entryId: null }];

  hits.sort((a, b) => a.start - b.start);
  const out: TextPart[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) out.push({ text: text.slice(cursor, h.start), entryId: null });
    out.push({ text: text.slice(h.start, h.end), entryId: h.id });
    cursor = h.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), entryId: null });
  return out;
}
