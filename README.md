# IntelliBooks — RAG Document Q&A

Upload PDF, DOCX or TXT documents (up to 20 MB) and ask questions about them. Answers are
**grounded strictly in the selected document**, streamed token-by-token, and show the source
passages (with page numbers) they came from. When the answer isn't in the document, the app says
so instead of guessing.

Built with **Next.js · Express · PostgreSQL + pgvector · Prisma · Clerk · Groq · Google Gemini**.

---

## Table of contents

1. [Stack and why](#stack-and-why)
2. [AI providers and why](#ai-providers-and-why)
3. [Architecture](#architecture)
4. [Setup](#setup)
5. [API keys](#api-keys)
6. [Environment variables](#environment-variables)
7. [Chunking and retrieval](#chunking-and-retrieval)
8. [Data isolation](#data-isolation)
9. [API reference](#api-reference)
10. [Tests](#tests)
11. [Known limitations / assumptions](#known-limitations--assumptions)
12. [How AI tools were used](#how-ai-tools-were-used)
13. [Demo](#demo)
14. [License](#license)

---

## Stack and why

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router), React, TypeScript, Tailwind | Fast, typed, good streaming and routing ergonomics |
| Frontend auth | `@clerk/nextjs` (`ClerkProvider`, `useAuth().getToken()`, `<UserButton />`) | Managed sign-up / sign-in / sign-out |
| Backend | Express + TypeScript | Small, explicit REST API; easy to reason about in a review |
| Backend auth | `@clerk/express` (`clerkMiddleware`, `getAuth`) | Verifies the Clerk session JWT on every request |
| Database | PostgreSQL 16 + pgvector | Stores documents, chunks (with embeddings) and chat history in one place |
| ORM | Prisma (migrations) | Typed data access + reproducible schema |
| Vector search | `vector(768)` + cosine distance (`<=>`) | Exact nearest-neighbour scan; simple and accurate at this scale |
| Embeddings | Google Gemini `gemini-embedding-001` (768 dims) | Free tier, batch endpoint, configurable dimensions |
| Chat LLM | Groq `openai/gpt-oss-20b` | Free tier, very fast streaming, OpenAI-compatible SDK |
| Streaming | SSE (`text/event-stream`) → `fetch` + `ReadableStream` | Token-by-token answers like ChatGPT |
| File parsing | `pdf-parse` (PDF, per page), `mammoth` (DOCX), UTF-8 (TXT) | Extracts text while preserving page numbers where available |
| File archival | Cloudinary (optional) | Keeps a copy of the original file; upload works even when unset |

---

## AI providers and why

The task encouraged OpenRouter's free models. We chose **Groq** for chat and **Google Gemini** for
embeddings instead, because:

- Both have a **free tier with no credit card**, matching the "free models" requirement.
- Groq's free streaming tier is stable and extremely fast, which makes the live-streaming demo
  reliable; OpenRouter free models were frequently busy / rate-limited at the time of building.
- Gemini's `batchEmbedContents` lets us embed many chunks in **one batched request** and lets us
  pin the output dimension (`outputDimensionality=768`) so it matches the DB column exactly.
- Both are plain HTTP APIs with retry/backoff on `429/5xx` (see `backend/src/lib/embeddings.ts` and
  `backend/src/lib/groq.ts`), and the UI shows a clear "rate limited, try again" message.

Swapping providers is isolated to `backend/src/lib/embeddings.ts` and `backend/src/lib/groq.ts`;
the prompt builder (`backend/src/lib/llm.ts`) is provider-neutral. To use OpenRouter instead, point
its SDK/base URL at `https://openrouter.ai/api/v1` and set the model names in `.env`.

**Embedding dimensions:** `EMBEDDING_DIMS` **must equal** the `vector(N)` column in
`backend/prisma/schema.prisma`. Both are currently **768**.

---

## Architecture

```
┌─────────────────┐      ┌──────────────────────┐      ┌─────────────────────┐
│   Browser       │      │   Express API        │      │  PostgreSQL         │
│  (Next.js UI)   │◄────►│  (port 8000)         │◄────►│  + pgvector         │
│                 │      │                      │      │  (port 5433 host)   │
│ • Clerk token   │      │ • clerkMiddleware    │      │ • documents         │
│ • SSE chat UI   │      │ • requireUser        │      │ • chunks (vector)   │
│ • ReadableStream│      │ • multer upload      │      │ • messages          │
└─────────────────┘      │ • vector retrieval   │      └─────────────────────┘
                         │ • SSE streamer       │
                         └──────────┬───────────┘
                                    │
                    ┌───────────────┼────────────────┐
                    ▼               ▼                ▼
              ┌──────────┐   ┌────────────┐   ┌──────────────┐
              │  Clerk   │   │  Groq      │   │  Gemini      │
              │  (auth)  │   │  (chat)    │   │ (embeddings) │
              └──────────┘   └────────────┘   └──────────────┘
```

### Data flow

**Upload (once per document)**
1. `POST /api/documents` (multipart) with a Clerk Bearer token.
2. Backend inserts the document as `processing` and returns **202 immediately**.
3. Background job parses text **per page**, chunks it (~1000 chars / 150 overlap), embeds in
   **batches**, and stores each chunk with its `page_number` and 768-dim vector.
4. Document becomes `ready` (or `failed` with a safe error message).

**Question (every question)**
1. `POST /api/chat` with `{ document_id, question }` (validated with zod).
2. Backend verifies the document belongs to the signed-in user (404 otherwise).
3. Question is embedded and a **cosine vector search** runs, filtered by `user_id` **and**
   `document_id`, returning the top 5 chunks above `MIN_SCORE`.
4. If nothing passes the threshold, the backend returns
   `"I couldn't find this in the document."` **without calling the LLM**.
5. Otherwise a grounded system prompt + passages is sent to Groq with `stream: true`.
6. Sources are emitted as SSE `event: sources`; tokens as `event: token`; then `event: done`.
7. The user + assistant messages (with sources) are saved so history survives a refresh.

---

## Setup

### Prerequisites
- Docker + Docker Compose
- Clerk account, Groq API key, Google Gemini API key (all free)
- Node 20+ only if you run without Docker

### 1. Configure environment

```bash
git clone https://github.com/05-rahul-vishwakarma/intellibooks.git
cd intellibooks
cp .env.example .env
# edit .env and fill in Clerk / Groq / Gemini keys (see API keys below)
```

### 2. Run everything

```bash
docker compose up --build
```

This starts:
- `db` — PostgreSQL 16 + pgvector (host port **5433**, container port 5432)
- `backend` — Express API on **8000**; applies `prisma migrate deploy` on startup
- `frontend` — Next.js on **3000**

> If you previously ran an older schema version, reset the local database once:
> `docker compose down -v && docker compose up --build`

### 3. Verify
- `GET http://localhost:8000/api/health` → `{ "status": "ok", ... }`
- Open `http://localhost:3000`, sign in, upload a PDF/DOCX/TXT, ask a question.

### Local development (without Docker)

```bash
# Database (or use your own Postgres + pgvector and set DATABASE_URL)
docker compose up -d db

# Backend
cd backend
npm install
npm run prisma:generate
npm run migrate          # prisma migrate deploy + mark interrupted docs failed
npm run dev              # http://localhost:8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev              # http://localhost:3000
```

---

## API keys

Put **all** values in the root `.env` (Docker Compose loads it). Never commit `.env`.

### Clerk (required)
1. Create an app at [clerk.com](https://clerk.com).
2. From **API keys**, copy:
   - `CLERK_SECRET_KEY` → backend (server-side verification)
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` → backend + frontend
3. Redirect URLs: `/sign-in`, `/sign-up`, and `/dashboard` (already in `.env.example`).

### Groq — chat (required)
1. Create a key at [console.groq.com/keys](https://console.groq.com/keys).
2. `GROQ_API_KEY=gsk_...`

### Google Gemini — embeddings (required)
1. Create a key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).
2. `GEMINI_API_KEY=AIza...`
3. Keep `EMBEDDING_MODEL=gemini-embedding-001` and `EMBEDDING_DIMS=768` (must match the DB).

### Cloudinary — original-file archival (optional)
If `CLOUDINARY_*` is omitted, uploads and Q&A still work; originals just aren't archived.

---

## Environment variables

See [`.env.example`](./.env.example) for the full annotated list. Summary:

| Variable | Where | Purpose |
|---|---|---|
| `CLERK_SECRET_KEY` | backend | Verify Clerk session tokens |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | backend + frontend | Clerk app identifier |
| `GROQ_API_KEY`, `GROQ_MODEL` | backend | Chat model |
| `GEMINI_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIMS` | backend | Embeddings (dims must match DB) |
| `CLOUDINARY_*` | backend (optional) | Archive original uploads |
| `DATABASE_URL` | backend | Postgres + pgvector |
| `NEXT_PUBLIC_API_URL` | frontend | Backend base URL |
| `MIN_SCORE`, `TOP_K` | backend | Retrieval threshold / number of chunks |
| `CHUNK_SIZE`, `CHUNK_OVERLAP` | backend | Chunking parameters |
| `MAX_FILE_SIZE_MB` | backend | Upload size limit (20) |
| `FRONTEND_URL` | backend | CORS allowed origin |

---

## Chunking and retrieval

### Chunking
- Text is parsed **per page** (PDF via `pdf-parse`, DOCX via `mammoth`, TXT as one page).
- Each page is split recursively into ~**1,000-character** chunks with ~**150-character overlap**.
- Overlap keeps sentences/paragraphs from being cut across chunks.
- Each chunk stores `page_number`, `content`, `chunk_index`, `user_id`, `document_id`, and a
  768-dim normalized `embedding`.
- PDF page numbers come from the parser. DOCX has no fixed pagination, so it is stored as page 1
  (page numbers are shown "where available", as required).

### Vector search
- The question is embedded with the **same model/task type** as the chunks.
- Query (PG `<=>` = cosine distance):

  ```sql
  SELECT id, page_number, content, 1 - (embedding <=> $1::vector) AS score
  FROM chunks
  WHERE user_id = $2 AND document_id = $3
  ORDER BY embedding <=> $1::vector
  LIMIT $4;
  ```

- `TOP_K = 5`. Chunks with `score < MIN_SCORE` are discarded.

### Grounding / anti-hallucination
- Default `MIN_SCORE = 0.60`. With normalized Gemini embeddings, unrelated text usually scores
  ~0.4–0.6 while relevant passages score ~0.7+. This default lets the honest
  "not in the document" path actually fire.
- If **no** chunk passes the threshold, the backend returns
  `"I couldn't find this in the document."` without calling the LLM.
- The system prompt additionally forbids outside knowledge, requires page citations, and instructs
  the model to use that exact sentence when the answer is absent.
- **Tuning:** run a few known-answer and known-unanswerable questions on a sample doc and adjust
  `MIN_SCORE` in `.env`. Raise it if the model answers things the document doesn't contain; lower it
  if real answers are rejected.

### Why no ANN index?
The embedding is 768 dims, well within pgvector's 2,000-dim limit for HNSW/IVFFlat, so an index
**could** be added. At this scale, per-user/per-document exact scans are fast and simpler, and they
avoid index-build cost during upload. For a large corpus, add `CREATE INDEX ... USING hnsw
(embedding vector_cosine_ops)`.

---

## Data isolation

Authentication is verified server-side on **every** request via `clerkMiddleware` + `requireUser`
(`backend/src/index.ts`). The user id comes from the verified Clerk token — **never** from the
request body.

Every table (`documents`, `chunks`, `messages`) has a `user_id`, and **every query filters on it**:

| Route | Scoping |
|---|---|
| `GET /api/documents` | `WHERE user_id = ?` |
| `GET /api/documents/:id` | `WHERE id = ? AND user_id = ?` → 404 if not owned |
| `DELETE /api/documents/:id` | lookup `id + user_id` → 404 if not owned |
| `POST /api/chat` | verifies document ownership before retrieval |
| `GET /api/messages/:id` | verifies document ownership before reading history |
| Vector search | `WHERE user_id = ? AND document_id = ?` |

`ON DELETE CASCADE` removes chunks and messages when a document is deleted. Cross-user access is
verified by a runnable test (see below): user B gets **404** on every route for user A's document.

---

## API reference

All routes except `/api/health` require `Authorization: Bearer <clerk-session-token>`.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check (no auth) |
| POST | `/api/documents` | Upload multipart `file` (PDF/DOCX/TXT, ≤20 MB) → `202` |
| GET | `/api/documents` | List the caller's documents |
| GET | `/api/documents/:id` | Get one owned document |
| DELETE | `/api/documents/:id` | Delete an owned document (cascades) |
| POST | `/api/chat` | Ask a question → SSE (`sources`, `token`, `done`, `error`) |
| GET | `/api/messages/:document_id` | Chat history for an owned document |

Errors are JSON: `{ "error": "..." }` with `400` (validation), `401` (no auth), `404` (not owned),
`413` (too large), `500` (server). Stack traces are never returned.

---

## Tests

### Provider smoke test
```bash
cd backend
npm run smoke-test
```
Checks that Gemini embeddings and Groq chat respond with the configured models.

### Two-user isolation test
Requires the backend running, the same `DATABASE_URL`, and two Clerk users.

```bash
cd backend
USER_A_ID=user_xxx \
USER_A_TOKEN=<clerk session JWT for A> \
USER_B_TOKEN=<clerk session JWT for B> \
npm run test:isolation
```
Grab session tokens from the browser devtools (`__session` cookie) while signed in as each user.
The test creates a document for user A, then asserts user B gets 404 on read / list / chat /
messages / delete for it, and that A's document survives B's delete attempt.

---

## Known limitations / assumptions

- **Single-document chat**: each conversation is tied to one document (multi-document Q&A is an
  optional bonus that is not implemented).
- **No follow-up context**: each question is answered independently; prior turns are stored but
  not sent to the LLM. A follow-up such as "and the second point?" won't resolve.
- **In-process background processing**: uploads return 202, but parsing/embedding run in the API
  process (no queue/worker). A crash mid-processing leaves the doc `failed` after restart
  (`run-migrations.ts` marks interrupted jobs).
- **DOCX has no page numbers** (stored as page 1).
- **Exact vector scan, no ANN index** (fine for this scale; see above).
- **Free-tier rate limits**: providers can return `429`; the UI shows a retryable message.
- **Assumption**: the review environment uses the provided `.env.example` values; changing the
  embedding model or dimensions requires updating `EMBEDDING_DIMS` **and** the DB `vector(N)`.

---

## How AI tools were used

Developed with **OpenCode** using specialized subagents:

| Agent | Role |
|---|---|
| `backend-agent` | Express routes, Clerk middleware, validation, SSE streaming, error handling |
| `database-agent` | Prisma schema, migrations, chunking, pgvector queries |
| `frontend-agent` | Next.js UI, Tailwind, Clerk integration, streaming client |
| `reviewer-agent` | Read-only review: bugs, security, isolation, migration drift |

The main agent delegated work, integrated results, and fixed issues found in review (migrations,
env wiring, validation, error handling, test harness, docs).

---

## Demo

Repository: **https://github.com/05-rahul-vishwakarma/intellibooks**

> **Demo video:** _TODO — record and paste the link here before submitting._
> The planned 5-minute script:
> 1. Sign in, upload a PDF, show `processing` → `ready`.
> 2. Ask 3–4 questions, including one the document cannot answer (shows
>    "I couldn't find this in the document.").
> 3. Click a source chip to show the full passage and page number.
> 4. Refresh to show chat history persists.
> 5. Sign in as a second user — empty document list; direct access returns 404.
> 6. Quick code walk: Clerk verification, `WHERE user_id`, chunking, retrieval, prompt.

---

## License

MIT
