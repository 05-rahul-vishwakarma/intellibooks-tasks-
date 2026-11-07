# IntelliBooks Backend Documentation

A beginner-friendly guide to the IntelliBooks backend — a RAG (Retrieval-Augmented Generation) document Q&A application.

---

## 1. What is IntelliBooks?

IntelliBooks lets users upload PDF, DOCX, or TXT documents and then ask questions about them. The backend reads the document, breaks it into pieces, converts those pieces into numbers (embeddings), stores them in a vector database, and when a user asks a question, it finds the most relevant pieces and uses an AI model to generate an answer based only on those pieces.

This is called **RAG** — Retrieval-Augmented Generation.

---

## 2. High-Level Architecture

```
┌─────────────┐      HTTP / SSE      ┌──────────────────────────────┐
│  Frontend   │◄─────────────────────►│   Express Backend (port 8000)│
│  (React)    │                      │  src/index.ts                │
└─────────────┘                      └──────────────┬───────────────┘
                                                   │
                              ┌────────────────────┼────────────────────┐
                              ▼                    ▼                    ▼
                      ┌────────────┐      ┌──────────────┐   ┌──────────────┐
                      │   Clerk    │      │   Prisma     │   │   Cloudinary │
                      │  (Auth)    │      │  (PostgreSQL)│   │   (File Storage)│
                      └────────────┘      └──────┬───────┘   └──────────────┘
                                                 │
                              ┌──────────────────┴──────────────────┐
                              ▼                                     ▼
                      ┌──────────────┐                    ┌──────────────┐
                      │  documents   │                    │    chunks    │
                      │   messages   │                    │   (vectors)  │
                      └──────────────┘                    └──────────────┘
```

---

## 3. Tech Stack & Why Each Choice

| Technology | Role | Why we use it (Beginner Explanation) |
|------------|------|--------------------------------------|
| **Node.js + Express** | Web server / API | JavaScript on the server. Express is minimal and easy to understand — perfect for building REST APIs quickly. |
| **TypeScript** | Type safety | Catches mistakes early (like passing wrong data types). Makes code self-documenting and easier to maintain. |
| **Clerk** | Authentication | Handles sign-up, sign-in, sessions, and user management so we don't have to build secure auth from scratch. |
| **Prisma ORM** | Database toolkit | Lets us talk to PostgreSQL using TypeScript objects instead of raw SQL. Safer and more readable. |
| **PostgreSQL + pgvector** | Database + vector search | Stores documents, chunks, and chat messages. `pgvector` lets us store AI embeddings and search them by similarity (nearest neighbor). |
| **Cloudinary** | File storage | Stores uploaded PDF/DOCX/TXT files in the cloud with a CDN. We don't have to manage disk space on our own server. |
| **Google Gemini** | Embeddings | Turns text into numbers (vectors) so we can search documents by meaning, not just keywords. |
| **Groq** | Chat LLM | Generates human-like answers to user questions. Fast inference (very quick responses). |
| **Multer** | File upload handling | Handles incoming file uploads in Express (parses `multipart/form-data`). |
| **Zod** | Input validation | Checks that incoming request data matches the expected shape before we process it. |
| **dotenv** | Environment variables | Keeps secrets (API keys, database URLs) out of the code and in `.env` files. |
| **SSE (Server-Sent Events)** | Streaming | Lets the backend stream AI response tokens to the frontend one by one, so the user sees the answer typing out in real time. |

---

## 4. Folder Structure

```
backend/
├── src/
│   ├── index.ts           # App entry point. Sets up Express, CORS, Clerk auth, mounts routes.
│   ├── env.ts             # Loads .env files from multiple possible locations.
│   ├── lib/
│   │   ├── db.ts          # Prisma client singleton (database connection).
│   │   ├── groq.ts        # Groq chat service (streaming + non-streaming).
│   │   ├── llm.ts         # NVIDIA LLM service (kept as fallback/alternative).
│   │   ├── embeddings.ts  # Gemini embedding service (text → vectors).
│   │   ├── parser.ts      # Extracts text per page from PDF/DOCX/TXT.
│   │   ├── chunker.ts     # Splits text into overlapping chunks.
│   │   ├── retrieval.ts   # Vector search: finds relevant chunks for a question.
│   │   └── cloudinary.ts  # Uploads file buffers to Cloudinary.
│   └── routes/
│       ├── documents.ts   # Upload, list, delete documents. Background processing.
│       ├── chat.ts        # RAG chat endpoint (SSE streaming).
│       └── messages.ts    # Fetch chat history for a document.
├── prisma/
│   └── schema.prisma      # Database schema (Document, Chunk, Message models).
├── .env                   # Environment variables (API keys, DB URL, etc.).
├── package.json           # Dependencies and scripts.
├── tsconfig.json          # TypeScript configuration.
└── Dockerfile             # Container setup for deployment.
```

---

## 5. Authentication Flow (Clerk)

Every request to the backend must be authenticated.

