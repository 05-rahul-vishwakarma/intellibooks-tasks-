import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

const configured = Boolean(cloudName && apiKey && apiSecret);

if (configured) {
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
} else {
  console.warn(
    "Cloudinary is not configured (CLOUDINARY_* missing); original files will not be archived."
  );
}

export function isCloudinaryConfigured(): boolean {
  return configured;
}

/**
 * Archive the original upload. Returns the secure URL, or `null` when
 * Cloudinary is not configured. Archiving is optional and must never break
 * document ingestion.
 */
export async function uploadBuffer(
  buffer: Buffer,
  filename: string,
  mimetype: string
): Promise<string | null> {
  if (!configured) return null;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        public_id: `intellibooks/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      },
      (error: unknown, result?: { secure_url?: string }) => {
        if (error) return reject(error);
        resolve(result?.secure_url ?? null);
      }
    );
    Readable.from([buffer]).pipe(stream);
  });
}

/**
 * Best-effort deletion of an archived raw file. Failures are logged, never
 * thrown, so a document delete always succeeds.
 */
export async function deleteStoredFile(url: string | null | undefined): Promise<void> {
  if (!configured || !url) return;

  try {
    const match = url.match(/\/raw\/upload\/(?:v\d+\/)?(.+)$/);
    if (!match) return;
    await cloudinary.uploader.destroy(match[1], { resource_type: "raw", invalidate: true });
  } catch (err) {
    console.warn("Cloudinary delete failed:", err);
  }
}

export { cloudinary };
