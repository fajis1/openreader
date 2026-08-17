const GREEK_LETTERS: Record<string, string> = {
  α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'e', θ: 'th',
  ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p',
  ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'ph', χ: 'ch', ψ: 'ps', ω: 'o',
};

function latinLetters(value: string): string {
  return value.normalize('NFKD').replace(/\p{Mark}/gu, '').toLowerCase().replace(/[^a-z]/g, '');
}

function greekTransliteration(value: string): string {
  return [...value.normalize('NFD').toLowerCase()]
    .map((character) => GREEK_LETTERS[character] ?? '')
    .join('');
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < right.length; j += 1) {
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + (left[i] === right[j] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function matchesTransliteratedTerm(term: string, query: string): boolean {
  const normalizedQuery = latinLetters(query);
  if (!normalizedQuery) return term.toLowerCase().includes(query.trim().toLowerCase());
  const transliteration = /\p{Script=Greek}/u.test(term)
    ? greekTransliteration(term)
    : latinLetters(term);
  if (transliteration.includes(normalizedQuery) || normalizedQuery.includes(transliteration)) return true;
  if (Math.min(transliteration.length, normalizedQuery.length) < 4) return false;
  return editDistance(transliteration, normalizedQuery) <= 2;
}
