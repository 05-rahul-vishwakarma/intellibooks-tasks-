import { apiRequest } from "@/lib/api";
import type { ChatSource } from "@/lib/api";

interface StreamChatParams {
  documentId: string;
  question: string;
  token: string | null;
  /** Called with the accumulated answer and sources as chunks arrive. */
  onUpdate: (content: string, sources: ChatSource[]) => void;
}

/**
 * Streams an answer for a question from the backend SSE endpoint.
 * Throws on HTTP failures or server-sent error events.
 */
export async function streamChat({
  documentId,
  question,
  token,
  onUpdate,
}: StreamChatParams): Promise<void> {
  const res = await apiRequest(
    "/api/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document_id: documentId, question }),
    },
    token ?? undefined
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: "Chat failed" }));
    throw new Error((errData as { error?: string }).error || "Chat failed");
  }
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let sources: ChatSource[] = [];

  const handleBlock = (block: string) => {
    const eventLine = block.split("\n").find((line) => line.startsWith("event: "));
    const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
    if (!eventLine || !dataLine) return;

    const eventType = eventLine.replace("event: ", "").trim();
    const rawData = dataLine.replace("data: ", "");

    if (eventType === "sources") {
      try {
        const parsed = JSON.parse(rawData);
        if (Array.isArray(parsed)) sources = parsed as ChatSource[];
      } catch {
        // ignore malformed chunk
      }
    } else if (eventType === "token") {
      try {
        content += String(JSON.parse(rawData));
      } catch {
        // ignore malformed chunk
      }
      onUpdate(content, sources);
    } else if (eventType === "done") {
      onUpdate(content, sources);
    } else if (eventType === "error") {
      let message = "Failed to generate answer. Please try again.";
      try {
        const parsed = JSON.parse(rawData) as { code?: number; message?: string };
        if (parsed.code === 429) {
          message = parsed.message || "Rate limited. Please wait a moment and try again.";
        }
      } catch {
        // ignore malformed chunk
      }
      throw new Error(message);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      if (block.trim()) handleBlock(block);
    }
  }
  if (buffer.trim()) handleBlock(buffer);
}
