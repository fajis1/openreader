import { db } from './src/db';
import { userPreferences } from './src/db/schema';
import defaultData from './src/lib/server/default_smart_audio_profiles.json';
import { eq } from 'drizzle-orm';

async function main() {
  const users = await db.select().from(userPreferences);
  for (const user of users) {
    let data = user.dataJson ? (typeof user.dataJson === 'string' ? JSON.parse(user.dataJson) : user.dataJson) : {};
    if (data.smartAudioProfiles && data.smartAudioProfiles.profiles) {
      const hasCatcher = data.smartAudioProfiles.profiles.some((p: any) => p.id === 'profile-bibliography-catcher');
      if (!hasCatcher) {
        const catcher = defaultData.profiles.find((p: any) => p.id === 'profile-bibliography-catcher');
        if (catcher) {
           data.smartAudioProfiles.profiles.push(catcher);
           await db.update(userPreferences).set({ dataJson: JSON.stringify(data) }).where(eq(userPreferences.userId, user.userId));
           console.log(`Added to user ${user.userId}`);
        }
      }
    }
  }
}
main().catch(console.error);
