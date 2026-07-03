import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
const client = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:8340',
  forcePathStyle: true,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});
async function test() {
  try {
    console.log("Listing...");
    await client.send(new ListObjectsV2Command({ Bucket: 'openreader', Prefix: '' }));
    console.log("List succeeded!");
  } catch (err) {
    console.error("List Error:", err.name);
  }
}
test();