1. The frontend signs the user in via Clerk.
2. Clerk gives the frontend a JWT (JSON Web Token).
3. The frontend sends this token in the `Authorization` header on every API call.
4. Backend middleware (`clerkMiddleware` from `@clerk/express`) verifies the token.
5. `requireUser` extracts `userId` from the token and attaches it to `req.userId`.
6. If no valid user, the backend returns `401 Unauthorized`.

**Why?** So users can only see and modify their own documents — data isolation.

---

## 6. Detailed Flow: Document Upload & Processing

**Endpoint:** `POST /api/documents`

### Step-by-step:

1. **Request arrives** — Frontend sends a file (PDF/DOCX/TXT) with `multipart/form-data`.
2. **Multer handles upload** — Validates file type (PDF/DOCX/TXT only) and size (max 20 MB).
3. **Create document record** — A row is inserted into the `documents` table with `status = "processing"`.
4. **Immediate response** — Backend returns `202 Accepted` to the frontend right away. The user doesn't have to wait for processing.
5. **Background processing** (fire-and-forget, not awaited):
   - **Parse** (`src/lib/parser.ts`) — Extracts text page-by-page using `pdf-parse`, `mammoth` (DOCX), or plain text reader.
   - **Chunk** (`src/lib/chunker.ts`) — Splits each page's text into overlapping chunks (~1000 characters, 150 overlap) so context isn't lost at boundaries.
   - **Embed** (`src/lib/embeddings.ts`) — Sends each chunk's text to Google Gemini (`gemini-embedding-001`) which converts it into a 768-dimensional vector (a list of numbers).
   - **Store** — Inserts chunks into the `chunks` table with their vector embeddings using `pgvector`.
   - **Mark ready** — Updates the document status to `"ready"` and saves `pageCount`.

**Why background processing?** Parsing, chunking, and embedding can take several seconds. We don't want the HTTP request to time out, so we respond immediately and process in the background.

**Cloudinary:** The raw file buffer is also uploaded to Cloudinary so we have a permanent URL (`cloudinary_url`) to the original file if needed later.

---

## 7. Detailed Flow: Chat / RAG Query

**Endpoint:** `POST /api/chat` (uses Server-Sent Events for streaming)

### Step-by-step:

1. **Request arrives** — Frontend sends `{ document_id, question }`.
2. **Ownership check** — Backend verifies the document belongs to the authenticated user (`userId` from Clerk). Returns `404` if not found or not owned.
3. **SSE setup** — Sets `Content-Type: text/event-stream` headers so the frontend can receive a stream of events.
4. **Retrieve** (`src/lib/retrieval.ts`) —
   - Embeds the user's question using Gemini (same embedding model used for chunks).
   - Runs a vector similarity search (`cosine distance`) in PostgreSQL using `pgvector`, scoped to `user_id + document_id`.
   - Returns top 5 chunks (`TOP_K=5`) with similarity score ≥ 0.30 (`MIN_SCORE`).
5. **Grounding check** — If no chunks meet the score threshold, the backend replies: *"I couldn't find this in the document."* (No LLM call — prevents hallucination.)
6. **Send sources** — Sends the retrieved chunks (with page numbers and scores) to the frontend via SSE `sources` event.
7. **Build prompt** (`src/lib/llm.ts`) — Creates a system prompt that instructs the AI to:
   - Answer ONLY from the provided passages.
   - Cite page numbers.
   - Admit if the answer isn't in the document.
8. **Stream LLM** — Sends the prompt + question to Groq (`openai/gpt-oss-20b`) with streaming enabled. Each token is sent to the frontend via SSE `token` events as it's generated.
9. **Save messages** — After streaming completes, saves the user message and assistant message (with sources) to the `messages` table.

**Why SSE?** AI responses take time to generate. Streaming lets the user see words appear one by one instead of waiting for the full answer.

**Why Groq?** Very fast inference, OpenAI-compatible API, and cost-effective for this use case.

---

## 8. Detailed Flow: Chat History

**Endpoint:** `GET /api/messages/:document_id`

1. Verify document ownership.
2. Fetch all messages for that document, ordered by creation time (oldest first).
3. Return them as JSON so the frontend can display the conversation history.

---

## 9. Detailed Flow: Delete Document

**Endpoint:** `DELETE /api/documents/:id`

1. Verify the document exists and belongs to the user.
2. Delete the document row.
3. Because of Prisma `onDelete: Cascade`, all related `chunks` and `messages` are automatically deleted too.
4. Return success message.

---

## 10. Database Schema (Prisma)

Defined in `prisma/schema.prisma`. Three main tables:

### `documents`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | Text | Clerk user ID (owner) |
| original_name | Text | Original filename |
| file_size | Int | File size in bytes |
| cloudinary_url | Text? | URL to file on Cloudinary |
| status | Text | `processing`, `ready`, or `failed` |
| error_message | Text? | Error if processing failed |
| page_count | Int | Number of pages extracted |
| created_at / updated_at | Timestamptz | Timestamps |

### `chunks`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| document_id | UUID | FK → documents |
| user_id | Text | Clerk user ID |
| page_number | Int | Which page this chunk came from |
| content | Text | The text chunk |
| chunk_index | Int | Order of this chunk in the document |
| embedding | Vector(768) | Gemini embedding vector |
| created_at | Timestamptz | Timestamp |

