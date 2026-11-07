import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

const CHAT_MODEL = process.env.CHAT_MODEL || "meta/llama-3.2-90b-vision-instruct";

export interface StreamToken {
  token: string;
}

export interface LLMStreamOptions {
  onToken: (token: string) => void;
  onError?: (err: Error) => void;
}

/**
 * Build a grounded system prompt that forces the LLM to answer only from the
 * retrieved passages, cite page numbers, and admit when it doesn't know.
 */
export function buildSystemPrompt(passages: { page_number: number; content: string }[]): string {
  const context = passages
    .map((p) => `[Page ${p.page_number}]\n${p.content}`)
    .join("\n\n---\n\n");

  return `You are a helpful assistant answering questions based ONLY on the provided document passages.

GROUND RULES:
1. Answer using ONLY the information in the passages below. Do not use outside knowledge.
2. If the answer is not in the passages, say: "I couldn't find this in the document."
3. Always cite the page number(s) where you found the information, e.g. "(see page 3)".
4. Be concise and factual. Temperature is low for accuracy.
5. Do not hallucinate or make up facts.

DOCUMENT PASSAGES:
${context}

Answer the user's question using only the passages above.`;
}

/**
 * Stream a chat completion from OpenRouter, calling onToken for each delta token.
 * Returns the full assembled response text.
 */
export async function streamChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options: LLMStreamOptions
): Promise<string> {
  const { onToken, onError } = options;

  try {
    const stream = await client.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.1,
      stream: true,
      messages,
    });

    let fullText = "";
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) {
        fullText += token;
        onToken(token);
      }
    }
    return fullText;
  } catch (err) {
    const status = (err as any)?.status || (err as any)?.response?.status;
    const message = (err as any)?.message || String(err);
    console.error(`NVIDIA LLM error (status=${status}):`, message);
    if (status === 429 || status === 402 || status === 503) {
      const rateErr = new Error("RATE_LIMITED");
      onError?.(rateErr);
      throw rateErr;
    }
    const appErr = new Error(`LLM_STREAM_FAILED: ${message}`);
    onError?.(appErr);
    throw appErr;
  }
}

export { CHAT_MODEL };