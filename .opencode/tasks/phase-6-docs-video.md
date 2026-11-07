# Phase 6: Docs & Video (~45 min)
## Goal
Complete README, verify fresh-clone build, record demo video, push repo.

## Agent Assignments

### frontend-agent
- Fill every `TODO` in README: setup, keys, stack, architecture, chunking & retrieval, isolation, limitations, AI tool usage
- Ensure demo video link (5 min max) in README or submission email

### backend-agent
- Run `docker compose up --build` from a **fresh clone** to confirm README steps work
- Verify smoke test passes on fresh clone

### reviewer-agent (review gate after Phase 6)
- Verify all TODOs gone from README
- Verify no secrets in git history (`git log -p | grep -i "sk-"`)

### Bonus (only if time remains, in order)
1. Eval script (30 min): 10 Q&A JSON, call API, compare, print x/10 — backend-agent
2. Hybrid search (45 min): tsvector + GIN + RRF — database-agent + backend-agent
3. Multi-document chat (1 h): `document_ids` list, `WHERE document_id = ANY(...)` — backend-agent + database-agent

## Cut Order (if time runs short)
1. Bonuses
2. Fancy UI polish
3. Isolation test file (but still test manually)
**Never cut:** auth verification, user scoping, "couldn't find" behavior, README

## Deliverables
- Complete README (no TODOs)
- Fresh-clone `docker compose up --build` verified
- Demo video link
- Repo pushed (public or shared), no secrets in git history

## Dependencies
- All prior phases complete

## Acceptance Criteria
- Fresh clone builds and runs end-to-end
- README complete
- Two-user isolation verified
- No secrets in git history