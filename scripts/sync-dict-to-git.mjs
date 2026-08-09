import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';

const PRONUNC_FILE = 'src/lib/server/default_global_pronunciations.json';
const DEFS_FILE = 'src/lib/server/default_global_definitions.json';
const DB_PATH = process.env.SQLITE_DB_PATH || 'docstore/sqlite3.db';

function ensureFileExists(filepath) {
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, '{}');
  }
}

function initDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  return new Database(DB_PATH);
}

function importDefaults() {
  const db = initDb();
  if (!db) return;

  try {
    const getStmt = db.prepare("SELECT value_json FROM admin_settings WHERE key = ?");
    const insertStmt = db.prepare("INSERT INTO admin_settings (key, value_json) VALUES (?, ?)");

    ensureFileExists(PRONUNC_FILE);
    const pronuncRow = getStmt.get('global_pronunciations');
    if (!pronuncRow) {
      const defaultPronunc = fs.readFileSync(PRONUNC_FILE, 'utf8');
      if (defaultPronunc.trim() && defaultPronunc !== '{}') {
        insertStmt.run('global_pronunciations', defaultPronunc);
        console.log('Seeded global_pronunciations from default JSON file.');
      }
    }

    ensureFileExists(DEFS_FILE);
    const defsRow = getStmt.get('global_definitions');
    if (!defsRow) {
      const defaultDefs = fs.readFileSync(DEFS_FILE, 'utf8');
      if (defaultDefs.trim() && defaultDefs !== '{}') {
        insertStmt.run('global_definitions', defaultDefs);
        console.log('Seeded global_definitions from default JSON file.');
      }
    }
  } catch (error) {
    if (error.code === 'SQLITE_ERROR') {
      console.log('Skipping dictionary seeding: Database tables not migrated yet.');
    } else {
      console.error('Failed to seed global dictionaries:', error);
    }
  }
}

function exportToGit() {
  const db = initDb();
  if (!db) {
    console.error(`Database not found at ${DB_PATH}. Run the app first.`);
    return;
  }

  const pronuncRow = db.prepare("SELECT value_json FROM admin_settings WHERE key = 'global_pronunciations'").get();
  if (pronuncRow) {
    fs.writeFileSync(PRONUNC_FILE, pronuncRow.value_json);
    console.log(`Exported global_pronunciations to ${PRONUNC_FILE}`);
  }

  const defsRow = db.prepare("SELECT value_json FROM admin_settings WHERE key = 'global_definitions'").get();
  if (defsRow) {
    fs.writeFileSync(DEFS_FILE, defsRow.value_json);
    console.log(`Exported global_definitions to ${DEFS_FILE}`);
  }

  const cleanup = spawnSync(process.execPath, [
    'scripts/clean-git-pronunciation-library.mjs',
    '--apply',
  ], { stdio: 'inherit' });
  if (cleanup.error) throw cleanup.error;
  if (cleanup.status !== 0) {
    throw new Error(`Dictionary cleanup exited with status ${cleanup.status}.`);
  }
}

const args = process.argv.slice(2);
if (args.includes('--import-defaults')) {
  importDefaults();
} else {
  exportToGit();
}
