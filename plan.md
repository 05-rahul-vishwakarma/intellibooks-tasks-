# PLAN.md: your working plan (private, don't need to submit)

Goal: a working, understood, demo-able app in a few hours. Core first, bonuses only if time remains.

---

## 1. RAG in 5 minutes (the only AI you need to know)

An LLM does not "know" your document. You have to hand it the right pieces at question time.

```
UPLOAD TIME (once per document)
  document ─▶ split into chunks ─▶ turn each chunk into a vector (embedding) ─▶ store in DB

QUESTION TIME (every question)
  question ─▶ turn into a vector ─▶ find the closest chunk vectors ─▶ paste them in the prompt
           ─▶ LLM answers using only those chunks
```

| Term | Plain meaning |
|---|---|
| **Chunk** | A ~1,000-character piece of the document |
| **Embedding** | A list of 2,048 numbers representing the *meaning* of a text. Similar meaning means numbers that are close together |
| **Vector search** | "Find the stored chunks whose numbers are closest to the question's numbers" (cosine distance) |
| **Top-k** | How many closest chunks you take (5) |
| **Grounding** | Forcing the answer to come only from the retrieved chunks |
| **Hallucination** | The LLM confidently making things up. Prevented by the prompt rules plus a similarity threshold |
| **Streaming** | The API sends the answer token by token (`stream=True`), and you forward each token to the browser over SSE |
| **Temperature** | Randomness. Use 0 to 0.2 for factual answers |

Why a threshold? Vector search *always* returns the 5 "closest" chunks, even if none are relevant. If the best score is low, the document doesn't contain the answer. Say so without even calling the LLM.

### The 3 snippets that are the whole AI part

OpenRouter is OpenAI-compatible, so use the `openai` npm package:

```ts
import OpenAI from "openai";
import pgvector from "pgvector";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

// 1. Embeddings (batch = array of strings, in one call)
const emb = await client.embeddings.create({ model: EMBEDDING_MODEL, input: ["chunk1", "chunk2"] });
const vectors = emb.data.map((d) => d.embedding);

// 2. Vector search (pg + pgvector). Always filter by user_id AND document_id
const { rows } = await pool.query(
  `SELECT id, page_number, content, 1 - (embedding <=> $1::vector) AS score
   FROM chunks WHERE user_id = $2 AND document_id = $3
   ORDER BY embedding <=> $1::vector LIMIT 5`,
  [pgvector.toSql(questionVector), userId, docId]
);

// 3. Streaming chat, forwarded to the browser as SSE
res.setHeader("Content-Type", "text/event-stream");
res.setHeader("Cache-Control", "no-cache");
res.flushHeaders();

const stream = await client.chat.completions.create({
  model: CHAT_MODEL, temperature: 0.1, stream: true,
  messages: [
    { role: "system", content: systemPromptWithPassages },
    { role: "user", content: question },
  ],
});
for await (const chunk of stream) {
  const token = chunk.choices[0]?.delta?.content;
  if (token) res.write(`event: token\ndata: ${JSON.stringify(token)}\n\n`);
}
res.write(`event: done\ndata: {}\n\n`);
res.end();
```

---

## 2. Gotchas to know before you start (these will cost you an hour if missed)

