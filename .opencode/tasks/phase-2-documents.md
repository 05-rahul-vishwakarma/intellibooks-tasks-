# Phase 2: Documents (~1 h 15 min)
## Goal
Upload a PDF/txt, parse it, chunk it, embed it into pgvector, and list/delete documents with status tracking.

## Agent Assignments

### database-agent
- Design `documents` table: `id`, `user_id`, `original_name`, `file_size`, `status` (processing/ready/failed), `error_message`, `created_at`
- Design `chunks` table: `id`, `document_id`, `user_id`, `page_number`, `content`, `embedding` (vector(2048)), `chunk_index`
- `ON DELETE CASCADE` from documents → chunks and messages
- Migration on startup (or migration files)
- Index on `user_id`, `document_id` (foreign keys)
- **Boundary:** No destructive operations without approval

### backend-agent
- `POST /api/documents`: multer upload, validate type/size (20 MB limit), insert `processing`, return 202
- Background processing (non-awaited after 202): parse per page (unpdf for PDF, mammoth for docx, plain txt), chunker (~1000 chars / 150 overlap, recursive split per page)
- Embedding in batches of 32 with retry
- Set `ready` or `failed(error)` when done
- `GET /api/documents` list (name/size/date/status)
- `DELETE /api/documents/:id` (cascades chunks + messages)
- Stuck-row cleanup on startup: mark leftover `processing` as `failed("interrupted")`

### frontend-agent
- Upload button (file input)
- Document list: name, size, date, status badge
- Polling while processing
- Delete document
- Empty and error states

### reviewer-agent (review gate after Phase 2)
- Grep: every SQL query must filter by `user_id`
- Verify upload type/size validation
- Confirm no stack traces leaked to client
- Confirm `ON DELETE CASCADE` present

## Deliverables
- DB schema + migration (`documents`, `chunks`)
- `POST /api/documents` route
- Background parse + chunk + embed pipeline
- `GET /api/documents`, `DELETE /api/documents/:id`
- Upload UI with list, status badge, polling, delete, empty/error states

## Dependencies
- Phase 1 complete (auth, `user_id` available)

## Acceptance Criteria
- Upload a real PDF → see `processing` then `ready`
- `chunks` rows have `page_number` and `user_id`
- `GET /api/documents` returns user's own docs only
- Delete cascades chunks
- Two-user isolation: user B cannot see user A's docs (verified in Phase 4)