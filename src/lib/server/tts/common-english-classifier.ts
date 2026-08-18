import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type CommonEnglishMatch = {
  word: string;
  zipfFrequency: number;
};

export async function classifyCommonEnglishWords(words: readonly string[]): Promise<CommonEnglishMatch[]> {
  const uniqueWords = [...new Set(words.filter((word) => typeof word === 'string' && word.trim()))];
  if (uniqueWords.length === 0) return [];
  const inputPath = path.join(os.tmpdir(), `openreader-english-cleanup-${randomUUID()}.json`);
  await fs.writeFile(inputPath, JSON.stringify(uniqueWords), { encoding: 'utf8', mode: 0o600 });
  try {
    const pythonBin = path.join(process.cwd(), '.venv', 'bin', 'python3');
    const { stdout } = await execFileAsync(pythonBin, [
      'scan_pdf_foreign_words.py',
      '--classify-english-json', inputPath,
    ], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) throw new Error('English classifier returned an invalid result.');
    return parsed.filter((item): item is CommonEnglishMatch => (
      Boolean(item)
      && typeof item === 'object'
      && typeof (item as CommonEnglishMatch).word === 'string'
      && typeof (item as CommonEnglishMatch).zipfFrequency === 'number'
    ));
  } finally {
    await fs.unlink(inputPath).catch(() => {});
  }
}
