import express from "express";
import multer from "multer";
import { Prisma, Document } from "@prisma/client";
import { prisma, pgvector } from "../lib/db";
import { parseFile } from "../lib/parser";
import { chunkDocument } from "../lib/chunker";
import { embedTexts } from "../lib/embeddings";
import { uploadBuffer } from "../lib/cloudinary";

const router = express.Router();

const upload = multer({
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || "20") * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

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
router.post("/", upload.single("file"), async (req, res) => {
  const userId = (req as any).userId;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const document = await prisma.document.create({
      data: {
        userId,
        originalName: file.originalname,
        fileSize: file.size,
        status: "processing",
      },
    });

    // Upload to Cloudinary
    const secureUrl = await uploadBuffer(file.buffer, file.originalname, file.mimetype);
    await prisma.document.update({
      where: { id: document.id },
      data: { cloudinaryUrl: secureUrl },
    });

    // Background processing — do not await before responding
    processDocument(document.id, userId, file.buffer, file.mimetype).catch((err) => {
      console.error(`Document ${document.id} processing failed:`, err);
      prisma.document
        .update({
          where: { id: document.id },
          data: { status: "failed", errorMessage: err.message },
        })
        .catch((e) => console.error("Failed to update error status:", e));
    });

    return res.status(202).json({
      id: document.id,
      status: "processing",
      message: "Document uploaded and processing started",
    });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: "Upload failed" });
  }
});

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
  const chunkSize = parseInt(process.env.CHUNK_SIZE || "1000");
  const chunkOverlap = parseInt(process.env.CHUNK_OVERLAP || "150");
  const chunks = chunkDocument(pages, chunkSize, chunkOverlap);

  if (chunks.length === 0) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "failed", errorMessage: "No text extracted" },
    });
    return;
  }

  // 3. Embed in batches
  const batchSize = parseInt(process.env.EMBEDDING_BATCH_SIZE || "32");
  const contents = chunks.map((c) => c.content);

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
  }

  // 4. Mark ready
  await prisma.document.update({
    where: { id: documentId },
    data: { status: "ready", pageCount: pages.length },
  });
}

// GET /api/documents — list user's documents
router.get("/", async (req, res) => {
  const userId = (req as any).userId;
  const documents = await prisma.document.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ documents: documents.map(serializeDocument) });
});

// DELETE /api/documents/:id — cascades chunks + messages
router.delete("/:id", async (req, res) => {
  const userId = (req as any).userId;
  const { id } = req.params;

  const result = await prisma.document.deleteMany({
    where: { id, userId },
  });

  if (result.count === 0) {
    return res.status(404).json({ error: "Document not found" });
  }

  return res.json({ message: "Document deleted", id });
});

export default router;
