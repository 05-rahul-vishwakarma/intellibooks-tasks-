# Phase 0: Setup (~30 min)
## Goal
Working repo with Docker (pgvector + backend + frontend), Clerk + NVIDIA keys configured, and a smoke-tested NVIDIA NIM call.

## Agent Assignments

### database-agent
- Confirm `pgvector/pgvector:pg16` image for the `db` service
- Add `CREATE EXTENSION vector` to db startup/init
- Define `vector(2048)` column sizing for embeddings (no HNSW/IVFFlat index over 2,000 dims; use exact scan or halfvec)
- **Boundary:** No destructive DB operations; no migrations yet (schema comes in Phase 2)

### backend-agent
- Create Express + TypeScript project skeleton (`src/`, `tsconfig.json`, `package.json`)
- Create `docker-compose.yml` with `db`, `backend`, `frontend` services
- Set up CORS for `http://localhost:3000`
- Smoke-test script: one NVIDIA embedding call + one chat call (confirm keys, model names, 2048 dims)

### frontend-agent
- Create Next.js App Router scaffold (`app/`, `layout.tsx`, `page.tsx`)
- Add Tailwind CSS config
- Create `.env` at project root with placeholder keys (Clerk, NVIDIA, API URL)

### reviewer-agent (review gate after Phase 0)
- Verify `.env` has no real secrets; confirm `.gitignore` excludes `.env`, `node_modules`
- Review `docker-compose.yml` for port conflicts and correct image

## Deliverables
- `.opencode/tasks/phase-0-setup.md` (this file)
- `docker-compose.yml`
- Express TS skeleton
- Next.js App Router scaffold + Tailwind
- `.env`
- Smoke-test script + confirmed NVIDIA response

## Dependencies
- None (first phase)

## Acceptance Criteria
- `docker compose up --build` starts all three services
- NVIDIA embedding call returns 2048-dim vector
- NVIDIA chat call returns a completion
- `.env` committed (no secrets), `.env` ignored