import express from "express";
import { prisma } from "../lib/db";

const router = express.Router();

// GET /api/messages/:document_id — chat history for a document
router.get("/:document_id", async (req, res) => {
  const userId = (req as any).userId;
  const { document_id } = req.params;

  // Verify ownership
  const document = await prisma.document.findFirst({
    where: { id: document_id, userId },
    select: { id: true },
  });
  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  const messages = await prisma.message.findMany({
    where: { documentId: document_id, userId },
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
});

export default router;
