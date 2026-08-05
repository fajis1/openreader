import { db } from './src/db/index.js';
import { userPreferences } from './src/db/schema.js';
import { readSmartAudioProfilesDocument, writeSmartAudioProfilesDocument } from './src/lib/server/smart-audio-profiles.js';

async function main() {
  const users = await db.select().from(userPreferences);
  console.log(`Found ${users.length} users`);
  for (const user of users) {
    try {
      const storageUserId = user.userId;
      const document = await readSmartAudioProfilesDocument(storageUserId);
      if (document && document.profiles) {
        let changed = false;
        for (const profile of document.profiles) {
           if (profile.id === "default" || profile.id === "profile-biblical-scholar-defs") {
              const before1 = "10. THE GARBAGE & TABLE FILTER: If an entire chunk consists of academic citations, Tables of Contents, disconnected word soup, broken formatting from a PDF table, academic indexes, bibliographies, lists of abbreviations, or repetitive strings of page numbers, DO NOT attempt to fix or phoneticize it. You must return an EMPTY STRING (literally nothing).";
              const after1 = "10. THE GARBAGE & TABLE FILTER: If a chunk is an academic index, bibliography, list of abbreviations (even if it contains introductory prose), Table of Contents, disconnected word soup, broken formatting from a PDF table, or repetitive strings of page numbers, DO NOT attempt to fix or phoneticize it. You must return an EMPTY STRING (literally nothing).";
              
              const before2 = "10. THE GARBAGE & TABLE FILTER: If an entire chunk consists of academic citations, Tables of Contents, disconnected word soup, broken formatting from a PDF table (e.g., \"Parity, suzerainty, patron\"), academic indexes, bibliographies, lists of abbreviations, or repetitive strings of page numbers, DO NOT attempt to fix or phoneticize it. Audiobooks cannot read tables or disconnected data. You must return an EMPTY STRING (literally nothing).";
              const after2 = "10. THE GARBAGE & TABLE FILTER: If a chunk is an academic index, bibliography, list of abbreviations (even if it contains introductory prose), Table of Contents, disconnected word soup, broken formatting from a PDF table (e.g., \"Parity, suzerainty, patron\"), or repetitive strings of page numbers, DO NOT attempt to fix or phoneticize it. Audiobooks cannot read tables or disconnected data. You must return an EMPTY STRING (literally nothing).";
              
              if (profile.customTtsPrompt.includes(before1)) {
                 profile.customTtsPrompt = profile.customTtsPrompt.replace(before1, after1);
                 changed = true;
              }
              if (profile.customTtsPrompt.includes(before2)) {
                 profile.customTtsPrompt = profile.customTtsPrompt.replace(before2, after2);
                 changed = true;
              }
           }
        }
        if (changed) {
           console.log(`Updating profiles for user: ${storageUserId}`);
           await writeSmartAudioProfilesDocument(storageUserId, document);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
  process.exit(0);
}
main();
