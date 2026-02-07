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
apiRouter.get("/endpoint", apiHandler(async (req, res) => {
    // req.userId, req.email, req.name available
}, true));
```

`apiHandler` handles: API version validation from the URL path, JWT token verification from `Authorization: Bearer` header, and user lookup from Prisma. The `CustomRequest` type extends Express Request with `version`, `userId`, `email`, and `name`.

### Authentication Flow

Email/password auth → JWT tokens (365-day expiry). The flow:
1. `POST /api/auth/signup` — creates user with bcrypt-hashed password, returns JWT
2. `POST /api/auth/signin` — validates credentials, returns JWT
3. Frontend stores token in localStorage and sends `Authorization: Bearer {token}` on subsequent requests
4. Password reset via CLI: `npm run reset-password -- user@example.com` prints a reset URL
5. `POST /api/auth/reset-password` — accepts `{ token, newPassword }` to complete the reset

### Route Structure

All API routes are mounted under `/api` via `apiRouter`.

Non-API `GET *` requests serve `frontend/dist/index.html` for client-side routing.

### Database

SQLite via Prisma ORM. Schema is at `prisma/schema.prisma`. Currently two tables: `users` and `key_value`. SQLite uses WAL mode for concurrency (configured in `src/prisma/client.ts`).

### Logging

`src/logging.ts` provides `logInfo` and `logError`. Both use `console.log` and `console.error` respectively.

### Cron Jobs

`src/cronjob/index.ts` exports `startCronJobs()` which is called at server startup.

## Environment Variables

Required: `JWT_SECRET`, `SERVICE_URL` (default `http://localhost:3000`), `DATABASE_URL` (default `file:./dev.db` relative to `prisma/`)
Optional: `WORKSPACE_DIR` (absolute path or relative to project root, default `./my-workspaces`)

## Design Direction

Per `plan-single-tenant.md`, FlowPal is evolving toward: a Next.js frontend, PostgreSQL database, WebSocket/SSE for real-time agent communication, and integration with the `opencode` agent running on user machines. Workflows are filesystem-first folder packages with `workflow.json` manifests, `run.py` entrypoints, and per-workflow `.env` + `.venv`.
