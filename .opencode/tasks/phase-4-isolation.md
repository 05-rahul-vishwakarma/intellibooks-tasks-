# Phase 4: Isolation Proof (~30 min)
## Goal
Prove two Clerk users cannot access each other's documents or data.

## Agent Assignments

### backend-agent
- Test with two Clerk accounts (two browsers or incognito)
- `tests/isolation.test.ts`: user B gets `404` on every route for user A's doc id
- Ensure all routes scope by `user_id`

### database-agent
- Grep codebase: confirm **no** SQL lacks `user_id`
- Verify foreign keys and cascades reference `user_id` correctly

### frontend-agent
- Standby (may assist with two-browser manual test)

### reviewer-agent (review gate after Phase 4)
- Verify isolation test passes
- Confirm no cross-user data leakage paths

## Deliverables
- `tests/isolation.test.ts`
- Manual two-user verification
- Grep report confirming all SQL has `user_id`

## Dependencies
- Phase 3 complete (chat + documents with real data)

## Acceptance Criteria
- User B gets 404 on user A's document id
- User B's document list is empty when user A has docs
- All SQL queries filter by `user_id`