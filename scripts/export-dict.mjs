import Database from 'better-sqlite3';
import fs from 'fs';

const db = new Database('docstore/sqlite3.db');
const pronunc = db.prepare("SELECT value_json FROM admin_settings WHERE key = 'global_pronunciations'").get();
if (pronunc) {
  fs.writeFileSync('src/lib/server/default_global_pronunciations.json', pronunc.value_json);
} else {
  fs.writeFileSync('src/lib/server/default_global_pronunciations.json', '{}');
}

const defs = db.prepare("SELECT value_json FROM admin_settings WHERE key = 'global_definitions'").get();
if (defs) {
  fs.writeFileSync('src/lib/server/default_global_definitions.json', defs.value_json);
} else {
  fs.writeFileSync('src/lib/server/default_global_definitions.json', '{}');
}

console.log('Exported global libraries to JSON files.');
