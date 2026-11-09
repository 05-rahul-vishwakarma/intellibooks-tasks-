import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

function sanitize(name: string): string {
  const base = path.basename(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.slice(-120) || "file";
}

/**
 * Persist an uploaded file buffer to local disk.
 * Returns the stored filename (relative to UPLOAD_DIR), or `null` when the
 * buffer is empty. Archiving must never break document ingestion.
 */
export async function saveBuffer(
  buffer: Buffer,
  originalName: string
): Promise<string | null> {
  if (!buffer || buffer.length === 0) return null;

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const storedName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${sanitize(
    originalName
  )}`;
  await fs.writeFile(path.join(UPLOAD_DIR, storedName), buffer);
  return storedName;
}

/**
 * Best-effort deletion of a stored file. Failures are logged, never thrown,
 * so a document delete always succeeds.
 */
export async function deleteStoredFile(
  storedName: string | null | undefined
): Promise<void> {
  if (!storedName) return;

  try {
    await fs.unlink(path.join(UPLOAD_DIR, path.basename(storedName)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Local file delete failed:", err);
    }
  }
}
