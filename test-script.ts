import { mergeStoredSmartAudioProfileSecrets } from './src/lib/server/smart-audio-profiles';

const storedProfiles = [
  {
    id: 'p1',
    name: 'Profile 1',
    geminiApiKey: 'my-secret-key-1',
  },
  {
    id: 'p2',
    name: 'Profile 2',
    geminiApiKey: 'my-secret-key-2',
  }
];

const incomingProfiles = [
  {
    id: 'p1',
    name: 'Profile 1 Edited',
    geminiApiKey: undefined,
  },
  {
    id: 'p2',
    name: 'Profile 2',
    // also testing omitted
  }
];

const merged = mergeStoredSmartAudioProfileSecrets(incomingProfiles as any, storedProfiles as any);
console.log(JSON.stringify(merged, null, 2));
