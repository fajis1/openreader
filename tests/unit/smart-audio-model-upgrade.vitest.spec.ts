import { describe, expect, it } from 'vitest';

import {
  applyPronunciationModelUpgradeToData,
  buildPronunciationModelUpgradeOffer,
  PRONUNCIATION_MODEL_UPGRADE_FROM,
  PRONUNCIATION_MODEL_UPGRADE_ID,
  PRONUNCIATION_MODEL_UPGRADE_TO,
} from '@/lib/server/smart-audio-profiles';

const profile = (id: string, pronunciationAiModel: string) => ({
  id,
  name: id,
  aiModel: 'gemini-3.1-flash-lite',
  pronunciationAiModel,
  customTtsPrompt: '',
  abbreviations: {},
  pronunciations: {},
  books: {},
});

describe('Gemini pronunciation model upgrade offer', () => {
  it('offers migration for every stored profile still explicitly using 3.6 Flash', () => {
    const offer = buildPronunciationModelUpgradeOffer({
      smartAudioProfiles: {
        selectedProfileId: 'one',
        profiles: [
          profile('one', PRONUNCIATION_MODEL_UPGRADE_FROM),
          profile('two', PRONUNCIATION_MODEL_UPGRADE_TO),
          profile('three', PRONUNCIATION_MODEL_UPGRADE_FROM),
        ],
      },
    });

    expect(offer).toEqual({
      available: true,
      affectedProfileCount: 2,
      fromModel: PRONUNCIATION_MODEL_UPGRADE_FROM,
      toModel: PRONUNCIATION_MODEL_UPGRADE_TO,
    });
  });

  it('does not prompt after the user has chosen to stay on the all-task migration', () => {
    const offer = buildPronunciationModelUpgradeOffer({
      smartAudioProfiles: {
        selectedProfileId: 'one',
        profiles: [profile('one', PRONUNCIATION_MODEL_UPGRADE_FROM)],
      },
      smartAudioModelUpgradeDecisions: {
        [PRONUNCIATION_MODEL_UPGRADE_ID]: 'stay',
      },
    });

    expect(offer.available).toBe(false);
    expect(offer.affectedProfileCount).toBe(1);
  });

  it('offers the corrective migration after the earlier pronunciation-only upgrade', () => {
    const offer = buildPronunciationModelUpgradeOffer({
      smartAudioProfiles: {
        selectedProfileId: 'one',
        profiles: [{
          ...profile('one', PRONUNCIATION_MODEL_UPGRADE_TO),
          aiModel: PRONUNCIATION_MODEL_UPGRADE_FROM,
        }],
      },
      smartAudioModelUpgradeDecisions: {
        'gemini-3.6-flash-to-gemini-3.7-flash': 'upgrade',
      },
    });

    expect(offer.available).toBe(true);
    expect(offer.affectedProfileCount).toBe(1);
  });

  it('does not prompt users who have no 3.6 pronunciation profiles', () => {
    expect(buildPronunciationModelUpgradeOffer({
      smartAudioProfiles: {
        selectedProfileId: 'one',
        profiles: [profile('one', PRONUNCIATION_MODEL_UPGRADE_TO)],
      },
    }).available).toBe(false);
  });

  it('upgrades cleanup and pronunciation fields set to 3.6 and preserves other models', () => {
    const data: Record<string, unknown> = {
      unrelatedPreference: true,
      smartAudioProfiles: {
        selectedProfileId: 'one',
        profiles: [
          { ...profile('one', PRONUNCIATION_MODEL_UPGRADE_FROM), aiModel: PRONUNCIATION_MODEL_UPGRADE_FROM },
          profile('two', 'custom-pronunciation-model'),
        ],
      },
    };

    applyPronunciationModelUpgradeToData(data, 'upgrade');

    const document = data.smartAudioProfiles as {
      profiles: Array<{ aiModel: string; pronunciationAiModel: string }>;
    };
    expect(document.profiles.map((item) => item.pronunciationAiModel)).toEqual([
      PRONUNCIATION_MODEL_UPGRADE_TO,
      'custom-pronunciation-model',
    ]);
    expect(document.profiles.map((item) => item.aiModel)).toEqual([
      PRONUNCIATION_MODEL_UPGRADE_TO,
      'gemini-3.1-flash-lite',
    ]);
    expect(data.unrelatedPreference).toBe(true);
    expect(data.smartAudioModelUpgradeDecisions).toEqual({
      [PRONUNCIATION_MODEL_UPGRADE_ID]: 'upgrade',
    });
  });

  it('records stay without changing a 3.6 profile', () => {
    const data: Record<string, unknown> = {
      smartAudioProfiles: {
        selectedProfileId: 'one',
        profiles: [profile('one', PRONUNCIATION_MODEL_UPGRADE_FROM)],
      },
    };

    applyPronunciationModelUpgradeToData(data, 'stay');

    const document = data.smartAudioProfiles as { profiles: Array<{ pronunciationAiModel: string }> };
    expect(document.profiles[0].pronunciationAiModel).toBe(PRONUNCIATION_MODEL_UPGRADE_FROM);
  });
});
