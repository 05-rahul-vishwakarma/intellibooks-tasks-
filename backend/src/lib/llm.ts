export interface Passage {
  page_number: number;
  content: string;
}

/**
 * Build a grounded system prompt that forces the LLM to answer only from the
 * retrieved passages, cite page numbers, and admit when it doesn't know.
 *
 * Provider-neutral on purpose: the chat model is Groq (see `groq.ts`), but this
 * prompt works with any OpenAI-compatible streaming API.
 */
export function buildSystemPrompt(passages: Passage[]): string {
  const context = passages
    .map((p) => `[Page ${p.page_number}]\n${p.content}`)
    .join("\n\n---\n\n");

  return `You are a helpful assistant answering questions based ONLY on the provided document passages.

GROUND RULES:
1. Answer using ONLY the information in the passages below. Do not use outside knowledge.
2. If the answer is not present in the passages, reply exactly: "I couldn't find this in the document."
3. Always cite the page number(s) where you found the information, e.g. "(see page 3)".
4. Be concise and factual. Do not speculate.
5. Never invent facts or cite page numbers that are not in the passages.

DOCUMENT PASSAGES:
${context}

Answer the user's question using only the passages above.`;
}
