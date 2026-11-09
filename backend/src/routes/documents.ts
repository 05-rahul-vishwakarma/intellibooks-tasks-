import express from "express";
import multer from "multer";
import { z } from "zod";
import { Prisma, Document } from "@prisma/client";
import { prisma, pgvector } from "../lib/db";
import { parseFile } from "../lib/parser";
import { chunkDocument } from "../lib/chunker";
import { embedTexts } from "../lib/embeddings";
import { deleteStoredFile, saveBuffer } from "../lib/storage";
import { asyncHandler, HttpError } from "../lib/http";

const router = express.Router();

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || "20", 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const FILE_TOO_LARGE_MESSAGE = `File is too large. Please upload a file under ${MAX_FILE_SIZE_MB} MB.`;

const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const upload = multer({
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    const err = new Error("Unsupported file type. Upload a PDF, DOCX or TXT file.") as Error & {
      status?: number;
    };
    err.status = 400;
    cb(err);
  },
});

// Wrap multer so an oversized upload returns a clear, friendly message
// instead of a raw MulterError.
const handleUpload: express.RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: FILE_TOO_LARGE_MESSAGE });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    if (err) {
      const status = (err as { status?: number }).status ?? 400;
      res.status(status).json({ error: (err as Error).message });
      return;
    }
    next();
  });
};

const idSchema = z.string().uuid("id must be a valid UUID");

function serializeDocument(doc: Document) {
  return {
    id: doc.id,
    original_name: doc.originalName,
    file_size: doc.fileSize,
    cloudinary_url: doc.cloudinaryUrl,
    status: doc.status,
    error_message: doc.errorMessage,
    page_count: doc.pageCount,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

// POST /api/documents — upload, insert processing, return 202
router.post(
  "/",
  handleUpload,
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const file = req.file;

    if (!file) {
      throw new HttpError(400, "No file uploaded. Send the file in the `file` field.");
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new HttpError(413, FILE_TOO_LARGE_MESSAGE);
    }

    const document = await prisma.document.create({
      data: {
        userId,
        originalName: file.originalname,
        fileSize: file.size,
        status: "processing",
      },
    });

    // Persist the original file to local disk. Optional: a storage failure
    // must not fail the upload.
    try {
      const storedName = await saveBuffer(file.buffer, file.originalname);
      if (storedName) {
        await prisma.document.update({
          where: { id: document.id },
          data: { cloudinaryUrl: storedName },
        });
      }
    } catch (err) {
      console.error(`Document ${document.id} local store failed:`, err);
    }

    // Background processing — do not await before responding.
    processDocument(document.id, userId, file.buffer, file.mimetype).catch(async (err) => {
      console.error(`Document ${document.id} processing failed:`, err);
      await prisma.chunk.deleteMany({ where: { documentId: document.id } });
      await prisma.document
        .update({
          where: { id: document.id },
          data: {
            status: "failed",
            errorMessage: err instanceof Error ? err.message : "Processing failed",
          },
        })
        .catch((e) => console.error("Failed to update error status:", e));
    });

    return res.status(202).json({
      id: document.id,
      status: "processing",
      message: "Document uploaded and processing started",
    });
  })
);

// Background processing: parse → chunk → embed → store → mark ready/failed
async function processDocument(
  documentId: string,
  userId: string,
  buffer: Buffer,
  mimetype: string
) {
  // 1. Parse per page
  const pages = await parseFile(buffer, mimetype);

  // 2. Chunk per page
  const chunkSize = parseInt(process.env.CHUNK_SIZE || "1000", 10);
  const chunkOverlap = parseInt(process.env.CHUNK_OVERLAP || "150", 10);
  const chunks = chunkDocument(pages, chunkSize, chunkOverlap);

  if (chunks.length === 0) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "failed", errorMessage: "No text extracted" },
    });
    return;
  }

  // 3. Embed in batches
  const batchSize = parseInt(process.env.EMBEDDING_BATCH_SIZE || "32", 10);
  const contents = chunks.map((c) => c.content);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < contents.length; i += batchSize) {
    const batch = contents.slice(i, i + batchSize);
    const vectors = await embedTexts(batch);

    const rows = batch.map((_, j) => {
      const c = chunks[i + j];
      return Prisma.sql`(${documentId}::uuid, ${userId}, ${c.pageNumber}, ${c.content}, ${c.documentChunkIndex}, ${pgvector.toSql(vectors[j])}::vector)`;
    });

    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO chunks (document_id, user_id, page_number, content, chunk_index, embedding)
        VALUES ${Prisma.join(rows)}
      `
    );

    // Pace batches to stay under the free-tier ~100 embeddings/minute quota.
    if (i + batchSize < contents.length) await sleep(650);
  }

  // 4. Mark ready
  await prisma.document.update({
    where: { id: documentId },
    data: { status: "ready", pageCount: pages.length },
  });
}

// GET /api/documents — list user's documents
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const documents = await prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ documents: documents.map(serializeDocument) });
  })
);

// GET /api/documents/:id — fetch one document (scoped to the owner)
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid id");
    }

    const document = await prisma.document.findFirst({
      where: { id: parsed.data, userId },
    });
    if (!document) {
      throw new HttpError(404, "Document not found");
    }
    return res.json(serializeDocument(document));
  })
);

// DELETE /api/documents/:id — cascades chunks + messages
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const parsed = idSchema.safeParse(req.params.id);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid id");
    }
    const id = parsed.data;

    const existing = await prisma.document.findFirst({
      where: { id, userId },
      select: { id: true, cloudinaryUrl: true },
    });
    if (!existing) {
      throw new HttpError(404, "Document not found");
    }

    await prisma.document.delete({ where: { id } });

    // Best-effort cleanup of the archived file; never block the response on it.
    await deleteStoredFile(existing.cloudinaryUrl);

    return res.json({ message: "Document deleted", id });
  })
);

export default router;
