import type { SmartAudioProfile } from '@/types/client';
import { repairPronunciationText } from './pronunciation-repair-engine';
import { batchRefineTextHash } from './batch-refine-assessment';
import { PRONUNCIATION_REPAIR_PROMPT_VERSION, type RepairDiagnostics } from './pronunciation-repair-diagnostics';
import { scanPronunciationIssues, assertPronunciationRepair } from '@/lib/shared/pronunciation-issues';
import { SmartAudioOutputValidationError } from '@/lib/shared/smart-audio-cleanup';
import { resolvePronunciationAiModel } from '@/lib/shared/smart-audio-models';
import { serverLogger } from '@/lib/server/logger';

export class SmartAudioTargetedRepairError extends SmartAudioOutputValidationError {
  constructor(readonly apiBlocked: boolean) {
    super(apiBlocked
      ? 'Gemini could not finish pronunciation repairs after retries. The chapter was retained for retry; no recording was generated.'
      : 'Targeted pronunciation repair could not safely resolve all findings. Review the retained chapter before recording.');
    this.name = 'SmartAudioTargetedRepairError';
  }
}

/** In-memory repair only. Callers must still validate the complete worker
 * response (including source coverage and speaker identities) before recording. */
export async function repairSmartAudioWorkerPronunciations(value: unknown, input: {
  profile: SmartAudioProfile; sourceText: string; dictionary: Record<string, string>; signal: AbortSignal;
}) {
  input.signal.throwIfAborted();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = value as Record<string, unknown>;
  if (result.status !== 'success') return value;
  let changed = false;
  const repair = async (text: unknown) => {
    if (typeof text !== 'string' || !scanPronunciationIssues(text, input.dictionary).length) return text;
    const diagnostics: RepairDiagnostics = { version: 1, promptVersion: PRONUNCIATION_REPAIR_PROMPT_VERSION,
      stage: 'scan', sourceHash: batchRefineTextHash(text), aiRequested: false };
    try {
      const repaired = await repairPronunciationText({ text, original: input.sourceText, profile: input.profile,
        dictionary: input.dictionary, signal: input.signal,
        resolveAi: async () => ({ primaryApiKey: input.profile.geminiApiKey || '', backupApiKey: input.profile.backupGeminiApiKey || '',
          selection: { aiModel: resolvePronunciationAiModel(input.profile),
            fallbackModels: input.profile.aiModelFallbacks?.filter(model => model !== resolvePronunciationAiModel(input.profile)).slice(0, 2) } }),
      }, diagnostics);
      // Automatic recovery cannot accept partial proposals or source-word
      // reconstruction: those remain available through the human review tool.
      assertPronunciationRepair(text, repaired.proposedText);
      changed ||= repaired.proposedText !== text;
      return repaired.proposedText;
    } catch {
      input.signal.throwIfAborted();
      throw new SmartAudioTargetedRepairError(diagnostics.apiBlocked === true);
    } finally {
      serverLogger.info({ event: 'smart_audio.targeted_pronunciation_repair', findingCount: diagnostics.findingCount,
        remainingCount: diagnostics.remainingFindings?.length, aiRequested: diagnostics.aiRequested,
        usedModel: diagnostics.usedModel, apiBlocked: diagnostics.apiBlocked === true }, 'Smart AI targeted pronunciation validation completed');
    }
  };
  if (Array.isArray(result.segments)) {
    const segments = [];
    for (const segment of result.segments) {
      if (!segment || typeof segment !== 'object' || Array.isArray(segment)) { segments.push(segment); continue; }
      segments.push({ ...segment, text: await repair(segment.text) });
    }
    return changed ? { ...result, segments } : value;
  }
  const cleaned_text = await repair(result.cleaned_text);
  return changed ? { ...result, cleaned_text } : value;
}