1. **pgvector index limit:** `vector` indexes (HNSW / IVFFlat) support at most 2,000 dimensions. The embedding model has 2,048. **Skip the index** (exact scan is fine per user/document) or use `halfvec(2048)`. Explain this choice in the README. It shows understanding.
2. **Check the embedding model page** on openrouter.ai for whether it expects a prefix or `input_type` for queries vs passages. Test with one call first.
3. **Free models fail sometimes.** Always wrap calls with retry + a friendly 429 message. Keep `CHAT_MODEL` in `.env` so you can switch to the Gemma fallback in seconds.
4. **Clerk JWT:** frontend (a client component, `"use client"`) gets the token with `useAuth().getToken()` from `@clerk/nextjs` and sends `Authorization: Bearer ...`. Backend uses `@clerk/express`: `app.use(clerkMiddleware())`, then in a `requireUser` middleware call `getAuth(req).userId` and return `401` if it is empty. Use that `userId` in every query (it is the token's `sub`). Don't use Clerk's redirecting `requireAuth()` for an API. **Call `getToken()` on every request** since tokens expire in about 60 s.
5. **SSE from Express:** set `Content-Type: text/event-stream`, call `res.flushHeaders()`, then `res.write(...)` per token. Stop the LLM stream if the client disconnects (`req.on("close", ...)`). On the frontend use `fetch` + `ReadableStream` (not `EventSource`, because it can't send an Authorization header).
6. **Don't block the server:** parsing and embedding run in an async function you start **without awaiting** after sending the `202`. Parsing a big PDF is CPU work, so process it page by page and `await` between pages (or use `worker_threads`) so the event loop stays free.
7. **Stuck "processing" rows:** on startup, mark any leftover `processing` documents as `failed` ("interrupted").
8. **Deleting:** `ON DELETE CASCADE` handles chunks and messages. Don't forget it.
9. **Docker:** use the `pgvector/pgvector:pg16` image, and run `CREATE EXTENSION vector` on startup.
10. **Never commit `.env`.** Add it to `.gitignore` first.
11. **Next.js specifics:**
    - Keep Next.js as a UI only. Don't build a second backend in Next API routes. The browser calls the Express API directly (`NEXT_PUBLIC_API_URL`) with the Clerk token, so enable CORS on Express for `http://localhost:3000`.
    - Chat, upload and anything using `useAuth()` / `fetch` streaming must be **client components** (`"use client"`).
    - `NEXT_PUBLIC_*` variables are **baked in at build time**. In Docker, pass them as build args (or the frontend will call `undefined`).
    - `clerkMiddleware` in Next needs `CLERK_SECRET_KEY` on the Next.js server too. That is fine, as long as it has no `NEXT_PUBLIC_` prefix.
    - Inside Docker, the browser reaches the API at `localhost:8000`, not the container name `backend`.

---

## 3. Timeline (about 6 hours, adjust to what you have)

Rule: finish each phase end to end before starting the next. A working ugly app beats a half-built pretty one.

### Phase 0: Setup (30 min)
- [ ] Create GitHub repo, `.gitignore` (`.env`, `node_modules`, `.venv`, `__pycache__`)
- [ ] Create Clerk app, copy 3 values. Create OpenRouter key
- [ ] `docker-compose.yml` with `db` (pgvector), `backend`, `frontend`
- [ ] `.env` + `.env.example`
- [ ] **Smoke-test OpenRouter** with a 10-line script: one embedding call, one chat call. Confirms keys, model names and dimension (2048)

### Phase 1: Auth and skeleton (45 min)
- [ ] Frontend: Next.js App Router + `@clerk/nextjs`: `<ClerkProvider>` in `layout.tsx`, `middleware.ts` with `clerkMiddleware`, `/sign-in` and `/sign-up` pages, `<UserButton />`
- [ ] Backend: Express + TypeScript + `clerkMiddleware` + `requireUser` + `/api/health`
- [ ] Frontend `api.ts` that attaches a fresh token
- [ ] Verify: `GET /api/documents` returns `401` without a token and `[]` with one

### Phase 2: Documents (1 h 15 min)
- [ ] DB schema + migration on startup
- [ ] `POST /api/documents`: validate type and size, insert `processing`, return 202
- [ ] Parsing (`unpdf` per page, `mammoth`, txt) with `multer` for uploads (set `limits.fileSize` to 20 MB)
- [ ] Chunker (per page, ~1000/150, recursive split)
- [ ] Embedding in batches of 32 with retry
- [ ] Background task: set `ready` or `failed(error)`
- [ ] `GET` list, `DELETE`
- [ ] UI: upload button, list with name/size/date/status badge, polling while processing, delete, empty and error states
- [ ] Verify: upload a real PDF, see `ready`, check `chunks` rows have page numbers

### Phase 3: Chat and RAG (1 h 30 min)
- [ ] `retrieval.ts`: embed question, SQL top-5 with `user_id` + `document_id`
- [ ] Threshold: print scores for 5 answerable and 5 unanswerable questions, pick `MIN_SCORE` between them
- [ ] `llm.ts`: grounded prompt + streaming
- [ ] SSE endpoint with `sources`, `token`, `done`, `error` events
- [ ] Save messages and sources after streaming ends
- [ ] `GET /messages`
- [ ] UI: chat, token-by-token rendering, loading and error states, source chips, modal with the full passage
- [ ] Verify: answerable question returns correct sources, unanswerable returns the "couldn't find" sentence, refresh keeps history

### Phase 4: Isolation proof (30 min)
- [ ] Test with two Clerk accounts (two browsers or incognito)
- [ ] `tests/isolation.test.ts`: user B gets 404 on every route for user A's doc id
- [ ] Grep that **no** SQL lacks `user_id`

### Phase 5: Polish (30 min)
- [ ] 429 message shown in the UI
- [ ] Responsive layout check on a narrow window
- [ ] Disable the send button while streaming, auto-scroll chat
- [ ] Clean error handling (no stack traces to the client)

### Phase 6: Docs and video (45 min)
- [ ] Fill every `TODO` in `README.md`
- [ ] Run `docker compose up --build` from a **fresh clone** to confirm the README steps work
- [ ] Record the demo (script below)
- [ ] Push, share the repo

### Bonus (only if time is left, in this order)
1. **Eval script (30 min):** easiest and impressive. 10 Q&A JSON, call the API, compare with a keyword match or ask the LLM to judge. Print `x/10`.
2. **Hybrid search (45 min):** add a `tsvector` column plus GIN index, run keyword and vector searches, merge with Reciprocal Rank Fusion.
3. **Multi-document chat (1 h):** make `document_ids` a list, change `WHERE document_id = ANY(...)`, and include the document name in each source.

**If you run out of time, cut in this order:** bonuses, then fancy UI, then the isolation test file (but still test manually). **Never cut:** auth verification, user scoping, "couldn't find" behaviour, README.

---

## 4. Demo video script (5 min max)

| Time | What to show |
|---|---|
| 0:00 | One sentence on what the app is |
| 0:15 | Sign up or sign in, upload a PDF, show `processing` then `ready` |
| 0:45 | Question 1 (easy fact): show streaming and click a source |
| 1:30 | Question 2 (needs another page): show the page number |
| 2:00 | Question 3 (follow-up) |
| 2:30 | Question 4 **not in the document**: show "I couldn't find this in the document" |
| 3:00 | Refresh the page: history is still there |
| 3:15 | Sign in as a second user in another browser: empty document list. Optionally `curl` user A's doc id with user B's token to show 404 |
| 3:45 | Code walk: `auth.ts`, the `WHERE user_id` in `retrieval.ts`, `chunking.ts`, the prompt in `llm.ts` |
| 4:45 | Close |

Pick a short, clear sample document (5 to 15 pages) and write down your 4 questions beforehand.

---

## 5. Prepare for the follow-up call

You'll be asked to explain and maybe change code live. Be ready to answer:

1. **Why that chunk size and overlap?** (precision vs context; overlap protects boundaries)
2. **How do you keep page numbers?** (chunk per page, store `page_number`)
3. **How does an embedding search work?** (vectors, cosine distance, `<=>`)
4. **How do you stop hallucination?** (prompt rules, top-k only, threshold, low temperature, show sources)
5. **Why no vector index?** (2,000 dim limit, small per-document scans; `halfvec` + HNSW to scale)
6. **How is the Clerk token verified?** (JWKS signature, expiry, issuer, `sub`)
7. **What if someone guesses another doc id?** (user-scoped query returns 404)
8. **How does streaming work end to end?** (LLM stream, SSE events, `fetch` reader on the client)
9. **What if a 20 MB file is uploaded?** (202 immediately, background processing)
10. **What happens when OpenRouter returns 429?** (retry with backoff, then friendly message)
11. **Likely live change:** change `top_k`, change chunk size, add a file type, add a filter, change the prompt wording. Know exactly which file each lives in.

---

## 6. Submission checklist

- [ ] Repo is public (or shared with them), **no secrets in git history** (`git log -p | grep -i "sk-"`)
- [ ] `.env.example` committed, `.env` ignored
- [ ] Fresh-clone `docker compose up --build` works
- [ ] README: setup, keys, stack, architecture, chunking and retrieval, isolation, limitations, AI tool usage, all `TODO`s gone
- [ ] Demo video link (5 min max) in the README or the submission email
- [ ] Two-user isolation verified
- [ ] You can explain every file