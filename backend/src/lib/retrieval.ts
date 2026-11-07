import { prisma, pgvector } from "../lib/db";
import { embedText } from "../lib/embeddings";

export interface RetrievedChunk {
  id: string;
  document_id: string;
  user_id: string;
  page_number: number;
  content: string;
  chunk_index: number;
  score: number;
}

interface ChunkRow {
  id: string;
  document_id: string;
  user_id: string;
  page_number: number;
  content: string;
  chunk_index: number;
  score: number;
}

const TOP_K = parseInt(process.env.TOP_K || "5", 10);

// Minimum cosine similarity for a chunk to count as "in the document".
// Gemini embeddings (normalized) give unrelated passages roughly 0.4–0.6 and
// genuinely relevant passages roughly 0.7+. 0.60 is a conservative default that
// lets the honest "I couldn't find this in the document" path actually fire.
// Tune with MIN_SCORE after running a few known-answer questions on a sample doc.
const MIN_SCORE = parseFloat(process.env.MIN_SCORE || "0.60");

/**
 * Embed a question and run vector search over chunks scoped to user_id + document_id.
 * Returns chunks above MIN_SCORE, or empty array if none are relevant enough.
 */
export async function retrieveChunks(
  question: string,
  userId: string,
  documentId: string
): Promise<RetrievedChunk[]> {
  const questionVector = pgvector.toSql(await embedText(question));

  const rows = await prisma.$queryRaw<ChunkRow[]>`
    SELECT id, document_id, user_id, page_number, content, chunk_index,
           1 - (embedding <=> ${questionVector}::vector) AS score
    FROM chunks
    WHERE user_id = ${userId} AND document_id = ${documentId}::uuid
    ORDER BY embedding <=> ${questionVector}::vector
    LIMIT ${TOP_K}
  `;

  const chunks: RetrievedChunk[] = rows.map((row) => ({
    id: row.id,
    document_id: row.document_id,
    user_id: row.user_id,
    page_number: row.page_number,
    content: row.content,
    chunk_index: row.chunk_index,
    score: Number(row.score),
  }));

  // Grounding threshold: if the best chunk is below MIN_SCORE, the document
  // doesn't contain the answer. Return empty so the caller can say so.
  const relevant = chunks.filter((c) => c.score >= MIN_SCORE);
  return relevant;
}

export { TOP_K, MIN_SCORE };
