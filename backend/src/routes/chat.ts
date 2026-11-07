import express from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { retrieveChunks, MIN_SCORE } from "../lib/retrieval";
import { buildSystemPrompt } from "../lib/llm";
import { groqStreamChat } from "../lib/groq";
import { asyncHandler, HttpError } from "../lib/http";

const router = express.Router();

const bodySchema = z.object({
  document_id: z.string().uuid("document_id must be a valid UUID"),
  question: z
    .string()
    .trim()
    .min(1, "question is required")
    .max(2000, "question must be 2000 characters or fewer"),
});

const NOT_FOUND_ANSWER = "I couldn't find this in the document.";

async function persistTurn(
  documentId: string,
  userId: string,
  question: string,
  answer: string,
  sources: unknown[]
) {
  await prisma.$transaction([
    prisma.message.create({
      data: {
        documentId,
        userId,
        role: "user",
        content: question,
        sources: [],
      },
    }),
    prisma.message.create({
      data: {
        documentId,
        userId,
        role: "assistant",
        content: answer,
        sources: sources as Prisma.InputJsonValue,
      },
    }),
  ]);
}

// POST /api/chat — SSE streaming RAG endpoint
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.userId!;

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message || "Invalid request body");
    }
    const { document_id: documentId, question } = parsed.data;

    // Verify the user owns this document (isolation). 404 so we don't leak existence.
    const document = await prisma.document.findFirst({
      where: { id: documentId, userId },
      select: { id: true },
    });
    if (!document) {
      throw new HttpError(404, "Document not found");
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
    // Use the response's close event (not the request's), and only treat it as
    // a disconnect if we didn't finish the response ourselves.
    res.on("close", () => {
      if (!res.writableEnded) clientDisconnected = true;
    });

    let errorSent = false;

    try {
      // 1. Retrieve relevant chunks (scoped to user + document).
      const chunks = await retrieveChunks(question, userId, documentId);

      // 2. Threshold check: if nothing is relevant, say so without calling the LLM.
      if (chunks.length === 0) {
        sendEvent("sources", []);
        sendEvent("token", NOT_FOUND_ANSWER);
        if (!clientDisconnected) {
          await persistTurn(documentId, userId, question, NOT_FOUND_ANSWER, []);
        }
        if (!clientDisconnected) sendEvent("done", {});
        res.end();
        return;
      }

      // 3. Send sources to client.
      const sources = chunks.map((c) => ({
        chunk_id: c.id,
        page_number: c.page_number,
        content: c.content,
        score: c.score,
      }));
      sendEvent("sources", sources);

      // 4. Build grounded prompt and stream the answer.
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
      await groqStreamChat(messages, {
        onToken: (token) => {
          if (clientDisconnected) return;
          assistantText += token;
          sendEvent("token", token);
        },
        onError: (err) => {
          if (errorSent) return;
          errorSent = true;
          if ((err as Error).message === "RATE_LIMITED") {
            sendEvent("error", {
              code: 429,
              message: "The AI provider is rate-limited. Please wait a moment and try again.",
            });
          } else {
            sendEvent("error", { code: 500, message: "Failed to generate answer." });
          }
        },
      });

      if (!clientDisconnected) {
        // 5. Persist the turn with the sources used.
        await persistTurn(documentId, userId, question, assistantText, sources);
        sendEvent("done", {});
      }
      res.end();
    } catch (err) {
      console.error("Chat error:", err);
      if (!clientDisconnected && !errorSent) {
        sendEvent("error", { code: 500, message: "Chat failed. Please try again." });
      }
      res.end();
    }
  })
);

export default router;
