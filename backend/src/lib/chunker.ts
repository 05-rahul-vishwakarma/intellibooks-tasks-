import { randomUUID } from "crypto";

// Recursive character text splitter, per page
// Target ~1000 chars with ~150 char overlap
export interface Chunk {
  pageNumber: number;
  content: string;
  chunkIndex: number;
}

export function chunkPage(
  pageNumber: number,
  text: string,
  chunkSize = 1000,
  overlap = 150
): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return chunks;

  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);

    if (end < clean.length) {
      const lastPeriod = clean.lastIndexOf(". ", end - 100);
      const lastSpace = clean.lastIndexOf(" ", end - 50);
      if (lastPeriod > start && lastPeriod > end - 200) {
        end = lastPeriod + 2;
      } else if (lastSpace > start && lastSpace > end - 100) {
        end = lastSpace + 1;
      }
    }

    const content = clean.slice(start, end).trim();
    if (content) {
      chunks.push({ pageNumber, content, chunkIndex: index++ });
    }

    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }

  return chunks;
}

export function chunkDocument(
  pages: { pageNumber: number; text: string }[],
  chunkSize = 1000,
  overlap = 150
): { documentChunkIndex: number; pageNumber: number; content: string }[] {
  let globalIndex = 0;
  const result: { documentChunkIndex: number; pageNumber: number; content: string }[] = [];

  for (const page of pages) {
    const pageChunks = chunkPage(page.pageNumber, page.text, chunkSize, overlap);
    for (const c of pageChunks) {
      result.push({
        documentChunkIndex: globalIndex++,
        pageNumber: c.pageNumber,
        content: c.content,
      });
    }
  }

  return result;
}