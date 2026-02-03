# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FlowPal is an open-source platform for running AI agent workflows on your local machine with a web interface. It uses a filesystem-first approach where workflows live as folder packages in a workspace directory.

## Repository Structure

This is a monorepo (without workspaces) containing:
- **Backend** (root): Express.js + TypeScript + Prisma + SQLite — lives in `src/`
- **Frontend** (`frontend/`): React 19 + TypeScript + Vite — separate `package.json`

The backend serves the built frontend from `frontend/dist/` as static files with SPA fallback routing.

## Commands

### Backend (run from repo root)
```bash
npm run dev              # Dev server with auto-reload (ts-node-dev)
npm run build            # Compile TypeScript to dist/
npm start                # Build + run (tsc && node dist/index.js)
```

### Frontend (run from frontend/)
```bash
npm run dev              # Vite dev server with HMR
npm run build            # TypeScript check + Vite production build
npm run lint             # ESLint
npm run preview          # Preview production build
```

### Database (Prisma, run from repo root)
```bash
npx prisma migrate dev --name <description>   # Create and apply migration
npx prisma migrate reset                      # Reset database (deletes all data)
npx prisma migrate deploy                     # Deploy migrations (production/Docker)
npx prisma studio                             # Visual database browser
```

### Initial Setup
```bash
npm install
cd frontend && npm install && cd ..
cp .env.example .env     # Then fill in values
npx prisma migrate dev
cd frontend && npm run build && cd ..
```

## Architecture

### Backend API Pattern

All authenticated/versioned API routes use the `apiHandler` wrapper from `src/utils.ts`:

```typescript
apiRouter.get("/:version/endpoint", apiHandler(async (req, res) => {
    // req.version, req.userId, req.email, req.name available
}, requireAuth, ["v1"]));
```

`apiHandler` handles: API version validation from the URL path, JWT token verification from `Authorization: Bearer` header, and user lookup from Prisma. The `CustomRequest` type extends Express Request with `version`, `userId`, `email`, and `name`.

### Authentication Flow

Google OAuth 2.0 → JWT tokens (365-day expiry). The flow:
1. `/api/auth/google` → redirects to Google consent
2. `/api/auth/google/callback` → exchanges code, upserts user, creates JWT
3. Redirects to `/auth-success?token={token}` on the frontend
4. Frontend stores token and sends `Authorization: Bearer {token}` on subsequent requests

### Route Structure

All API routes are mounted under `/api` via `apiRouter`. Versioned routes use `/:version/` prefix (currently `v1`). Sub-routers are mounted as `/:version/user`, etc.

Non-API `GET *` requests serve `frontend/dist/index.html` for client-side routing.

### Database

SQLite via Prisma ORM. Schema is at `prisma/schema.prisma` (also duplicated at `src/prisma/schema.prisma`). Currently two tables: `users` and `key_value`. SQLite uses WAL mode for concurrency (configured in `src/prisma/client.ts`).

### Logging

`src/logging.ts` provides `logInfo` and `logError`. Uses LogDNA when `LOGDNA_KEY` is set, otherwise falls back to console.

### Cron Jobs

`src/cronjob/index.ts` exports `startCronJobs()` which is called at server startup.

## Environment Variables

Required: `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
URLs: `API_URL` (default `http://localhost:3000`), `WEBSITE_URL` (same), `DATABASE_URL` (default `file:./dev.db` relative to `prisma/`)
Optional: `LOGDNA_KEY`, `SLACK_BOT_TOKEN`

## Design Direction

Per `plan-single-tenant.md`, FlowPal is evolving toward: a Next.js frontend, PostgreSQL database, WebSocket/SSE for real-time agent communication, and integration with the `opencode` agent running on user machines. Workflows are filesystem-first folder packages with `workflow.json` manifests, `run.py` entrypoints, and per-workflow `.env` + `.venv`.
