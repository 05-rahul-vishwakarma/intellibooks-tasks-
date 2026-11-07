import express from "express";
import { z } from "zod";
import { prisma } from "../lib/db";
import { asyncHandler, HttpError } from "../lib/http";

const router = express.Router();

const idSchema = z.string().uuid("document_id must be a valid UUID");

// GET /api/messages/:document_id — chat history for a document
router.get(
  "/:document_id",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const parsed = idSchema.safeParse(req.params.document_id);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid document_id");
    }
    const documentId = parsed.data;

    // Verify ownership before returning any history.
    const document = await prisma.document.findFirst({
      where: { id: documentId, userId },
      select: { id: true },
    });
    if (!document) {
      throw new HttpError(404, "Document not found");
    }

    const messages = await prisma.message.findMany({
      where: { documentId, userId },
      orderBy: { createdAt: "asc" },
    });

    return res.json({
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: m.sources,
        created_at: m.createdAt,
      })),
    });
  })
);

export default router;
