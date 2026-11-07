const MAX_RETRIES = 4;
const RETRY_BASE_MS = 2000;
const BATCH_SIZE = parseInt(process.env.EMBEDDING_BATCH_SIZE || "50", 10);

const MODEL = process.env.EMBEDDING_MODEL || "gemini-embedding-001";
// Must equal VECTOR(n) in the DB (see prisma/schema.prisma → vector(768)).
const DIMS = Number(process.env.EMBEDDING_DIMS || 768);

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfterMs?: number) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Required when you request fewer than the model's full dimensions
function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / mag);
}

async function embedBatch(texts: string[], taskType: TaskType): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey, // header, not ?key= (keeps the key out of logs)
        },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: `models/${MODEL}`,
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: DIMS,
          })),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        let retryAfter = Number(res.headers.get("retry-after"));
        if (!retryAfter && res.status === 429) {
          try {
            const body = JSON.parse(text);
            const detail = body?.error?.details?.find(
              (d: any) => d["@type"]?.includes("RetryInfo")
            );
            if (detail?.retryDelay) {
              const ms = Number(detail.retryDelay.replace("s", "")) * 1000;
              if (!isNaN(ms)) retryAfter = ms / 1000;
            }
          } catch {}
        }
        throw new HttpError(
          res.status,
          `Gemini embedding failed: ${res.status} ${text}`,
          retryAfter ? retryAfter * 1000 : undefined
        );
      }

      const data = (await res.json()) as { embeddings?: { values: number[] }[] };
      if (!data.embeddings?.length) {
        throw new Error("Gemini embedding response contained no embeddings");
      }
      const vectors = data.embeddings.map((e) => normalize(e.values));
      const wrong = vectors.find((v) => v.length !== DIMS);
      if (wrong) {
        throw new Error(
          `Embedding dimension mismatch: model returned ${wrong.length} dims but EMBEDDING_DIMS=${DIMS}. ` +
            `Make the DB column and EMBEDDING_DIMS agree.`
        );
      }
      return vectors;
    } catch (err) {
      lastError = err;
      const status = err instanceof HttpError ? err.status : undefined;
      const retryable = status === 429 || status === 503 || status === 500;

      if (!retryable || attempt === MAX_RETRIES) throw err;

      const delay = (err as HttpError).retryAfterMs ?? RETRY_BASE_MS * 2 ** (attempt - 1);
      console.warn(`Embedding ${status} (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

// For ingestion: embeds chunks in batches
export async function embedTexts(
  texts: string[],
  taskType: TaskType = "RETRIEVAL_DOCUMENT"
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    out.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE), taskType)));
  }
  return out;
}

// For the user's question
export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text], "RETRIEVAL_QUERY");
  return vec;
}