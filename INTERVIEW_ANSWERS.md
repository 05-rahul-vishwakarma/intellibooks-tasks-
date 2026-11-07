# IntelliBooks — Interview Answers

This document contains answers to technical interview questions about the IntelliBooks project, based on the actual implementation in the codebase.

---

## 1. Chatbot Flow: What happens behind the scenes when a user asks a question?

**Step 1 — Request received.** The frontend (Next.js) sends a `POST /api/chat` request with `{ document_id, question }` and a Clerk auth token. The frontend opens an SSE (Server-Sent Events) connection so it can receive tokens as they stream in.

**Step 2 — Ownership check.** The backend (`backend/src/routes/chat.ts`) verifies that the authenticated `userId` owns the requested `document_id`. It runs `prisma.document.findFirst({ where: { id, userId } })`. If the document doesn't exist or belongs to another user, it returns `404`. This prevents cross-user access.

**Step 3 — Embed the question.** The backend calls `retrieveChunks(question, userId, documentId)` from `backend/src/lib/retrieval.ts`, which calls `embedText(question)` from `backend/src/lib/embeddings.ts`. This hits the Gemini batch embed endpoint (`gemini-embedding-001`, task type `RETRIEVAL_QUERY`, 768 dimensions) and returns a normalized vector.

**Step 4 — Vector search in pgvector.** A raw SQL query runs through Prisma `$queryRaw`:
```sql
SELECT id, document_id, user_id, page_number, content, chunk_index,
       1 - (embedding <=> $questionVector::vector) AS score
FROM chunks
WHERE user_id = $1 AND document_id = $2::uuid
ORDER BY embedding <=> $questionVector::vector
LIMIT 5
```
The `<=>` operator is pgvector's cosine distance. The score `1 - distance` means higher = more similar. `TOP_K` is 5 (configurable via env).

**Step 5 — Relevance threshold.** The backend filters results: only chunks with `score >= MIN_SCORE` (default `0.30`, configurable via env) are kept. This is the grounding guardrail.

**Step 6 — No relevant chunks?** If the filtered list is empty, the backend sends SSE event `"I couldn't find this in the document."` and **does not call the LLM at all**. This prevents hallucination when the document doesn't contain the answer.

**Step 7 — Build grounded prompt.** If relevant chunks exist, `buildSystemPrompt()` from `backend/src/lib/llm.ts` wraps each chunk as `[Page N] ...content...` and instructs the LLM to answer only from the passages, cite page numbers, and admit when it doesn't know.

**Step 8 — Call the LLM.** `groqStreamChat()` from `backend/src/lib/groq.ts` calls the Groq SDK (model `openai/gpt-oss-20b`, temperature `0.1`, streaming enabled) with the system prompt + user question. Tokens stream back as SSE `event: token`.

**Step 9 — Sources + save history.** The `sources` event (chunk IDs, page numbers, content, scores) is sent to the frontend for citations. After streaming finishes, both user and assistant messages (with sources as JSONB) are saved to the `messages` table.

---

## 2. Embedding model, vector dimension, and switching models

**Current setup:**
- **Embedding model:** `gemini-embedding-001` (from Google Gemini API), configured via `EMBEDDING_MODEL` env var.
- **Vector dimension:** `768` (from `EMBEDDING_DIMS` env var).
- The `chunks.embedding` column in Prisma is typed as `Unsupported("vector(768)")` in `backend/prisma/schema.prisma`, meaning the actual column is `vector(768)` managed via migration.

**Note:** The README mentions NVIDIA NIM embeddings (`nvidia/embed-qa-4`, 2048 dims), but the actual code uses Gemini at 768 dims. Always trust the code over the README.

**How to switch to a different embedding model:**
1. Change `EMBEDDING_MODEL` and `EMBEDDING_DIMS` in `.env` to the new model and its dimension.
2. Update the `vector(n)` column in the database to match the new dimension (create a new migration via Prisma).
3. **Re-embed all existing documents.** Old chunk embeddings were generated with the old model and live in a different vector space. You cannot mix embeddings from different models in the same column. You must delete old chunks and re-run the ingestion pipeline (parse → chunk → embed → store) for every document.
4. Ensure the new model supports the same task types (`RETRIEVAL_DOCUMENT` for ingestion, `RETRIEVAL_QUERY` for questions) so query and document vectors remain comparable.
5. If the new model's dimension exceeds pgvector's index limit (2,000 dims for HNSW/IVFFlat), you may need to switch from exact scan to `halfvec` + HNSW, or keep exact scan if per-document scans remain small.

---

## 3. Streaming in Node.js — and debugging "whole answer shows up at once" in production

