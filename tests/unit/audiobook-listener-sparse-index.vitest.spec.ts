import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const listener = fs.readFileSync(
  path.join(process.cwd(), 'src/app/(app)/listen/[bookId]/page.tsx'),
  'utf8',
);

describe('audiobook listener sparse chapter indexes', () => {
  test('uses array position only for navigation and the persisted index for chapter operations', () => {
    expect(listener).toContain('const selectedChapterIndex = currentChapter?.index;');
    expect(listener).toContain('fetchChapterText(selectedChapterIndex)');
    expect(listener).toContain('chapterIndex: currentChapter.index');
    expect(listener).toContain('chapterIndex=${currentChapter.index}');
    expect(listener).toContain('currentChapterPosition');
    expect(listener).not.toContain('currentChapterIndex');
  });
});
