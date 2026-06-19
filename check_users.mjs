import Database from 'better-sqlite3';
const db = new Database('docstore/sqlite3.db', { readonly: true });
try {
  const users = db.prepare('SELECT * FROM user').all();
  console.log("Users:", users.length, users);
} catch (e) {
  console.error("Error:", e.message);
}
try {
  const sessions = db.prepare('SELECT * FROM session').all();
  console.log("Sessions:", sessions.length, sessions.slice(0, 2));
} catch (e) {
  console.error("Error:", e.message);
}
