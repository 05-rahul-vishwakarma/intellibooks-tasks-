# IntelliBooks — RAG Document Q&A

IntelliBooks is a Retrieval-Augmented Generation (RAG) application that lets you upload documents (PDF, DOCX, TXT) and ask questions against their content. Answers are grounded strictly in your uploaded documents, streamed token-by-token, with source citations and page numbers.

Built with Next.js, Express, PostgreSQL + pgvector (Prisma), Clerk auth, and NVIDIA NIM.

---

## Table of Contents

1. [Stack](#stack)
2. [Architecture](#architecture)
3. [Setup](#setup)
4. [API Keys](#api-keys)
5. [Chunking and Retrieval](#chunking-and-retrieval)
6. [Isolation](#isolation)
7. [Limitations](#limitations)
8. [AI Tool Usage](#ai-tool-usage)
9. [Demo](#demo)
10. [License](#license)

---

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14 (App Router), React, TypeScript, Tailwind CSS |
| Frontend Auth | `@clerk/nextjs` (ClerkProvider, middleware, `<UserButton />`, `useAuth()`) |
| Backend | Express + TypeScript, `@clerk/express` (`clerkMiddleware`, `getAuth`) |
| Database | PostgreSQL 16 + pgvector (`pgvector/pgvector:pg16` Docker image) |
| ORM | Prisma (`@prisma/client` + `prisma migrate`) |
| Vector search | `vector(2048)` column, exact cosine scan (`<=>`), no HNSW/IVFFlat index (see Limitations) |
| Embeddings | NVIDIA NIM OpenAI-compatible API (`nvidia/embed-qa-4`, 2048 dims) |
| Chat LLM | NVIDIA NIM (`nvidia/nemotron-4-340b-instruct`, temperature 0.1, streaming) |
| Streaming | SSE (`text/event-stream`) from Express → `fetch` + `ReadableStream` on client |
| File parsing | `pdf-parse` (PDF), `mammoth` (DOCX), Node `Buffer.toString` (TXT) |
| Container | Docker Compose (db, backend, frontend) |

---

## Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Browser       │      │   Express API    │      │  PostgreSQL     │
│  (Next.js UI)   │◄────►│  (port 8000)     │◄────►│  + pgvector     │
│                 │      │                  │      │  (port 5432)    │
│ • Clerk token   │      │ • clerkMiddleware│      │ • documents     │
│ • SSE chat UI   │      │ • requireUser    │      │ • chunks (vec)  │
│ • ReadableStream│      │ • multer upload  │      │ • messages      │
└─────────────────┘      │ • retrieval SQL  │      └─────────────────┘
                         │ • SSE streamer   │
                         └──────────────────┘
```

### Data flow

**Upload time (once per document):**
1. Frontend POSTs file to `POST /api/documents` with Clerk Bearer token
2. Backend inserts document as `processing`, returns `202` immediately
3. Background task parses per page (pdf-parse/mammoth/txt), chunks (~1000 chars / 150 overlap), embeds in batches of 32 with retry
4. Chunks stored with `vector(2048)` embedding + `page_number` + `user_id`
5. Document marked `ready` or `failed(error)`

**Question time (every question):**
1. Frontend POSTs `{ document_id, question }` to `POST /api/chat` (SSE)
2. Backend verifies `user_id` owns the document (404 otherwise)
3. Question embedded, vector search top-5 filtered by `user_id` + `document_id`
4. Threshold check: if best score < `MIN_SCORE`, returns "I couldn't find this in the document" without calling the LLM
5. Grounded system prompt + passages sent to OpenRouter chat with `stream: true`
6. Tokens streamed as SSE `event: token`; sources sent as `event: sources`; `event: done` at end
7. User + assistant messages saved with sources JSONB

---

## Setup

### Prerequisites
- Docker + Docker Compose
- Node 20+ (for local dev)
- Clerk account + OpenRouter API key

### 1. Clone and configure

```bash
git clone <repo-url>
cd intellibooks
# Create .env with your Clerk and NVIDIA keys (see API Keys below)
# Example: cp .env.example .env  (if you have a template)
```

### 2. Start the stack

```bash
docker compose up --build
```

This starts three services:
- `db` — PostgreSQL 16 with pgvector (port 5432)
- `backend` — Express API (port 8000); runs `prisma migrate deploy` on startup
- `frontend` — Next.js UI (port 3000)

### 3. Verify

- `GET http://localhost:8000/api/health` → `{ status: "ok" }`
- Open `http://localhost:3000`, sign in with Clerk, upload a PDF, ask a question

### Local development (without Docker)

```bash
# Backend
cd backend
# Ensure .env is at project root (one level up) with your keys + DATABASE_URL
npm install
npm run prisma:generate
npm run migrate   # prisma migrate deploy + fail stuck processing docs
npm run dev       # ts-node src/index.ts

# Frontend
cd frontend
# NEXT_PUBLIC_* vars are passed via root .env through Docker Compose build args
npm install
npm run dev   # next dev
```

---

## API Keys

### Clerk
1. Create an app at [clerk.com](https://clerk.com)
2. Copy `CLERK_SECRET_KEY` (sk_test_...) and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (pk_test_...)
3. Add all keys to `.env` (root)

### NVIDIA NIM
1. Create an account at [build.nvidia.com](https://build.nvidia.com)
2. Generate an API key (starts with `nvapi-`)
3. Add `NVIDIA_API_KEY` to `.env`
4. Default models in `.env`: `nvidia/nemotron-4-340b-instruct` (chat) and `nvidia/embed-qa-4` (embeddings)

### Environment variables (`.env`)

```
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
NVIDIA_API_KEY=nvapi-...
CHAT_MODEL=nvidia/nemotron-4-340b-instruct
EMBEDDING_MODEL=nvidia/embed-qa-4
NEXT_PUBLIC_API_URL=http://localhost:8000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/intellibooks
MIN_SCORE=0.30
TOP_K=5
CHUNK_SIZE=1000
CHUNK_OVERLAP=150
MAX_FILE_SIZE_MB=20
```

> **Never commit `.env`.** It is in `.gitignore`.

---

## Chunking and Retrieval

### Chunking
- Documents are parsed **per page** (PDF via `pdf-parse`, DOCX via `mammoth`, TXT as single page)
- Each page is split recursively into ~1,000-character chunks with ~150-character overlap
- Overlap protects sentence/paragraph boundaries from being split across chunks
- Each chunk stores: `page_number`, `content`, `chunk_index`, `user_id`, `document_id`, and a 2,048-dim `embedding`

### Vector search
- Question embedded with the same model as document chunks
- Prisma `$queryRaw`: `SELECT ..., 1 - (embedding <=> $1::vector) AS score FROM chunks WHERE user_id = $2 AND document_id = $3 ORDER BY embedding <=> $1::vector LIMIT 5`
- Cosine distance via pgvector `<=>` operator; score = 1 - distance (higher = more similar)
- `TOP_K = 5` closest chunks returned

### Threshold (grounding / anti-hallucination)
- `MIN_SCORE` (default 0.30) filters retrieved chunks
- If **no** chunk meets the threshold, the backend returns `"I couldn't find this in the document."` **without calling the LLM**
- This prevents the LLM from answering when the document doesn't contain the answer
- System prompt enforces: answer only from passages, cite page numbers, admit when unknown

### Why no vector index?
pgvector HNSW/IVFFlat indexes support at most 2,000 dimensions. Our embedding model produces 2,048 dims, so we use **exact scan** (`ORDER BY embedding <=> ... LIMIT 5`). Per-user/per-document scans are small enough that exact scan is performant. To scale, switch to `halfvec(2048)` + HNSW.

---

## Isolation

Every table (`documents`, `chunks`, `messages`) has a `user_id` column. **Every SQL query filters by `user_id`** — verified by grep across the codebase.

- `GET /api/documents` → `WHERE user_id = $1` (user sees only their docs)
- `DELETE /api/documents/:id` → `WHERE id = $1 AND user_id = $2` (404 if not owned)
- `POST /api/chat` → verifies document ownership before retrieval (404 if not owned)
- `GET /api/messages/:document_id` → verifies ownership (404 if not owned)
- `ON DELETE CASCADE` from `documents` → `chunks` and `messages`

**Two-user isolation test:** `tests/isolation.test.ts` confirms user B gets `404` on every route for user A's document ID.

---

## Limitations

- **No vector index**: exact scan only (2,048-dim embeddings exceed pgvector's 2,000-dim index limit)
- **Single-document chat**: each chat session is tied to one document (multi-document chat is a planned bonus)
- **No follow-up context**: questions are answered independently; conversation history is stored but not injected into retrieval (planned enhancement)
- **File size limit**: 20 MB maximum upload
- **Supported types**: PDF, DOCX, TXT only
- **Free OpenRouter models**: may rate-limit (429); client shows retryable error with "Try again"
- **Embedding dimension**: 2,048 dims; if you switch models, update `vector(2048)` column and `EMBEDDING_MODEL` env var

---

## AI Tool Usage

This project was developed using OpenCode with NVIDIA Nemotron as the underlying model, organized around four specialized subagents:

| Agent | Role |
|-------|------|
| `frontend-agent` | Next.js UI, Tailwind, Clerk frontend integration, API consumption |
| `backend-agent` | Express routes, Clerk auth middleware, SSE streaming, error handling |
| `database-agent` | PostgreSQL + pgvector schema, migrations, chunking, vector queries |
| `reviewer-agent` | Read-only code review: bugs, security, performance, isolation verification |

The `reviewer-agent` is strictly read-only and never modifies files. The main agent delegates tasks to subagents and integrates results.

---

## Demo

A 5-minute demo video is available at: **[LINK_TO_VIDEO]**

Demo script (from plan.md):
- 0:00 — One sentence on what the app is
- 0:15 — Sign in, upload a PDF, show `processing` → `ready`
- 0:45 — Question 1 (easy fact): show streaming + click a source
- 1:30 — Question 2 (another page): show page number
- 2:00 — Question 3 (follow-up)
- 2:30 — Question 4 **not in document**: show "I couldn't find this in the document"
- 3:00 — Refresh: history still there
- 3:15 — Sign in as second user: empty document list (isolation)
- 3:45 — Code walk: auth, `WHERE user_id`, chunking, prompt
- 4:45 — Close

---

## License

MIT# intellibooks
