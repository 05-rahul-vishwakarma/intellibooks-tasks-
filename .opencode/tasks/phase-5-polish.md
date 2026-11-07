# Phase 5: Polish (~30 min)
## Goal
Hardened UX: 429 handling, responsive layout, streaming UX, clean errors.

## Agent Assignments

### frontend-agent
- 429 message shown in UI (rate limit banner)
- Responsive layout on narrow windows (mobile-friendly chat)
- Send button disabled while streaming (already in Phase 3, verify)
- Auto-scroll chat (already in Phase 3, verify)
- Clean error handling (no stack traces to client)

### backend-agent
- 429 retry with backoff + friendly rate-limit message
- Ensure all error responses are generic (no internal details)

### reviewer-agent (review gate after Phase 5)
- Final review of error handling, security, and UX polish

## Deliverables
- 429 UI state with retry guidance
- Responsive chat layout (mobile + desktop)
- Streaming UX (send disabled, auto-scroll)
- Generic error responses only

## Dependencies
- Phase 4 complete (isolation verified)

## Acceptance Criteria
- 429 shown gracefully in UI with retry-after guidance
- Chat usable on narrow screens (< 640px)
- Send button disabled during stream
- Auto-scroll to bottom when streaming
- No stack traces leaked to client