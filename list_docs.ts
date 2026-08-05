import { db } from './src/db';
import { documents } from './src/db/schema';
import { getDocumentBlob } from './src/lib/server/documents/blobstore';

async function main() {
  const docs = await db.select().from(documents);
  console.log("Documents found:");
  for (const doc of docs) {
    console.log(`- ID: ${doc.id}, Title: ${doc.title}, Type: ${doc.type}`);
    if (doc.type === 'pdf') {
       const buf = await getDocumentBlob(doc.id, '');
       console.log(`  Size: ${buf.length} bytes`);
       // write it to a temp file for testing
       require('fs').writeFileSync('temp_test.pdf', buf);
    }
  }
}
main().catch(console.error);
