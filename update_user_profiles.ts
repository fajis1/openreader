import { db } from './src/db/index.js';
import { userPreferences } from './src/db/schema.js';
import { readSmartAudioProfilesDocument, writeSmartAudioProfilesDocument } from './src/lib/server/smart-audio-profiles.js';

const example6 = `\n\n--- EXAMPLE 6 (Embedded Latin Removal) ---\nRAW TEXT:\nafter the third sale, the father broke his potestas over his son, because, according to the Twelve Tables, si pater ter filium venum duit, filius a patre liber esto, and the son therefore stood in mancipii causa to his adopter.\n\nOPTIMIZED TEXT:\nafter the third sale, the father broke his potestas over his son, because, according to the Twelve Tables... and the son therefore stood in mancipii causa to his adopter.\n(Why: The long embedded Latin quote is cleanly excised with an ellipsis, while the short 2-word Latin phrases like "potestas" and "mancipii causa" are retained because they are under 5 words).`;

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
           if (profile.id === "default") {
              if (!profile.customTtsPrompt.includes("EXAMPLE 6")) {
                 profile.customTtsPrompt = profile.customTtsPrompt.replace("Keep the digits).\n\n13. LAYOUT ENGINE", "Keep the digits)." + example6 + "\n\n13. LAYOUT ENGINE");
                 changed = true;
              }
           } else if (profile.id === "profile-biblical-scholar-defs") {
              if (!profile.customTtsPrompt.includes("EXAMPLE 6")) {
                 profile.customTtsPrompt = profile.customTtsPrompt.replace("Keep the digits).", "Keep the digits)." + example6);
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
