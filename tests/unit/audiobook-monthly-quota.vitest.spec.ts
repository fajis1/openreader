import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';
import { calculateMonthlyAudiobookAllowance } from '../../src/lib/server/access/audiobook-quota';

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('monthly audiobook allowance', () => {
  test('shows the unused free allowance before support credits', () => {
    expect(calculateMonthlyAudiobookAllowance({
      used: 1,
      freeLimit: 2,
      paidCreditsAvailable: 5,
    })).toMatchObject({
      allowed: true,
      freeUsed: 1,
      freeRemaining: 1,
      supportCreditsRemaining: 5,
      totalRemaining: 6,
      shouldConsumeCredit: false,
    });
  });

  test('makes every granted support credit usable after the free allowance', () => {
    let used = 2;
    let credits = 5;

    for (let index = 0; index < 5; index += 1) {
      const allowance = calculateMonthlyAudiobookAllowance({
        used,
        freeLimit: 2,
        paidCreditsAvailable: credits,
      });
      expect(allowance.allowed).toBe(true);
      expect(allowance.shouldConsumeCredit).toBe(true);
      used += 1;
      credits -= 1;
    }

    expect(calculateMonthlyAudiobookAllowance({
      used,
      freeLimit: 2,
      paidCreditsAvailable: credits,
    })).toMatchObject({
      allowed: false,
      freeRemaining: 0,
      supportCreditsRemaining: 0,
      totalRemaining: 0,
    });
  });

  test('records full generations in a ledger that audiobook reset does not delete', () => {
    const quotaSource = source('src/lib/server/access/audiobook-quota.ts');
    const resetSource = source('src/app/api/audiobook/route.ts');
    const pruneSource = source('src/lib/server/tasks/handlers/prune-job-events.ts');

    expect(quotaSource).toContain("MONTHLY_AUDIOBOOK_USAGE_ACTION = 'audiobook_full_generation'");
    expect(quotaSource).toContain('.insert(userJobEvents)');
    expect(resetSource).not.toContain('delete(userJobEvents)');
    expect(pruneSource).toContain('62 * 24 * 60 * 60 * 1000');
  });

  test('includes repairs with the original generation but charges after a reset', () => {
    const queueSource = source('src/app/api/audiobooks/queue/route.ts');

    expect(queueSource).toContain('const shouldChargeMonthlyQuota = existingChapter.length === 0 && !hasPriorFullGenerationJob');
    expect(queueSource).toContain('monthlyQuotaCharge: shouldChargeMonthlyQuota');
    expect(queueSource).toContain('recordMonthlyAudiobookUsage({ userId, jobId })');
  });

  test('wires the allowance endpoint into the left library sidebar', () => {
    const cardSource = source('src/components/doclist/window/AudiobookQuotaCard.tsx');
    const listSource = source('src/components/doclist/DocumentList.tsx');

    expect(cardSource).toContain("'/api/audiobooks/quota'");
    expect(cardSource).toContain('free {pluralBooks(data.freeRemaining)} left');
    expect(cardSource).toContain('support {data.supportCreditsRemaining === 1');
    expect(cardSource).toContain('Resets {resetLabel} UTC');
    expect(listSource).toContain('<AudiobookQuotaCard />');
  });
});