### `messages`
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| document_id | UUID | FK → documents |
| user_id | Text | Clerk user ID |
| role | Text | `"user"` or `"assistant"` |
| content | Text | Message text |
| sources | JSON | Array of source chunks used |
| created_at | Timestamptz | Timestamp |

**Indexes:** All tables are indexed on `user_id` for fast, secure queries per user.

---

## 11. Environment Variables Explained

Found in `backend/.env`:

| Variable | Example | Purpose |
|----------|---------|---------|
| `CLERK_SECRET_KEY` | `sk_test_...` | Clerk backend secret for verifying tokens |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_test_...` | Clerk frontend key |
| `CLOUDINARY_CLOUD_NAME` | `dxgapyggk` | Cloudinary cloud identifier |
| `CLOUDINARY_API_KEY` | `...` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | `...` | Cloudinary API secret |
| `GEMINI_API_KEY` | `...` | Google Gemini API key (for embeddings) |
| `EMBEDDING_MODEL` | `gemini-embedding-001` | Gemini embedding model name |
| `EMBEDDING_DIMS` | `768` | Vector dimension size |
| `GROQ_API_KEY` | `gsk_...` | Groq API key (for chat) |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Groq chat model |
| `NVIDIA_API_KEY` | `nvapi_...` | NVIDIA NIM key (kept as fallback) |
| `CHAT_MODEL` | `meta/llama-3.2-90b-vision-instruct` | NVIDIA chat model (fallback) |
| `DATABASE_URL` | `postgresql://...` | Neon PostgreSQL connection string |
| `PORT` | `8000` | Backend server port |
| `FRONTEND_URL` | `http://localhost:3000` | Allowed CORS origin |
| `MAX_FILE_SIZE_MB` | `20` | Max upload size |
| `MIN_SCORE` | `0.30` | Minimum similarity score for RAG |
| `TOP_K` | `5` | Max chunks to retrieve per question |
| `CHUNK_SIZE` | `1000` | Characters per chunk |
| `CHUNK_OVERLAP` | `150` | Overlap between chunks |

**Security note:** Never commit `.env` to version control. API keys and database URLs are secrets.

---

## 12. Key Design Decisions (For Learners)

### Why RAG instead of fine-tuning?
Fine-tuning an AI model on your documents is expensive and slow to update. RAG lets you upload a new document and immediately ask questions about it — no retraining needed.

### Why vector search instead of keyword search?
Keyword search finds exact word matches. Vector search finds **meaning**. A question about "salary" will match a document saying "compensation" even if the word "salary" never appears.

### Why SSE instead of regular JSON?
AI text generation is slow (1–10 seconds). With SSE, the user sees the answer streaming in real time, making the app feel fast and responsive.

### Why process documents in the background?
Upload → Parse → Chunk → Embed → Store can take 5–30 seconds. HTTP requests should be fast. We return `202 Accepted` immediately and let the user continue using the app while processing finishes.

### Why separate `chunks` table?
We don't store the whole document as one vector. We split it into chunks because:
1. Embedding models have token limits.
2. We want to cite specific pages.
3. We only retrieve relevant chunks, not the whole document, saving tokens and cost.

---

## 13. How to Run Locally

```bash
# 1. Navigate to backend
cd backend

# 2. Install dependencies
npm install

# 3. Copy environment variables (create .env if not present)
# Make sure GROQ_API_KEY, GEMINI_API_KEY, DATABASE_URL, Clerk keys are set.

# 4. Generate Prisma client
npx prisma generate

# 5. Set up database (creates tables if they don't exist)
# The schema is already applied to the Neon database.
# For local dev, you can run migrations:
npx prisma migrate dev

# 6. Start development server
npm run dev
# Server runs on http://localhost:8000

# 7. Health check
curl http://localhost:8000/api/health
# → {"status":"ok","service":"intellibooks-backend"}
```

---

## 14. API Summary

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/health` | Health check | No |
| POST | `/api/documents` | Upload a document (returns 202) | Yes |
| GET | `/api/documents` | List user's documents | Yes |
| DELETE | `/api/documents/:id` | Delete a document (cascades) | Yes |
| POST | `/api/chat` | Ask a question (SSE streaming) | Yes |
| GET | `/api/messages/:document_id` | Get chat history | Yes |

---

## 15. Common Beginner Questions

**Q: Where is the frontend?**
A: In the `frontend/` folder at the repo root. It's a Next.js app that calls these backend APIs.

**Q: Can I switch the chat model back to NVIDIA?**
A: Yes. Edit `src/routes/chat.ts` to import `streamChat` from `../lib/llm` instead of `groqStreamChat` from `../lib/groq`. The `llm.ts` service is still intact.

**Q: What happens if embedding fails?**
A: The document status is set to `"failed"` and the error message is saved. The user can delete it and try again.

**Q: How do I add a new file type?**
A: Add a parser function in `src/lib/parser.ts`, add the MIME type to `parseFile`, and update the allowed list in `src/routes/documents.ts` Multer filter.

---

*End of documentation. Happy coding!* 🚀