**How streaming works in IntelliBooks:**
- The backend uses Express with SSE (`Content-Type: text/event-stream`).
- `groqStreamChat()` from `backend/src/lib/groq.ts` calls the Groq SDK with `stream: true`.
- It iterates over the async stream: `for await (const chunk of stream)` and extracts `delta.content` tokens.
- Each token is sent to the client via `res.write(`event: token\ndata: ${JSON.stringify(token)}\n\n`)`.
- The frontend (`frontend/lib/chat.ts`) reads the response body as a `ReadableStream`, decodes text, splits SSE blocks by `\n\n`, and parses `event: token` / `data: ...` to update the UI incrementally.

**If it works locally but the whole answer appears at once in production, check:**
1. **Proxy buffering.** A reverse proxy (Nginx, Cloudflare, AWS ALB, Vercel, etc.) may be buffering the SSE response and flushing it all at the end. Nginx needs `proxy_buffering off;` and `X-Accel-Buffering: no;` header (IntelliBooks already sets `X-Accel-Buffering: no`).
2. **Node.js `res.write` vs `res.end`.** Ensure tokens are written with `res.write()` and not buffered until `res.end()`. IntelliBooks calls `res.flushHeaders()` after setting SSE headers.
3. **Response compression.** If middleware (like `compression`) is applied to the SSE route, it may buffer the entire stream before sending. The SSE route should skip compression.
4. **Client-side parsing.** The frontend may be waiting for the stream to close before rendering. Verify `reader.read()` is processing chunks incrementally and calling `onUpdate` per token.
5. **HTTP/2 or CDN buffering.** Some CDNs buffer streaming responses. Check if a CDN sits between the client and backend.

---

## 4. Uploading a 500MB file — ensuring full embedding and crash recovery

**Current limits:**
- `MAX_FILE_SIZE_MB` defaults to `20` MB in `backend/src/index.ts` (`express.json({ limit: "1mb" })`) and `backend/src/routes/documents.ts` (multer `limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 }`).
- A 500 MB file would be rejected by multer with `LIMIT_FILE_SIZE` (413 error) unless `MAX_FILE_SIZE_MB` is raised to at least 500.

**How to ensure every part is embedded and stored correctly:**
1. **Parse per page.** `parseFile()` from `backend/src/lib/parser.ts` extracts text per page (PDF via `pdf-parse`, DOCX via `mammoth`, TXT as single page). Verify `pageCount` matches expectations.
2. **Chunk per page.** `chunkDocument()` from `backend/src/lib/chunker.ts` splits each page into ~1,000-character chunks with ~150-character overlap, tracking `chunkIndex` and `pageNumber`. Log total chunk count.
3. **Embed in batches.** `embedTexts()` from `backend/src/lib/embeddings.ts` embeds chunks in batches (default 32) with retry logic (4 retries, exponential backoff on 429/500/503).
4. **Insert into DB.** Each batch is inserted with `prisma.$executeRaw` into the `chunks` table with `vector(768)` embedding, `page_number`, `user_id`, `document_id`.
5. **Mark status.** Only after all batches succeed is the document marked `"ready"` with `pageCount`. If any step fails, the document is marked `"failed"` with `errorMessage`.
6. **Verification query.** After processing, run `SELECT count(*) FROM chunks WHERE document_id = ?` and compare against expected chunk count. Also verify `status = 'ready'`.

**If the process crashes halfway:**
- Documents are inserted with `status: "processing"` immediately after upload.
- Processing runs in the background (`processDocument(...).catch(...)`), not awaited before responding `202`.
- If it crashes mid-way, the document stays in `"processing"` forever (no automatic retry or timeout).
- Some chunks may already be inserted (each batch commits independently), but the document is not marked `"ready"`.
- **Fix needed:** Add a startup script or cron job that finds documents stuck in `"processing"` beyond a TTL and either retries processing or marks them `"failed"`. Also consider chunk-level idempotency (e.g., delete existing chunks for a document before re-processing) to avoid duplicates on retry.

---

## 5. Upload failing despite 1GB middleware limit — debugging

**Where limits exist in IntelliBooks:**
- `MAX_FILE_SIZE_MB` env var (default `20`), used by multer in `backend/src/routes/documents.ts`.
- `express.json({ limit: "1mb" })` in `backend/src/index.ts` — this only applies to JSON bodies, not multipart file uploads.
- Cloudinary archival upload (`uploadBuffer`) — separate service with its own limits.

