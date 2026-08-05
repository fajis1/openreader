const END_MATTER_HEADING = /^(?:(?:(?:author|name|subject|scripture|biblical|general)\s+)?(?:index|indexes|indices)|(?:select(?:ed)?|primary|secondary|brief)?\s*bibliography|works\s+cited|references?|notes?)$/i;

function normalizeHeading(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s*\((?:continued|cont\.?)\)\s*$/i, '')
    .replace(/^[\s\d.:–—-]+|[\s.:–—-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAudiobookEndMatterHeading(value: string): boolean {
  return END_MATTER_HEADING.test(normalizeHeading(value));
}

export function chapterStartsWithEndMatter(text: string): { found: boolean, truncateAt: number } {
  const lines = text.split(/\r?\n/);
  let passedMeaningfulLines = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    passedMeaningfulLines++;
    
    // If we find an end matter heading, we truncate right before it
    if (isAudiobookEndMatterHeading(line)) {
      // Find the character index of this line to truncate the string
      const matchIndex = text.indexOf(lines[i]);
      return { found: true, truncateAt: matchIndex };
    }
    
    // We only want to search the first few meaningful lines of a chunk
    // just in case a random sentence says "This is not a bibliography".
    // But since chunks can be 10,000 characters, we search the first 10 lines.
    if (passedMeaningfulLines > 10) break;
  }
  return { found: false, truncateAt: -1 };
}

export function extractEpubChapterHeading(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1] ?? html;
  const bodyHeading = body.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/iu)?.[1];
  const metadataTitle = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1];
  return (bodyHeading ?? metadataTitle ?? '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export type AudiobookPdfBlock = {
  text: string;
  kind: string;
  pageNumber: number;
};

function looksLikeTableOfContentsEntry(value: string): boolean {
  const normalized = value.normalize('NFKC').trim();
  if (!normalized) return true;
  return /\.{2,}\s*\d+\s*$/u.test(normalized)
    || /(?:^|\s)\d{1,4}\s*$/u.test(normalized)
    || /^(?:chapter|part|section)\s+(?:\d+|[ivxlcdm]+)\s*$/iu.test(normalized);
}

function looksLikeNarrativeProse(value: string): boolean {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!normalized || looksLikeTableOfContentsEntry(normalized)) return false;
  const words = normalized.match(/\p{L}[\p{L}\p{M}'’“-]*/gu) ?? [];
  return words.length >= 4 && (
    /[.!?…]["'”’)\]]?(?:\s|$)/u.test(normalized)
    || words.length >= 8
  );
}

export function removePdfTableOfContents<T extends AudiobookPdfBlock>(
  blocks: readonly T[],
  totalPages: number,
): { blocks: T[]; skipped: boolean } {
  const contentsHeading = /^(?:table\s+of\s+)?contents$/i;
  const startIndex = blocks.findIndex((block) => (
    block.pageNumber <= Math.max(12, Math.ceil(totalPages * 0.25))
    && contentsHeading.test(normalizeHeading(block.text))
  ));
  if (startIndex < 0) return { blocks: [...blocks], skipped: false };

  const startPage = blocks[startIndex].pageNumber;
  let resumeIndex = -1;
  for (let index = startIndex + 1; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.pageNumber < startPage) continue;
    if (block.kind !== 'doc_title' && block.kind !== 'paragraph_title') continue;
    let hasFollowingProse = false;
    for (let bodyIndex = index + 1; bodyIndex < blocks.length; bodyIndex += 1) {
      const candidate = blocks[bodyIndex];
      if (candidate.pageNumber > block.pageNumber + 1) break;
      if (
        candidate.kind === 'doc_title'
        || candidate.kind === 'paragraph_title'
      ) {
        break;
      }
      if (looksLikeNarrativeProse(candidate.text)) {
        hasFollowingProse = true;
        break;
      }
    }
    if (hasFollowingProse) {
      resumeIndex = index;
      break;
    }
  }

  if (resumeIndex < 0) return { blocks: [...blocks], skipped: false };
  return {
    blocks: [...blocks.slice(0, startIndex), ...blocks.slice(resumeIndex)],
    skipped: true,
  };
}

export function truncateAudiobookEndMatter<T extends { title: string; text: string }>(
  chapters: readonly T[],
  minimumProgress = 0.7,
): T[] {
  const totalLength = chapters.reduce((sum, chapter) => sum + chapter.text.length, 0);
  if (totalLength === 0) return [...chapters];
  let processedLength = 0;
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    const progress = processedLength / totalLength;
    if (progress >= minimumProgress) {
      if (isAudiobookEndMatterHeading(chapter.title)) {
        return chapters.slice(0, index);
      }
      
      const textCheck = chapterStartsWithEndMatter(chapter.text);
      if (textCheck.found) {
        // We found an end matter heading inside the text!
        // We want to keep this chapter, but truncate its text right before the heading.
        const truncatedChapters = chapters.slice(0, index);
        if (textCheck.truncateAt > 0) {
          truncatedChapters.push({
            ...chapter,
            text: chapter.text.substring(0, textCheck.truncateAt).trim()
          });
        }
        return truncatedChapters;
      }

      // If we are very deep into the book (>85%), check if this chapter is just a wall of citations/indexes
      // by measuring the density of narrative prose.
      if (progress >= 0.85) {
        const lines = chapter.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length > 5) {
          let proseLines = 0;
          for (const line of lines) {
            if (looksLikeNarrativeProse(line)) {
              proseLines++;
            }
          }
          // If less than 25% of the lines in this chapter look like normal prose, it's definitely an index/bibliography.
          if (proseLines / lines.length < 0.25) {
            return chapters.slice(0, index);
          }
        }
      }
    }
    processedLength += chapter.text.length;
  }
  return [...chapters];
}
