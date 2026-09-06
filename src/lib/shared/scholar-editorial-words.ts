// Internal editorial letters are included for narration, without joining phrases.
export function expandScholarEditorialWords(text: string): string {
  for (const script of ['Greek', 'Hebrew']) {
    const letters = `[\\p{Script=${script}}\\p{Mark}]`;
    const pattern = new RegExp(`(?<![\\p{Letter}\\p{Mark}])${letters}+(?:\\(${letters}+\\)${letters}*)+(?![\\p{Letter}\\p{Mark}])`, 'gu');
    text = text.replace(pattern, word => word.replace(/[()]/gu, ''));
  }
  return text;
}

export function hasSplitScholarEditorialWord(text: string): boolean {
  const tag = String.raw`\[([^\]\r\n]+)\]\(\/[^/\r\n]+\/\)`;
  const boundaries: number[] = [];
  let visible = '';
  let cursor = 0;
  for (const match of text.matchAll(new RegExp(tag, 'gu'))) {
    visible += text.slice(cursor, match.index);
    boundaries.push(visible.length);
    visible += match[1];
    boundaries.push(visible.length);
    cursor = match.index + match[0].length;
  }
  visible += text.slice(cursor);
  for (const script of ['Greek', 'Hebrew']) {
    const letters = `[\\p{Script=${script}}\\p{Mark}]`;
    const pattern = new RegExp(`(?<![\\p{Letter}\\p{Mark}])${letters}+(?:\\(${letters}+\\)${letters}*)+(?![\\p{Letter}\\p{Mark}])`, 'gu');
    for (const match of visible.matchAll(pattern)) {
      if (boundaries.some(position => position > match.index && position < match.index + match[0].length)) return true;
    }
  }
  return false;
}

export const SCHOLAR_EDITORIAL_WORD_INSTRUCTIONS = `For Greek/Hebrew words with internal editorial parentheses, include the parenthesized letters for narration: θε(οῦ) is one complete word, θεοῦ. This is a narration convention, not a judgment about manuscript priority. Look up and pronounce the expanded complete word. Preserve the printed notation inside a single pronunciation tag when possible. Never output [θε](/θɛ/)(οῦ) or tag its ending separately. Repair existing partial tags by replacing their IPA with the complete word's pronunciation. Do not join whitespace-separated words, whole parenthetical phrases, mixed scripts, or alternatives containing a slash. Leave ambiguous readings for human review; do not invent a reading.`;
