import { Readable } from 'stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getS3Config, getS3ProxyClient } from '@/lib/server/storage/s3';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

export class RobustS3Stream extends Readable {
  private bucket: string;
  private key: string;
  private totalSize: number;
  private currentOffset: number;
  private endOffset: number;

  constructor(bucket: string, key: string, startOffset: number, totalSize: number, endOffset?: number) {
    super();
    this.bucket = bucket;
    this.key = key;
    this.totalSize = totalSize;
    this.currentOffset = startOffset;
    this.endOffset = endOffset !== undefined ? endOffset : totalSize - 1;
  }

  _read() {
    if (this.currentOffset > this.endOffset) {
      this.push(null);
      return;
    }

    const fetchEnd = Math.min(this.currentOffset + CHUNK_SIZE - 1, this.endOffset);
    const range = `bytes=${this.currentOffset}-${fetchEnd}`;
    this.currentOffset = fetchEnd + 1;

    const client = getS3ProxyClient();
    client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.key,
      Range: range,
    })).then(async (res) => {
      if (!res.Body) {
        this.emit('error', new Error('Empty body returned from S3'));
        return;
      }
      
      try {
        const arr = await res.Body.transformToByteArray();
        this.push(Buffer.from(arr));
      } catch (err) {
        this.emit('error', err);
      }
    }).catch((err) => {
      this.emit('error', err);
    });
  }
}
