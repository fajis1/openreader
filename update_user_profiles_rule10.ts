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
              if (!profile.customTtsPrompt.includes("lists of abbreviations")) {
                 profile.customTtsPrompt = profile.customTtsPrompt.replace(
                   "academic indexes, bibliographies, or repetitive",
                   "academic indexes, bibliographies, lists of abbreviations, or repetitive"
                 );
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
