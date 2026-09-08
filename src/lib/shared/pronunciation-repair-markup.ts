/** Conservative structural recovery; never invent labels or phonemes. */
export function normalizeRepairMarkup(text: string): string {
  return text
    .replace(/\[_?\[([^\[\]\r\n]+)\]\(\/([^/\s()[\]]+)\/\)_?\]\(\/\2\/\)/gu, '[$1](/$2/)')
    .replace(/(\[[^\[\]\r\n]+\]\(\/[^/\s()[\]]+)\)(?![\p{Letter}\p{Mark}])/gu, '$1/)')
    .replace(/(\[[^\[\]\r\n]+\]\(\/[^/\r\n]+\/)\]/gu, '$1)');
}

/** Balanced outer regions keep nested payloads out of the OCR-word scanner. */
export function pronunciationMarkupRegions(text: string): { start: number; end: number; nested: boolean }[] {
  const regions = [];
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '[') continue;
    let depth = 1;
    let end = start + 1;
    let nested = false;
    const limit = Math.min(text.length, start + 12000);
    for (; end < limit && !/[\r\n]/u.test(text[end]); end++) {
      if (text[end] === '[') { depth++; nested = true; }
      if (text[end] === ']' && --depth === 0) break;
    }
    if (depth !== 0 || text.slice(end + 1, end + 3) !== '(/') continue;
    depth = 1;
    for (end += 3; end < limit && !/[\r\n]/u.test(text[end]); end++) {
      if (text[end] === '[') nested = true;
      if (text[end] === '(') depth++;
      if (text[end] === ')' && --depth === 0) break;
    }
    if (depth !== 0) continue;
    regions.push({ start, end: end + 1, nested });
    start = end;
  }
  return regions;
}

/** Context-only grammar notation. Global dictionary rules remain unchanged. */
export function contextualPronunciationWord(label: string): string | undefined {
  if (/^-(?:\([\p{Script=Greek}\p{Mark}]+\))?[\p{Script=Greek}\p{Mark}]{2,}$/u.test(label)) {
    return label.slice(1).replace(/[()]/gu, '');
  }
  const elided = /^([γδ])[’'᾽᾿ʼ]$/u.exec(label);
  return elided ? `${elided[1]}ε` : undefined;
}
