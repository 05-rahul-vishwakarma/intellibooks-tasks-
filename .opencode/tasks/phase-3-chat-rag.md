# Phase 3: Chat & RAG (~1 h 30 min)
## Goal
Ask questions against a document; get grounded, streamed answers with source citations; handle unanswerable questions.

## Agent Assignments

### database-agent
- Vector search SQL: top-5 chunks, filter by `user_id` AND `document_id`, `ORDER BY embedding <=> $1::vector LIMIT 5`, compute `1 - (embedding <=> $1::vector) AS score`
- Determine `MIN_SCORE` threshold (test 5 answerable + 5 unanswerable questions)
- `messages` table: `id`, `document_id`, `user_id`, `role`, `content`, `created_at`
- `sources` table or JSONB on messages: chunk ids + page numbers

### backend-agent
- `retrieval.ts`: embed question, run vector search SQL, apply threshold
- `llm.ts`: grounded system prompt (answer only from retrieved chunks, low temperature 0.1-0.2), streaming chat via OpenRouter
- SSE endpoint: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `res.flushHeaders()`, events: `token`, `sources`, `done`, `error`
- Handle client disconnect (`req.on("close", ...)`)
- Save messages + sources after streaming ends
- `GET /api/messages/:document_id`
- Retry + friendly 429 message

### frontend-agent
- Chat UI: token-by-token rendering (SSE via `fetch` + `ReadableStream`, not `EventSource`)
- Loading and error states
- Source chips; modal with full passage
- `"use client"` components (uses `useAuth()` + `fetch` streaming)
- Disable send button while streaming; auto-scroll chat

### reviewer-agent (review gate after Phase 3)
- Review grounded prompt rules
- Verify threshold logic (don't call LLM if best score below `MIN_SCORE`)
- Confirm SSE headers and disconnect handling
- Confirm no stack traces to client
- Confirm `user_id` scoped in all chat queries

## Deliverables
- `retrieval.ts`, `llm.ts`
- SSE chat endpoint
- `GET /api/messages`
- Chat UI with streaming, sources, loading/error states
- `messages` + `sources` schema

## Dependencies
- Phase 2 complete (documents + chunks ready)

## Acceptance Criteria
- Answerable question → correct sources returned, streamed answer
- Unanswerable question → "I couldn't find this in the document" (no LLM call)
- Refresh keeps message history
- Source chip opens passage modal