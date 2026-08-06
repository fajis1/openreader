import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { splitAudiobookTextForTts } from '@/lib/shared/audiobook-batching';
import { getFFmpegPath } from '@/lib/server/audiobooks/ffmpeg-bin';
import {
  generateTTSBuffer,
  type ServerTTSRequest,
  type TtsUpstreamRuntimeSettings,
} from '@/lib/server/tts/generate';

async function concatenateMp3Segments(
  segments: readonly Buffer[],
  signal?: AbortSignal,
): Promise<Buffer> {
  if (segments.length === 1) return segments[0];

  const workDir = await mkdtemp(join(tmpdir(), 'openreader-tts-segments-'));
  try {
    const segmentPaths: string[] = [];
    for (let index = 0; index < segments.length; index += 1) {
      const segmentPath = join(workDir, `${String(index).padStart(4, '0')}.mp3`);
      await writeFile(segmentPath, segments[index]);
      segmentPaths.push(segmentPath);
    }
    const concatListPath = join(workDir, 'segments.txt');
    const outputPath = join(workDir, 'combined.mp3');
    await writeFile(
      concatListPath,
      segmentPaths.map((segmentPath) => `file '${segmentPath}'`).join('\n'),
      'utf8',
    );

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(getFFmpegPath(), [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatListPath,
        '-c:a',
        'libmp3lame',
        '-b:a',
        '64k',
        outputPath,
      ]);
      let stderr = '';
      let finished = false;
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const onAbort = () => {
        if (finished) return;
        finished = true;
        ffmpeg.kill('SIGKILL');
        cleanup();
        reject(new Error('ABORTED'));
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      ffmpeg.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      ffmpeg.on('error', (error) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(error);
      });
      ffmpeg.on('close', (code) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg failed to concatenate TTS segments (code ${code}): ${stderr.slice(-500)}`));
        }
      });
    });

    return await readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function generateSegmentedAudiobookTtsBuffer(
  request: ServerTTSRequest,
  signal?: AbortSignal,
  runtimeSettings?: TtsUpstreamRuntimeSettings,
): Promise<Buffer> {
  const audioSegments: Buffer[] = [];
  
  // Regex to match <voice name="...">...</voice>
  const voiceTagRegex = /<voice\s+name="([^"]+)">([\s\S]*?)<\/voice>/gi;
  
  // If the text contains voice tags, we parse them. Otherwise, we treat the whole text as one segment.
  const parsedChunks: { text: string; voice: string }[] = [];
  let lastIndex = 0;
  
  let match;
  while ((match = voiceTagRegex.exec(request.text)) !== null) {
    // Add any untagged text before this match using the default voice
    const beforeText = request.text.substring(lastIndex, match.index).trim();
    if (beforeText) {
      parsedChunks.push({ text: beforeText, voice: request.voice });
    }
    
    // Add the tagged text
    const assignedVoice = match[1].trim() || request.voice;
    const innerText = match[2].trim();
    if (innerText) {
      parsedChunks.push({ text: innerText, voice: assignedVoice });
    }
    
    lastIndex = voiceTagRegex.lastIndex;
  }
  
  // Add any remaining untagged text
  const afterText = request.text.substring(lastIndex).trim();
  if (afterText) {
    parsedChunks.push({ text: afterText, voice: request.voice });
  }

  // If no tags were found at all, just push the original text
  if (parsedChunks.length === 0) {
    parsedChunks.push({ text: request.text, voice: request.voice });
  }

  // Now, for each chunk, we still need to run it through splitAudiobookTextForTts
  // to ensure no chunk exceeds the TTS engine's character limits (e.g. 4000 chars)
  for (const chunk of parsedChunks) {
    const subSegments = splitAudiobookTextForTts(chunk.text, request.language);
    for (const text of subSegments) {
      audioSegments.push(await generateTTSBuffer(
        { ...request, text, voice: chunk.voice, format: 'mp3' },
        signal,
        runtimeSettings,
      ));
    }
  }

  if (audioSegments.length === 0) {
    throw new Error('No speakable text remained after TTS segmentation.');
  }

  return concatenateMp3Segments(audioSegments, signal);
}
