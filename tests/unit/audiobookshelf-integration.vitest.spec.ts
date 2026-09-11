import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import {
  sanitizeFilenameForAudiobookshelf,
  resolveAudiobookshelfConfig,
  fetchAudiobookshelfLibraries,
  triggerAudiobookshelfScan,
} from '@/lib/server/audiobooks/audiobookshelf';
import { RUNTIME_CONFIG_SCHEMA } from '@/lib/server/admin/settings';

describe('Audiobookshelf Integration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('sanitizeFilenameForAudiobookshelf', () => {
    test('removes illegal filesystem characters', () => {
      const input = 'The Lord of the Rings: The Fellowship / Two Towers * "Special" <Edition>?';
      const output = sanitizeFilenameForAudiobookshelf(input);
      expect(output).toBe('The Lord of the Rings_ The Fellowship _ Two Towers _ _Special_ _Edition__');
      expect(/[\\/:*?"<>|]/.test(output)).toBe(false);
    });

    test('normalizes whitespace and removes trailing/leading periods', () => {
      const input = ' ...The   Way  of   Kings... ';
      const output = sanitizeFilenameForAudiobookshelf(input);
      expect(output).toBe('The Way of Kings');
    });

    test('falls back to "Untitled" when given empty or purely invalid string', () => {
      expect(sanitizeFilenameForAudiobookshelf('')).toBe('Untitled');
      expect(sanitizeFilenameForAudiobookshelf('...')).toBe('Untitled');
      expect(sanitizeFilenameForAudiobookshelf('   ')).toBe('Untitled');
    });
  });

  describe('resolveAudiobookshelfConfig', () => {
    test('resolves config from environment variables when present', async () => {
      process.env.AUDIOBOOKSHELF_URL = 'http://192.168.90.244:13378/';
      process.env.AUDIOBOOKSHELF_TOKEN = 'abs-secret-token-123';
      process.env.AUDIOBOOKSHELF_LIBRARY_ID = 'lib-456';
      process.env.AUDIOBOOKSHELF_FOLDER_ID = 'fold-789';

      const config = await resolveAudiobookshelfConfig();
      expect(config.url).toBe('http://192.168.90.244:13378');
      expect(config.token).toBe('abs-secret-token-123');
      expect(config.libraryId).toBe('lib-456');
      expect(config.folderId).toBe('fold-789');
      expect(config.isConfigured).toBe(true);
      expect(config.autoDetectMetadata).toBe(true);
    });

    test('detects not configured when token is missing', async () => {
      delete process.env.AUDIOBOOKSHELF_TOKEN;
      const config = await resolveAudiobookshelfConfig();
      expect(config.isConfigured).toBe(false);
    });
  });

  describe('fetchAudiobookshelfLibraries', () => {
    test('fetches and normalizes libraries list from Audiobookshelf API', async () => {
      const mockLibraries = [
        {
          id: 'lib-audiobooks',
          name: 'Audiobooks Only',
          mediaType: 'book',
          folders: [
            { id: 'folder-1', fullPath: '/mnt/truenas/Audiobooks Only' },
          ],
        },
      ];

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ libraries: mockLibraries }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await fetchAudiobookshelfLibraries('http://192.168.90.244:13378', 'test-token');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('lib-audiobooks');
      expect(result[0].name).toBe('Audiobooks Only');
      expect(result[0].folders[0].id).toBe('folder-1');
      expect(result[0].folders[0].fullPath).toBe('/mnt/truenas/Audiobooks Only');
    });

    test('throws error if Audiobookshelf responds with error status', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Unauthorized token', { status: 401 }),
      );

      await expect(
        fetchAudiobookshelfLibraries('http://192.168.90.244:13378', 'bad-token'),
      ).rejects.toThrow(/401/);
    });
  });

  describe('triggerAudiobookshelfScan', () => {
    test('posts to /api/libraries/:id/scan', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

      const success = await triggerAudiobookshelfScan('http://192.168.90.244:13378', 'token-123', 'lib-abc');
      expect(success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://192.168.90.244:13378/api/libraries/lib-abc/scan',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer token-123' },
        }),
      );
    });
  });

  describe('Runtime config schema', () => {
    test('contains all Audiobookshelf and Gemini universal keys with appropriate defaults', () => {
      expect(RUNTIME_CONFIG_SCHEMA).toHaveProperty('audiobookshelfUrl');
      expect(RUNTIME_CONFIG_SCHEMA).toHaveProperty('audiobookshelfToken');
      expect(RUNTIME_CONFIG_SCHEMA).toHaveProperty('audiobookshelfLibraryId');
      expect(RUNTIME_CONFIG_SCHEMA).toHaveProperty('audiobookshelfFolderId');
      expect(RUNTIME_CONFIG_SCHEMA).toHaveProperty('audiobookshelfAutoDetectMetadata');
      expect(RUNTIME_CONFIG_SCHEMA).toHaveProperty('geminiApiKey');

      expect(RUNTIME_CONFIG_SCHEMA.audiobookshelfUrl.default).toBe('http://192.168.90.244:13378');
      expect(RUNTIME_CONFIG_SCHEMA.audiobookshelfAutoDetectMetadata.default).toBe(true);
    });
  });

  describe('Metadata inference parsing', () => {
    test('extracts title, author, and series from formatted or markdown wrapped JSON', () => {
      const rawGeminiResponse = '```json\n{\n  "title": "The Way of Kings",\n  "author": "Brandon Sanderson",\n  "series": "The Stormlight Archive",\n  "seriesIndex": "1",\n  "subtitle": null\n}\n```';
      const cleaned = rawGeminiResponse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned);

      expect(parsed.title).toBe('The Way of Kings');
      expect(parsed.author).toBe('Brandon Sanderson');
      expect(parsed.series).toBe('The Stormlight Archive');
      expect(parsed.seriesIndex).toBe('1');
    });

    test('companion document retains matching basename with audio file', () => {
      const cleanTitle = sanitizeFilenameForAudiobookshelf('The Way of Kings: Special Edition');
      const audioFileName = `${cleanTitle}.m4b`;
      const companionFileName = `${cleanTitle}.pdf`;

      expect(audioFileName).toBe('The Way of Kings_ Special Edition.m4b');
      expect(companionFileName).toBe('The Way of Kings_ Special Edition.pdf');
      expect(audioFileName.replace(/\.m4b$/, '')).toBe(companionFileName.replace(/\.pdf$/, ''));
    });
  });
});
