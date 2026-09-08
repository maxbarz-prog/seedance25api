import { S3Client, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

// Video/asset storage. With VIDEO_BUCKET set (AWS), outputs are copied from
// the provider into our private S3 bucket and served through short-lived
// presigned URLs, so provider URLs never reach users and expiry is ours to
// control. Without a bucket (local dev / mock providers) the provider URL is
// kept as-is, marked with a "url:" prefix so readers can tell the two apart.

const BUCKET = process.env.VIDEO_BUCKET;
const SIGNED_URL_TTL_S = 3600;
const UPLOAD_LIMITS: Record<string, { ext: string; maxBytes: number }> = {
  "image/jpeg": { ext: "jpg", maxBytes: 10 * 1024 * 1024 },
  "image/png": { ext: "png", maxBytes: 10 * 1024 * 1024 },
  "image/webp": { ext: "webp", maxBytes: 10 * 1024 * 1024 },
  "video/mp4": { ext: "mp4", maxBytes: 50 * 1024 * 1024 },
  "video/quicktime": { ext: "mov", maxBytes: 50 * 1024 * 1024 },
  "audio/mpeg": { ext: "mp3", maxBytes: 15 * 1024 * 1024 },
  "audio/wav": { ext: "wav", maxBytes: 15 * 1024 * 1024 },
};
export const UPLOAD_TYPES = Object.keys(UPLOAD_LIMITS);

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) _s3 = new S3Client({});
  return _s3;
}

export function storageEnabled(): boolean {
  return !!BUCKET;
}

// Liveness probe for the status page: proves the bucket exists and the
// Lambda's role can reach it. Throws on failure so the caller can report why.
export async function storageReachable(): Promise<boolean> {
  if (!BUCKET) return false;
  await s3().send(new HeadBucketCommand({ Bucket: BUCKET }));
  return true;
}

export interface StoredVideo {
  key: string;
  bytes: number;
}

// Copy a provider result into our bucket. Streams so large clips never sit
// fully in memory.
export async function storeVideoFromUrl(
  userId: string,
  jobId: string,
  sourceUrl: string
): Promise<StoredVideo> {
  if (!BUCKET) {
    return { key: `url:${sourceUrl}`, bytes: 0 };
  }
  const res = await fetch(sourceUrl);
  if (!res.ok || !res.body) {
    throw new Error(`fetch of provider output failed: ${res.status}`);
  }
  const key = `videos/${userId}/${jobId}.mp4`;
  const upload = new Upload({
    client: s3(),
    params: {
      Bucket: BUCKET,
      Key: key,
      Body: Readable.fromWeb(res.body as import("stream/web").ReadableStream),
      ContentType: "video/mp4",
    },
  });
  await upload.done();
  const head = await s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  return { key, bytes: head.ContentLength ?? 0 };
}

// Store a server-generated object (e.g. a trimmed reference clip).
export async function storeBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
  if (!BUCKET) throw new Error("storage not configured");
  await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

// Store a finished video we assembled ourselves (a stitched extension)
// under the same key shape as a copied provider output.
export async function storeVideoBuffer(
  userId: string,
  jobId: string,
  body: Buffer
): Promise<StoredVideo> {
  if (!BUCKET) throw new Error("storage not configured");
  const key = `videos/${userId}/${jobId}.mp4`;
  await storeBuffer(key, body, "video/mp4");
  return { key, bytes: body.length };
}

// Resolve a stored key to something a browser (or an upstream provider, for
// reference images) can fetch for the next hour.
export async function readUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  if (key.startsWith("url:")) return key.slice(4);
  if (key.startsWith("http://") || key.startsWith("https://")) return key; // legacy rows
  if (!BUCKET) return null;
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: SIGNED_URL_TTL_S,
  });
}

export async function deleteObject(key: string | null | undefined): Promise<void> {
  if (!key || key.startsWith("url:") || !BUCKET) return;
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// Presigned PUT for input uploads (images, reference video/audio) straight
// from the browser.
export async function presignUpload(
  userId: string,
  contentType: string
): Promise<{ key: string; url: string; maxBytes: number } | null> {
  if (!BUCKET) return null;
  const limit = UPLOAD_LIMITS[contentType];
  if (!limit) return null;
  const key = `uploads/${userId}/${crypto.randomUUID()}.${limit.ext}`;
  const url = await getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 600 }
  );
  return { key, url, maxBytes: limit.maxBytes };
}
