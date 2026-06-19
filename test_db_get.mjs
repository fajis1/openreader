import { getRuntimeConfig } from './src/lib/server/admin/settings.ts';

async function run() {
  try {
    const config = await getRuntimeConfig();
    console.log("Config allowedEmails:", config.allowedEmails);
  } catch (e) {
    console.error("ERROR:", e);
  }
}
run();