**Debugging steps for a 500MB upload failing despite 1GB allowance:**
1. **Check `MAX_FILE_SIZE_MB`.** Multer uses this env var, not a hardcoded 1GB. If it's still `20` (default), a 500MB file gets `LIMIT_FILE_SIZE` (413). Verify the actual value loaded in production.
2. **Check reverse proxy limits.** Nginx `client_max_body_size`, AWS ALB, Vercel, or Cloudflare may have their own lower body size limits. Return 413 or 502 before Node even sees the request.
3. **Check memory usage.** Multer with `memoryStorage` (default) loads the entire file into RAM as a `Buffer`. A 500MB file plus parsing overhead can exceed Node's default heap limit or container memory (e.g., Docker `mem_limit`, Kubernetes `limits.memory`), causing OOM kill.
4. **Check request timeout.** A 500MB upload over slow network may exceed proxy or Node timeout (`keep-alive timeout`, `request timeout`). The connection closes before upload finishes.
5. **Check Cloudinary.** The archival upload to Cloudinary may fail on large files. IntelliBooks wraps it in try/catch so it doesn't block the upload, but the file URL won't be saved.
6. **Check logs.** Look for `MulterError` with `code: LIMIT_FILE_SIZE`, `EntityTooLarge`, OOM messages, or proxy 502/504 errors.

**Fix:** Use `multer.diskStorage()` or `multer.memoryStorage()` with increased limits, stream the file to temporary storage instead of buffering in RAM, raise `MAX_FILE_SIZE_MB`, and align reverse proxy `client_max_body_size`.

---

## 6. Clerk auth — preventing cross-user document access in chat answers

**Mechanism:**
- Clerk issues a session JWT. The backend verifies it via `clerkMiddleware` from `@clerk/express` in `backend/src/index.ts`.
- `getAuth(req).userId` extracts the authenticated user's ID and sets `req.userId`.
- `requireUser` middleware returns `401` if no `userId`.

**How isolation is enforced in chat:**
1. `POST /api/chat` receives `document_id` and `question` from the body, and `userId` from `req.userId` (set by Clerk middleware).
2. Before retrieval, the backend verifies ownership: `prisma.document.findFirst({ where: { id: document_id, userId } })`. If the document doesn't exist or belongs to another user, returns `404`.
3. `retrieveChunks(question, userId, documentId)` runs SQL with `WHERE user_id = $1 AND document_id = $2::uuid`. Both filters are in the SQL itself — defense in depth.
4. The `chunks` table has `user_id` column and composite indexes on `(user_id, document_id)`.

**Why User B can't see User A's documents:**
- Every query filters by `user_id`. Even if User B guesses User A's `document_id`, the ownership check returns `404`, and the vector search filters by `user_id` so no chunks are returned.
- The `documents`, `chunks`, and `messages` tables all have `user_id` and `ON DELETE CASCADE` relationships.
- The isolation test (`tests/isolation.test.ts`) confirms user B gets `404` on every route for user A's document ID.

---

## 7. Technologies used and why — plus anything dropped

**Stack (from actual code, not just README):**

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router), React, TypeScript, Tailwind CSS | Fast development, SSR/SSO, type safety, Clerk integration |
| Frontend Auth | Clerk (`@clerk/nextjs`) | Drop-in auth, session management, JWT handling |
| Backend | Express + TypeScript | Simple, familiar, easy to add SSE streaming |
| Backend Auth | `@clerk/express` (`clerkMiddleware`, `getAuth`) | Consistent auth across frontend and backend |
| Database | PostgreSQL 16 + pgvector | Single DB for relational data + vector search; no separate vector DB |
| ORM | Prisma | Type-safe DB access, migrations, `@prisma/client` |
| Embeddings | Google Gemini `gemini-embedding-001` (768 dims) | Good quality, batch embed API, retry support |
| LLM | Groq (`openai/gpt-oss-20b`) | Fast inference, streaming support, OpenAI-compatible SDK |
| Vector search | pgvector cosine distance (`<=>`) | Keeps everything in PostgreSQL; exact scan for ≤2,000 dims |
| Streaming | SSE (`text/event-stream`) | Real-time token streaming without WebSocket complexity |
| File parsing | `pdf-parse` (PDF), `mammoth` (DOCX), `Buffer.toString` (TXT) | Lightweight, per-page extraction |
| File storage | Cloudinary (optional archival) | Offloads file storage; upload failure doesn't block ingestion |
| Container | Docker Compose (db, backend, frontend) | Reproducible local dev environment |

**Note on discrepancies:** The README says NVIDIA NIM for both embeddings (`nvidia/embed-qa-4`, 2048 dims) and chat (`nvidia/nemotron-4-340b-instruct`), but the actual code uses **Gemini for embeddings** and **Groq for chat**. There's also an unused `backend/src/lib/llm.ts` pointing at NVIDIA NIM — it appears to be dead code not imported by the chat route.

