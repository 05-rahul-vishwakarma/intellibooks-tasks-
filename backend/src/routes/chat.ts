import express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { retrieveChunks, MIN_SCORE } from "../lib/retrieval";
import { buildSystemPrompt } from "../lib/llm";
import { groqStreamChat } from "../lib/groq";

const router = express.Router();

// POST /api/chat — SSE streaming RAG endpoint
router.post("/", async (req, res) => {
  const userId = (req as any).userId;
  const { document_id, question } = req.body;

  if (!document_id || !question) {
    return res.status(400).json({ error: "document_id and question are required" });
  }

  // Verify the user owns this document (isolation)
  const document = await prisma.document.findFirst({
    where: { id: document_id, userId },
    select: { id: true },
  });
  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  let clientDisconnected = false;
  req.on("close", () => {
    clientDisconnected = true;
  });

  try {
    // 1. Retrieve relevant chunks
    const chunks = await retrieveChunks(question, userId, document_id);

    // 2. Threshold check: if no relevant chunks, say so without calling LLM
    if (chunks.length === 0) {
      sendEvent("sources", []);
      sendEvent("token", "I couldn't find this in the document.");
      sendEvent("done", {});
      res.end();
      return;
    }

    // 3. Send sources to client
    const sources = chunks.map((c) => ({
      chunk_id: c.id,
      page_number: c.page_number,
      content: c.content,
      score: c.score,
    }));
    sendEvent("sources", sources);

    // 4. Build grounded prompt and stream LLM response
    const passages = chunks.map((c) => ({
      page_number: c.page_number,
      content: c.content,
    }));
    const systemPrompt = buildSystemPrompt(passages);

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: question },
    ];

    let assistantText = "";
    await groqStreamChat(
      messages,
      {
        onToken: (token) => {
          if (clientDisconnected) return;
          assistantText += token;
          sendEvent("token", token);
        },
        onError: (err) => {
          if ((err as Error).message === "RATE_LIMITED") {
            sendEvent("error", { code: 429, message: "Rate limited. Please try again shortly." });
          } else {
            sendEvent("error", { code: 500, message: "Failed to generate answer." });
          }
        },
      }
    );

    if (!clientDisconnected) {
      // 5. Save user message + assistant message with sources
      await prisma.message.create({
        data: {
          documentId: document_id,
          userId,
          role: "user",
          content: question,
          sources: [],
        },
      });
      await prisma.message.create({
        data: {
          documentId: document_id,
          userId,
          role: "assistant",
          content: assistantText,
          sources: sources as Prisma.InputJsonValue,
        },
      });

      sendEvent("done", {});
    }
    res.end();
  } catch (err) {
    console.error("Chat error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Chat failed" });
    }
    if (!clientDisconnected) {
      sendEvent("error", { code: 500, message: "Chat failed" });
      res.end();
    }
  }
});

export default router;