# Phase 1: Auth & Skeleton (~45 min)
## Goal
Authenticated Express backend + Next.js frontend; `GET /api/documents` returns `401` without token and `[]` with a valid Clerk token.

## Agent Assignments

### frontend-agent
- Next.js `<ClerkProvider>` in `layout.tsx`
- `middleware.ts` with `clerkMiddleware`
- `/sign-in` and `/sign-up` pages
- `<UserButton />` component
- `api.ts` helper that attaches a fresh Clerk token (`useAuth().getToken()`) to every request
- `"use client"` on any component using `useAuth()` / `fetch`

### backend-agent
- Express + TypeScript server with `clerkMiddleware()`
- `requireUser` middleware: call `getAuth(req).userId`, return `401` if empty
- `GET /api/health` endpoint
- CORS enabled for `http://localhost:3000`

### database-agent
- No schema work yet (Phase 2). Standby.

### reviewer-agent (review gate after Phase 1)
- Verify `userId` sourced from `getAuth(req).userId` (token `sub`)
- Confirm no Clerk redirecting `requireAuth()` used on API routes
- Confirm `NEXT_PUBLIC_*` vars are not used on the backend

## Deliverables
- `middleware.ts` (Next.js)
- `layout.tsx` with `<ClerkProvider>`
- `/sign-in`, `/sign-up` pages
- `<UserButton />`
- `api.ts` with fresh-token attachment
- Express `clerkMiddleware` + `requireUser`
- `GET /api/health`
- CORS config

## Dependencies
- Phase 0 complete (repo, docker-compose, OpenRouter smoke test)

## Acceptance Criteria
- `GET /api/documents` returns `401` without a token
- `GET /api/documents` returns `[]` with a valid Clerk token
- Sign-in / sign-up pages load
- Frontend can attach a fresh Clerk token to requests