**Anything tried and dropped:** I don't have direct evidence of technologies that were tried and removed from the codebase. The unused NVIDIA client in `llm.ts` may be an earlier approach that was replaced by Groq, but this is inferred, not confirmed by git history or comments.

---

## 8. Docker on Windows — script file exists inside container but says "does not exist"

**Possible reasons:**

1. **Line endings (CRLF vs LF).** Windows uses `\r\n` (CRLF); Linux containers expect `\n` (LF). A Windows-created shell script has CRLF endings. When Linux tries to execute `./script.sh`, the kernel sees `\r\n` and interprets `\r` as part of the interpreter path (e.g., `/bin/bash\r` not found), producing "file not found" or "bad interpreter."
   - **Fix:** Convert scripts to LF (`dos2unix`, `sed -i 's/\r$//'`, or configure Git `core.autocrlf=false` / `text=eol=lf`).

2. **Working directory mismatch.** The script may be at a different path inside the container than expected. Docker `WORKDIR` may not match where the file was copied.
   - **Fix:** Check `docker exec <container> pwd` and `docker exec <container> ls -la /path/to/script`. Ensure `COPY` or volume mount places the file where the entrypoint expects it.

3. **Volume mount issues (Windows → Docker Desktop).** File permissions or case sensitivity on Windows mounts can prevent execution. Windows file systems are case-insensitive; Linux is case-sensitive.
   - **Fix:** Verify `docker exec <container> ls -la /app/script.sh` shows executable bit (`chmod +x`). Use `COPY` instead of bind mounts for scripts in production images.

4. **Missing shebang or wrong interpreter.** The script may lack `#!/bin/sh` or reference an interpreter not installed in the container (e.g., `#!/bin/bash` in an Alpine image that only has `sh`).
   - **Fix:** Add correct shebang or install the interpreter (`apk add bash` for Alpine).

5. **File copied with wrong context.** `COPY` in Dockerfile may have copied from the wrong host path, or `.dockerignore` excluded it.
   - **Fix:** Check Dockerfile `COPY` source and `.dockerignore`.

**Quick diagnostic:** Run `docker exec <container> ls -la <path>` to confirm the file exists and has execute permissions. Run `docker exec <container> file <path>` to check for CRLF. Run `docker exec <container> cat -A <path>` to see `^M$` line endings (confirming CRLF).

---

## 9. Document updated or deleted, but chatbot answers from old content

**Why this happens:**
- **No update/delete propagation.** IntelliBooks supports `DELETE /api/documents/:id`, which cascades to `chunks` and `messages` via `ON DELETE CASCADE`. However, there is **no PUT/PATCH endpoint** to update a document's content. If a user replaces a file, the old chunks remain in the database.
- **Status not reset on re-upload.** If a document is re-uploaded with the same ID, the old chunks aren't automatically deleted before new ones are inserted. Duplicate or stale chunks accumulate.
- **No versioning.** The `chunks` table has no version or content hash to detect changes.
- **Caching.** If the frontend caches document metadata or sources, stale data may appear even after backend changes.

**How to fix it:**
1. **Add an update endpoint (`PUT /api/documents/:id`).** Before re-processing:
   - Delete existing chunks: `prisma.chunk.deleteMany({ where: { documentId } })`.
   - Re-parse, re-chunk, re-embed, re-insert new chunks.
   - Reset `status` to `"processing"`, then `"ready"` when done.
2. **Content hash.** Store a hash of the file content on the `Document` model. On re-upload, compare the hash; skip processing if unchanged.
3. **Idempotent re-ingestion.** When re-processing a document, always delete old chunks first to avoid duplicates.
4. **Frontend cache invalidation.** After update/delete, invalidate the document list and chat cache so the UI fetches fresh data.

---

## 10. User asks something not in the knowledge base

**What the chatbot does:**
1. The question is embedded and vector search runs against the user's document chunks.
2. `retrieveChunks()` filters results by `MIN_SCORE` (default `0.30`).
3. If **no chunk** meets the threshold, `backend/src/routes/chat.ts` sends SSE events:
   - `event: sources` → `[]` (empty)
   - `event: token` → `"I couldn't find this in the document."`
   - `event: done` → `{}`
4. **The LLM is never called.** This is intentional — it saves cost, avoids latency, and prevents hallucination.
5. The user message and assistant response (with empty sources) are saved to the `messages` table.

**Additionally**, even if chunks are returned, the system prompt (`buildSystemPrompt` in `backend/src/lib/llm.ts`) instructs the LLM:
- "Answer using ONLY the information in the passages below."
- "If the answer is not in the passages, say: 'I couldn't find this in the document.'"
- "Always cite the page number(s)."

So if the LLM determines the retrieved passages don't contain the answer, it should still say it doesn't know, rather than guessing from outside knowledge.
