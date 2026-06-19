import { getResolvedRuntimeConfigWithSources } from './src/lib/server/runtime-config.ts';

async function run() {
  try {
    const data = await getResolvedRuntimeConfigWithSources();
    console.log("Values:", data.values.allowedEmails);
  } catch (e) {
    console.error("ERROR:", e);
  }
}
run();
