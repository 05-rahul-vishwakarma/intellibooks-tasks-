import Groq from "groq-sdk";

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  throw new Error("GROQ_API_KEY is not set");
}

const client = new Groq({ apiKey });

export const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

export interface GroqStreamOptions {
  onToken: (token: string) => void;
  onError?: (err: Error) => void;
}

/**
 * Non-streaming chat completion via Groq.
 */
export async function groqChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[]
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    temperature: 0.1,
    stream: false,
    messages,
  });

  return completion.choices[0]?.message?.content || "";
}

/**
 * Streaming chat completion via Groq. Calls onToken for each delta token.
 * Returns the full assembled response text.
 */
export async function groqStreamChat(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options: GroqStreamOptions
): Promise<string> {
  const { onToken, onError } = options;

  try {
    const stream = await client.chat.completions.create({
      model: GROQ_MODEL,
      temperature: 0.1,
      stream: true,
      messages,
    });

    let fullText = "";
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content || "";
      if (token) {
        fullText += token;
        onToken(token);
      }
    }
    return fullText;
  } catch (err) {
    const status = (err as any)?.status || (err as any)?.response?.status;
    const message = (err as any)?.message || String(err);
    console.error(`Groq LLM error (status=${status}):`, message);
    if (status === 429 || status === 503) {
      const rateErr = new Error("RATE_LIMITED");
      onError?.(rateErr);
      throw rateErr;
    }
    const appErr = new Error(`GROQ_STREAM_FAILED: ${message}`);
    onError?.(appErr);
    throw appErr;
  }
}
