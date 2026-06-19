import { setRuntimeConfigKey } from './src/lib/server/admin/settings.ts';

async function run() {
  try {
    await setRuntimeConfigKey('allowedEmails', ['test@test.com']);
    console.log("SUCCESS");
  } catch (e) {
    console.error("ERROR:", e);
  }
}
run();
